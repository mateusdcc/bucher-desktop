# UI Audit & Design System — Bücher Desktop

> Phase 1 deliverable of the design-system unification mission.
> Scope: every UI surface in `src/` — app shell, reader, study modes, AI flows,
> settings/extension manager, the extension host, and all 12 built-in extensions.
> Method: full read of every view module and `styles.css`, plus pattern greps
> across all extension definitions and React views. All counts below are
> measured, not estimated.

---

## 1. Component & Element Inventory

### 1.1 Core application (vanilla JS + `src/ui.js` helpers)

| Element | Where (file · classes) | Current implementation |
|---|---|---|
| App shell grid | `app.js` · `.shell`, `.workspace` | CSS grid, `--library-width` custom prop |
| Sidebar | `app.js` · `.sidebar`, `.sidebar-brand` | ad-hoc flex column, hardcoded `#181818` |
| Brand lockup | `app.js` · `.sidebar-brand` | icon + text, one-off |
| Search trigger | `app.js` · `.library-search` | `<button>` styled as input + `<kbd>` |
| Library tree | `app.js` · `.tree`, `.tree-row`, `.tree-link`, `.tree-chevron`, `.tree-indent`, `.tree-options`, `.tree-name` | ad-hoc rows, `--depth` indent math |
| Tree progress ring | `reader.js` · `.tree-status.checked`, `.tree-status.partial` | conic-gradient ring, one-off |
| Toolbar / breadcrumb | `app.js` · `.toolbar`, `.breadcrumb`, `.crumb-book`, `.crumb-page`, `.toolbar-actions` | ad-hoc header bar |
| Icon buttons (14+ sites) | `app.js`, `reader.js`, `ai.js`, `host.js`, extensions · `.icon-button` | `ui.iconButton()` — shared factory, one style |
| Text buttons | everywhere · global `button` rule | `ui.button()` — ghost default; variants via extra classes |
| Primary button | `.accent-button` (12 call sites) | green-on-dark one-off (`#202a23`) |
| Accent text button | `.accent` (reader solved/read states) | color-only variant |
| Brand button | `settings.js` · `.chatgpt-login-button` | black `#000` + logo pseudo-element |
| Jump bar | `app.js` · `.jump-bar`, `.jump-origin`, `.jump-depth` | ad-hoc strip |
| Reference pane | `app.js` · `.reference-pane`, `.reference-header`, `.reference-title`, `.reference-scroll` | 3 layouts (vertical/horizontal/floating), hardcoded borders `#464d45`/`#525b51` |
| Panel resizers (2) | `panel-resize.js` · `.panel-resizer` | shared factory ✓ (keyboard + pointer, ARIA separator) |
| Reader article | `app.js`, `reader.js` · `.article`, `.page`, `.page-title`, `.description` | serif reading column |
| Overview progress | `reader.js` · `.book-progress`, `.book-progress-label`, `.progress-track` | 2px bar, one-off |
| Contents list | `reader.js` · `.contents`, `.contents-row`, `.contents-trailing` | button rows, `--depth` |
| Outline rail | `reader.js` · `.outline`, `.outline-link`, `.eyebrow` | ad-hoc link list |
| Callouts (12 kinds) | `reader.js` · `.callout`, `.callout-kind`, `.callout-title`, `.exercise` | section + eyebrow row |
| Hint / prerequisite disclosures | `reader.js` · `.hint`, `.prerequisites`, `.prerequisite-links` | native `<details>` |
| Exercise action bar | `reader.js` · `.exercise-actions` | first-child gets one-off bg `#222622` |
| Solution panel | `reader.js` · `.solution-panel`, `.solution-inner` | card `#1c1e1c` |
| Solution tabs | `reader.js` · `.solution-tabs`, `.selected` | tab impl **#1** (`.selected` class) |
| Compare picker | `reader.js` · `.compare-select`, `.proof-columns`, `.proof` | raw `<select>` |
| Inline solution editor | `solution-editor.js` · `.solution-source`, `.inline-editor-tools`, `.solution-rendered-block` | CodeMirror 6 + live preview widgets |
| Markdown source editor | `ui.js editor()` · `.editor`, `.source-editor` | raw `<textarea>` in dialog |
| Chapter footer nav | `reader.js` · `.chapter-footer`, `.previous-chapter`, `.next-chapter`, `.read-chapter` | 3-button strip |
| Exercise sheet | `reader.js` · `.sheet-exercise` | list mode wrapper |
| Flashcard | `study.js` · `.flashcard`, `.recall-input`, `.ratings`, `.card-source` | card `#1c1e1c`, raw input, rating buttons one-off `#222a23` |
| Quick notes | `study.js` · `.note-row`, `.note-status`, `.quiet-link` | ad-hoc rows |
| Cloze blanks | `markdown.js` · `.cloze`, `mark` | inline toggle button, bg `#26382a` |
| Typst math / source | `markdown.js`, `reader.js` · `.typst-math`, `.typst-source` | pre block `#202020` |
| Dialogs (9 kinds) | `ui.js dialog()` · `.dialog`, `.dialog-heading`, `.dialog-actions` | native `<dialog>` ✓ shared; size variants `.command-palette`, `.editor`, `.settings`, `.extension-source-dialog` |
| Command palette | `command-palette.js` · `.command-palette`, `.search-input`, `.search-results`, `.search-result` | combobox + listbox ✓ ARIA-complete |
| Library search | `app.js` · same `.search-*` classes | duplicated result-row logic vs palette |
| Form dialog | `ui.js formDialog()` · `.form`, `.field` | label+input pairs |
| Toast | `ui.js notice()` · `#notice`, `#notice.error` | fixed bottom-right, 2 colors |
| Settings page | `settings.js` · `.settings`, `.settings-section`, `.settings-tabs`, `.settings-status`, `.settings-field`, `.settings-check`, `.settings-message`, `.settings-path`, `.settings-provider` | tab impl **#2** (`aria-pressed` + one-off `#2c382e`) |
| Provider disclosures | `settings.js` · `.provider-settings`, `.chatgpt-settings`, `.ollama-settings` | `<details>` sections |
| Extension manager cards | `settings.js` · `.extension-manager-card`, `-head`, `-meta`, `-actions` | card list |
| Toggle switch | `settings.js` · `.extension-switch`, `.extension-switch-knob` | the only switch in the app |
| Runtime status chips | `settings.js` · `.extension-runtime-list`, `-row`, `.extension-runtime-state.{cold,loading,warm,error}` | badge system **#3** |
| Dependency inspector | `settings.js` · `.extension-dep-row`, `-head`, `-version`, `.extension-dep-badge.{lazy,bundled}`, `.extension-capability-status.{ok,bad}` | badge systems **#2/#4** |
| AI request panel | `ai.js` · `.ai-panel`, `.ai-heading`, `.ai-scope`, `.ai-actions`, `.ai-status`, `.ai-result`, `.ai-form` | rail-mounted form card |
| AI explanation bubble | `ai.js` · `.ai-explanation` (+`::after` tail) | one-off bubble `#212722`, border `#638a6c` |
| AI field auto-grow | `ai.js` · `.fit-field` | grid overlay trick |
| AI import draft | `ai.js` · `.ai-import-page`, `.ai-import`, `.import-draft`, `.draft-section`, `.draft-book-title`, `.draft-chapter` | editable preview sections |
| Patch diff view | `patch-view.js` · `.patch-diff`, `.diff-header`, `.diff-heading`, `.diff-counts`, `.diff-lines`, `.diff-row.{added,removed}`, `.diff-gutter`, `.diff-text`, `.diff-kind`, `.diff-ending`, `.diff-fold` | full diff UI, own palette |
| Empty library / error states | `app.js` · `.page-title` + `.muted` + retry button | ad-hoc |
| Startup state | `index.html`, `app.js` · `.startup`, `p.muted` "Opening library…" | plain text, no skeleton |

