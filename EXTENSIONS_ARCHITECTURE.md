# Bücher Extension System — Architecture

Status: Phase 1 audit & design. Implementation follows in atomic commits (see plan at the end).

## 1. Codebase audit (what exists today)

**Stack.** Tauri 2 desktop app (`src-tauri/`, Rust) + a **vanilla-JS ES-module frontend** (`src/`) bundled by
esbuild (`build.mjs`, entry `src/app.js`, ESM, targets safari16/chrome105). There is **no React and no
TypeScript** in the repo. UI is built with small DOM helpers (`src/ui.js`: `el`, `button`, `iconButton`,
`dialog`, `notice`) and lucide icons. CodeMirror 6 is already a dependency (used by the solution editor,
`src/solution-editor.js`). Rendering: markdown-it + KaTeX + tex2typst (`src/markdown.js`).

**Book model.** Books are folders of Markdown under `Buches/<Title>/` in the app data dir
(`~/Library/Application Support/com.mateusdcc.bucher` on macOS):

- `_index.md` — frontmatter `title`, `description`, `icon`, optional `grading` rubric; body = introduction.
- `concepts/<Name>.md` (+ nested subfolders) — chapters. Frontmatter `name`, `description`, `category`,
  `order`, `icon`, `depends_on`, `block_depends_on`.
- `_progress.md` — YAML frontmatter (`buches_progress: 1`, `chapters: { <relative path>: { read, solved: [nodeIds] } }`,
  `cards: { … }`). Written atomically through a per-path promise queue (`src/model/progress.js`).
- `_solutions/…`, `_notes.md`, `_cards.md` — solution attempts, quick notes, flashcards.

**Parsing pipeline.** `src/model/library.js` adapts Tauri file commands (`load_library`, `save_markdown`
with optimistic-concurrency `expected`, `discard_solution`) to an Obsidian-like `vault`/`metadataCache` API.
`src/model/catalog.js` lists books; `src/model/learning.js` (`LearningIndex`) parses each chapter into
**units** (headings, callouts, text, fenced solutions delimited by `---`) and **nodes** (definitions,
theorems, exercises, language blocks). Exercise node ids are `^<anchor>` (a `^block-id` paragraph after a
block) or positional `type:title#n`. `src/reader.js` renders overview/chapter/exercises views; exercises get
hints, prerequisite links, "Mark solved", a CodeMirror solution editor, and AI actions.

**Markdown rendering.** `renderMarkdown(source, env)` (`src/markdown.js`) first extracts math
(`src/model/math.js` — its tokenizer **already skips fenced code blocks**, so fence payloads are safe),
then renders with custom rules: wiki links, cloze `==…==`, `typst` fences → KaTeX, heading ids, internal
link resolution. `src/app.js#renderText` wraps the HTML into a `.markdown` div; `app.js#render` rebuilds the
article on every navigation/refresh.

**AI pipeline.** Frontend `src/ai.js` builds panels and calls Rust commands via `invoke`. Rust
`src-tauri/src/ai.rs` composes **system prompts server-side** and talks to local Ollama
(`http://127.0.0.1:11434/api/generate`, optional JSON-schema `format`) or ChatGPT (`chatgpt.rs`, Responses
API). Authoring commands: `ai_prepare_import` (Markdown → `{ introduction, chapters[] }` draft, schema
constrained), `ai_import_book` (publish draft), `ai_propose_patch` (`{ original, replacement }`),
`ai_generate_solution`, `ai_explain`, `ai_review_solution`. Provider/model selection lives in
`src/settings.js` (`selectedAi()`, localStorage).

**Settings & tests.** `settingsPage(library, initial)` renders tabbed settings (Library / AI).
`npm test` = `node --test` (model-level integration test over the demo book). `cargo test` covers Rust
library/AI logic. `scripts/check-ai-ui.mjs` runs Playwright Chromium against the built `dist/`, mocking
`window.__TAURI_INTERNALS__.invoke` with a localStorage-backed fixture library seeded from `demo/Buches/**`.
The demo book is embedded in the binary (`library.rs` `DEMO` + `include_str!`) and seeded **once** on first
launch (`.initialized` marker).

