/**
 * End-to-end checks for the extension system. Builds the app, serves dist/
 * into Chromium with a mocked Tauri IPC layer (same pattern as
 * check-ai-ui.mjs), and exercises every built-in extension end to end:
 * rendering, interaction, persistence across reload, manager toggles, and
 * AI skill injection.
 *
 * Run: node scripts/check-extensions-ui.mjs [scenario …]
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
execFileSync(process.execPath, ['build.mjs']);
const output = '.deinorganizer/e2e-staging/extensions';

const labIndex = '---\ntitle: Extension Lab\ndescription: Fixture book for extension checks.\n---\n\n# Extension Lab\n\nInteractive blocks under test.';
const diagramsChapter = `---
name: Diagrams
order: 1
---

# Diagrams

A flowchart with a stable id:

\`\`\`ext-mermaid
id: flow-1
title: Decision flow
diagram: |
  flowchart TD
    A["Start"] --> B{"ok?"}
    B -- yes --> C["Done"]
    B -- no --> A
\`\`\`

A malformed block must render a validation card, never crash:

\`\`\`ext-mermaid
id: broken-1
caption: missing diagram field
\`\`\`
`;

const plotsChapter = `---
name: Plots
order: 2
---

# Plots

A quadratic family with live sliders:

\`\`\`ext-math-plot
id: quadratic-1
title: Quadratic family
xRange: [-6, 6]
functions:
  - expr: a*x^2 + b*x + c
    label: f(x)
params:
  - name: a
    min: -3
    max: 3
    step: 0.1
    value: 1
  - name: b
    min: -5
    max: 5
    step: 0.1
    value: 0
  - name: c
    min: -5
    max: 5
    step: 0.1
    value: 0
\`\`\`

An expression referencing an undeclared symbol must fail gracefully:

\`\`\`ext-math-plot
id: bad-plot
functions:
  - expr: mystery*x
\`\`\`
`;

const steppersChapter = `---
name: Steppers
order: 3
---

# Steppers

An algorithm trace:

\`\`\`ext-state-stepper
id: sort-trace
title: Bubble sort pass
steps:
  - title: Start
    explanation: Compare the first pair.
    arrays:
      - name: a
        values: [5, 2, 8, 1]
        highlight: [0, 1]
        pointers: { i: 0, j: 1 }
    variables: { swaps: 0 }
  - title: Swap
    explanation: 5 > 2, swap them.
    arrays:
      - name: a
        values: [2, 5, 8, 1]
        highlight: [0, 1]
        pointers: { i: 0, j: 1 }
    variables: { swaps: 1 }
  - title: Advance
    explanation: Move the window right.
    arrays:
      - name: a
        values: [2, 5, 8, 1]
        highlight: [1, 2]
        pointers: { i: 1, j: 2 }
    variables: { swaps: 1 }
  - title: Done
    explanation: The pass ends with 8 at the right edge.
    arrays:
      - name: a
        values: [2, 5, 1, 8]
        highlight: [2, 3]
        pointers: { i: 2, j: 3 }
    variables: { swaps: 2 }
\`\`\`

A state machine:

\`\`\`ext-state-stepper
id: states-1
title: Connection states
steps:
  - title: Closed
    nodes:
      - { id: closed, label: CLOSED, active: true }
      - { id: listen, label: LISTEN }
    edges:
      - { from: closed, to: listen, label: open }
  - title: Listening
    nodes:
      - { id: closed, label: CLOSED }
      - { id: listen, label: LISTEN, active: true }
    edges:
      - { from: closed, to: listen, label: open, active: true }
\`\`\`
`;

const codeLabChapter = `---
name: Code Lab
order: 4
---

# Code Lab

Implement binary search:

\`\`\`ext-code-lab
id: lab-binary
title: Binary search
description: |
  Return the index of \`target\` in the sorted array, or \`-1\`.
starter: |
  function binarySearch(a, target) {
    // your code here
  }
tests:
  - name: finds the middle
    fn: binarySearch
    args: [[1, 3, 5, 7, 9], 5]
    expected: 2
  - name: missing value
    fn: binarySearch
    args: [[1, 3, 5], 4]
    expected: -1
  - name: empty array
    fn: binarySearch
    args: [[], 1]
    expected: -1
  - name: single element hit
    fn: binarySearch
    args: [[42], 42]
    expected: 0
    hidden: true
\`\`\`

An infinite loop must be killed by the timeout:

\`\`\`ext-code-lab
id: lab-loop
title: Runaway loop
timeoutMs: 1000
starter: |
  function spin() {
    while (true) {}
  }
tests:
  - name: terminates
    fn: spin
    args: []
    expected: null
\`\`\`
`;

const parsonsChapter = `---
name: Parsons
order: 5
---

# Parsons

Order the proof:

\`\`\`ext-parsons-puzzle
id: parsons-order
title: Sum of two evens
prompt: Arrange the proof steps in a valid logical order.
lines:
  - text: "Let m = 2a and n = 2b."
  - text: "Then m + n = 2a + 2b."
  - text: "Factor: m + n = 2(a + b)."
  - text: "Since a + b is an integer, m + n is even."
distractors:
  - "Therefore m + n is odd."
\`\`\`

Order and indent the Python:

\`\`\`ext-parsons-puzzle
id: parsons-indent
title: Indent the function
indentation: true
lines:
  - text: "def total(n):"
    indent: 0
  - text: "s = 0"
    indent: 1
  - text: "return s"
    indent: 1
\`\`\`
`;

const sqlLabChapter = `---
name: SQL Lab
order: 6
---

# SQL Lab

Query the library:

\`\`\`ext-sql-lab
id: sql-where
title: Early science fiction
prompt: |
  List the \`title\` of every book published before 1970.
setup: |
  CREATE TABLE books (id INT, title STRING, year INT);
  INSERT INTO books VALUES (1, 'Dune', 1965);
  INSERT INTO books VALUES (2, 'Neuromancer', 1984);
  INSERT INTO books VALUES (3, 'Foundation', 1951);
  INSERT INTO books VALUES (4, 'Snow Crash', 1992);
starter: |
  SELECT title FROM books
expected:
  - { title: Dune }
  - { title: Foundation }
\`\`\`
`;

const graphsChapter = `---
name: Graphs
order: 7
---

# Graphs

Explore the proof map:

\`\`\`ext-interactive-graph
id: graph-explore
title: Proof map
mode: explore
layout: TB
nodes:
  - id: def-even
    label: "Definition: even"
    kind: definition
    note: An integer is even when it equals 2k.
  - id: closure
    label: "Closure under +"
    kind: lemma
    note: The sum of two integers is an integer.
  - id: sum-even
    label: "Sum of evens is even"
    kind: theorem
    note: Factor 2a + 2b as 2(a+b).
edges:
  - { from: def-even, to: sum-even, label: unfolds }
  - { from: closure, to: sum-even, label: justifies }
\`\`\`

Wire the missing links:

\`\`\`ext-interactive-graph
id: graph-wire
title: Wire the pipeline
mode: exercise
layout: LR
nodes:
  - { id: src, label: Source, kind: concept }
  - { id: lex, label: Lexer, kind: step }
  - { id: parse, label: Parser, kind: step }
  - { id: codegen, label: Codegen, kind: step }
edges:
  - { from: src, to: lex }
  - { from: lex, to: parse }
  - { from: parse, to: codegen }
exercise:
  type: wire-edges
  hiddenEdges:
    - { from: lex, to: parse }
    - { from: parse, to: codegen }
\`\`\`

Classify the nodes:

\`\`\`ext-interactive-graph
id: graph-classify
title: Classify the proof steps
mode: exercise
layout: TB
nodes:
  - { id: n1, label: "Even means 2k", kind: definition }
  - { id: n2, label: "Sum of integers is integer", kind: lemma }
  - { id: n3, label: "Sum of evens is even", kind: theorem }
edges:
  - { from: n1, to: n3 }
  - { from: n2, to: n3 }
exercise:
  type: classify-nodes
  extraKinds: [claim]
\`\`\`
`;

const desmosChapter = `---
name: Desmos Studio
order: 8
---

# Desmos Studio

Drag the vertex:

\`\`\`ext-desmos-lab
id: desmos-vertex
title: Drag the vertex of a parabola
mode: explore
xRange: [-6, 6]
yRange: [-4, 8]
curves:
  - kind: function
    expr: a*(x-h)^2 + k
    label: f(x)
    tangent: true
    area: { from: 0, to: 2 }
params:
  - { name: a, min: -3, max: 3, step: 0.1, value: 1 }
  - { name: h, min: -4, max: 4, step: 0.1, value: 0 }
  - { name: k, min: -3, max: 5, step: 0.1, value: 0 }
draggables:
  - { paramX: h, paramY: k, label: vertex, color: "#e8d06f" }
\`\`\`

A travelling wave:

\`\`\`ext-desmos-lab
id: desmos-wave
title: Travelling wave
mode: explore
xRange: [-6, 6]
yRange: [-2, 2]
curves:
  - kind: function
    expr: sin(x - t)
    label: sin(x - t)
animate: { min: 0, max: 6.283185, speed: 2 }
\`\`\`

Fit the line:

\`\`\`ext-desmos-lab
id: desmos-fit-line
title: Fit the line through P1 and P2
mode: challenge
xRange: [-1, 5]
yRange: [-1, 7]
curves:
  - kind: function
    expr: m*x + b
    label: y = m x + b
    color: "#73d695"
params:
  - { name: m, min: -4, max: 4, step: 0.05, value: 0 }
  - { name: b, min: -4, max: 6, step: 0.05, value: 0 }
draggables:
  - { paramY: b, x: 0, label: intercept, color: "#6fb7e8" }
targets:
  - { x: 1, y: 2, tolerance: 0.15, label: P1 }
  - { x: 3, y: 4, tolerance: 0.15, label: P2 }
challengeCurve: 0
\`\`\`
`;

const polyglotChapter = `---
name: Polyglot Studio
order: 9
---

# Polyglot Studio

Python exercise:

\`\`\`ext-polyglot-studio
id: poly-two-sum
title: "Two Sum (Python)"
language: python
description: |
  Return the **indices** of the two numbers in \`nums\` that add up to
  \`target\` (ascending order). Exactly one solution exists.
starter: |
  print("sandbox ready")
  def two_sum(nums, target):
      # Return the two indices whose values sum to target.
      pass
tests:
  - name: basic pair
    fn: two_sum
    args: [[2, 7, 11, 15], 9]
    expected: [0, 1]
  - name: middle pair
    fn: two_sum
    args: [[3, 2, 4], 6]
    expected: [1, 2]
  - name: negatives (hidden)
    fn: two_sum
    args: [[-3, 4, 3, 90], 0]
    expected: [0, 2]
    hidden: true
hints:
  - A brute-force double loop works in O(n²).
  - Store seen values in a dict mapping value → index.
\`\`\`

JavaScript exercise:

\`\`\`ext-polyglot-studio
id: poly-fib
title: "Fibonacci (JavaScript)"
language: javascript
description: Return the n-th Fibonacci number (0-indexed), iteratively.
starter: |
  function fib(n) {
    return 0;
  }
tests:
  - { name: zero, fn: fib, args: [0], expected: 0 }
  - { name: one, fn: fib, args: [1], expected: 1 }
  - { name: ten, fn: fib, args: [10], expected: 55 }
  - { name: large (hidden), fn: fib, args: [50], expected: 12586269025, hidden: true }
\`\`\`
`;

const duckdbChapter = `---
name: DuckDB Lab
order: 10
---

# DuckDB Lab

Explore the data:

\`\`\`ext-sql-duckdb-lab
id: duckdb-explore
title: Explore regional sales
mode: explore
description: Run queries and sort the result table by clicking column headers.
tables:
  - name: sales
    columns:
      - { name: region, type: TEXT }
      - { name: product, type: TEXT }
      - { name: units, type: INTEGER }
      - { name: revenue, type: DOUBLE }
    rows:
      - [EU, Widget, 10, 100.0]
      - [EU, Gizmo, 4, 60.0]
      - [US, Widget, 7, 70.0]
      - [US, Gizmo, 9, 135.0]
      - [APAC, Widget, 12, 120.0]
query: |
  SELECT * FROM sales;
\`\`\`

Aggregate challenge:

\`\`\`ext-sql-duckdb-lab
id: duckdb-challenge
title: Total revenue per region
mode: challenge
description: |
  Return each region's total revenue as columns \`region\` and \`total\`,
  rounded to 2 decimals. Row order does not matter.
tables:
  - name: sales
    columns:
      - { name: region, type: TEXT }
      - { name: product, type: TEXT }
      - { name: units, type: INTEGER }
      - { name: revenue, type: DOUBLE }
    rows:
      - [EU, Widget, 10, 100.0]
      - [EU, Gizmo, 4, 60.0]
      - [US, Widget, 7, 70.0]
      - [US, Gizmo, 9, 135.0]
      - [APAC, Widget, 12, 120.0]
query: |
  SELECT region FROM sales;
expected:
  columns: [region, total]
  rows:
    - [EU, 160.0]
    - [US, 205.0]
    - [APAC, 120.0]
  ordered: false
\`\`\`
`;

const spatialChapter = `---
name: Spatial Lab
order: 11
---

# Spatial Lab

Find the matrix:

\`\`\`ext-3d-spatial-lab
id: spatial-find-matrix
title: "Find the matrix A"
mode: challenge
kind: vectors
description: Tune the entries of A until the transformed basis vectors land on the targets.
vectors:
  - { to: [1, 0, 0], label: e1, color: "#e88f9f" }
  - { to: [0, 1, 0], label: e2, color: "#73d695" }
transform:
  label: A
  matrix:
    - [a, b, "0"]
    - [c, d, "0"]
    - ["0", "0", "1"]
params:
  - { name: a, min: -3, max: 3, step: 0.1, value: 1 }
  - { name: b, min: -3, max: 3, step: 0.1, value: 0 }
  - { name: c, min: -3, max: 3, step: 0.1, value: 0 }
  - { name: d, min: -3, max: 3, step: 0.1, value: 1 }
targets:
  - { vector: 0, position: [2, 1, 0], tolerance: 0.15, label: "A·e1" }
  - { vector: 1, position: [1, 2, 0], tolerance: 0.15, label: "A·e2" }
\`\`\`

Animated surface:

\`\`\`ext-3d-spatial-lab
id: spatial-ripple
title: Ripple surface
kind: surface
surface:
  expr: a * sin(x - t) * cos(y)
  xRange: [-4, 4]
  yRange: [-4, 4]
  resolution: 32
params:
  - { name: a, min: 0.2, max: 2, step: 0.05, value: 1 }
animate: { min: 0, max: 6.283185, speed: 2 }
\`\`\`

Geometric solids:

\`\`\`ext-3d-spatial-lab
id: spatial-solids
title: Solid geometry
kind: solids
solids:
  - { shape: box, position: [-2, 0, 0.5], size: [1, 1, 1], color: "#6fb7e8", label: cube }
  - { shape: sphere, position: [0, 0, 0.8], size: [0.8, 0, 0], color: "#73d695", label: sphere }
  - { shape: torus, position: [2, 0, 0.6], size: [0.7, 0.25, 0], color: "#e8d06f", label: torus }
\`\`\`
`;

const nativeChapter = `---
name: Native Workbench
order: 12
---

# Native Workbench

Git exercise:

\`\`\`ext-tauri-native-workbench
id: native-git-feature
title: "Git: feature branch workflow"
kind: git
description: |
  Create a branch named \`feature\`, add \`hello.txt\` containing exactly
  \`hello\` (one line), and commit it with a message containing "add greeting".
setup:
  gitInit: true
  files:
    - { path: README.md, content: "# Demo project\\n" }
checks:
  - { type: branch-exists, name: feature }
  - { type: current-branch, name: feature }
  - { type: file-equals, path: hello.txt, content: "hello\\n" }
  - { type: log-contains, text: add greeting }
\`\`\`

Pipeline exercise:

\`\`\`ext-tauri-native-workbench
id: native-pipeline-errors
title: "Pipeline: count the errors"
kind: pipeline
description: Count the lines containing ERROR in server.log and save the number to count.txt.
setup:
  files:
    - path: server.log
      content: |
        INFO started
        ERROR disk full
        INFO retrying
        ERROR timeout
        INFO done
checks:
  - type: pipeline-output
    stages:
      - [cat, server.log]
      - [grep, ERROR]
      - [wc, "-l"]
    expected: "2"
  - { type: file-equals, path: count.txt, content: "2\\n" }
\`\`\`

Native system facts:

\`\`\`ext-tauri-native-workbench
id: native-system
title: This machine
kind: system
mode: explore
description: Real host facts reported by the Rust backend (sysinfo).
\`\`\`
`;

const fixtureEntries = [
  { path: 'Buches/Extension Lab/_index.md', source: labIndex },
  { path: 'Buches/Extension Lab/concepts/Diagrams.md', source: diagramsChapter },
  { path: 'Buches/Extension Lab/concepts/Plots.md', source: plotsChapter },
  { path: 'Buches/Extension Lab/concepts/Steppers.md', source: steppersChapter },
  { path: 'Buches/Extension Lab/concepts/Code Lab.md', source: codeLabChapter },
  { path: 'Buches/Extension Lab/concepts/Parsons.md', source: parsonsChapter },
  { path: 'Buches/Extension Lab/concepts/SQL Lab.md', source: sqlLabChapter },
  { path: 'Buches/Extension Lab/concepts/Graphs.md', source: graphsChapter },
  { path: 'Buches/Extension Lab/concepts/Desmos Studio.md', source: desmosChapter },
  { path: 'Buches/Extension Lab/concepts/Polyglot Studio.md', source: polyglotChapter },
  { path: 'Buches/Extension Lab/concepts/DuckDB Lab.md', source: duckdbChapter },
  { path: 'Buches/Extension Lab/concepts/Spatial Lab.md', source: spatialChapter },
  { path: 'Buches/Extension Lab/concepts/Native Workbench.md', source: nativeChapter },
];

const browser = await chromium.launch({
  ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }),
  // Software WebGL (SwiftShader) for the 3D lab scenarios; recent Chromium
  // gates it behind this flag, and without it GPU-process crashes can occur.
  args: ['--enable-unsafe-swiftshader'],
});

const demo = 'demo/Buches';
const demoEntries = await Promise.all((await readdir(demo, { recursive: true }))
  .filter(file => file.endsWith('.md'))
  .map(async file => ({ path: 'Buches/' + file, source: await readFile(resolve(demo, file), 'utf8') })));

async function setup(entries = fixtureEntries, bookTitle = 'Extension Lab') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 840 } });
  await page.route('http://localhost/**', route => {
    const { pathname } = new URL(route.request().url());
    const file = resolve('dist', pathname === '/' ? 'index.html' : pathname.slice(1));
    return existsSync(file) ? route.fulfill({ path: file }) : route.abort();
  });
  await page.addInitScript(seed => {
    const read = () => JSON.parse(localStorage.getItem('fixture-library') ?? JSON.stringify(seed));
    const write = entries => localStorage.setItem('fixture-library', JSON.stringify(entries));
    window.__TAURI_INTERNALS__ = {
      async invoke(command, args) {
        const entries = read();
        if (command === 'load_library') return { basePath: '/fixture', entries };
        if (command === 'save_markdown') {
          const current = entries.find(entry => entry.path === args.path);
          if ((current?.source ?? null) !== args.expected) throw new Error('The file changed on disk.');
          if (current) current.source = args.text;
          else entries.push({ path: args.path, source: args.text });
          write(entries);
          return;
        }
        if (command === 'discard_solution') {
          write(entries.filter(entry => !(entry.path === args.path && entry.source === args.expected)));
          return;
        }
        if (command === 'ai_ollama_status') return { installed: true, connected: true, models: ['fixture:latest'] };
        if (command === 'chatgpt_status') return { state: 'signed-out' };
        // --- Native workbench mock (in-memory; the real sandbox is cargo-tested) ---
        if (command === 'check_capability') {
          const known = ['workbench_init', 'workbench_reset', 'workbench_write', 'workbench_read',
            'workbench_list', 'workbench_run', 'workbench_pipeline', 'native_system_info', 'sysinfo'];
          return known.includes(args.name)
            ? { name: args.name, kind: args.name === 'sysinfo' ? 'rust-crate' : 'ipc-command', available: true, detail: 'Fixture capability.' }
            : { name: args.name, kind: 'unknown', available: false, detail: 'Not registered in fixture.' };
        }
        if (command === 'native_system_info') {
          return { os: 'FixtureOS', osVersion: '1.0', kernel: 'fixture-kernel', hostname: 'e2e-host', cpuBrand: 'Fixture CPU', cpuCount: 8, totalMemoryMb: 16384, usedMemoryMb: 8192 };
        }
        if (command.startsWith('workbench_')) {
          window.fixtureWorkspaces = window.fixtureWorkspaces ?? new Map();
          const state = (() => {
            if (!window.fixtureWorkspaces.has(args.workspaceId)) {
              window.fixtureWorkspaces.set(args.workspaceId, { files: new Map(), git: null });
            }
            return window.fixtureWorkspaces.get(args.workspaceId);
          })();
          const ok = (stdout = '', stderr = '', code = 0) => ({ stdout, stderr, code });
          const runStage = (program, stageArgs, stdin) => {
            if (program === 'git') {
              const [sub, ...rest] = stageArgs;
              if (sub === 'init') {
                const branch = rest.includes('-b') ? rest[rest.indexOf('-b') + 1] : 'main';
                state.git = { branch, branches: [branch], commits: [] };
                return ok('Initialized empty Git repository\n');
              }
              if (!state.git) return ok('', 'not a git repository', 128);
              if (sub === 'add') return ok();
              if (sub === 'commit') {
                const mi = rest.indexOf('-m');
                state.git.commits.push(mi >= 0 ? rest[mi + 1] : 'commit');
                return ok(`[${state.git.branch} commit]\n`);
              }
              if (sub === 'checkout') {
                const bi = rest.indexOf('-b');
                if (bi >= 0) {
                  const name = rest[bi + 1];
                  state.git.branches.push(name);
                  state.git.branch = name;
                  return ok(`Switched to a new branch '${name}'\n`);
                }
                if (!state.git.branches.includes(rest[0])) return ok('', `pathspec '${rest[0]}' did not match`, 1);
                state.git.branch = rest[0];
                return ok(`Switched to branch '${rest[0]}'\n`);
              }
              if (sub === 'branch') return ok(state.git.branches.map(b => (b === state.git.branch ? '* ' : '  ') + b).join('\n') + '\n');
              if (sub === 'rev-parse') return ok(state.git.branch + '\n');
              if (sub === 'log') return ok(state.git.commits.map((m, i) => `abc${i} ${m}`).join('\n') + (state.git.commits.length ? '\n' : ''));
              if (sub === 'status') return ok(`On branch ${state.git.branch}\n`);
              return ok('', `git ${sub} is not allowed.`, 1);
            }
            const input = stdin ?? '';
            if (program === 'echo') return ok(stageArgs.join(' ') + '\n');
            if (program === 'cat') {
              if (!stageArgs.length) return ok(input);
              let out = '';
              for (const p of stageArgs) {
                if (!state.files.has(p)) return ok('', `cat: ${p}: No such file or directory`, 1);
                out += state.files.get(p);
              }
              return ok(out);
            }
            if (program === 'grep') {
              const pattern = stageArgs.find(a => !a.startsWith('-'));
              const lines = input.split('\n').filter(l => l.includes(pattern));
              return ok(lines.length ? lines.join('\n') + '\n' : '', '', lines.length ? 0 : 1);
            }
            if (program === 'wc') return ok(String(input.split('\n').filter(l => l.length).length) + '\n');
            if (program === 'sort') return ok(input.split('\n').filter(l => l.length).sort().join('\n') + '\n');
            if (program === 'ls') return ok([...state.files.keys()].join('\n') + '\n');
            return ok('', `${program} is not allowed.`, 1);
          };
          if (command === 'workbench_init') return '/fixture/workspaces/' + args.workspaceId;
          if (command === 'workbench_reset') { window.fixtureWorkspaces.delete(args.workspaceId); return; }
          if (command === 'workbench_write') { state.files.set(args.path, args.content); return; }
          if (command === 'workbench_read') {
            if (!state.files.has(args.path)) throw new Error('No such file: ' + args.path);
            return state.files.get(args.path);
          }
          if (command === 'workbench_list') return [...state.files.entries()].map(([path, content]) => ({ path, size: content.length }));
          if (command === 'workbench_run') {
            const out = runStage(args.program, args.args, null);
            if (args.outputFile) state.files.set(args.outputFile, out.stdout);
            return out;
          }
          if (command === 'workbench_pipeline') {
            let carry = null;
            let last = ok();
            const stderrs = [];
            for (const stage of args.stages) {
              last = runStage(stage[0], stage.slice(1), carry);
              if (last.stderr) stderrs.push(last.stderr);
              carry = last.stdout;
            }
            last.stderr = stderrs.join('\n');
            if (args.outputFile) state.files.set(args.outputFile, last.stdout);
            return last;
          }
        }
        if (command === 'ai_prepare_import' || command === 'ai_propose_patch' || command === 'ai_explain'
          || command === 'ai_generate_solution' || command === 'ai_review_solution') {
          window.fixtureSkillRequests = window.fixtureSkillRequests ?? [];
          window.fixtureSkillRequests.push({ command, skills: args.skills ?? null });
          throw new Error('Fixture does not generate.');
        }
        throw new Error('Unexpected IPC command ' + command);
      },
    };
  }, entries);
  await page.goto('http://localhost/');
  await page.getByRole('heading', { name: bookTitle, level: 1 }).waitFor();
  return page;
}

const button = (page, name) => page.getByRole('button', { name, exact: true });
async function openChapter(page, name) {
  await page.locator('.tree-link', { hasText: name }).first().click();
  await page.locator('article h1.page-title', { hasText: name }).waitFor();
}
async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${output}/${name}.jpg`, type: 'jpeg', quality: 90, animations: 'disabled' });
}
async function openExtensionsManager(page) {
  await button(page, 'Settings').click();
  await button(page, 'Extensions').click();
  await page.locator('.extension-manager-card').first().waitFor();
}
const storedProgress = page => page.evaluate(() => {
  const entries = JSON.parse(localStorage.getItem('fixture-library'));
  return entries.find(entry => entry.path.endsWith('_progress.md'))?.source ?? '';
});

const scenarios = {
  async mermaid(page) {
    await openChapter(page, 'Diagrams');
    const frame = page.locator('.extension-frame[data-extension="ext-mermaid"][data-block-key="id:flow-1"]');
    await frame.locator('.mermaid-stage svg').waitFor({ timeout: 20000 });
    assert.match(await frame.locator('.mermaid-zoom-label').textContent(), /^\d+%$/);
    assert.ok(await frame.locator('.mermaid-stage svg').innerHTML().then(html => html.includes('Start')));
    await shot(page, 'mermaid-01-rendered');

    // Validation fallback for the malformed block.
    const fallback = page.locator('.extension-fallback', { hasText: 'invalid block data' });
    await fallback.waitFor();
    assert.ok(await fallback.textContent().then(text => text.includes('diagram')));

    // Zoom controls + persistence across reload.
    await button(page, 'Reset view').click();
    assert.equal(await frame.locator('.mermaid-zoom-label').textContent(), '100%');
    await button(page, 'Zoom in').click();
    assert.equal(await frame.locator('.mermaid-zoom-label').textContent(), '125%');
    await page.waitForTimeout(650);
    assert.match(await storedProgress(page), /id:flow-1/);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Diagrams' }).waitFor();
    await frame.locator('.mermaid-stage svg').waitFor({ timeout: 20000 });
    assert.equal(await frame.locator('.mermaid-zoom-label').textContent(), '125%');
    await button(page, 'Reset view').click();
    assert.equal(await frame.locator('.mermaid-zoom-label').textContent(), '100%');

    // Pan with the pointer.
    const box = await frame.locator('.mermaid-viewport').boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    const transform = await frame.locator('.mermaid-stage').evaluate(node => node.style.transform);
    assert.match(transform, /translate\(60px, 20px\)/);
    await shot(page, 'mermaid-02-panned');

    // Collapse / expand and source inspection.
    await frame.locator('.extension-collapse').click();
    assert.equal(await frame.locator('.extension-frame-body').isHidden(), true);
    await frame.locator('.extension-collapse').click();
    await frame.getByRole('button', { name: 'View source and data' }).click();
    await page.getByRole('dialog', { name: 'Extension source' }).waitFor();
    assert.ok(await page.getByRole('dialog').textContent().then(text => text.includes('flowchart TD')));
    await page.keyboard.press('Escape');

    // Manager toggle removes rendering and skill injection; re-enable restores.
    await openExtensionsManager(page);
    const toggle = page.getByRole('switch', { name: 'Disable Mermaid Diagram' });
    await toggle.click();
    await page.getByRole('switch', { name: 'Enable Mermaid Diagram' }).waitFor();
    await page.locator('.extension-manager-card', { hasText: 'Mermaid Diagram' }).getByRole('button', { name: 'View AI skill' }).click();
    await page.getByRole('dialog', { name: 'AI skill · Mermaid Diagram' }).waitFor();
    assert.ok(await page.getByRole('dialog').textContent().then(text => text.includes('sequenceDiagram')));
    await page.keyboard.press('Escape');
    await button(page, 'View composed AI prompt').click();
    const composed = await page.getByRole('dialog').textContent();
    assert.ok(!composed.includes('ext-mermaid'), 'disabled extension must leave the composed prompt');
    assert.ok(composed.includes('ext-math-plot'), 'enabled extensions stay in the composed prompt');
    await page.keyboard.press('Escape');
    await button(page, 'Back to reader').click();
    await page.locator('.extension-disabled-card', { hasText: 'Mermaid Diagram' }).first().waitFor();
    assert.equal(await page.locator('.extension-frame[data-extension="ext-mermaid"] .mermaid-stage svg').count(), 0);
    await shot(page, 'mermaid-03-disabled');
    await page.locator('.extension-disabled-card').first().getByRole('button', { name: 'Enable extension' }).click();
    await frame.locator('.mermaid-stage svg').waitFor({ timeout: 20000 });
    await shot(page, 'mermaid-04-reenabled');
  },
  async mathPlot(page) {
    await openChapter(page, 'Plots');
    const frame = page.locator('.extension-frame[data-extension="ext-math-plot"][data-block-key="id:quadratic-1"]');
    await frame.locator('canvas').waitFor();
    await page.waitForTimeout(300);
    const before = await frame.locator('canvas').evaluate(node => node.toDataURL());
    assert.ok(before.length > 5000, 'canvas should contain a rendered plot');
    await shot(page, 'plot-01-default');

    // Move slider a and confirm the curve redraws and the value label updates.
    const slider = frame.getByLabel('Parameter a');
    await slider.evaluate(node => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(node, '2.5');
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await frame.locator('.plot-param-value').first().textContent(), '2.5');
    const after = await frame.locator('canvas').evaluate(node => node.toDataURL());
    assert.notEqual(before, after);
    await shot(page, 'plot-02-slider');

    // Persistence across reload.
    await page.waitForTimeout(650);
    assert.match(await storedProgress(page), /quadratic-1/);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Plots' }).waitFor();
    await frame.locator('canvas').waitFor();
    assert.equal(await frame.getByLabel('Parameter a').inputValue(), '2.5');

    // Hover readout.
    const box = await frame.locator('canvas').boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
    await frame.locator('.plot-readout').waitFor();
    assert.match(await frame.locator('.plot-readout').textContent(), /x = /);

    // Undeclared symbol → error fallback card, not a crash.
    await page.locator('.extension-fallback', { hasText: 'could not render' }).waitFor();
    assert.ok(await page.locator('.extension-fallback', { hasText: 'could not render' }).textContent()
      .then(text => text.includes('mystery')));
    await shot(page, 'plot-03-error-fallback');
  },
  async stateStepper(page) {
    await openChapter(page, 'Steppers');
    const frame = page.locator('.extension-frame[data-extension="ext-state-stepper"][data-block-key="id:sort-trace"]');
    await frame.locator('.stepper-cell').first().waitFor();
    assert.equal(await frame.locator('.stepper-counter').textContent(), 'Step 1 / 4');
    assert.equal(await frame.locator('.stepper-cell').first().textContent(), '5');
    assert.equal(await frame.locator('.stepper-cell.highlighted').count(), 2);
    assert.equal(await frame.locator('.stepper-pointer').count(), 2);
    await shot(page, 'stepper-01-step1');

    // Next advances the snapshot.
    await frame.getByRole('button', { name: 'Next step' }).click();
    assert.equal(await frame.locator('.stepper-counter').textContent(), 'Step 2 / 4');
    assert.equal(await frame.locator('.stepper-cell').first().textContent(), '2');
    assert.match(await frame.locator('.stepper-variable').textContent(), /1/);

    // Position persists across reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Steppers' }).waitFor();
    await frame.locator('.stepper-cell').first().waitFor();
    assert.equal(await frame.locator('.stepper-counter').textContent(), 'Step 2 / 4');

    // Prev and bounds.
    await frame.getByRole('button', { name: 'Previous step' }).click();
    assert.equal(await frame.locator('.stepper-counter').textContent(), 'Step 1 / 4');
    assert.equal(await frame.getByRole('button', { name: 'Previous step' }).isDisabled(), true);
    for (let i = 0; i < 3; i += 1) await frame.getByRole('button', { name: 'Next step' }).click();
    assert.equal(await frame.locator('.stepper-counter').textContent(), 'Step 4 / 4');
    assert.equal(await frame.getByRole('button', { name: 'Next step' }).isDisabled(), true);

    // Auto-play restarts from the end and advances; pause stops it.
    await frame.getByLabel('Auto-play speed').selectOption('3');
    await frame.getByRole('button', { name: 'Auto-play' }).click();
    await frame.getByRole('button', { name: 'Pause' }).waitFor();
    await page.waitForTimeout(550);
    const played = await frame.locator('.stepper-counter').textContent();
    assert.notEqual(played, 'Step 1 / 4');
    await frame.getByRole('button', { name: 'Pause' }).click();
    const paused = await frame.locator('.stepper-counter').textContent();
    await page.waitForTimeout(450);
    assert.equal(await frame.locator('.stepper-counter').textContent(), paused);
    await shot(page, 'stepper-02-autoplay');

    // State machine block renders nodes and transitions.
    const graph = page.locator('.extension-frame[data-block-key="id:states-1"]');
    await graph.locator('.stepper-node').first().waitFor();
    assert.equal(await graph.locator('.stepper-node.active').count(), 1);
    assert.equal(await graph.locator('.stepper-node-label.active').textContent(), 'CLOSED');
    await graph.getByRole('button', { name: 'Next step' }).click();
    assert.equal(await graph.locator('.stepper-node-label.active').textContent(), 'LISTEN');
    await shot(page, 'stepper-03-graph');
  },
  async codeLab(page) {
    await openChapter(page, 'Code Lab');
    const frame = page.locator('.extension-frame[data-extension="ext-code-lab"][data-block-key="id:lab-binary"]');
    await frame.locator('.cm-content').waitFor();
    assert.match(await frame.locator('.cm-content').textContent(), /function binarySearch/);
    assert.equal(await frame.locator('.extension-badge').textContent(), 'Unsolved');
    await shot(page, 'codelab-01-starter');

    // Running the empty starter fails the tests and marks progress.
    await frame.getByRole('button', { name: 'Run tests' }).click();
    await frame.locator('.codelab-test').first().waitFor();
    assert.equal(await frame.locator('.codelab-summary').textContent(), '0 / 4 tests passed');
    assert.equal(await frame.locator('.extension-badge').textContent(), 'In Progress');
    const hiddenRow = frame.locator('.codelab-test', { hasText: 'Hidden test 1' });
    assert.equal(await hiddenRow.count(), 1);
    assert.ok(!(await hiddenRow.textContent()).includes('single element'));
    await shot(page, 'codelab-02-failing');

    // Write a correct solution and run again.
    const solution = 'function binarySearch(a, target) {\n  let lo = 0, hi = a.length - 1;\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1;\n    if (a[mid] === target) return mid;\n    if (a[mid] < target) lo = mid + 1;\n    else hi = mid - 1;\n  }\n  return -1;\n}';
    await frame.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText(solution);
    await frame.getByRole('button', { name: 'Run tests' }).click();
    await frame.locator('.codelab-test.pass').first().waitFor();
    assert.equal(await frame.locator('.codelab-summary').textContent(), '4 / 4 tests passed');
    await frame.locator('.extension-badge[data-status="passed"]').waitFor();
    // Completion marked the book exercise solved (exerciseTools shows "Solved").
    await page.getByRole('button', { name: 'Solved', exact: true }).first().waitFor();
    assert.match(await storedProgress(page), /solved/);
    await shot(page, 'codelab-03-passed');

    // Code, results, and status survive a reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Code Lab' }).waitFor();
    await frame.locator('.cm-content').waitFor();
    assert.match(await frame.locator('.cm-content').textContent(), /while \(lo <= hi\)/);
    assert.equal(await frame.locator('.codelab-summary').textContent(), '4 / 4 tests passed');
    assert.equal(await frame.locator('.extension-badge').textContent(), 'Passed');

    // The infinite-loop block is terminated by the timeout; the app stays live.
    const loop = page.locator('.extension-frame[data-block-key="id:lab-loop"]');
    await loop.getByRole('button', { name: 'Run tests' }).click();
    await loop.locator('.codelab-test-detail', { hasText: 'timed out' }).waitFor({ timeout: 8000 });
    assert.equal(await loop.locator('.extension-badge').textContent(), 'In Progress');
    await shot(page, 'codelab-04-timeout');
    await frame.getByRole('button', { name: 'Reset code' }).click();
    assert.match(await frame.locator('.cm-content').textContent(), /your code here/);
  },
  async parsons(page) {
    await openChapter(page, 'Parsons');
    const frame = page.locator('.extension-frame[data-extension="ext-parsons-puzzle"][data-block-key="id:parsons-order"]');
    await frame.locator('.parsons-line').first().waitFor();
    assert.equal(await frame.locator('.parsons-tray .parsons-line').count(), 5);
    assert.equal(await frame.locator('.parsons-answer .parsons-line').count(), 0);
    assert.equal(await frame.getByRole('button', { name: 'Check order' }).isDisabled(), true);
    await shot(page, 'parsons-01-scrambled');

    // Click-to-order the correct sequence.
    for (const line of [0, 1, 2, 3]) {
      await frame.locator(`.parsons-tray .parsons-line[data-line="${line}"]`).click();
    }
    assert.equal(await frame.locator('.parsons-answer .parsons-line').count(), 4);
    await frame.getByRole('button', { name: 'Check order' }).click();
    assert.equal(await frame.locator('.parsons-summary').textContent(), 'Correct — well done!');
    assert.equal(await frame.locator('.parsons-answer .parsons-line.correct').count(), 4);
    await frame.locator('.extension-badge[data-status="passed"]').waitFor();
    await page.getByRole('button', { name: 'Solved', exact: true }).first().waitFor();
    await shot(page, 'parsons-02-solved');

    // Arrangement survives reload; shuffle resets it.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Parsons' }).waitFor();
    await frame.locator('.parsons-answer .parsons-line').first().waitFor();
    assert.equal(await frame.locator('.parsons-answer .parsons-line').count(), 4);
    assert.equal(await frame.locator('.extension-badge').textContent(), 'Passed');
    await frame.getByRole('button', { name: 'Shuffle / reset' }).click();
    assert.equal(await frame.locator('.parsons-answer .parsons-line').count(), 0);
    assert.equal(await frame.locator('.parsons-tray .parsons-line').count(), 5);
    assert.equal(await frame.locator('.extension-badge').textContent(), 'Unsolved');

    // Wrong order gives per-line feedback.
    for (const line of [1, 0, 2, 3]) {
      await frame.locator(`.parsons-tray .parsons-line[data-line="${line}"]`).click();
    }
    await frame.getByRole('button', { name: 'Check order' }).click();
    assert.equal(await frame.locator('.parsons-summary').textContent(), '2 of 4 placed lines correct');
    assert.equal(await frame.locator('.parsons-answer .parsons-line.incorrect').count(), 2);
    assert.equal(await frame.locator('.parsons-answer .parsons-line.correct').count(), 2);
    await shot(page, 'parsons-03-feedback');

    // Return a line to the tray with its remove button.
    await frame.locator('.parsons-answer .parsons-line').first().getByRole('button', { name: 'Return line to tray' }).click();
    assert.equal(await frame.locator('.parsons-answer .parsons-line').count(), 3);
    assert.equal(await frame.locator('.parsons-tray .parsons-line').count(), 2);

    // HTML5 drag-and-drop: drag a tray line into the answer zone.
    await frame.evaluate(root => {
      const chip = root.querySelector('.parsons-tray .parsons-line');
      const transfer = new DataTransfer();
      chip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
      const zone = root.querySelector('.parsons-answer');
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer }));
    });
    assert.equal(await frame.locator('.parsons-answer .parsons-line').count(), 4);

    // Indentation is graded on the second block.
    const indent = page.locator('.extension-frame[data-block-key="id:parsons-indent"]');
    for (const line of [0, 1, 2]) {
      await indent.locator(`.parsons-tray .parsons-line[data-line="${line}"]`).click();
    }
    await indent.getByRole('button', { name: 'Check order' }).click();
    assert.equal(await indent.locator('.parsons-summary').textContent(), '1 of 3 placed lines correct');
    for (const position of [1, 2]) {
      await indent.locator('.parsons-answer .parsons-line').nth(position).getByRole('button', { name: 'Increase indent' }).click();
    }
    await indent.getByRole('button', { name: 'Check order' }).click();
    assert.equal(await indent.locator('.parsons-summary').textContent(), 'Correct — well done!');
    await indent.locator('.extension-badge[data-status="passed"]').waitFor();
    await shot(page, 'parsons-04-indent');
  },
  async sqlLab(page) {
    await openChapter(page, 'SQL Lab');
    const frame = page.locator('.extension-frame[data-extension="ext-sql-lab"][data-block-key="id:sql-where"]');
    await frame.locator('.sql-table-chip', { hasText: 'books' }).waitFor({ timeout: 20000 });
    assert.match(await frame.locator('.cm-content').textContent(), /SELECT title FROM books/);
    await shot(page, 'sql-01-starter');

    // The starter returns too many rows: graded fail with a result table.
    await frame.getByRole('button', { name: 'Run query' }).click();
    await frame.locator('.sql-verdict.fail').waitFor();
    assert.match(await frame.locator('.sql-verdict').textContent(), /4 rows; expected 2/);
    assert.equal(await frame.locator('.sql-result .sql-table tbody tr').count(), 4);
    assert.equal(await frame.locator('.extension-badge').textContent(), 'In Progress');
    await shot(page, 'sql-02-fail');

    // Correct query passes and completes the exercise.
    await frame.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT title FROM books WHERE year < 1970');
    await frame.getByRole('button', { name: 'Run query' }).click();
    await frame.locator('.sql-verdict.pass').waitFor();
    assert.equal(await frame.locator('.sql-result .sql-table tbody tr').count(), 2);
    await frame.locator('.extension-badge[data-status="passed"]').waitFor();
    await page.getByRole('button', { name: 'Solved', exact: true }).first().waitFor();
    await shot(page, 'sql-03-pass');

    // Query and verdict survive reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'SQL Lab' }).waitFor();
    await frame.locator('.cm-content').waitFor();
    assert.match(await frame.locator('.cm-content').textContent(), /WHERE year < 1970/);
    await frame.locator('.sql-verdict.pass').waitFor();

    // Broken SQL surfaces an error verdict, not a crash.
    await frame.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT FROM WHERE');
    await frame.getByRole('button', { name: 'Run query' }).click();
    await frame.locator('.sql-verdict.error').waitFor();
    await shot(page, 'sql-04-error');

    // Expected result can be revealed for study.
    await frame.locator('.sql-expected summary').click();
    assert.equal(await frame.locator('.sql-expected .sql-table tbody tr').count(), 2);
  },
  async showcase(page) {
    // The real seeded showcase book, loaded from demo/ like the app seeds it.
    await page.locator('.tree-link', { hasText: 'The Interactive Extension Showcase' }).first().click();
    await page.getByRole('heading', { name: 'The Interactive Extension Showcase', level: 1 }).waitFor();
    await page.getByText('0 of 4 exercises solved').waitFor();
    await shot(page, 'showcase-01-overview');
    const noFallbacks = async () => assert.equal(await page.locator('article .extension-fallback').count(), 0);

    // Visualization chapters.
    await openChapter(page, 'Diagrams with Mermaid');
    await page.locator('.extension-frame[data-extension="ext-mermaid"] .mermaid-stage svg').first().waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.extension-frame[data-extension="ext-mermaid"]').count(), 2);
    await noFallbacks();
    await shot(page, 'showcase-02-mermaid');

    await openChapter(page, 'Exploring Functions');
    await page.locator('.extension-frame[data-extension="ext-math-plot"] canvas').first().waitFor();
    const quadratic = page.locator('.extension-frame[data-block-key="id:showcase-quadratic"]');
    await quadratic.getByLabel('Parameter a').evaluate(node => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(node, '-2');
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    assert.equal(await quadratic.locator('.plot-param-value').first().textContent(), '-2');
    await noFallbacks();
    await shot(page, 'showcase-03-plot');

    await openChapter(page, 'Watching Algorithms Run');
    const trace = page.locator('.extension-frame[data-block-key="id:showcase-bubble-sort"]');
    await trace.locator('.stepper-cell').first().waitFor();
    await trace.getByRole('button', { name: 'Next step' }).click();
    assert.equal(await trace.locator('.stepper-counter').textContent(), 'Step 2 / 4');
    await noFallbacks();

    // Exercise chapter: solve the code lab inside its exercise callout.
    await openChapter(page, 'Coding Practice');
    const lab = page.locator('.extension-frame[data-block-key="id:showcase-binary-search"]');
    await lab.locator('.cm-content').waitFor();
    assert.equal(await page.locator('.callout.exercise').count(), 1);
    await lab.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('function binarySearch(a, target) {\n  let lo = 0, hi = a.length - 1;\n  while (lo <= hi) {\n    const mid = (lo + hi) >> 1;\n    if (a[mid] === target) return mid;\n    if (a[mid] < target) lo = mid + 1;\n    else hi = mid - 1;\n  }\n  return -1;\n}');
    await lab.getByRole('button', { name: 'Run tests' }).click();
    await lab.locator('.extension-badge[data-status="passed"]').waitFor();
    await page.getByRole('button', { name: 'Solved', exact: true }).first().waitFor();
    await noFallbacks();
    await shot(page, 'showcase-04-codelab');

    // Parsons chapter: solve the proof puzzle inside its callout.
    await openChapter(page, 'Ordering Proofs');
    const proof = page.locator('.extension-frame[data-block-key="id:showcase-even-sum-proof"]');
    await proof.locator('.parsons-line').first().waitFor();
    for (const line of [0, 1, 2, 3]) {
      await proof.locator(`.parsons-tray .parsons-line[data-line="${line}"]`).click();
    }
    await proof.getByRole('button', { name: 'Check order' }).click();
    await proof.locator('.extension-badge[data-status="passed"]').waitFor();
    assert.equal(await page.locator('.extension-frame[data-extension="ext-parsons-puzzle"]').count(), 2);
    await noFallbacks();

    // SQL chapter: solve the join exercise.
    await openChapter(page, 'Querying Data');
    const sql = page.locator('.extension-frame[data-block-key="id:showcase-orders-per-customer"]');
    await sql.locator('.sql-table-chip').first().waitFor({ timeout: 20000 });
    await sql.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('SELECT c.name, COUNT(*) AS orders FROM customers c JOIN orders o ON o.customer_id = c.id GROUP BY c.name');
    await sql.getByRole('button', { name: 'Run query' }).click();
    await sql.locator('.sql-verdict.pass').waitFor();
    await noFallbacks();
    await shot(page, 'showcase-05-sql');

    // Meta chapter: the nested example fence stays code, the pipeline renders.
    await openChapter(page, 'Authoring with Extensions');
    await page.locator('.extension-frame[data-block-key="id:showcase-pipeline"] .mermaid-stage svg').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('.extension-frame[data-extension="ext-math-plot"]').count(), 0);
    await noFallbacks();

    // Overview reflects the three solved exercises.
    await page.locator('.tree-link', { hasText: 'The Interactive Extension Showcase' }).first().click();
    await page.getByText('3 of 4 exercises solved').waitFor();
    await shot(page, 'showcase-06-progress');

    // AI import receives the composed skills of all enabled extensions.
    await button(page, 'Settings').click();
    await button(page, 'AI').click();
    await page.locator('.ollama-settings summary').click();
    await page.getByText('Connected', { exact: true }).waitFor();
    await page.getByLabel('Local model').selectOption('fixture:latest');
    await button(page, 'Back to reader').click();
    const prepare = async () => {
      await page.getByRole('button', { name: 'Import with AI' }).click();
      await page.getByLabel('Book title').fill('Skill probe');
      await page.getByLabel('Source Markdown').fill('# Probe\n\nSome content.');
      await page.getByRole('button', { name: 'Prepare draft' }).click();
      await page.getByText('Fixture does not generate.').waitFor();
      await page.getByRole('button', { name: 'Dismiss prepare from markdown' }).click();
    };
    await prepare();
    const first = await page.evaluate(() => window.fixtureSkillRequests.at(-1));
    assert.equal(first.command, 'ai_prepare_import');
    for (const id of ['ext-mermaid', 'ext-math-plot', 'ext-state-stepper', 'ext-code-lab', 'ext-parsons-puzzle', 'ext-sql-lab']) {
      assert.ok(first.skills.includes(id), `skills must include ${id}`);
    }
    assert.match(first.skills, /few-shot|Example —/);

    // Disabling an extension removes its skill from the next request.
    await openExtensionsManager(page);
    await page.getByRole('switch', { name: 'Disable SQL Lab' }).click();
    await page.getByRole('switch', { name: 'Enable SQL Lab' }).waitFor();
    await page.getByRole('button', { name: 'Back to reader' }).click();
    await prepare();
    const second = await page.evaluate(() => window.fixtureSkillRequests.at(-1));
    assert.ok(!second.skills.includes('ext-sql-lab'));
    assert.ok(second.skills.includes('ext-mermaid'));
    await shot(page, 'showcase-07-skills');
  },
  async manager(page) {
    // Warm the mermaid runtime by visiting a diagram chapter.
    await openChapter(page, 'Diagrams');
    await page.locator('.extension-frame[data-extension="ext-mermaid"] .mermaid-stage svg').first().waitFor({ timeout: 20000 });
    await openExtensionsManager(page);
    await page.locator('.extension-runtimes .extension-runtime-row', { hasText: 'mermaid' }).waitFor();
    assert.equal(await page.locator('.extension-runtimes .extension-runtime-row', { hasText: 'mermaid' }).locator('.extension-runtime-state').textContent(), 'warm');
    await shot(page, 'manager-01-runtimes');

    // Dependency inspector: lazy web package + live runtime chip.
    await page.locator('.extension-manager-card', { hasText: 'Mermaid Diagram' }).getByRole('button', { name: 'Dependencies & Runtime' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dependencies & Runtime · Mermaid Diagram' });
    await dialog.waitFor();
    const mermaidRow = dialog.locator('.extension-dep-row', { hasText: 'mermaid' });
    assert.match(await mermaidRow.locator('.extension-dep-version').textContent(), /\^11\.17\.2/);
    assert.equal(await mermaidRow.locator('.extension-dep-badge').textContent(), 'lazy-loaded');
    assert.equal(await mermaidRow.locator('.extension-runtime-state').textContent(), 'warm');
    assert.ok(await dialog.textContent().then(text => text.includes('No native dependencies')));
    await shot(page, 'manager-02-dependencies');
    await page.keyboard.press('Escape');

    // Bundled packages show the bundled badge.
    await page.locator('.extension-manager-card', { hasText: 'Code Lab' }).getByRole('button', { name: 'Dependencies & Runtime' }).click();
    const labDialog = page.getByRole('dialog', { name: 'Dependencies & Runtime · Code Lab' });
    await labDialog.waitFor();
    assert.equal(await labDialog.locator('.extension-dep-row', { hasText: '@codemirror/view' }).locator('.extension-dep-badge').textContent(), 'bundled');
    await page.keyboard.press('Escape');
  },
  async interactiveGraph(page) {
    await openChapter(page, 'Graphs');
    const explore = page.locator('.extension-frame[data-block-key="id:graph-explore"]');
    await explore.locator('.react-flow__node').first().waitFor({ timeout: 30000 });
    assert.equal(await explore.locator('.react-flow__node').count(), 3);
    await shot(page, 'graph-01-explore');

    // Click a node to inspect its note, then trace downstream.
    await explore.locator('.react-flow__node[data-id="def-even"]').click();
    await explore.locator('.igraph-inspector').waitFor();
    assert.match(await explore.locator('.igraph-note').textContent(), /even when it equals 2k/);
    await explore.getByRole('button', { name: 'Trace dependencies' }).click();
    await explore.locator('.react-flow__edge.animated').first().waitFor({ timeout: 5000 });
    await shot(page, 'graph-02-trace');

    // Wire exercise: a wrong link is rejected, correct links complete it.
    const wire = page.locator('.extension-frame[data-block-key="id:graph-wire"]');
    await wire.scrollIntoViewIfNeeded();
    await wire.locator('.react-flow__node').first().waitFor();
    assert.equal(await wire.locator('.react-flow__edge').count(), 1);
    const drag = async (fromId, toId) => {
      const source = wire.locator(`.react-flow__node[data-id="${fromId}"] .react-flow__handle-right`);
      const target = wire.locator(`.react-flow__node[data-id="${toId}"] .react-flow__handle-left`);
      const a = await source.boundingBox();
      const b = await target.boundingBox();
      assert.ok(a && b);
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
      await page.mouse.up();
    };
    await drag('src', 'codegen');
    await wire.locator('.igraph-message', { hasText: 'Not a valid dependency' }).waitFor();
    await drag('lex', 'parse');
    await wire.locator('.igraph-message', { hasText: 'Correct link! 1 of 2' }).waitFor();
    await drag('parse', 'codegen');
    await wire.locator('.extension-badge[data-status="passed"]').waitFor();
    // onComplete remounts the frame with persisted state; wait for the rebuild.
    // Edges are horizontal (zero-height) paths, so poll the count, not visibility.
    await page.waitForFunction(() => document.querySelectorAll(
      '.extension-frame[data-block-key="id:graph-wire"] .react-flow__edge').length === 3, null, { timeout: 10000 });
    assert.equal(await wire.locator('.react-flow__edge').count(), 3);
    await shot(page, 'graph-03-wired');

    // Classify exercise: assign kinds and check.
    const classify = page.locator('.extension-frame[data-block-key="id:graph-classify"]');
    await classify.scrollIntoViewIfNeeded();
    await classify.locator('.igraph-kind-select').first().waitFor();
    await classify.getByLabel('Classify Even means 2k').selectOption('definition');
    await classify.getByLabel('Classify Sum of integers is integer').selectOption('lemma');
    await classify.getByLabel('Classify Sum of evens is even').selectOption('theorem');
    await classify.getByRole('button', { name: 'Check classification' }).click();
    await classify.locator('.extension-badge[data-status="passed"]').waitFor();
    await page.waitForFunction(() => {
      const nodes = document.querySelectorAll('.extension-frame[data-block-key="id:graph-classify"] .igraph-node');
      return nodes.length === 3 && [...nodes].every(node => node.style.borderColor === 'rgb(115, 214, 149)');
    }, null, { timeout: 10000 });
    await shot(page, 'graph-04-classified');

    // Progress survives reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Graphs' }).waitFor();
    await wire.scrollIntoViewIfNeeded();
    await wire.locator('.react-flow__node').first().waitFor({ timeout: 30000 });
    assert.equal(await wire.locator('.extension-badge').textContent(), 'Passed');
    await page.waitForFunction(() => document.querySelectorAll(
      '.extension-frame[data-block-key="id:graph-wire"] .react-flow__edge').length === 3, null, { timeout: 10000 });
    assert.equal(await wire.locator('.react-flow__edge').count(), 3);
    assert.equal(await classify.locator('.extension-badge').textContent(), 'Passed');
  },
  async desmosLab(page) {
    await openChapter(page, 'Desmos Studio');
    const vertex = page.locator('.extension-frame[data-block-key="id:desmos-vertex"]');
    await vertex.scrollIntoViewIfNeeded();
    await vertex.locator('.desmos-canvas').waitFor({ timeout: 30000 });
    // KaTeX legend + live integral value (∫₀² x² dx = 8/3).
    assert.ok(await vertex.locator('.desmos-tex .katex').count() >= 1);
    await vertex.locator('.desmos-area-value', { hasText: '2.66667' }).waitFor();

    // Drag the vertex point from (0,0) to (2,3): h/k sliders must follow.
    const canvasBox = await vertex.locator('.desmos-canvas').boundingBox();
    assert.ok(canvasBox);
    const toScreen = (wx, wy) => ({
      x: canvasBox.x + (wx + 6) / 12 * canvasBox.width,
      y: canvasBox.y + (1 - (wy + 4) / 12) * canvasBox.height,
    });
    const start = toScreen(0, 0);
    const end = toScreen(2, 3);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => {
      const frame = document.querySelector('.extension-frame[data-block-key="id:desmos-vertex"]');
      return frame?.querySelector('input[aria-label="Parameter h"]')?.value === '2'
        && frame?.querySelector('input[aria-label="Parameter k"]')?.value === '3';
    }, null, { timeout: 5000 });
    await shot(page, 'desmos-01-vertex-drag');

    // Tangent scrubbing: f(x)=(x-2)²+3 has slope -4 at x=0.
    const hover = toScreen(0, 2);
    await page.mouse.move(hover.x, hover.y);
    await vertex.locator('.desmos-readout', { hasText: 'slope -4' }).waitFor();
    await shot(page, 'desmos-02-tangent');

    // Animation: play advances t, pause freezes it.
    const wave = page.locator('.extension-frame[data-block-key="id:desmos-wave"]');
    await wave.scrollIntoViewIfNeeded();
    await wave.locator('.desmos-canvas').waitFor();
    await wave.getByRole('button', { name: 'Play animation' }).click();
    await page.waitForTimeout(800);
    const tText = await wave.locator('.desmos-t').textContent();
    const tValue = Number(tText.replace('t = ', ''));
    assert.ok(tValue > 0.5, `t should advance, got ${tText}`);
    await wave.getByRole('button', { name: 'Pause animation' }).click();
    const frozen = await wave.locator('.desmos-t').textContent();
    await page.waitForTimeout(350);
    assert.equal(await wave.locator('.desmos-t').textContent(), frozen);

    // Challenge: fit y = m x + b through (1,2) and (3,4) → m=1, b=1.
    const fit = page.locator('.extension-frame[data-block-key="id:desmos-fit-line"]');
    await fit.scrollIntoViewIfNeeded();
    await fit.locator('.desmos-canvas').waitFor();
    assert.equal(await fit.locator('.extension-badge').textContent(), 'Unsolved');
    assert.match(await fit.locator('.desmos-challenge').textContent(), /P1: Δ/);
    const setParam = (name, value) => fit.locator(`input[aria-label="Parameter ${name}"]`)
      .evaluate((input, v) => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    await setParam('m', '1');
    await setParam('b', '1');
    await fit.locator('.extension-badge[data-status="passed"]').waitFor();
    assert.equal(await fit.locator('.desmos-challenge').getAttribute('data-state'), 'passed');
    await shot(page, 'desmos-03-challenge-passed');

    // Progress survives reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Desmos Studio' }).waitFor();
    await fit.scrollIntoViewIfNeeded();
    await fit.locator('.desmos-canvas').waitFor({ timeout: 30000 });
    assert.equal(await fit.locator('.extension-badge').textContent(), 'Passed');
    assert.equal(await fit.locator('input[aria-label="Parameter m"]').inputValue(), '1');
  },
  async polyglotStudio(page) {
    await openChapter(page, 'Polyglot Studio');
    const py = page.locator('.extension-frame[data-block-key="id:poly-two-sum"]');
    await py.scrollIntoViewIfNeeded();
    await py.locator('.cm-editor').waitFor({ timeout: 30000 });
    assert.match(await py.locator('.poly-description').textContent(), /indices/);
    assert.equal(await py.locator('.poly-tabs button').count(), 3);

    // Hidden tests are masked before the first run.
    await py.getByRole('tab', { name: /Tests/ }).click();
    assert.match(await py.locator('.poly-tests').textContent(), /Hidden test 3 — revealed after your first run/);
    await py.getByRole('tab', { name: /Solution\.py/ }).click();

    // Run the naive starter: fails with a diff, console captures stdout.
    await py.getByRole('button', { name: 'Run tests' }).click();
    await py.locator('.poly-results-head', { hasText: '0 / 3 tests passed' }).waitFor({ timeout: 60000 });
    assert.match(await py.locator('.poly-console').textContent(), /sandbox ready/);
    assert.match(await py.locator('.poly-diff-expected').first().textContent(), /\[0, 1\]/);
    assert.match(await py.locator('.poly-diff-actual').first().textContent(), /None/);
    await shot(page, 'poly-01-python-fail');

    // Type the real solution and re-run: all tests pass, exercise completes.
    const replaceCode = async (frame, text) => {
      await frame.locator('.cm-content').click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.insertText(text);
    };
    await replaceCode(py, 'def two_sum(nums, target):\n    seen = {}\n    for i, x in enumerate(nums):\n        if target - x in seen:\n            return [seen[target - x], i]\n        seen[x] = i\n');
    await py.getByRole('button', { name: 'Run tests' }).click();
    await py.locator('.poly-results-head', { hasText: '3 / 3 tests passed' }).waitFor({ timeout: 30000 });
    await py.locator('.extension-badge[data-status="passed"]').waitFor();
    assert.match(await py.locator('.poly-results-head').textContent(), /engine boot \d+ ms/);
    await shot(page, 'poly-02-python-pass');

    // JavaScript sandbox: same flow through the code-lab worker.
    const js = page.locator('.extension-frame[data-block-key="id:poly-fib"]');
    await js.scrollIntoViewIfNeeded();
    await js.locator('.cm-editor').waitFor();
    await replaceCode(js, 'function fib(n) {\n  let a = 0, b = 1;\n  for (let i = 0; i < n; i++) { [a, b] = [b, a + b]; }\n  return a;\n}\n');
    await js.getByRole('button', { name: 'Run tests' }).click();
    await js.locator('.poly-results-head', { hasText: '4 / 4 tests passed' }).waitFor({ timeout: 30000 });
    await js.locator('.extension-badge[data-status="passed"]').waitFor();
    await shot(page, 'poly-03-js-pass');

    // Code and results survive reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Polyglot Studio' }).waitFor();
    await py.scrollIntoViewIfNeeded();
    await py.locator('.cm-editor').waitFor({ timeout: 30000 });
    assert.equal(await py.locator('.extension-badge').textContent(), 'Passed');
    assert.match(await py.locator('.cm-content').textContent(), /seen\[target - x\]/);
    assert.equal(await js.locator('.extension-badge').textContent(), 'Passed');
  },
  async sqlDuckdbLab(page) {
    await openChapter(page, 'DuckDB Lab');
    const explore = page.locator('.extension-frame[data-block-key="id:duckdb-explore"]');
    await explore.scrollIntoViewIfNeeded();
    // Engine boot + auto-run of the initial query (WASM is ~33 MB, allow time).
    await explore.locator('.ducklab-table tbody tr').first().waitFor({ timeout: 90000 });
    assert.equal(await explore.locator('.ducklab-table tbody tr').count(), 5);
    assert.match(await explore.locator('.ducklab-engine').textContent(), /DuckDB · ready \(boot \d+ ms\)/);
    assert.equal(await explore.locator('.ducklab-table-card').count(), 1);
    assert.match(await explore.locator('.ducklab-table-card').textContent(), /revenue\s*DOUBLE/);

    // Sort by revenue: numeric columns sort descending first (TanStack default).
    await explore.locator('.ducklab-table th', { hasText: 'revenue' }).click();
    await explore.locator('.ducklab-table th[aria-sort="descending"]').waitFor();
    assert.equal(await explore.locator('.ducklab-table tbody tr').first().locator('td').nth(3).textContent(), '135');
    await explore.locator('.ducklab-table th', { hasText: 'revenue' }).click();
    await explore.locator('.ducklab-table th[aria-sort="ascending"]').waitFor();
    assert.equal(await explore.locator('.ducklab-table tbody tr').first().locator('td').nth(3).textContent(), '60');
    await shot(page, 'duckdb-01-explore-sorted');

    // Challenge: wrong query fails grading, correct aggregate passes.
    const challenge = page.locator('.extension-frame[data-block-key="id:duckdb-challenge"]');
    await challenge.scrollIntoViewIfNeeded();
    await challenge.locator('.ducklab-run:not([disabled])').waitFor({ timeout: 90000 });
    await challenge.getByRole('button', { name: 'Run query' }).click();
    await challenge.locator('.ducklab-verdict.fail').waitFor({ timeout: 30000 });
    assert.match(await challenge.locator('.ducklab-verdict').textContent(), /expected columns \[region, total\]/);
    await shot(page, 'duckdb-02-challenge-fail');

    await challenge.locator('.cm-content').click();
    await page.keyboard.press('Meta+A');
    await page.keyboard.insertText('SELECT region, ROUND(SUM(revenue), 2) AS total\nFROM sales\nGROUP BY region;\n');
    await challenge.getByRole('button', { name: 'Run query' }).click();
    await challenge.locator('.ducklab-verdict.pass').waitFor({ timeout: 30000 });
    await challenge.locator('.extension-badge[data-status="passed"]').waitFor();
    assert.equal(await challenge.locator('.ducklab-table tbody tr').count(), 3);
    await challenge.scrollIntoViewIfNeeded();
    await shot(page, 'duckdb-03-challenge-pass');

    // Query and verdict survive reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'DuckDB Lab' }).waitFor();
    await challenge.scrollIntoViewIfNeeded();
    await challenge.locator('.ducklab-verdict.pass').waitFor({ timeout: 90000 });
    assert.equal(await challenge.locator('.extension-badge').textContent(), 'Passed');
    assert.match(await challenge.locator('.cm-content').textContent(), /GROUP BY region/);
  },
  async spatialLab(page) {
    await openChapter(page, 'Spatial Lab');
    const matrix = page.locator('.extension-frame[data-block-key="id:spatial-find-matrix"]');
    await matrix.scrollIntoViewIfNeeded();
    await matrix.locator('.spatial-canvas canvas').waitFor({ timeout: 60000 });
    // Labels are WebGL sprites (no DOM); give the scene a moment to settle,
    // then verify visually via screenshots. Functional checks use the DOM
    // challenge chips, badges, and sliders below.
    await page.waitForTimeout(1200);
    assert.equal(await matrix.locator('.extension-badge').textContent(), 'Unsolved');
    assert.match(await matrix.locator('.spatial-challenge').textContent(), /away/);
    await shot(page, 'spatial-01-vectors');

    // Morph slider interpolates without breaking the scene.
    await matrix.locator('input[aria-label="Transformation morph"]').evaluate(input => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, '0.4');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);
    assert.ok(await matrix.locator('.spatial-canvas canvas').isVisible());

    // Solve: A = [[2,1],[1,2]] maps e1→(2,1,0), e2→(1,2,0).
    // Prototype setter bypasses React's node-level value tracker so the
    // dispatched input event registers as a real change.
    const setParam = (name, value) => matrix.locator(`input[aria-label="Parameter ${name}"]`)
      .evaluate((input, v) => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, value);
    await setParam('a', '2');
    await setParam('b', '1');
    await setParam('c', '1');
    await setParam('d', '2');
    await matrix.locator('.extension-badge[data-status="passed"]').waitFor({ timeout: 10000 });
    assert.match(await matrix.locator('.spatial-challenge').textContent(), /✓ landed/);
    // onComplete refreshes the reader; let the remounted scene render a frame.
    await matrix.locator('.spatial-canvas canvas').waitFor({ timeout: 30000 });
    await page.waitForTimeout(1200);
    await shot(page, 'spatial-02-matrix-solved');

    // Animated surface: play advances t, pause freezes it.
    // (The matrix solve triggered a reader refresh — wait for the remount.)
    const ripple = page.locator('.extension-frame[data-block-key="id:spatial-ripple"]');
    await ripple.locator('.spatial-canvas canvas').waitFor({ timeout: 30000 });
    await ripple.scrollIntoViewIfNeeded();
    await ripple.getByRole('button', { name: 'Play', exact: true }).click();
    await page.waitForTimeout(800);
    const tText = await ripple.locator('.spatial-t').textContent();
    assert.ok(Number(tText.replace('t = ', '')) > 0.5, `t should advance, got ${tText}`);
    await ripple.getByRole('button', { name: 'Pause', exact: true }).click();
    const frozen = await ripple.locator('.spatial-t').textContent();
    await page.waitForTimeout(350);
    assert.equal(await ripple.locator('.spatial-t').textContent(), frozen);
    await shot(page, 'spatial-03-surface');

    // Solids scene renders with labels.
    const solids = page.locator('.extension-frame[data-block-key="id:spatial-solids"]');
    await solids.locator('.spatial-canvas canvas').waitFor({ timeout: 30000 });
    await solids.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await shot(page, 'spatial-04-solids');

    // Challenge progress survives reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Spatial Lab' }).waitFor();
    await matrix.scrollIntoViewIfNeeded();
    await matrix.locator('.spatial-canvas canvas').waitFor({ timeout: 60000 });
    await matrix.locator('.extension-badge[data-status="passed"]').waitFor({ timeout: 15000 });
    assert.equal(await matrix.locator('input[aria-label="Parameter a"]').inputValue(), '2');
  },
  async nativeWorkbench(page) {
    await openChapter(page, 'Native Workbench');
    const git = page.locator('.extension-frame[data-block-key="id:native-git-feature"]');
    await git.scrollIntoViewIfNeeded();
    await git.locator('.workbench-terminal').waitFor({ timeout: 30000 });
    // Setup seeded the repo and README.
    await git.locator('.workbench-file', { hasText: 'README.md' }).waitFor();
    const run = async (frame, cmd) => {
      await frame.locator('.workbench-input').fill(cmd);
      await frame.locator('.workbench-input').press('Enter');
      await page.waitForTimeout(150);
    };
    await run(git, 'git checkout -b feature');
    await run(git, 'echo hello > hello.txt');
    await run(git, 'git add hello.txt');
    await run(git, 'git commit -m "add greeting"');
    assert.match(await git.locator('.workbench-log').textContent(), /Switched to a new branch 'feature'/);
    await shot(page, 'native-01-terminal');

    // Blocked programs are rejected client-side before any IPC.
    await run(git, 'rm -rf /');
    assert.match(await git.locator('.workbench-log').textContent(), /"rm" is not allowed/);

    await git.getByRole('button', { name: 'Verify native state' }).click();
    await git.locator('.extension-badge[data-status="passed"]').waitFor({ timeout: 15000 });
    assert.equal(await git.locator('.workbench-check.pass').count(), 4);
    await shot(page, 'native-02-verified');

    // Pipeline exercise: chain programs and redirect to a workspace file.
    const pipe = page.locator('.extension-frame[data-block-key="id:native-pipeline-errors"]');
    await pipe.locator('.workbench-terminal').waitFor({ timeout: 15000 });
    await pipe.scrollIntoViewIfNeeded();
    await run(pipe, 'cat server.log | grep ERROR | wc -l > count.txt');
    assert.match(await pipe.locator('.workbench-log').textContent(), /2/);
    await pipe.getByRole('button', { name: 'Verify native state' }).click();
    await pipe.locator('.extension-badge[data-status="passed"]').waitFor({ timeout: 15000 });
    assert.equal(await pipe.locator('.workbench-check.pass').count(), 2);

    // System scene shows the (fixture) host facts.
    const sys = page.locator('.extension-frame[data-block-key="id:native-system"]');
    await sys.locator('.workbench-syscard').first().waitFor({ timeout: 15000 });
    await sys.scrollIntoViewIfNeeded();
    assert.match(await sys.locator('.workbench-sysinfo').textContent(), /FixtureOS 1\.0/);
    assert.match(await sys.locator('.workbench-sysinfo').textContent(), /Fixture CPU \(8 cores\)/);
    await shot(page, 'native-03-sysinfo');

    // History and verification survive reload.
    await page.waitForTimeout(650);
    await page.reload();
    await page.locator('article h1.page-title', { hasText: 'Native Workbench' }).waitFor();
    await git.scrollIntoViewIfNeeded();
    await git.locator('.workbench-terminal').waitFor({ timeout: 30000 });
    await git.locator('.extension-badge[data-status="passed"]').waitFor({ timeout: 15000 });
    assert.match(await git.locator('.workbench-log').textContent(), /git commit -m "add greeting"/);
    assert.equal(await pipe.locator('.extension-badge').textContent(), 'Passed');
  },
};

try {
  await mkdir(output, { recursive: true });
  const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(scenarios);
  for (const name of names) {
    assert.ok(Object.hasOwn(scenarios, name), `Unknown UI test ${name}`);
    const page = name === 'showcase' ? await setup(demoEntries, 'Proofs in Linear Algebra') : await setup();
    const errors = [];
    page.on('pageerror', error => errors.push(error));
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning' || message.text().includes('[ext-debug]')) console.log('BROWSER:', message.text());
    });
    try {
      await scenarios[name](page);
      assert.deepEqual(errors, []);
      console.log(`Passed ${name}`);
    } catch (error) {
      console.log('PAGEERRORS:', errors.map(e => e.message));
      console.log('NOTICE:', await page.locator('#notice').textContent().catch(() => 'n/a'));
      console.log('ARTICLE-AT-FAILURE:', await page.locator('article').evaluate(n => [...n.querySelectorAll('.bucher-extension')].map(p => p.getAttribute('data-extension') + '|' + (p.getAttribute('data-source') || '').split('\n')[0] + '|children:' + p.children.length + '|' + (p.firstElementChild?.className ?? 'EMPTY')).join(' ;; ')).catch(() => 'n/a'));
      console.log('DIALOGS-OPEN:', await page.evaluate(() => [...document.querySelectorAll('dialog')].map(d => d.open + ':' + (d.getAttribute('aria-labelledby') ? document.getElementById(d.getAttribute('aria-labelledby'))?.textContent : d.textContent.slice(0, 40))).join(' ;; ')));
      console.log('CARD-VISIBILITY:', await page.evaluate(() => [...document.querySelectorAll('.extension-disabled-card')].map(c => { const r = c.getBoundingClientRect(); const s = getComputedStyle(c); return `${r.width}x${r.height}@${r.top} display:${s.display} vis:${s.visibility}`; }).join(' ;; ')));
      throw error;
    } finally {
      await page.context().close();
    }
  }
} finally {
  await browser.close();
}