### 1.2 Extension host & boundary

| Element | Where | Implementation |
|---|---|---|
| Block frame | `host.js` · `.bucher-extension`, `.extension-frame`, `.extension-frame-header`, `.extension-frame-body`, `.extension-collapse`, `.extension-name`, `.extension-title`, `.extension-frame-tools` | card `#1b1d1b`, header `#202320`, border `#353b36` |
| Exercise status badge | `host.js` · `.extension-badge[data-status]` | badge system **#1** (unsolved/in-progress/passed) |
| Degraded badge | `host.js` · `.extension-capability-badge` | warning chip, icon + text |
| Fallback cards (5 kinds) | `boundary.js` · `.extension-fallback`, `.extension-disabled-card`, `.extension-capability-card`, `.extension-fallback-heading`, `.extension-issues`, `.extension-error-message`, `.extension-fallback-actions`, `.extension-fallback-source` | 3 border/bg moods (danger `#4a3a33`/`#221d1a`, neutral, warning `#4a4433`/`#22201a`) |
| Source dialog | `boundary.js` · `.extension-source-dialog`, `.extension-source` | pre `#141614` |

### 1.3 Built-in extensions (12)

| Extension | Toolbar | Stage | Controls | Feedback |
|---|---|---|---|---|
| `ext-mermaid` | `.mermaid-toolbar` (zoom in/out/reset iconButtons + `.mermaid-zoom-label`) | `.mermaid-viewport`/`.mermaid-stage` (pan/zoom) | — | `.mermaid-caption` |
| `ext-math-plot` | `.plot-toolbar` (reset view + `.plot-hint`) | `.plot-wrap`/`.plot-canvas` + `.plot-readout` | `.plot-sliders`/`.plot-param` — **slider impl #1** (custom webkit thumb) | `.plot-legend`/`.plot-legend-item`/`.plot-swatch` |
| `ext-state-stepper` | `.stepper-controls` — **playback impl #1** (prev/play/next + `.stepper-speed` raw select + `.stepper-counter`) | `.stepper-stage`, `.stepper-arrays`, `.stepper-cell`, `.stepper-pointers`, `.stepper-variables`, `.stepper-graph` (SVG) | `.stepper-track` progress | `.stepper-explanation` |
| `ext-code-lab` | `.codelab-controls` (Run tests / Reset code + `.codelab-summary`) | CodeMirror `.codelab-editor` | — | `.codelab-results`, `.codelab-test.{pass,fail}`, `.codelab-test-detail`, `.codelab-diff-label`, `.codelab-console-details`/`.codelab-console` — **console #1** |
| `ext-parsons-puzzle` | `.parsons-controls` (Check order / Shuffle + `.parsons-summary`) | `.parsons-pools`, `.parsons-tray`, `.parsons-answer`, `.parsons-line` (drag & drop + 5 iconButtons/line) | — | `.parsons-empty`, correct/incorrect line states |
| `ext-sql-lab` | `.sql-controls` (Run query / Reset query) | CodeMirror `.sql-editor`, `.sql-schema`/`.sql-table-chip` | — | `.sql-verdict.{pass,fail,error}` — **banner family**, `.sql-table-wrap`/`.sql-table` — **table #1**, `.sql-empty`, `.sql-expected` |
| `ext-interactive-graph` | `.igraph-toolbar` (raw JSX `<button>`×4 + `.igraph-status`) | `.igraph-canvas` (React Flow) + `.igraph-node`, `.igraph-kind`, `.igraph-kind-select` (raw `<select>`) | trace up/down toggles | `.igraph-message`, `.igraph-inspector` card |
| `ext-desmos-lab` | `.desmos-toolbar` — **playback impl #2** (play/pause iconButton + `.desmos-t` + reset + `.desmos-hint`) | `.desmos-wrap`/`.desmos-canvas` + `.desmos-readout` | `.desmos-sliders`/`.desmos-param` — **slider impl #2** (native `accent-color`) | `.desmos-legend` (KaTeX), `.desmos-challenge[data-state]`, `.desmos-area-value` |
| `ext-polyglot-studio` | `.poly-toolbar` — **tab impl #3** (`.poly-tabs` raw JSX `role=tab` buttons) + `.poly-language` select + `.poly-timer` + Run | CodeMirror `.poly-editor` | — | `.poly-tests`, `.poly-test-spec.{pass,fail}`, `.poly-hints`, `.poly-fatal`, `.poly-results`, `.poly-result.{pass,fail}`, `.poly-error`, `.poly-diff` expected/actual, `.poly-console`/`.poly-log` — **console #2** |
| `ext-sql-duckdb-lab` | `.ducklab-toolbar` (`.ducklab-engine` status + Run JSX button) | CodeMirror `.ducklab-editor`, `.ducklab-schema`/`.ducklab-table-card`/`.ducklab-column`/`.ducklab-rowcount` | — | `.ducklab-error`, `.ducklab-verdict.{pass,fail}`, `.ducklab-results`, `.ducklab-table` (TanStack, sortable) — **table #2** |
| `ext-3d-spatial-lab` | `.spatial-toolbar` — **playback impl #3** (JSX play/pause + `.spatial-morph` raw range + `.spatial-t` + `.spatial-hint`) | `.spatial-canvas` (R3F) | `.spatial-sliders`/`.spatial-param` — **slider impl #3** (native range) | `.spatial-challenge.{passed}`, `.spatial-error` |
| `ext-tauri-native-workbench` | `.workbench-inputrow` (raw `el('input')` + raw `el('button')` Run/Verify + reset iconButton) | `.workbench-terminal`/`.workbench-log`/`.workbench-entry`/`.workbench-cmd`/`-stdout`/`-stderr`/`-code` — **console #3**, `.workbench-side`, `.workbench-files`/`.workbench-file`/`.workbench-fileview` | — | `.workbench-checks`/`.workbench-check.{pass,fail}`, `.workbench-empty`, `.workbench-sysinfo`/`.workbench-syscard` |

