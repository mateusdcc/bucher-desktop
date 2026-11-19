/**
 * ext-code-lab — in-browser coding sandbox with a unit-test runner.
 *
 * CodeMirror 6 editor + author-defined visible/hidden tests executed in an
 * isolated Web Worker (dist/code-lab-worker.js) with timeout protection.
 * Passing every test marks the owning book exercise solved. Code, results,
 * and status persist with the book progress.
 *
 * @module extensions/code-lab/code-lab
 */
import { z } from 'zod';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { button, el, icon } from '../../ui.js';
import { blockMeta, createValidator } from '../validate.js';

/**
 * @typedef {import('../types.js').BucherExtension} BucherExtension
 * @typedef {import('../types.js').MountProps} MountProps
 * @typedef {import('../types.js').MountedExtension} MountedExtension
 */

/**
 * @typedef {Object} LabTest
 * @property {string} name
 * @property {string} fn
 * @property {unknown[]} [args]
 * @property {unknown} [expected]
 * @property {boolean} [hidden]
 */

/**
 * @typedef {Object} LabResult
 * @property {string} name
 * @property {boolean} pass
 * @property {boolean} hidden
 * @property {string} [actual]
 * @property {string} [expected]
 * @property {string} [error]
 * @property {number} durationMs
 */

const schema = z.object({
  ...blockMeta,
  language: z.literal('javascript').default('javascript'),
  description: z.string().max(8000).optional().describe('Markdown problem statement.'),
  starter: z.string().max(20000).default('').describe('Initial editor contents.'),
  timeoutMs: z.number().int().min(500).max(30000).default(5000),
  tests: z.array(z.object({
    name: z.string().min(1).max(120),
    fn: z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, 'fn must be a JavaScript function name.'),
    args: z.array(z.unknown()).default([]),
    expected: z.unknown(),
    hidden: z.boolean().optional(),
  })).min(1).max(30),
});

/** @typedef {import('zod').infer<typeof schema>} Payload */

/** @type {BucherExtension} */
export const codeLabExtension = {
  id: 'ext-code-lab',
  name: 'Code Lab',
  version: '1.0.0',
  description: 'Write JavaScript in an embedded editor and pass visible and hidden unit tests running in a sandboxed worker.',
  category: 'exercise',
  icon: 'code-2',
  skill: {
    instructions: `Use ext-code-lab for hands-on programming practice: implement a function, fix a bug, or complete an algorithm. Rules:
- JavaScript only (no TypeScript, no Python). Code runs in a sandboxed worker: no DOM, no network, no imports — pure functions only.
- The learner's code must define the function(s) named by tests[].fn at top level. Give a starter with the exact signature and a helpful comment.
- Write 3–8 tests mixing typical cases, edge cases (empty input, duplicates, negatives), and 1–3 hidden:true tests. args and expected are JSON values; expected is compared structurally (deep equality).
- Keep each test deterministic and fast; the whole run is killed after timeoutMs (default 5000).
- The description is Markdown: state the task, the contract, and 1–2 examples. Do not reveal hidden test inputs in the description.
- Set a stable id and a short title. Place the block in a chapter so passing marks the exercise solved.`,
    syntaxSpec: `Fence info string: ext-code-lab. YAML fields:
- description (Markdown string, optional but recommended): the problem statement.
- starter (string): initial code, usually the function signature with a TODO comment. Use a | block scalar.
- timeoutMs (int 500–30000, optional, default 5000).
- tests (required, 1–30): [{ name, fn, args: [JSON values], expected: JSON value, hidden?: true }].
- id / title as usual.`,
    fewShotExamples: [
      {
        title: 'Binary search',
        yaml: `id: binary-search
title: Implement binary search
description: |
  Implement \`binarySearch(a, target)\` for a sorted array of numbers.
  Return the index of \`target\`, or \`-1\` when it is absent. Aim for O(log n).
starter: |
  function binarySearch(a, target) {
    // your code here
  }
tests:
  - name: finds the middle
    fn: binarySearch
    args: [[1, 3, 5, 7, 9], 5]
    expected: 2
  - name: finds the first
    fn: binarySearch
    args: [[1, 3, 5, 7, 9], 1]
    expected: 0
  - name: missing value
    fn: binarySearch
    args: [[1, 3, 5], 4]
    expected: -1
  - name: empty array
    fn: binarySearch
    args: [[], 1]
    expected: -1
    hidden: true
  - name: single element hit
    fn: binarySearch
    args: [[42], 42]
    expected: 0
    hidden: true`,
      },
      {
        title: 'Two sum',
        yaml: `id: two-sum
title: Two sum indices
description: |
  Return the indices \`[i, j]\` (i < j) of the two numbers adding up to \`target\`.
  Exactly one solution exists; do not reuse an element.
starter: |
  function twoSum(nums, target) {
    // your code here
  }
tests:
  - name: basic pair
    fn: twoSum
    args: [[2, 7, 11, 15], 9]
    expected: [0, 1]
  - name: non-adjacent pair
    fn: twoSum
    args: [[3, 2, 4], 6]
    expected: [1, 2]
  - name: negatives
    fn: twoSum
    args: [[-1, -2, -3, -4, -5], -8]
    expected: [2, 4]
    hidden: true`,
      },
    ],
  },
  dependencies: {
    webPackages: [
      { name: '@codemirror/commands', version: '^6.11.1', purpose: 'Editor keymaps and history.' },
      { name: '@codemirror/state', version: '^6.7.6', purpose: 'Editor state and compartments.' },
      { name: '@codemirror/view', version: '^6.43.15', purpose: 'CodeMirror 6 editor surface.' },
      { name: '@codemirror/lang-javascript', version: '^6.2.5', purpose: 'JavaScript syntax highlighting.' },
      { name: '@codemirror/language', version: '^6.13.1', purpose: 'Highlight style infrastructure.' },
      { name: '@lezer/highlight', version: '^1.2.5', purpose: 'Syntax highlight tags.' },
    ],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    return mountCodeLab(host, props);
  },
};

