/**
 * React view for ext-polyglot-studio (browser-only; loaded lazily at mount).
 * Tabbed CodeMirror IDE + JS/Python worker sandboxes + test runner + console.
 *
 * @module extensions/polyglot-studio-view
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Payload } from './polyglot-studio.js';
import type { MountProps } from './types.js';

interface TestResult {
  name: string;
  pass: boolean;
  hidden: boolean;
  actual?: string;
  expected?: string;
  error?: string;
  durationMs: number;
}
interface LogLine { level: string; text: string }
interface RunInfo { bootMs?: number; runMs?: number; heapBytes?: number }

export interface PolyglotProps {
  data: Payload;
  host: MountProps;
}

function preview(value: unknown): string {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function formatBytes(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

export function PolyglotStudio({ data, host }: PolyglotProps) {
  const saved = (host.savedState ?? {}) as Record<string, unknown>;
  const [tab, setTab] = useState<'solution' | 'tests' | 'hints'>('solution');
  const [code, setCode] = useState<string>(typeof saved.code === 'string' ? saved.code : data.starter);
  const [results, setResults] = useState<TestResult[] | null>(Array.isArray(saved.results) ? saved.results as TestResult[] : null);
  const [logs, setLogs] = useState<LogLine[]>(Array.isArray(saved.logs) ? saved.logs as LogLine[] : []);
  const [runInfo, setRunInfo] = useState<RunInfo | null>((saved.runInfo as RunInfo) ?? null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  const engineReadyRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef(0);
  const mountedStatusRef = useRef<string | null>(null);
  const completedRef = useRef(false);

  const languageExtension = useMemo(
    () => (data.language === 'python' ? python() : javascript()),
    [data.language],
  );

  const status: 'unsolved' | 'in-progress' | 'passed' = useMemo(() => {
    if (results && results.length > 0 && results.every(result => result.pass)) return 'passed';
    if (results || code !== data.starter) return 'in-progress';
    return 'unsolved';
  }, [results, code, data.starter]);

  useEffect(() => {
    if (mountedStatusRef.current === null) mountedStatusRef.current = status;
    host.onSaveState({ code, results, logs, runInfo, status });
    if (status === 'passed' && mountedStatusRef.current !== 'passed' && !completedRef.current) {
      completedRef.current = true;
      host.onComplete();
    }
  }, [code, results, logs, runInfo, status, host]);

  const stopTimers = useCallback(() => {
    if (timeoutRef.current !== null) { window.clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    if (timerRef.current !== null) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  useEffect(() => () => {
    stopTimers();
    workerRef.current?.terminate();
    workerRef.current = null;
  }, [stopTimers]);

  const run = useCallback(() => {
    if (running || host.readOnly) return;
    setFatal(null);
    setRunning(true);
    setElapsed(0);
    startedRef.current = Date.now();
    timerRef.current = window.setInterval(() => setElapsed(Date.now() - startedRef.current), 100);

    if (!workerRef.current) {
      workerRef.current = data.language === 'python'
        ? new Worker('/pyodide-worker.js', { type: 'module' })
        : new Worker('/code-lab-worker.js');
    }
    const worker = workerRef.current;
    // First Python run includes the WASM boot; give it a generous budget.
    const budget = data.timeoutMs + (data.language === 'python' && !engineReadyRef.current ? 30000 : 0);
    timeoutRef.current = window.setTimeout(() => {
      worker.terminate();
      workerRef.current = null;
      engineReadyRef.current = false;
      stopTimers();
      setRunning(false);
      setFatal(`Execution exceeded ${data.timeoutMs} ms — the sandbox worker was terminated. Check for infinite loops.`);
    }, budget);

    worker.onmessage = event => {
      const message = event.data as { type: string; results?: TestResult[]; logs?: LogLine[]; error?: string; bootMs?: number; runMs?: number; heapBytes?: number };
      stopTimers();
      setRunning(false);
      setLogs(message.logs ?? []);
      if (message.type === 'result') {
        if (data.language === 'python') engineReadyRef.current = true;
        setResults(message.results ?? []);
        setRunInfo({ bootMs: message.bootMs, runMs: message.runMs, heapBytes: message.heapBytes });
        setFatal(null);
      } else {
        setResults(null);
        setFatal(message.error ?? 'Unknown execution error.');
      }
    };
    worker.onerror = event => {
      stopTimers();
      setRunning(false);
      setFatal(event.message || 'The sandbox worker crashed.');
    };
    worker.postMessage({
      type: 'run',
      indexURL: new URL('/pyodide/', window.location.href).href,
      code,
      tests: data.tests,
    });
  }, [running, host.readOnly, data, code, stopTimers]);

  const descriptionHost = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (descriptionHost.current && data.description) {
      descriptionHost.current.replaceChildren(host.renderMarkdown(data.description));
    }
  }, [data.description, host]);

  const visibleTests = data.tests.map((test, index) => ({ test, index, result: results?.[index] ?? null }));
  const passCount = results?.filter(result => result.pass).length ?? 0;

  return (
    <div className="poly-extension">
      {data.description && <div className="poly-description markdown" ref={descriptionHost} />}
      <div className="poly-toolbar">
        <div className="poly-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'solution'} className={tab === 'solution' ? 'active' : ''} onClick={() => setTab('solution')}>
            Solution.{data.language === 'python' ? 'py' : 'js'}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'tests'} className={tab === 'tests' ? 'active' : ''} onClick={() => setTab('tests')}>
            Tests ({data.tests.length})
          </button>
          {data.hints && data.hints.length > 0 && (
            <button type="button" role="tab" aria-selected={tab === 'hints'} className={tab === 'hints' ? 'active' : ''} onClick={() => setTab('hints')}>
              Hints ({data.hints.length})
            </button>
          )}
        </div>
        <span className="poly-language muted">{data.language === 'python' ? 'Python 3.14 · WASM' : 'JavaScript · Worker'}</span>
        <span className="poly-timer muted">{running ? `${(elapsed / 1000).toFixed(1)} s` : runInfo?.runMs != null ? `${runInfo.runMs} ms` : ''}</span>
        <button type="button" className="accent-button poly-run" disabled={running || host.readOnly} onClick={run}>
          {running ? 'Running…' : 'Run tests'}
        </button>
      </div>

      {tab === 'solution' && (
        <div className="poly-editor">
          <CodeMirror
            value={code}
            height="220px"
            theme={oneDark}
            extensions={[languageExtension]}
            readOnly={host.readOnly}
            onChange={value => setCode(value)}
          />
        </div>
      )}
      {tab === 'tests' && (
        <div className="poly-tests">
          {visibleTests.map(({ test, index, result }) => {
            const masked = test.hidden && !results;
            return (
              <div key={index} className={`poly-test-spec ${result ? (result.pass ? 'pass' : 'fail') : ''}`}>
                <span className="poly-test-mark">{result ? (result.pass ? '✓' : '✗') : '•'}</span>
                {masked
                  ? <span className="muted">Hidden test {index + 1} — revealed after your first run.</span>
                  : (
                    <code>
                      {test.fn}({(test.args ?? []).map(preview).join(', ')}) → {preview(test.expected)}
                      {test.hidden ? '  (hidden)' : ''}
                    </code>
                  )}
                <span className="poly-test-name muted">{test.name}</span>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'hints' && data.hints && (
        <ol className="poly-hints">
          {data.hints.map((hint, index) => <li key={index}>{hint}</li>)}
        </ol>
      )}

      {fatal && <pre className="poly-fatal" role="alert">{fatal}</pre>}

      {results && (
        <div className="poly-results">
          <div className="poly-results-head">
            <strong>{passCount} / {results.length} tests passed</strong>
            {runInfo && (
              <span className="muted">
                {data.language === 'python' && runInfo.bootMs ? `engine boot ${runInfo.bootMs} ms · ` : ''}
                {runInfo.runMs != null ? `run ${runInfo.runMs} ms` : ''}
                {runInfo.heapBytes ? ` · WASM heap ${formatBytes(runInfo.heapBytes)}` : ''}
              </span>
            )}
          </div>
          {results.map((result, index) => (
            <div key={index} className={`poly-result ${result.pass ? 'pass' : 'fail'}`}>
              <div className="poly-result-head">
                <span>{result.pass ? '✓' : '✗'} {result.name}{result.hidden ? ' (hidden)' : ''}</span>
                <span className="muted">{result.durationMs} ms</span>
              </div>
              {!result.pass && result.error && <pre className="poly-error">{result.error}</pre>}
              {!result.pass && !result.error && (result.actual !== undefined || result.expected !== undefined) && (
                <div className="poly-diff">
                  <div className="poly-diff-expected"><span>expected</span><code>{result.expected}</code></div>
                  <div className="poly-diff-actual"><span>actual</span><code>{result.actual}</code></div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {logs.length > 0 && (
        <div className="poly-console">
          <div className="poly-console-head muted">console</div>
          {logs.map((line, index) => (
            <div key={index} className={`poly-log ${line.level === 'error' ? 'error' : ''}`}>{line.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}