### 1.4 Control census (measured)

- **23 raw ad-hoc control constructions** inside extensions (8 files): raw JSX
  `<button>`/`<input>`/`<select>` in the 4 React views, raw `el('input'|'button'|'select')`
  in `math-plot`, `desmos-lab`, `state-stepper`, `tauri-native-workbench`.
- **`styles.css`: 715 lines, 258 hardcoded hex occurrences, 97 unique hex values**,
  against only **11 CSS variables** in `:root`.
- **Canvas/WebGL palettes hardcoded in JS**: mermaid 23 hex, desmos 15, math-plot 6,
  state-stepper 3, spatial-lab 2 + TSX `KIND_COLORS` (6), `PALETTE` (6), axis colors (3),
  interactive-graph edge/label/minimap colors (8).
- **1 undefined variable bug**: `.desmos-param-value` and `.spatial-param-value` use
  `var(--muted-foreground)` which is never defined (falls back to inherited color).

---

## 2. Duplication & Inconsistency Hotspots

### H1 — Twelve toolbar implementations, one concept
`.mermaid-toolbar`, `.plot-toolbar`, `.stepper-controls`, `.codelab-controls`,
`.parsons-controls`, `.sql-controls`, `.igraph-toolbar`, `.desmos-toolbar`,
`.poly-toolbar`, `.ducklab-toolbar`, `.spatial-toolbar`, `.workbench-inputrow`
(+ app `.toolbar`, `.exercise-actions`, `.solution-actions`, `.page-actions`,
`.ai-actions`, `.dialog-actions`, `.ratings`, `.inline-editor-tools`,
`.extension-manager-actions`, `.extension-fallback-actions`, `.chapter-footer`).
Gaps range 2/4/6/8/10/12px; margins 6/8/10px; wrap behavior inconsistent.

