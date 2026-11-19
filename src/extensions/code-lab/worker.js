/**
 * ext-code-lab execution worker.
 *
 * Built by build.mjs as a separate classic (IIFE) entry: dist/code-lab-worker.js,
 * created via `new Worker('/code-lab-worker.js')` — same-origin 'self' under Tauri.
 *
 * Isolation model: the worker has no DOM and no Tauri IPC internals. User code
 * is compiled with `new Function` in strict mode with dangerous globals
 * shadowed to undefined inside its scope (this is why the app CSP allows
 * 'unsafe-eval'; see EXTENSIONS_ARCHITECTURE.md §7). The main thread enforces
 * the run timeout by terminating the worker, so infinite loops cannot hang
 * the reader.
 *
 * Protocol (main → worker):
 *   { type: 'run', code: string, tests: [{ name, fn, args, expected, hidden }] }
 * Protocol (worker → main):
 *   { type: 'result', results: [{ name, pass, hidden, actual?, expected?, error?, durationMs }], logs }
 *   { type: 'fatal', error: string, logs }
 */

/* global self */
'use strict';

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

const SHADOWED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'caches',
  'localStorage', 'sessionStorage', 'navigator', 'location', 'Worker',
  'SharedWorker', 'BroadcastChannel', 'EventSource', 'open', 'close', 'postMessage',
];
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Structural equality for test expectations (arrays, plain objects, primitives).
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const recordA = /** @type {Record<string, unknown>} */ (a);
  const recordB = /** @type {Record<string, unknown>} */ (b);
  const ka = Object.keys(recordA);
  const kb = Object.keys(recordB);
  if (ka.length !== kb.length) return false;
  return ka.every(key => Object.hasOwn(recordB, key) && deepEqual(recordA[key], recordB[key]));
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function preview(value) {
  try {
    if (value === undefined) return 'undefined';
    if (typeof value === 'function') return 'function ' + (value.name || '(anonymous)');
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

self.onmessage = async event => {
  const { code, tests } = /** @type {{ code: string, tests: LabTest[] }} */ (event.data);
  /** @type {{ level: string, text: string }[]} */
  const logs = [];
  /**
   * @param {string} level
   * @returns {(...args: unknown[]) => void}
   */
  function capture(level) {
    return (...args) => {
      logs.push({ level, text: args.map(preview).join(' ') });
      if (logs.length > 200) logs.shift();
    };
  }
  const consoleShim = {
    log: capture('log'), info: capture('info'), warn: capture('warn'),
    error: capture('error'), debug: capture('log'),
  };
  const names = [...new Set(tests.map(test => test.fn))];
  if (names.some(name => typeof name !== 'string' || !IDENTIFIER.test(name))) {
    self.postMessage({ type: 'fatal', error: 'A test references an invalid function name.', logs });
    return;
  }
  /** @type {Record<string, unknown>} */
  let scope;
  try {
    const extractor = new Function(
      'console', ...SHADOWED,
      '"use strict";\n' + code + '\n;return {' + names.map(name =>
        `"${name}": typeof ${name} === "function" ? ${name} : undefined`).join(',') + '};'
    );
    scope = /** @type {Record<string, unknown>} */ (extractor(consoleShim, ...SHADOWED.map(() => undefined)));
  } catch (error) {
    self.postMessage({ type: 'fatal', error: errorMessage(error), logs });
    return;
  }
  /** @type {LabResult[]} */
  const results = [];
  for (const test of tests) {
    const started = Date.now();
    const fn = scope[test.fn];
    if (typeof fn !== 'function') {
      results.push({ name: test.name, pass: false, hidden: Boolean(test.hidden), error: `Function "${test.fn}" is not defined.`, durationMs: 0 });
      continue;
    }
    try {
      let actual = fn(...(test.args ?? []));
      if (actual && typeof actual.then === 'function') actual = await actual;
      const pass = deepEqual(actual, test.expected);
      results.push({
        name: test.name, pass, hidden: Boolean(test.hidden),
        actual: preview(actual), expected: preview(test.expected), durationMs: Date.now() - started,
      });
    } catch (error) {
      results.push({
        name: test.name, pass: false, hidden: Boolean(test.hidden),
        error: errorMessage(error), durationMs: Date.now() - started,
      });
    }
  }
  self.postMessage({ type: 'result', results, logs });
};
