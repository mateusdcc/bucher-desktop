/**
 * React view for ext-sql-duckdb-lab (browser-only; loaded lazily at mount).
 * Self-hosted DuckDB-WASM engine, seeded tables, SQL editor, sortable
 * TanStack result tables, schema diagram, and graded challenges.
 *
 * @module extensions/sql-duckdb-lab-view
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { sql } from '@codemirror/lang-sql';
import { oneDark } from '@codemirror/theme-one-dark';
import {
  createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel,
  useReactTable, type SortingState,
} from '@tanstack/react-table';
import { gradeRows, type Payload } from './sql-duckdb-lab.js';
import { trackRuntime } from './runtime.js';
import type { MountProps } from './types.js';

type Cell = string | number | boolean | null;
interface QueryResult { columns: string[]; rows: Cell[][] }
interface Verdict { match: boolean; reason?: string }
interface Engine { db: { terminate: () => Promise<void> }; conn: { query: (sql: string) => Promise<any>; close: () => Promise<void> }; worker: Worker }

export interface DuckdbLabProps {
  data: Payload;
  host: MountProps;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/** SQL literal for seeding (strings escaped, numbers/bools/nulls direct). */
function literal(value: Cell): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${value.replace(/'/g, "''")}'`;
}

function normalizeCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return Number(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

export function SqlDuckdbLab({ data, host }: DuckdbLabProps) {
  const saved = (host.savedState ?? {}) as Record<string, unknown>;
  const defaultQuery = data.query ?? `SELECT * FROM ${data.tables[0].name};`;
  const [query, setQuery] = useState<string>(typeof saved.query === 'string' ? saved.query : defaultQuery);
  const [result, setResult] = useState<QueryResult | null>((saved.result as QueryResult) ?? null);
  const [verdict, setVerdict] = useState<Verdict | null>((saved.verdict as Verdict) ?? null);
  const [runMs, setRunMs] = useState<number | null>(typeof saved.runMs === 'number' ? saved.runMs : null);
  const [engineState, setEngineState] = useState<'booting' | 'ready' | 'error'>('booting');
  const [bootMs, setBootMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const engineRef = useRef<Engine | null>(null);
  const mountedStatusRef = useRef<string | null>(null);
  const completedRef = useRef(false);

  const status: 'unsolved' | 'in-progress' | 'passed' = useMemo(() => {
    if (data.mode !== 'challenge') return 'unsolved';
    if (verdict?.match) return 'passed';
    if (result || query !== defaultQuery) return 'in-progress';
    return 'unsolved';
  }, [data.mode, verdict, result, query, defaultQuery]);

  useEffect(() => {
    if (mountedStatusRef.current === null) mountedStatusRef.current = status;
    host.onSaveState({ query, result, verdict, runMs, status });
    if (status === 'passed' && mountedStatusRef.current !== 'passed' && !completedRef.current) {
      completedRef.current = true;
      host.onComplete();
    }
  }, [query, result, verdict, runMs, status, host]);

  const runQuery = useCallback(async (sqlText: string) => {
    const engine = engineRef.current;
    if (!engine || running) return;
    setRunning(true);
    setError(null);
    const started = performance.now();
    try {
      const arrow = await engine.conn.query(sqlText);
      const columns: string[] = arrow.schema.fields.map((field: { name: string }) => field.name);
      const rows: Cell[][] = arrow.toArray().map((row: Record<string, unknown>) =>
        columns.map(column => normalizeCell(row[column])));
      const elapsed = Math.round(performance.now() - started);
      const limited: QueryResult = { columns, rows: rows.slice(0, 200) };
      setResult(limited);
      setRunMs(elapsed);
      setSorting([]);
      if (data.mode === 'challenge' && data.expected) {
        let next: Verdict;
        if (data.expected.columns && columns.join('\u0000').toLowerCase() !== data.expected.columns.join('\u0000').toLowerCase()) {
          next = { match: false, reason: `expected columns [${data.expected.columns.join(', ')}], got [${columns.join(', ')}]` };
        } else {
          next = gradeRows(rows, data.expected.rows, { ordered: data.expected.ordered, tolerance: data.expected.tolerance });
        }
        setVerdict(next);
      }
    } catch (queryError) {
      setResult(null);
      setVerdict(null);
      setError(queryError instanceof Error ? queryError.message : String(queryError));
    } finally {
      setRunning(false);
    }
  }, [running, data]);

  // Boot the engine once per mount; seed the declared tables.
  useEffect(() => {
    let cancelled = false;
    let engine: Engine | null = null;
    (async () => {
      const started = Date.now();
      try {
        const duckdb = await trackRuntime('duckdb', () => import('@duckdb/duckdb-wasm'));
        if (cancelled) return;
        const asset = (file: string) => new URL(`/duckdb/${file}`, window.location.href).href;
        const bundle = await duckdb.selectBundle({
          mvp: { mainModule: asset('duckdb-mvp.wasm'), mainWorker: asset('duckdb-browser-mvp.worker.js') },
          eh: { mainModule: asset('duckdb-eh.wasm'), mainWorker: asset('duckdb-browser-eh.worker.js') },
        });
        if (!bundle.mainWorker || !bundle.mainModule) throw new Error('No compatible DuckDB WASM bundle for this browser.');
        const worker = new Worker(bundle.mainWorker);
        const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
        await db.instantiate(bundle.mainModule);
        if (cancelled) { worker.terminate(); await db.terminate(); return; }
        const conn = await db.connect();
        for (const table of data.tables) {
          const ddl = table.columns.map(column => `${column.name} ${column.type}`).join(', ');
          await conn.query(`CREATE TABLE ${table.name} (${ddl});`);
          if (table.rows.length) {
            const values = table.rows.map(row => `(${row.map(literal).join(', ')})`).join(', ');
            await conn.query(`INSERT INTO ${table.name} VALUES ${values};`);
          }
        }
        if (cancelled) { await conn.close(); await db.terminate(); worker.terminate(); return; }
        engine = { db, conn, worker };
        engineRef.current = engine;
        setBootMs(Date.now() - started);
        setEngineState('ready');
        if (data.mode === 'explore') await runQuery(defaultQuery);
      } catch (bootError) {
        if (!cancelled) {
          setEngineState('error');
          setError(bootError instanceof Error ? bootError.message : String(bootError));
        }
      }
    })();
    return () => {
      cancelled = true;
      const current = engineRef.current ?? engine;
      engineRef.current = null;
      if (current) {
        current.conn.close().catch(() => {});
        current.db.terminate().catch(() => {});
        current.worker.terminate();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const descriptionHost = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (descriptionHost.current && data.description) {
      descriptionHost.current.replaceChildren(host.renderMarkdown(data.description));
    }
  }, [data.description, host]);

  const columnHelper = useMemo(() => createColumnHelper<Cell[]>(), []);
  const tableColumns = useMemo(() => (result?.columns ?? []).map((name, index) =>
    columnHelper.accessor(row => row[index], {
      id: name,
      header: name,
      cell: info => formatCell(info.getValue()),
    })), [result, columnHelper]);
  const table = useReactTable({
    data: result?.rows ?? [],
    columns: tableColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="ducklab-extension">
      {data.description && <div className="ducklab-description markdown" ref={descriptionHost} />}
      <div className="ducklab-schema">
        {data.tables.map(tableDef => (
          <div key={tableDef.name} className="ducklab-table-card">
            <div className="ducklab-table-name">{tableDef.name}</div>
            {tableDef.columns.map(column => (
              <div key={column.name} className="ducklab-column">
                <span>{column.name}</span>
                <span className="muted">{column.type}</span>
              </div>
            ))}
            <div className="ducklab-rowcount muted">{tableDef.rows.length} rows</div>
          </div>
        ))}
      </div>
      <div className="ducklab-toolbar">
        <span className="muted ducklab-engine">
          {engineState === 'booting' ? 'Booting DuckDB engine…'
            : engineState === 'error' ? 'Engine failed to start'
              : `DuckDB · ready${bootMs != null ? ` (boot ${bootMs} ms)` : ''}${runMs != null ? ` · query ${runMs} ms` : ''}`}
        </span>
        <button
          type="button"
          className="accent-button ducklab-run"
          disabled={engineState !== 'ready' || running || host.readOnly}
          onClick={() => runQuery(query)}
        >
          {running ? 'Running…' : 'Run query'}
        </button>
      </div>
      <div className="ducklab-editor">
        <CodeMirror
          value={query}
          height="120px"
          theme={oneDark}
          extensions={[sql()]}
          readOnly={host.readOnly}
          onChange={value => setQuery(value)}
        />
      </div>
      {error && <pre className="ducklab-error" role="alert">{error}</pre>}
      {data.mode === 'challenge' && verdict && (
        <div className={`ducklab-verdict ${verdict.match ? 'pass' : 'fail'}`} role="status">
          {verdict.match ? '✓ Result matches the expected set — solved!' : `✗ Not yet: ${verdict.reason ?? 'result differs from the expected set.'}`}
        </div>
      )}
      {result && (
        <div className="ducklab-results">
          <div className="ducklab-results-head muted">
            {result.rows.length} row{result.rows.length === 1 ? '' : 's'} · click a header to sort
          </div>
          <div className="ducklab-table-wrap">
            <table className="ducklab-table">
              <thead>
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <th key={header.id} onClick={header.column.getToggleSortingHandler()} aria-sort={header.column.getIsSorted() === 'asc' ? 'ascending' : header.column.getIsSorted() === 'desc' ? 'descending' : 'none'}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span className="ducklab-sort">{header.column.getIsSorted() === 'asc' ? ' ▲' : header.column.getIsSorted() === 'desc' ? ' ▼' : ''}</span>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map(row => (
                  <tr key={row.id}>
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