### H2 — Three slider implementations
1. `math-plot`: custom `-webkit-appearance:none` track `#333833` + accent thumb (15px).
2. `desmos-lab` / `spatial-lab`: native range with `accent-color: var(--accent)`.
3. `spatial-morph`: bare native range, no value readout styling.
Parameter rows also differ: `.plot-param` (grid 26px/1fr/64px) vs `.desmos-param`
(flex, 18px name) vs `.spatial-param` (flex, 34px name). Readout colors differ
(accent vs muted vs **undefined** `--muted-foreground`). No reset-to-default anywhere.

### H3 — Three tab implementations, three selected states
- `.settings-tabs`: `aria-pressed=true` → `#2c382e` bg + accent text.
- `.solution-tabs`: `.selected` class → `var(--selected)` bg + accent text.
- `.poly-tabs`: `.active` class → `#2c312c` bg + strong text, 6px radius container.
Only polyglot uses `role=tab`/`aria-selected`; the others use pressed buttons.

### H4 — Four badge systems with duplicated status semantics
`.extension-badge` (exercise status), `.extension-dep-badge` (lazy/bundled),
`.extension-runtime-state` (cold/loading/warm/error), `.extension-capability-badge`
+ `.extension-capability-status` (degraded/connected). Same visual language
(10–11px uppercase, 3px radius) re-declared 4×; warning `#32301f/#d9c97a` and
success `#20301f/#73d695` pairs copy-pasted across them.

### H5 — Seven+ error/success banner variants, three reds, five greens
Banners: `.sql-verdict`, `.ducklab-verdict`, `.poly-fatal`, `.poly-error`,
`.ducklab-error`, `.spatial-error`, `.extension-fallback`, `#notice.error`,
`.ai-status.error-text`, `.codelab-test.fail`.
Danger text: `#e8927c` / `#e8b9a8` / `#f5ada4` / `#fac2b9` / `#e8a86f` (5 shades).
Danger surfaces: `#3a2927` / `#26201d` / `#241a1a` / `#2a1f1b` / `#221d1a` / `#392725`.
Danger borders: `#4a3a33` / `#5a3a30` / `#402c2c` / `#3a2c26` / `#4a4433`.
Success surfaces: `#20301f` / `#1d261d` / `#1a241c` / `#26382a` / `#222a23` / `#202a23`.

### H6 — Ten card shells, three surface elevations, two border colors
Cards: `.extension-frame`, `.flashcard`, `.solution-panel`, `.igraph-inspector`,
`.ducklab-table-card`, `.workbench-syscard`, `.extension-dep-row`, `.codelab-test`,
`.poly-results`, `.poly-tests`, `.poly-hints`, `.workbench-check`, `.workbench-files`,
`.patch-diff`, `.ai-explanation`.
Surfaces: `#1b1d1b` vs `#191b19` vs `#1c1e1c` (indistinguishable, arbitrary).
Borders: `#353b36` (shell-level) vs `#2c312c` (extension-level) vs `#363936`
(settings) vs `#3b403b` (diff) — four "subtle border" values.