const EDITOR_THEME = EditorView.theme({
  '&': { backgroundColor: '#141614', color: '#deded9', fontSize: '13px', border: '1px solid #2c312c' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', caretColor: '#73d695' },
  '.cm-cursor': { borderLeftColor: '#73d695' },
  '&.cm-focused': { outline: 'none', borderColor: '#4a5a4a' },
  '.cm-gutters': { backgroundColor: '#141614', color: '#5a605a', border: 'none' },
  '.cm-activeLineGutter': { backgroundColor: '#1b1d1b' },
  '.cm-activeLine': { backgroundColor: '#1b1d1b66' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#36574466' },
}, { dark: true });

const HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, color: '#b48fe8' },
  { tag: tags.comment, color: '#6a706a', fontStyle: 'italic' },
  { tag: tags.string, color: '#e8d06f' },
  { tag: tags.number, color: '#e8a86f' },
  { tag: tags.function(tags.variableName), color: '#73d695' },
  { tag: tags.operator, color: '#9c9d95' },
  { tag: tags.bool, color: '#e8a86f' },
]);

/**
 * @param {HTMLElement} host
 * @param {MountProps} props
 * @returns {MountedExtension}
 */
function mountCodeLab(host, props) {
  const data = /** @type {Payload} */ (props.data);
  const saved = props.savedState ?? {};
  let code = typeof saved.code === 'string' ? saved.code : data.starter;
  let status = saved.status === 'passed' || saved.status === 'in-progress' ? saved.status : 'unsolved';
  /** @type {LabResult[] | null} */
  let results = Array.isArray(saved.results) ? /** @type {LabResult[]} */ (saved.results) : null;
  /** @type {{ level: string, text: string }[]} */
  let logs = Array.isArray(saved.logs) ? /** @type {{ level: string, text: string }[]} */ (saved.logs) : [];
  /** @type {Worker | null} */
  let worker = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timeout = null;
  let running = false;

  const summary = el('p', 'codelab-summary muted');
  const resultsList = el('div', 'codelab-results');
  const consoleBody = el('pre', 'codelab-console');
  const consoleDetails = el('details', 'codelab-console-details', el('summary', '', 'Console output'), consoleBody);
  const editorHost = el('div', 'codelab-editor');
  const run = button('Run tests', 'play', () => runTests(), 'accent-button');
  const reset = button('Reset code', 'rotate-ccw', () => {
    if (running) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: data.starter } });
    code = data.starter;
    results = null;
    logs = [];
    status = 'unsolved';
    renderResults();
    persist();
  });
  const controls = el('div', 'codelab-controls', run, reset, summary);
  const root = el('div', 'codelab-extension',
    data.description ? el('div', 'codelab-description', props.renderMarkdown(data.description)) : null,
    editorHost, controls, resultsList, consoleDetails);
  host.append(root);

  const readOnly = new Compartment();
  const view = new EditorView({
    parent: editorHost,
    doc: code,
    extensions: [
      keymap.of([
        { key: 'Mod-Enter', run: () => { runTests(); return true; } },
        ...defaultKeymap, ...historyKeymap,
      ]),
      history(), javascript(), EDITOR_THEME, syntaxHighlighting(HIGHLIGHT),
      EditorView.lineWrapping,
      readOnly.of(EditorState.readOnly.of(props.readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': 'Solution code', spellcheck: 'false' }),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        code = update.state.doc.toString();
        if (status === 'passed') status = 'in-progress';
        else if (status === 'unsolved' && code !== data.starter) status = 'in-progress';
        persist();
      }),
    ],
  });

  function persist() {
    props.onSaveState({ code, status, results, logs });
  }

  function renderResults() {
    summary.textContent = results
      ? `${results.filter(result => result.pass).length} / ${results.length} tests passed`
      : `${data.tests.length} tests · ${data.tests.filter(test => test.hidden).length} hidden`;
    resultsList.replaceChildren();
    if (!results) return;
    let hiddenIndex = 0;
    for (const result of results) {
      const label = result.hidden ? `Hidden test ${++hiddenIndex}` : result.name;
      const row = el('div', 'codelab-test ' + (result.pass ? 'pass' : 'fail'),
        el('div', 'codelab-test-head',
          icon(result.pass ? 'check-circle-2' : 'x-circle'),
          el('span', 'codelab-test-name', label),
          el('span', 'codelab-test-time', `${result.durationMs} ms`)));
      if (!result.pass) {
        if (result.hidden) {
          row.append(el('p', 'codelab-test-detail muted', 'Failed — hidden test details stay in the book source.'));
        } else if (result.error) {
          row.append(el('pre', 'codelab-test-detail', result.error));
        } else {
          row.append(el('div', 'codelab-test-detail',
            el('div', '', el('span', 'codelab-diff-label', 'expected'), el('code', '', result.expected ?? 'undefined')),
            el('div', '', el('span', 'codelab-diff-label', 'received'), el('code', '', result.actual ?? 'undefined'))));
        }
      }
      resultsList.append(row);
    }
    consoleBody.textContent = logs.length ? logs.map(entry => `[${entry.level}] ${entry.text}`).join('\n') : '(no output)';
    consoleDetails.hidden = !logs.length;
  }

  function finishRun() {
    running = false;
    run.disabled = false;
    worker?.terminate();
    worker = null;
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
  }

  function runTests() {
    if (running) return;
    running = true;
    run.disabled = true;
    summary.textContent = 'Running tests in the sandbox…';
    resultsList.replaceChildren();
    const currentCode = view.state.doc.toString();
    code = currentCode;
    try {
      worker = new Worker('/code-lab-worker.js');
    } catch (error) {
      finishRun();
      results = [{ name: 'Sandbox', pass: false, hidden: false, error: error instanceof Error ? error.message : String(error), durationMs: 0 }];
      renderResults();
      persist();
      return;
    }
    const fail = (/** @type {string} */ message) => {
      finishRun();
      results = [{ name: 'Sandbox', pass: false, hidden: false, error: message, durationMs: data.timeoutMs }];
      status = 'in-progress';
      renderResults();
      persist();
    };
    timeout = setTimeout(() => {
      fail(`Execution timed out after ${data.timeoutMs} ms — the worker was terminated. Check for infinite loops.`);
    }, data.timeoutMs);
    worker.onerror = event => fail(event.message || 'The sandbox worker failed to load.');
    worker.onmessage = event => {
      const message = /** @type {{ type: string, results?: LabResult[], logs?: { level: string, text: string }[], error?: string }} */ (event.data);
      logs = message.logs ?? [];
      if (message.type === 'fatal') {
        finishRun();
        results = [{ name: 'Compile', pass: false, hidden: false, error: message.error ?? 'Unknown error', durationMs: 0 }];
        status = 'in-progress';
        renderResults();
        persist();
        return;
      }
      results = message.results ?? [];
      const allPass = results.length > 0 && results.every(result => result.pass);
      status = allPass ? 'passed' : 'in-progress';
      finishRun();
      renderResults();
      persist();
      if (allPass) props.onComplete();
    };
    worker.postMessage({ type: 'run', code: currentCode, tests: data.tests });
  }

  renderResults();
  return {
    destroy() {
      finishRun();
      view.destroy();
    },
  };
}
