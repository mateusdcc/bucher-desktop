/**
 * ext-polyglot-studio — multi-language code & Python/WASM data lab.
 *
 * A mini-IDE inside the book: tabbed Solution / Tests / Hints editors
 * (CodeMirror 6 via @uiw/react-codemirror), real Python 3.14 execution in a
 * self-hosted Pyodide WASM module worker, JavaScript execution in the isolated
 * code-lab worker, live execution timers, a stdout console, diff-highlighted
 * test failures, and automatic progress persistence. Passing every test marks
 * the owning book exercise solved.
 *
 * The React view lives in polyglot-studio-view.tsx (lazy, browser-only).
 *
 * @module extensions/polyglot-studio
 */
import { z } from 'zod';
import { el } from '../ui.js';
import { blockMeta, createValidator } from './validate.js';
import { mountReactComponent } from './react-runtime.js';

/**
 * @typedef {import('./types.js').BucherExtension} BucherExtension
 * @typedef {import('./types.js').MountProps} MountProps
 * @typedef {import('./types.js').MountedExtension} MountedExtension
 * @typedef {import('./react-runtime.js').ReactMount} ReactMount
 */

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const schema = z.object({
  ...blockMeta,
  language: z.enum(['python', 'javascript']),
  description: z.string().max(4000).optional().describe('Markdown problem statement shown above the editor.'),
  starter: z.string().min(1).max(8000).describe('Initial solution code with the function signature(s) the tests call.'),
  tests: z.array(z.object({
    name: z.string().min(1).max(80),
    fn: z.string().regex(IDENTIFIER, 'fn must be a function name defined by the solution.').max(60),
    args: z.array(z.unknown()).max(8).optional().describe('Positional arguments (JSON values).'),
    expected: z.unknown().describe('Expected return value (JSON value; compared with deep equality).'),
    hidden: z.boolean().optional().describe('Hidden tests are revealed only after the first run.'),
  })).min(1).max(12),
  hints: z.array(z.string().max(500)).max(5).optional(),
  timeoutMs: z.number().int().min(500).max(30000).default(5000),
});

/** @typedef {import('zod').infer<typeof schema>} Payload */

/** @type {BucherExtension} */
export const polyglotStudioExtension = {
  id: 'ext-polyglot-studio',
  name: 'Polyglot Code Studio',
  version: '1.0.0',
  description: 'Embedded mini-IDE with real Python (Pyodide WASM) and JavaScript sandboxes, tabbed editors, test runner, console, and progress persistence.',
  category: 'exercise',
  icon: 'terminal',
  skill: {
    instructions: `Use ext-polyglot-studio for real coding exercises the reader solves by writing a function: algorithms, data manipulation, string processing, math utilities. It runs REAL Python 3.14 (Pyodide WASM) or JavaScript in an isolated worker — prefer it over ext-code-lab when you want Python or a tabbed IDE with hints. Rules:
- language: python or javascript. starter: the initial editor content — give the exact function signature(s) with a docstring/comment and an empty or naive body (pass / return None / TODO comment for the reader). Never ship the full solution in starter.
- tests: 1–12 items { name, fn, args, expected, hidden? }. fn is the function name the reader must define; args is a JSON array of positional arguments; expected is the JSON return value compared by deep equality (Python == / structural JS equality). Make 1–3 tests hidden: true for edge cases.
- Python args/expected map to Python literals: JSON arrays→lists, objects→dicts, null→None, true/false→True/False. Expected values must be exactly what the function returns (e.g. a list, not a tuple).
- description: Markdown problem statement with constraints and 1–2 worked examples. hints: up to 5 progressive hints (shown in a Hints tab).
- Keep functions pure (no input()/network); print() output appears in the console. timeoutMs defaults to 5000.
- Set a stable id and title; place the block in a chapter (embed in a > [!exercise] callout to make it a book exercise).`,
    syntaxSpec: `Fence info string: ext-polyglot-studio. YAML fields:
- language: python | javascript (required).
- description: Markdown problem statement (optional).
- starter: initial solution code (required).
- tests: [{ name, fn, args?: [JSON values], expected: JSON value, hidden?: bool }] (1–12).
- hints: [strings] (optional, max 5). timeoutMs: 500–30000 (default 5000).`,
    fewShotExamples: [
      {
        title: 'Python: two sum',
        yaml: `id: poly-two-sum
title: "Two Sum (Python)"
language: python
description: |
  Given a list of integers \`nums\` and an integer \`target\`, return the
  **indices** of the two numbers that add up to \`target\` (ascending order).
  Exactly one solution exists; you may not use the same element twice.
starter: |
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
  - For each x, check whether target - x is already in the dict.`,
      },
      {
        title: 'JavaScript: fibonacci',
        yaml: `id: poly-fib
title: "Fibonacci (JavaScript)"
language: javascript
description: |
  Return the n-th Fibonacci number (0-indexed): fib(0) = 0, fib(1) = 1.
  Use an iterative approach so large n stay fast.
starter: |
  function fib(n) {
    // Return the n-th Fibonacci number.
    return 0;
  }
tests:
  - { name: zero, fn: fib, args: [0], expected: 0 }
  - { name: one, fn: fib, args: [1], expected: 1 }
  - { name: ten, fn: fib, args: [10], expected: 55 }
  - { name: large (hidden), fn: fib, args: [50], expected: 12586269025, hidden: true }
hints:
  - Keep two running values and slide them forward n times.`,
      },
    ],
  },
  dependencies: {
    webPackages: [
      { name: 'pyodide', version: '^314.0.8', purpose: 'Python 3.14 WASM runtime, self-hosted assets, module-worker sandbox.', lazyLoad: true },
      { name: '@uiw/react-codemirror', version: '^4.25.12', purpose: 'React CodeMirror 6 editor for the tabbed IDE.', lazyLoad: true },
      { name: 'codemirror', version: '^6.0.2', purpose: 'CodeMirror 6 core (peer of the React wrapper).', lazyLoad: true },
      { name: '@codemirror/lang-python', version: '^6.2.1', purpose: 'Python syntax highlighting and indentation.', lazyLoad: true },
      { name: '@codemirror/lang-javascript', version: '^6.2.5', purpose: 'JavaScript syntax highlighting.', lazyLoad: true },
      { name: '@codemirror/theme-one-dark', version: '^6.1.3', purpose: 'Editor theme matched to the app palette.', lazyLoad: true },
      { name: '@babel/runtime', version: '^7.29.14', purpose: 'Runtime helpers required by the React CodeMirror wrapper.', lazyLoad: true },
      { name: 'react', version: '^19.3.1', purpose: 'UI runtime for the IDE island (shared React island).', lazyLoad: true },
      { name: 'react-dom', version: '^19.3.1', purpose: 'React root rendering into the extension frame.', lazyLoad: true },
    ],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    host.replaceChildren(el('p', 'muted', 'Loading code studio…'));
    /** @type {ReactMount | null} */
    let handle = null;
    let destroyed = false;
    (async () => {
      try {
        const { PolyglotStudio } = await import('./polyglot-studio-view.tsx');
        if (destroyed) return;
        handle = await mountReactComponent(host, PolyglotStudio, { data: props.data, host: props });
      } catch (error) {
        if (!destroyed) props.onError(error);
      }
    })();
    return {
      destroy() {
        destroyed = true;
        handle?.destroy();
      },
    };
  },
};