### H7 — Three console/output implementations
`.codelab-console` (max-h 180, pad 9/11), `.poly-console` (max-h 160, pad 8/12),
`.workbench-log` (max-h 240, pad 8/12) — same `#141614` bg, same mono 12px,
different heights/padding; only workbench has a head strip; log entry coloring
ad-hoc per extension (`#c9cbc4`/`#cfd2c9` stdout, `#e8927c` stderr).

### H8 — Three playback control implementations
stepper (prev/play/next + speed **select** + counter + track), desmos (play/pause
+ t readout, speed fixed in payload), spatial (play/pause + t readout). No shared
speed control (0.5×–2×), no shared scrubber; keyboard support only in stepper.

### H9 — Duplicated readouts, legends, tables, test rows, empty states
- Readouts: `.plot-readout` vs `.desmos-readout` (near-identical, 11 vs 12px).
- Legends: `.plot-legend*` vs `.desmos-legend*` (swatch 12×3 vs 14×4).
- Tables: `.sql-table` vs `.ducklab-table` (different th styling, row borders).
- Test rows: `.codelab-test` vs `.poly-result`/`.poly-test-spec` vs `.workbench-check`.
- Empty states: `.parsons-empty`, `.sql-empty`, `.workbench-empty`, `p.muted`
  ("No matching…", "Your library is empty.", "All caught up…") — no shared component.
- Loading: plain "Loading…" / "Checking…" / "Opening library…" text everywhere;
  **no spinner or skeleton primitive exists**.

### H10 — Radius, spacing, typography drift
- Radius language: 0 (app default) / 3px (badges) / 4px (spatial label) / 6px
  (poly tabs) / 8px (graph node) / 12px (switch) / 50% (knob, ring).
- Spacing: 30+ distinct px values, no 4/8 grid (5, 7, 9, 11, 13, 17, 21, 27, 47…).
- Fonts: `var(--reader)` vs hardcoded `Spectral, serif` (desmos/spatial param names);
  SVG labels hardcode `Inter Variable, system-ui, sans-serif`; mono stacks vary
  (`ui-monospace, monospace` everywhere ✓ but sizes 10/10.5/11/11.5/12/12.5/13/13.5/14px).
- Font weights: 500/550/560/570/580/590/600/620/650 — nine weights, no scale.

### H11 — Theme & elevation
Dark-only (`color-scheme: dark`, meta tag). No light palette, no theme switch.
Elevation is implicit: app `#171717` → sidebar `#181818` → dialog `#222322` →
frame `#1b1d1b` → inset `#161816`/`#141614`; hover `#222322`/`#292d29`/`#232623`;
selected `#242624`/`#303630`/`#2c312c`. Shadows only on dialog/floating pane.
Scrollbars: `scrollbar-width: thin` on 6 core scrollers, default elsewhere.
Focus ring is consistent ✓ (`:focus-visible` accent 2px) — keep.

### H12 — Button variant chaos
Ghost (global), `.accent-button` (primary), `.accent` (text), `.icon-button`,
`.quiet-link`, `.chatgpt-login-button` (brand), plus context one-offs
(`.exercise-actions button:first-child`, `.ratings button`, `.jump-bar button`,
`.solution-tabs .selected`, `.settings-tabs [aria-pressed]`). No danger/success
button variants exist; destructive actions use `confirm()` + ghost buttons.
Disabled state = `opacity:.52; cursor:wait` globally (even for non-loading disables).

---

## 3. Target Design System Specification

Inspired by **Linear** (semantic surfaces, quiet borders, tight type), **Raycast**
(command surfaces, crisp controls), **Obsidian** (reading-first serif, sharp cards),
**Vercel Geist** (status semantics, monospace data). The current dark look is the
baseline — tokens map 1:1 to today's values so migration is visually lossless;
a light palette is added for parity.

### 3.1 Color & surface elevation tokens (`src/components/ui/tokens.css`)

Semantic variables, themed via `html[data-theme="dark"|"light"]` (default dark).
Legacy `:root` vars (`--surface`, `--text`, `--accent`, …) become aliases of the
new tokens during migration and are deleted in Commit 13.

