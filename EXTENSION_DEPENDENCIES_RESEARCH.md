# Extension Dependencies — Research & Adoption Plan

Phase 0 audit for the dependency-aware extension runtime. All package versions below were
verified against the npm registry / crates.io on 2026-11-19. Ground rule from the first
extension pass still applies: **the host is vanilla JS + esbuild + Tauri 2, not React/Vite** —
the plan adapts the requested React ecosystem to that reality instead of rewriting the app.

## 1. Reference findings

**Observable Framework / JupyterLite (lazy heavy runtimes).** Observable self-hosts npm imports
at build time and recommends *dynamic* `import()` for libraries not needed at first paint
("Dynamic imports… can improve performance if the library is not needed to render content
visible on page load"); DuckDB-Wasm is exposed as a lazily-instantiated client. JupyterLite
boots Pyodide only when a Python kernel is requested, and the Pyodide project documents
self-hosting the runtime (`indexURL` pointing at local files) to remove CDN dependence.
→ **Adopt:** every heavy engine (Pyodide, DuckDB, three, React Flow) loads via dynamic
`import()` inside `mount()`, never at app startup; WASM/stdlib assets are copied into `dist/`
and served same-origin; a runtime-status tracker reports cold/warm per engine.

**VS Code (`contributes`, `extensionDependencies`, activation events).** Extensions are
self-describing manifests; the host activates them lazily on declared events and resolves
inter-extension dependencies before activation. → **Adopt:** a `dependencies` manifest on
`BucherExtension` (web packages + Tauri capabilities), registry-level audit at registration,
and mount-time activation of lazy assets — the block *is* the activation event.

**Tauri v2 capabilities.** Verified in the v2 docs: "By default, all commands that you
registered in your app… are allowed to be used by all the windows and webviews" — custom IPC
commands need no capability entries (our existing `capabilities/default.json` only grants
`opener:allow-default-urls`). Plugin commands (e.g. `plugin-shell`) are deny-by-default and
require explicit scoped permissions. → **Adopt:** implement native superpowers as *custom,
scoped Rust commands* (workspace-confined, argument-allowlisted, timeout-bounded) instead of
`plugin-shell`, which would hand the webview a general subprocess API. Declare them in the
manifest as `ipc-command` dependencies and health-check them over IPC.

**Bret Victor / Nicky Case (explorable explanations).** Core principles we will bake into the
new extensions: direct manipulation with zero in-betweens (drag → system recalculates now);
*control* the parameter, *step up* to see all values at once, *step down* to a concrete
instance (ladder of abstraction); sliders over passive animation; every interaction produces
visible feedback; the explorable is embedded in prose, not a sandbox dump. → drives
ext-desmos-lab (scrubbing, tangent lines, challenge targets) and ext-3d-spatial-lab
(matrix sliders morphing basis vectors live).

**Desmos / GeoGebra.** 60fps graphing comes from incremental canvas redraws, parameter
sliders bound to expressions, and geometric verification (points on curves). → custom
high-DPI canvas engine + mathjs (evaluation **and symbolic derivatives**) + KaTeX (already
installed) for live LaTeX; draggable control points and shaded integrals as overlays.

**Excalidraw / XYFlow.** Node-edge canvases with pan/zoom, selection, and automatic layout.
→ `@xyflow/react` (the maintained React Flow v13 package) + `@dagrejs/dagre` for hierarchical
auto-layout (the original `dagre` 0.8.5 is unmaintained since 2022 — rejected).

**Sandpack / DuckDB-WASM playgrounds.** Studio-grade embedded dev environments: tabbed files,
console, instant test runners; real SQL engines in-browser with result inspection. →
ext-polyglot-studio (CodeMirror tabs + JS worker + lazy Pyodide) and ext-sql-duckdb-lab
(real DuckDB SQL, sortable Arrow result tables, automated grading).

## 2. Stack adaptation: React islands inside the vanilla host

The requested packages (`@xyflow/react`, `@react-three/fiber`, `@tanstack/react-table`,
`@uiw/react-codemirror`) are React libraries. Rather than porting the app, extensions may
bring their own UI runtime:

- `react` + `react-dom` 19.3.1 become regular dependencies, loaded **lazily** through a
  shared `react-runtime` helper (one cached React copy for all blocks; `createRoot` per
  block, `root.unmount()` in `destroy`). The host shell stays vanilla.
- React-based extensions are written in **TSX** (strict TypeScript — esbuild compiles it
  natively; `jsx: automatic`). The JSDoc-typed JS SDK remains; tsconfig gains `*.tsx`.
- esbuild `splitting` (already on) puts React and each heavy engine in separate chunks;
  initial app startup is unchanged.

## 3. Adopted packages (verified 2026-11-19)

| Package | Version | Used by | Loading | Notes |
| --- | --- | --- | --- | --- |
| react / react-dom | 19.3.1 | graph, polyglot, duckdb, 3d | lazy shared chunk | fiber 9 requires `>=19 <19.4` ✓ |
| @types/react / @types/react-dom | 19.3.0 | typecheck | dev | |
| @xyflow/react | 13.0.2 | ext-interactive-graph | lazy | peers react ≥18 ✓; CSS imported |
| @dagrejs/dagre | 3.1.3 | ext-interactive-graph | lazy | maintained fork of dagre |
| mathjs | 15.2.0 | ext-desmos-lab, ext-3d-spatial-lab | lazy | eval + `derivative()` symbolic |
| katex | 0.19.1 (installed) | ext-desmos-lab | bundled | live LaTeX labels |
| pyodide | 314.0.8 | ext-polyglot-studio | lazy + local assets | Python 3.14 WASM; self-hosted |
| @uiw/react-codemirror | 4.25.12 | ext-polyglot-studio | lazy | peers: codemirror 6, one-dark, @babel/runtime |
| codemirror | 6.0.2 | ext-polyglot-studio | lazy | meta package (peer of uiw) |
| @codemirror/lang-python | 6.2.1 | ext-polyglot-studio | lazy | |
| @codemirror/theme-one-dark | 6.1.3 | ext-polyglot-studio | lazy | |
| @babel/runtime | ^7 | ext-polyglot-studio | lazy | peer of uiw wrapper |
| @duckdb/duckdb-wasm | **1.32.0 (pinned)** | ext-sql-duckdb-lab | lazy + local assets | `latest` dist-tag is a **dev** build (1.33.1-dev57.0) — pin last stable |
| @tanstack/react-table | **8.21.3 (pinned)** | ext-sql-duckdb-lab | lazy | v9 is a fresh major; v8 API is battle-tested |
| three | 0.187.0 | ext-3d-spatial-lab | lazy | WebGL works in WKWebView |
| @types/three | 0.187.0 | typecheck | dev | |
| @react-three/fiber | 9.8.2 | ext-3d-spatial-lab | lazy | react 19 ✓ three ≥0.156 ✓ |
| @react-three/drei | 10.7.9 | ext-3d-spatial-lab | lazy | OrbitControls, Text, Line |

**Rejected / adapted:** `dagre` (unmaintained → @dagrejs/dagre); `function-plot` (maintained,
but its D3 chart API fights the required overlays — draggable points, tangent scrubbing,
integral shading, challenge targets; the brief explicitly allows a custom high-DPI engine,
which mathjs + canvas + KaTeX delivers with full control); `@duckdb/duckdb-wasm@latest`
(dev tag); `@tanstack/react-table@9` (too new); `plugin-shell` (over-broad IPC surface).

**Rust (src-tauri):** `sysinfo` 0.40.4 (crates.io, updated 2026-11-16) for the native system
panel; `tokio` gains the `process` feature for timeout-bounded subprocess runs. No new Tauri
plugins — native workbench commands are custom, scoped, and allowlisted (git 2.50.1 present
on host; pipelines are chained allowlisted programs, never a shell).

## 4. CSP & asset provisioning (Tauri)

Current CSP: `default-src 'self'; script-src 'self' 'unsafe-eval'; worker-src 'self'; …
connect-src ipc: http://ipc.localhost`. Required additions, each justified:

- `script-src` += `'wasm-unsafe-eval'` — Pyodide and DuckDB compile WASM. Pyodide docs:
  wasm-unsafe-eval is required; **Safari/WebKit ignores it and needs `unsafe-eval`**, which
  we already carry for the code-lab worker. No further loosening.
- `connect-src` += `'self'` — Pyodide/DuckDB fetch their own same-origin assets
  (explicit connect-src overrides default-src).
- Workers stay same-origin (`worker-src 'self'`): DuckDB's self-hosted
  `duckdb-browser-mvp.worker.js` is loaded directly (no blob: needed when self-hosted);
  Pyodide runs inside our own bundled worker entry; the JS sandbox reuses the code-lab
  worker pattern.

`build.mjs` provisions assets into `dist/` (dev server, Tauri frontendDist, and the
Playwright route harness all serve them identically):

- `dist/pyodide/` ← `node_modules/pyodide/{pyodide.asm.js,pyodide.asm.wasm,python_stdlib.zip,pyodide-lock.json}`;
  `loadPyodide({ indexURL: '/pyodide/' })`. No CDN at runtime; stdlib only (no micropip).
- `dist/duckdb/` ← `@duckdb/duckdb-wasm/dist/{duckdb-mvp.wasm,duckdb-eh.wasm,duckdb-browser-mvp.worker.js,duckdb-browser-eh.worker.js}`;
  manual `DuckDBBundles` + `selectBundle` (documented webpack/vite pattern, adapted to esbuild
  by copying files instead of `?url` imports).

Pyodide is single-instance per JS scope → one shared warm runtime in a dedicated worker,
reused by every polyglot block; runtime tracker exposes cold/loading/warm.

## 5. Runtime architecture additions

1. **`ExtensionDependencyManifest`** (zod-validated): `webPackages[{name,version,purpose,lazyLoad?}]`,
   `tauriDependencies[{type:'tauri-plugin'|'rust-crate'|'ipc-command',name,requiredPermissions?,fallbackBehavior:'disable-on-web'|'degrade-gracefully',purpose}]`.
   Registry audits declarations at registration; all six existing extensions get manifests too.
2. **`check_capability` Rust command + `checkTauriCapability()` bridge**: reports availability
   of IPC commands/plugins; on plain web (no `__TAURI_INTERNALS__`) returns unavailable with
   reason, and extensions apply their declared fallback. Frames show a diagnostic badge
   instead of crashing; the manager shows live Connected/Unavailable status.
3. **Runtime status tracker**: per-engine cold/loading/warm/error + asset provenance;
   surfaced in the manager's "Dependencies & Runtime" inspector and frame badges.
4. **Native workbench**: workspace-confined file/git/pipeline commands under
   `$APPDATA/workspaces/<id>/` with traversal/symlink guards (same pattern as `library.rs`),
   argument allowlists, and tokio timeouts; `native_system_info` via sysinfo.

## 6. Commit roadmap (16 atomic commits, per the brief)

1 docs research (this file) · 2 manifest types/schema/registry · 3 capability health-check
(Rust + bridge) · 4 manager/frame dependency UI · 5/6 graph deps+ext · 7/8 desmos deps+ext ·
9/10 polyglot deps+ext · 11/12 duckdb deps+ext · 13/14 3d deps+ext · 15 native workbench
(Rust + ext) · 16 Showcase v2 book + seeding + full E2E. Every commit: `npm run build` +
`npm run typecheck` + tests, `cargo check` whenever Rust changes; E2E scenario per extension.