## 2. Adaptation decisions (spec → this codebase)

The brief assumes React + TypeScript + Zod. This repo is deliberately vanilla JS; rewriting it would break
the reading pipeline, CSP, and Tauri integration. We keep the **contract and guarantees** and adapt the
mechanics:

| Brief | Adaptation |
| --- | --- |
| React `Component` | `mount(host, props) → { destroy() }` DOM renderer (same props: `data`, `savedState`, `onSaveState`, `onComplete`, `theme`). |
| Strict TypeScript | New extension code is **JSDoc-typed and checked by `tsc --noEmit` with `strict` + `checkJs`** scoped to `src/extensions/` (`tsconfig.json`, `npm run typecheck`). Legacy code is untouched. |
| Zod validation | **zod v4** added as a dependency; every extension ships a zod schema; `validate()` returns structured issues; `z.toJSONSchema` feeds the AI skill. |
| Manifest-driven registration | Each extension module exports a `BucherExtension` object (id, name, version, description, category, icon, skill, schema, mount). A central registry registers the built-ins; the contract is manifest-shaped so third-party bundles can register later. |
| Block embedding | Fenced code blocks whose info string is the extension id (```` ```ext-mermaid ````) with a **YAML payload** (the `yaml` package is already used for frontmatter; block scalars keep code/diagrams readable for weak LLMs). |

## 3. Extension contract & registry (`src/extensions/`)

```js
/**
 * @typedef {Object} BucherExtension
 * @property {string} id                  // 'ext-…', also the Markdown fence info string
 * @property {string} name @property {string} version @property {string} description
 * @property {'visualization'|'exercise'|'hybrid'} category
 * @property {string} icon                // lucide name
 * @property {ExtensionSkill} skill       // instructions, syntaxSpec, fewShotExamples
 * @property {import('zod').ZodType} schema
 * @property {(data: unknown) => ValidationResult} validate
 * @property {(host: HTMLElement, props: MountProps) => MountedExtension} mount
 */
```

- `MountProps`: `{ data, savedState, onSaveState(state), onComplete(), theme: 'dark', readOnly, renderMarkdown }`.
- `registry.js`: singleton `ExtensionRegistry` — `register`, `get`, `list`, `isEnabled(id)`, `setEnabled(id, on)`
  (persisted in `localStorage['bucher/extensions-disabled']`), `subscribe(listener)`. Disabled extensions
  render an inert "disabled" card and are excluded from AI skill injection.
- `validate.js`: wraps zod parsing into `{ ok: true, data } | { ok: false, issues: [{ path, message }] }`;
  the frame shows a graceful fallback (issues + raw source) instead of crashing.
- `boundary.js`: error boundary — try/catch around mount + a scoped `error`/`unhandledrejection` guard while
  the extension's async work runs; failures render a fallback card with message, "View source", and Retry.
- `host.js`: hydration + lifecycle. A document-level `MutationObserver` destroys mounts whose root leaves the
  DOM (covers navigation, dialogs, reference pane, rail replacement) — no leaked workers/timers/editors.

## 4. Block syntax, parsing, hydration, stable keys

````markdown
```ext-code-lab
id: binary-search            # optional but recommended: stable state key
title: Implement binary search
…extension-specific YAML…
```
````

- `markdown.js` fence rule: info matching a registered `ext-…` id (or any `ext-…` id, so unknown/disabled
  extensions still get a card) emits
  `<div class="bucher-extension" data-extension="<id>" data-source="<escaped YAML>"></div>`.
  Math extraction already ignores fences; no other renderer changes needed.
- `app.js#renderText(source, path, quiz, extCtx)` hydrates placeholders after `innerHTML`. `extCtx`
  (supplied by `reader.js` per unit/callout) provides the chapter, the owning exercise node (if any), and
  the book entry. Without context (AI previews, dialogs, reference pane) blocks mount read-only with
  ephemeral state.
- **State keys** (per book, stored under the chapter-relative path):
  1. payload `id:` → `id:<id>` (stable across edits — the AI skill instructs authors to always set it);
  2. block anchor `^anchor` / owning exercise node id → that id;
  3. fallback `u<unitIndex>:<extId>:<n>` (positional; documented as edit-fragile).
- `learning.js` gains an **injected classifier** (`isExerciseExtension(id)`, default: none) so it stays
  dependency-free for Node tests. Fence units classified as exercises become real exercise nodes
  (`type: 'exercise'`), which plugs them into the existing machinery: exercise sheet, counts, hints,
  "Mark solved", prerequisite graph. `app.js` injects the registry-backed classifier.

## 5. Persistence & completion

- `_progress.md` frontmatter gains `extensions: { "<chapter rel path>#<block key>": <state JSON> }`,
  normalized like `cards` (old files without it keep working). `BookProgress` gains
  `readExtensions(book)` and `setExtensionState(book, key, state|null)` through the existing atomic queue.
- Saves are **debounced (400 ms) and optimistic**: the in-memory entry cache updates immediately so
  re-renders never lose work; disk writes serialize behind the queue. `null` deletes the key (Reset State).
- Exercise extensions call `onComplete()` when their success condition holds (all tests pass, puzzle
  solved, query correct). The host maps that to `progress.set(model, exerciseTarget, true)` + refresh —
  the chapter's solved list, overview counts, and exercise sheet update exactly like hand-marked exercises.
  Regression (editing code after passing) demotes the badge to In Progress but does not un-mark the book
  exercise (same semantics as un-marking manually is left to the reader).
- Frame chrome: collapsible header (icon, extension name, block title), **status badge** for exercises
  (`Unsolved` / `In Progress` / `Passed`), toolbar: **Reset State**, **View Source/Data** (dialog with the
  YAML + current saved state), collapse toggle. Visualization frames get the same chrome minus the badge.

## 6. AI skill exposure & prompt composition

- `skill = { instructions, syntaxSpec, fewShotExamples: [{ title, yaml }] }` per extension.
- `src/extensions/skills.js#composeSkills()` aggregates **enabled** extensions into one prompt section:
  when/how to use each block, the exact fence + YAML syntax, a JSON Schema derived from the zod schema
  (`z.toJSONSchema`), and 1–2 few-shot examples.
- Rust authoring commands (`ai_prepare_import`, `ai_propose_patch`, `ai_generate_solution`, `ai_explain`,
  `ai_review_solution`) accept an optional `skills: String` appended to the system prompt; the import
  system prompt additionally instructs the model to use extension blocks where they teach better.
  `src/ai.js` passes `composeSkills()` on every authoring call. Toggling an extension in the manager
  changes the very next generation — no restart.
- The parser side needs no changes: generated fences flow through the same markdown rule; malformed
  payloads surface as validation cards, never crashes.

## 7. Sandboxing (ext-code-lab) & CSP

- User code runs in a **dedicated Web Worker** built as a separate esbuild entry
  (`dist/code-lab-worker.js`, classic/IIFE, stable name → `new Worker('/code-lab-worker.js')`, same-origin
  `'self'` under Tauri). Fresh worker per run; main thread enforces a **timeout (default 5 s) via
  `worker.terminate()`** — infinite loops cannot hang the app.
- Inside the worker, user code is compiled with `new Function` in strict mode; dangerous globals
  (`fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, `indexedDB`, `caches`, …) are shadowed to
  `undefined` in the function scope. The worker has no DOM, no Tauri IPC internals, and only communicates
  via a typed `postMessage` protocol. Console output is captured and relayed.
- Tauri CSP change (required for in-worker compilation, documented trade-off): `script-src 'self'
  'unsafe-eval'` + explicit `worker-src 'self'`. Everything else stays locked down. This is the standard
  playground trade-off (Observable/CodeSandbox-style); the worker isolation above contains it.
- Tests are declared by the book author: `{ name, fn, args, expected, hidden? }`. Runner extracts the
  named functions from user code, deep-compares results, reports pass/fail with expected/actual diffs and
  console logs. Hidden tests reveal only their pass/fail status. All pass → `onComplete()`.
- JavaScript is fully supported. TypeScript/Pyodide are **out of scope** for this pass (would require a
  bundled transpiler/wasm runtime); the skill text tells the AI to author JavaScript only.

## 8. Extension Manager UI

Settings gains an **Extensions** tab (and a command-palette entry): cards per installed extension with
icon, name, version, category badge, description, an enable/disable switch, and **View AI skill** (dialog
showing instructions, syntax spec, JSON schema, and few-shot examples verbatim). Toggling re-renders the
reader (disabled blocks become inert cards with an Enable button) and changes skill injection immediately.

## 9. Built-in extensions

| id | Category | Engine | State persisted |
| --- | --- | --- | --- |
| `ext-mermaid` | visualization | mermaid v11 (dynamic import), SVG zoom/pan (wheel + drag + buttons), theme-synced dark config, re-render on demand | zoom/pan |
| `ext-math-plot` | visualization | dependency-free canvas plotter + safe Pratt expression parser (no eval); functions/parametric/datasets, live parameter sliders, hover crosshair readout | slider values, viewport |
| `ext-state-stepper` | visualization | JSON steps → array cells, pointers, highlights, variable chips, explanation; Prev/Next/Auto-Play/Speed player | step index, speed |
| `ext-code-lab` | exercise | CodeMirror 6 editor + worker sandbox + unit-test runner (§7) | code, last results, status |
| `ext-parsons-puzzle` | exercise | drag-and-drop (HTML5 DnD) + keyboard/click ordering, optional indentation, distractor tray, per-line feedback, exact or alternative orderings | arrangement, status |
| `ext-sql-lab` | exercise (bonus) | alasql in-memory SQL playground: author-defined schema/seed, query editor, result table, expected-row validation (order-insensitive by default) | query, status |

Each ships: zod schema, `validate`, full mount with persistence + completion semantics, error fallback,
and a complete AI skill (instructions + syntax spec + 2 few-shot examples).

## 10. Showcase book & seeding

`demo/Buches/The Interactive Extension Showcase/` — `_index.md` + six chapters (one per extension, each
with prose, anchored blocks with explicit `id`s, hints, and a mixed final chapter). Added to the Rust
`DEMO`-style embedding with a **one-time `.showcase-seeded` marker** so existing initialized libraries
receive it once without resurrecting it after deletion. The Playwright fixture picks it up automatically
from `demo/`.

## 11. Verification

- `npm run typecheck` — strict tsc/checkJs over `src/extensions/` (new `typescript` devDependency).
- `npm test` — existing model tests stay green; new `test/extensions.test.js` covers registry, validation,
  skill composition, block keys, progress persistence, parsons/plot/stepper logic (pure modules).
- `cargo test --manifest-path src-tauri/Cargo.toml --locked` — Rust changes (skills param, showcase seed).
- `npm run build` — clean esbuild bundle incl. worker entry.
- `node scripts/check-extensions-ui.mjs` — Playwright E2E over the showcase book: every extension renders
  and interacts, code-lab passes/fails/timeouts, persistence survives reload, manager toggles change
  rendering and the composed skill prompt, AI import fixture receives the skills section.

## 12. Commit plan (atomic, each verified before commit)

1. `docs(extensions)`: this audit/architecture.
2. `feat(extensions)`: SDK types, zod validation, registry, error boundary, typecheck setup, deps.
3. `feat(extensions)`: skill composer + Rust `skills` parameter + ai.js wiring.
4. `feat(extensions)`: frame UI, hydration, `_progress.md` persistence, exercise integration, manager UI.
5. `feat(extensions)`: ext-mermaid. 6. ext-math-plot. 7. ext-state-stepper.
8. `feat(extensions)`: ext-code-lab (worker, CSP, build entry). 9. ext-parsons-puzzle. 10. ext-sql-lab.
11. `feat(extensions)`: showcase book, seeding, E2E script, final verification.