```css
/* Surfaces (elevation ladder) */
--bg-app:        /* dark #171717 · light #ffffff   */
--bg-surface:    /* dark #1b1d1b · light #f7f7f5   */  /* cards, frames, panels */
--bg-elevated:   /* dark #222322 · light #ffffff   */  /* dialogs, popovers, headers */
--bg-inset:      /* dark #141614 · light #f0f0ee   */  /* consoles, code, canvases */
--bg-interactive:/* dark #232623 · light #ececea   */  /* chips, cells, hover targets */
--bg-hover:      /* dark #222322 · light #f0f0ee   */
--bg-selected:   /* dark #242624 · light #e8e8e4   */
--bg-sidebar:    /* dark #181818 · light #fafaf8   */

/* Borders */
--border-subtle: /* dark #2c312c · light #e4e4e0   */  /* inside surfaces */
--border-strong: /* dark #353b36 · light #d4d4cf   */  /* shell-level splits */
--border-focus:  /* = --accent-primary */

/* Text */
--text-primary:  /* dark #eeeee9 · light #1a1a18   */
--text-secondary:/* dark #deded9 · light #33332f   */
--text-muted:    /* dark #9c9d95 · light #6b6b64   */
--text-faint:    /* dark #8b8e85 · light #8a8a82   */

/* Accent & status */
--accent-primary:      /* dark #73d695 · light #1f9d55 */
--accent-primary-hover:/* dark #a1f0b7 · light #178a49 */
--accent-surface:      /* dark #202a23 · light #e3f4e9 */
--accent-surface-hover:/* dark #27372c · light #d3ecdc */
--status-success:      /* = accent-primary */
--status-success-surface: /* dark #20301f · light #e3f4e9 */
--status-success-border:  /* dark #2c4a35 · light #b7dfc4 */
--status-warning:      /* dark #d9c97a · light #9a7b1c */
--status-warning-surface: /* dark #32301f · light #f7efd8 */
--status-warning-border:  /* dark #4a4433 · light #e2d3a8 */
--status-danger:       /* dark #e8927c · light #c2452d */
--status-danger-surface:  /* dark #2a1f1b · light #fbe9e4 */
--status-danger-border:   /* dark #4a3a33 · light #ecc4b8 */
--status-info:         /* dark #6fb7e8 · light #2270b5 */
--status-info-surface: /* dark #1d2733 · light #e3eef8 */

/* Data-viz palette (canvas/WebGL/SVG — shared module reads these) */
--viz-1 … --viz-6:  /* #e88f9f #73d695 #6fb7e8 #e8d06f #b48fe8 #e8a86f (dark) */
--viz-grid:        /* dark #2c312c · light #d4d4cf */
--viz-axis:        /* dark #5a605a · light #8a8a82 */

/* Effects */
--shadow-dialog: 0 20px 90px rgb(0 0 0 / .47);
--shadow-float:  0 12px 40px rgb(0 0 0 / .6);
--ring-focus: 2px solid var(--accent-primary);  /* offset 2px, keep current */
--scrollbar-thumb: var(--border-strong);
```

Rules: **no hex outside `tokens.css`** except the data-viz palette module
(`src/components/ui/palette.ts`) which resolves tokens via `getComputedStyle`
for canvas/WebGL contexts (with static fallbacks). Diff added/removed colors
become `--status-success-*` / `--status-danger-*` derivatives.

### 3.2 Typography & spacing scale

```css
--font-ui: 'Inter Variable', system-ui, sans-serif;
--font-reader: 'Spectral', Georgia, serif;
--font-mono: ui-monospace, 'SF Mono', Menlo, monospace;

--text-xs: 11px;   /* eyebrows, badges, meta */
--text-sm: 12px;   /* secondary UI, hints */
--text-base: 13px; /* controls, dense UI */
--text-md: 14px;   /* body UI (current default) */
--text-lg: 15px;   /* section titles */
--text-xl: 18px;   /* dialog titles, reader h3 */
--text-2xl: 22px;  /* reader h2 */
--text-display: clamp(31px, 3.25vw, 46px); /* page titles (unchanged) */
--text-reading: 18px/1.58 var(--font-reader); /* article body (unchanged) */

--weight-normal: 400; --weight-medium: 500; --weight-semibold: 600; --weight-bold: 650;
/* collapses today's 500/550/560/570/580/590/600/620/650 drift */

--space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
--space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px;
/* all component padding/gaps snap to this grid; reader prose keeps its
   typographic em-based rhythm (documented exception) */

--radius-sm: 3px;  /* badges, chips */
--radius-md: 6px;  /* buttons, inputs, tabs, cards */
--radius-lg: 10px; /* dialogs, workbench shells */
--radius-full: 999px; /* switches, progress rings */
/* sharp Obsidian-like cards become 6px — the single intentional visual
   refinement; everything else maps 1:1 */
```

