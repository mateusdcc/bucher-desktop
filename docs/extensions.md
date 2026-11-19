# Extensions

Bücher books can embed interactive **extension blocks**: visualizations and auto-graded exercises that live inside ordinary Markdown. Six extensions ship with the app; the built-in book *The Interactive Extension Showcase* demonstrates all of them.

## Blocks

A block is a fenced code block whose info string is the extension id, with a YAML payload:

````markdown
```ext-math-plot
id: damped-wave
title: A damped wave
functions:
  - expr: exp(-a*x) * sin(x)
params:
  - name: a
    min: 0
    max: 1
    step: 0.05
    value: 0.2
```
````

Rules of thumb:

- **Always set `id:`** — it is the key under which learner progress is stored. Without it, blocks fall back to anchors (`^block-id` paragraph after the block) or positional keys that shift when you edit.
- Payloads are validated with zod before rendering. Malformed blocks show an error card with the exact issues; they never crash the reader.
- Use `|` block scalars for multiline code, diagrams, and SQL.
- Exercise blocks belong in **chapters** (not the introduction). Embed them in a `> [!exercise]` callout to give them a title, hints, and the standard exercise tools — passing the block marks that exercise solved. Standalone exercise fences also become exercises automatically.

## The built-in extensions

| id | Category | What it does |
| --- | --- | --- |
| `ext-mermaid` | visualization | Mermaid diagrams (flowchart, sequence, state, class, …) with zoom/pan and theme-synced colors. |
| `ext-math-plot` | visualization | Canvas plots of functions, parametric curves, and datasets with live parameter sliders and hover readouts. Safe expression parser — no `eval`. |
| `ext-state-stepper` | visualization | Prev/Next/Auto-Play player over snapshot steps: array cells, pointers, highlights, variables, and node/edge state diagrams. |
| `ext-code-lab` | exercise | CodeMirror editor + JavaScript unit tests (visible and hidden) run in an isolated worker with a timeout. All tests pass → exercise solved. |
| `ext-parsons-puzzle` | exercise | Drag/click scrambled lines into order; optional graded indentation and distractor lines; per-line feedback. |
| `ext-sql-lab` | exercise | SQL queries against a fresh seeded alasql database per attempt; result table + grading against expected rows (order-insensitive by default). |

Every block frame offers: collapse, **Reset state**, and **View source and data** (`{}`). Exercise frames show an `Unsolved` / `In Progress` / `Passed` badge.

## Persistence

Block state (slider values, viewport, step position, code + results, puzzle arrangement, queries + verdicts) is stored in the book's `_progress.md` frontmatter under `extensions:`, keyed by `<chapter path>#<block key>`. Writes are debounced and atomic, alongside reading progress and flashcard scheduling. Backing up the book folder backs up learner work.

## Extension Manager

**Settings → Extensions** (or the command palette → *Manage extensions*) lists installed extensions with enable/disable switches. Disabling an extension:

- makes its blocks inert cards in the reader (with an Enable button), and
- removes its AI skill from generation prompts immediately.

**View AI skill** shows the exact instructions, syntax spec, JSON Schema, and few-shot examples an extension contributes; **View composed AI prompt** shows the aggregated section sent to the model.

## AI authoring

When extensions are enabled, *Import with AI*, *Propose a patch*, *Generate solution*, *Explain*, and *Review attempt* receive the composed skill section (see `docs/local-ai.md`, `skills` argument). The model is told when to use each block, the exact YAML syntax, and concrete examples — so generated books use extensions correctly without extra prompting.

## Sandboxing & CSP

- Code Lab executes learner JavaScript in a dedicated same-origin Web Worker (`dist/code-lab-worker.js`). Dangerous globals (`fetch`, `XMLHttpRequest`, `importScripts`, storage, …) are shadowed inside the compiled scope; the worker has no DOM and no Tauri IPC. The main thread terminates the worker after `timeoutMs` (default 5 s).
- SQL Lab runs each attempt on a fresh in-memory alasql database; datasets are author-bounded.
- To compile learner code inside the worker, the app CSP allows `script-src 'self' 'unsafe-eval'` and `worker-src 'self'`. This is the standard interactive-playground trade-off; the worker isolation above contains it. Everything else (no remote scripts, no inline injection, asset protocol scoped to the library) stays locked down.
- JavaScript only in Code Lab for now — TypeScript/Pyodide would require bundling a transpiler/wasm runtime and are deliberately out of scope.

## Developing a new extension

1. Create `src/extensions/<name>.js` exporting a `BucherExtension` (see `src/extensions/types.js`): metadata, `skill`, a zod `schema`, `validate` (use `createValidator`), and `mount(host, props)`.
2. `mount` receives `{ data, savedState, onSaveState, onComplete, onError, theme, readOnly, renderMarkdown }` and returns `{ destroy }`. Persist plain-JSON state; call `onComplete()` when an exercise is solved (after `onSaveState`); release workers/timers/editors in `destroy`.
3. Register it in `src/extensions/builtins.js`.
4. Add few-shot examples that pass your own schema — `npm test` checks every built-in example automatically.
5. Verify with `npm run typecheck`, `npm test`, and a scenario in `scripts/check-extensions-ui.mjs`.

Architecture details and design rationale: `EXTENSIONS_ARCHITECTURE.md`.
