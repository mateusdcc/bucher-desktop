/**
 * ext-polyglot-studio Python execution worker (Pyodide / WASM).
 *
 * Built by build.mjs as a same-origin ES MODULE entry (dist/pyodide-worker.js):
 * Pyodide rejects classic workers. The official loader is imported at runtime
 * from the self-hosted assets (dist/pyodide/), never from a CDN.
 *
 * Isolation model: user code runs inside the WASM Python VM in this worker —
 * no DOM, no Tauri IPC, no network beyond the same-origin asset fetches made
 * during boot. The main thread terminates the worker on timeout, so infinite
 * loops cannot hang the reader.
 *
 * Protocol (main → worker):
 *   { type: 'run', indexURL, code, tests: [{ name, fn, args, expected, hidden }] }
 * Protocol (worker → main):
 *   { type: 'result', results: [{ name, pass, hidden, actual?, expected?, error?, durationMs }],
 *     logs, bootMs, runMs, heapBytes? }
 *   { type: 'fatal', error, logs }
 */

/* global self */

/** @type {any} */
let pyodide = null;
let bootMs = 0;
/** @type {{ level: string, text: string }[]} */
let logs = [];

const DRIVER = `
import json as _json
import traceback as _traceback
import time as _time

_payload = _json.loads(_payload_json)
_results = []
_ns = {'__name__': '__sandbox__'}
_fatal = None
try:
    exec(compile(_payload['code'], '<solution>', 'exec'), _ns)
except BaseException:
    _fatal = _traceback.format_exc(limit=4)

if _fatal is None:
    for _test in _payload['tests']:
        _started = _time.perf_counter()
        _fn = _ns.get(_test['fn'])
        if not callable(_fn):
            _results.append({'name': _test['name'], 'pass': False,
                             'hidden': bool(_test.get('hidden')),
                             'error': 'Function "' + _test['fn'] + '" is not defined.',
                             'durationMs': 0})
            continue
        try:
            _actual = _fn(*_test.get('args', []))
            _ok = bool(_actual == _test['expected'])
            _results.append({'name': _test['name'], 'pass': _ok,
                             'hidden': bool(_test.get('hidden')),
                             'actual': repr(_actual), 'expected': repr(_test['expected']),
                             'durationMs': round((_time.perf_counter() - _started) * 1000, 2)})
        except BaseException:
            _results.append({'name': _test['name'], 'pass': False,
                             'hidden': bool(_test.get('hidden')),
                             'error': _traceback.format_exc(limit=3),
                             'durationMs': round((_time.perf_counter() - _started) * 1000, 2)})

_json.dumps({'results': _results, 'fatal': _fatal})
`;

self.onmessage = async event => {
  const message = /** @type {{ type: string, indexURL: string, code: string, tests: unknown[] }} */ (event.data);
  if (message.type !== 'run') return;
  logs = [];
  try {
    if (!pyodide) {
      const started = Date.now();
      const { loadPyodide } = await import(message.indexURL + 'pyodide.mjs');
      pyodide = await loadPyodide({
        indexURL: message.indexURL,
        packageBaseUrl: message.indexURL,
        stdout: (/** @type {string} */ line) => {
          logs.push({ level: 'log', text: line });
          if (logs.length > 200) logs.shift();
        },
        stderr: (/** @type {string} */ line) => {
          logs.push({ level: 'error', text: line });
          if (logs.length > 200) logs.shift();
        },
      });
      bootMs = Date.now() - started;
    }
    const runStarted = Date.now();
    pyodide.globals.set('_payload_json', JSON.stringify({ code: message.code, tests: message.tests }));
    const raw = /** @type {string} */ (pyodide.runPython(DRIVER));
    const parsed = /** @type {{ results: unknown[], fatal: string | null }} */ (JSON.parse(raw));
    let heapBytes;
    try { heapBytes = pyodide._module.HEAPU8.buffer.byteLength; } catch { heapBytes = undefined; }
    if (parsed.fatal) {
      self.postMessage({ type: 'fatal', error: parsed.fatal, logs, bootMs });
      return;
    }
    self.postMessage({
      type: 'result', results: parsed.results, logs, bootMs,
      runMs: Date.now() - runStarted, heapBytes,
    });
  } catch (error) {
    self.postMessage({
      type: 'fatal',
      error: error instanceof Error ? error.message : String(error),
      logs, bootMs,
    });
  }
};