### 3.3 Canonical component catalog (`src/components/ui/`)

Architecture (adapts the repo's vanilla-JS + esbuild + JSDoc stack):
- Primitives are **strictly-typed TypeScript DOM factories** (erasable syntax
  only, so Node's native type-stripping runs them in unit tests). Barrel:
  `src/components/ui/index.ts`. `tsconfig.json` include gains `src/components`.
- **Dual consumption**: vanilla views call the factories; React island views
  import `src/components/ui/react.tsx` — thin wrappers that mount the same
  factories (single DOM logic source) — plus the `ds` class-name map from
  `classes.ts` for layout JSX. All styling lives in the design-system CSS;
  no feature file declares component styles after migration.
- Every factory returns the root element; stateful widgets return a handle
  `{ root, …setters, destroy? }`. All interactive primitives are keyboard- and
  ARIA-complete by construction.

```ts
// buttons.ts
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type ButtonSize = 'xs' | 'sm' | 'md';
interface ButtonProps {
  label?: string; variant?: ButtonVariant; size?: ButtonSize;
  leftIcon?: string; rightIcon?: string;      // lucide names
  loading?: boolean; disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: (event: MouseEvent) => void | Promise<void>; // async auto-disable + error toast
  className?: string; title?: string; ariaLabel?: string;
}
function Button(props: ButtonProps): HTMLButtonElement;
function IconButton(props: Omit<ButtonProps, 'label' | 'leftIcon' | 'rightIcon'> &
  { icon: string; label: string; pressed?: boolean }): HTMLButtonElement;

// toggle.ts
interface ToggleSwitchProps { checked: boolean; label: string;
  onChange: (checked: boolean) => void; disabled?: boolean; }
function ToggleSwitch(props): { root: HTMLButtonElement; setChecked(v: boolean): void };
interface SegmentedControlProps<T extends string> {
  options: { value: T; label: string; icon?: string }[];
  value: T; onChange: (value: T) => void; ariaLabel: string; size?: 'sm' | 'md';
}
function SegmentedControl<T extends string>(props): { root: HTMLElement; setValue(v: T): void };

// inputs.ts
interface InputProps { label?: string; value?: string; placeholder?: string;
  type?: 'text' | 'search' | 'number'; mono?: boolean; required?: boolean;
  maxLength?: number; disabled?: boolean; ariaLabel?: string;
  onInput?: (value: string) => void; onEnter?: () => void; }
function Input(props): { root: HTMLElement; input: HTMLInputElement; setValue(v: string): void };
function Textarea(props: InputProps & { rows?: number; autoGrow?: boolean; source?: boolean }):
  { root: HTMLElement; input: HTMLTextAreaElement; setValue(v: string): void };
interface SelectProps<T extends string> { label?: string; value?: T;
  options: { value: T; label: string }[]; onChange: (value: T) => void;
  ariaLabel?: string; disabled?: boolean; size?: 'sm' | 'md'; }
function Select<T extends string>(props): { root: HTMLElement; select: HTMLSelectElement; setValue(v: T): void };

// parameter-slider.ts — the signature widget
interface ParameterSliderProps {
  name: string;               // italic math label (reader font)
  value: number; min: number; max: number; step: number;
  defaultValue?: number;      // enables reset-to-default button
  format?: (value: number) => string;   // monospace readout (default: trimmed fixed)
  latex?: string;             // optional KaTeX readout instead of text
  disabled?: boolean;
  onInput: (value: number) => void;
}
function ParameterSlider(props): { root: HTMLElement; setValue(v: number): void; setDisabled(v: boolean): void };

// containers.ts
interface CardProps { inset?: boolean; padding?: 'sm' | 'md'; className?: string; children?: Node[] }
function Card(props): HTMLElement;
interface PanelHeaderProps { icon?: string; title: string; subtitle?: string;
  badge?: BadgeProps; actions?: Node[]; collapsible?: { expanded: boolean; onToggle(): void } }
function PanelHeader(props): HTMLElement;
function Toolbar(props: { children?: Node[]; className?: string }): HTMLElement; // 8px gap, wrap
interface TabsProps<T extends string> { tabs: { value: T; label: string; icon?: string }[];
  value: T; onChange(v: T): void; ariaLabel: string; }
function Tabs<T extends string>(props): { root: HTMLElement; setValue(v: T): void }; // role=tablist

// badge.ts
type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent';
interface BadgeProps { variant?: BadgeVariant; children: string; icon?: string; title?: string }
function Badge(props): HTMLElement;
// exercise status map: Unsolved→neutral, In Progress→warning, Passed→success
// runtime map: cold→neutral, loading→warning, warm→success, error→danger
// dependency map: bundled→neutral, lazy-loaded→info, Connected→success, Unavailable→danger

// modal.ts
interface ModalProps { title: string; size?: 'sm' | 'md' | 'lg' | 'source';
  onClose?: () => void; }
function Modal(props): { dialog: HTMLDialogElement; body: HTMLElement;
  setActions(nodes: Node[]): void; close(): void };  // native <dialog>, focus trap, Esc
function Drawer(props: { title: string; side: 'right' | 'bottom'; onClose?: () => void }):
  { root: HTMLElement; body: HTMLElement; close(): void };

// feedback.ts
type CalloutTone = 'info' | 'success' | 'warning' | 'danger' | 'hint';
interface CalloutBannerProps { tone: CalloutTone; title?: string; icon?: string;
  children?: Node[]; actions?: Node[]; }
function CalloutBanner(props): HTMLElement;
interface EmptyStateProps { icon?: string; title: string; hint?: string; action?: Node }
function EmptyState(props): HTMLElement;
function Spinner(props?: { size?: 'sm' | 'md'; label?: string }): HTMLElement;
function ProgressBar(props: { value: number; max: number; label: string }): HTMLElement;
function Toast(message: string, tone?: 'success' | 'danger'): void; // replaces notice()

// workbench.ts — shared extension shell
interface InteractiveWorkbenchProps {
  toolbar?: Node[];                    // left controls
  status?: Node;                       // right-aligned status (badge/readout)
  stage: Node;                         // canvas/editor/main area
  console?: ConsoleOutputHandle;       // collapsible bottom output
  footer?: { reset?: () => void; hint?: () => void;
             run?: { label: string; onClick: () => void; loading?: boolean } };
  description?: Node;
}
function InteractiveWorkbench(props): { root: HTMLElement; setConsoleOpen(open: boolean): void };
interface ConsoleEntry { kind: 'cmd' | 'stdout' | 'stderr' | 'info'; text: string; meta?: string }
interface ConsoleOutputHandle { root: HTMLElement; append(entry: ConsoleEntry): void;
  clear(): void; setTitle(title: string): void; }
function ConsoleOutput(props?: { title?: string; maxHeight?: number }): ConsoleOutputHandle;
function SplitPane(props: { direction: 'horizontal' | 'vertical'; first: Node; second: Node;
  initial?: number; min?: number; max?: number; storageKey?: string }): HTMLElement; // wraps panel-resize
interface PlaybackControlsProps {
  playing: boolean; onTogglePlay(): void;
  onStepBack?(): void; onStepForward?(): void;
  index?: number; count?: number; onScrub?(index: number): void;
  speed?: number; onSpeedChange?(speed: number): void; // 0.5 | 1 | 1.5 | 2
  readout?: string; ariaLabel: string;
}
function PlaybackControls(props): { root: HTMLElement;
  setPlaying(v: boolean): void; setIndex(i: number, count: number): void; setReadout(text: string): void };
```

### 3.4 Migration map (Phase 3–4)

| Commit | Area | Primitives consumed |
|---|---|---|
| 7 | Shell, sidebar, tree, toolbar, library, search, palette, jump bar, reference pane | Button, IconButton, Input, Modal, EmptyState, Badge, tokens |
| 8 | Reader, callouts, exercise tools, solution panel/tabs/editor, study modes, diff view | Tabs, Button, CalloutBanner, Card, Input, Textarea, ProgressBar, Badge |
| 9 | Generator/AI flows, form dialogs, settings forms, provider panels | Modal, Input, Textarea, Select, Button, CalloutBanner, Spinner |
| 10 | Extension frame + manager + dependency inspector + theme toggle | PanelHeader, Badge, ToggleSwitch, Card, Modal, Tabs, CalloutBanner |
| 11 | 6 visualization extensions | InteractiveWorkbench, PanelHeader, ParameterSlider, PlaybackControls, Toolbar, palette |
| 12 | 6 exercise/sandbox extensions | InteractiveWorkbench, ConsoleOutput, Badge, Button, CalloutBanner, Tabs |
| 13 | Dead-style purge + reuse metrics | — |

**Verification contract per commit:** `npm run typecheck` + `npm run build` +
`npm test` (21) + `cargo test --locked` (17, untouched areas) + full
`check-extensions-ui.mjs` (15 scenarios) + `check-ai-ui.mjs` (11 scenarios).
E2E selectors are updated in the same commit as the markup they target; visual
parity is checked against staging screenshots. Legacy class names survive only
as thin aliases inside the design-system CSS until Commit 13 removes them.