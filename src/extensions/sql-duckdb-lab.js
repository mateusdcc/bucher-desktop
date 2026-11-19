/**
 * ext-sql-duckdb-lab — in-browser relational database & data science sandbox.
 *
 * Real DuckDB SQL (DuckDB-WASM, self-hosted, lazy) over AI-seeded tables.
 * Readers write queries in a CodeMirror SQL editor, inspect sortable result
 * tables (@tanstack/react-table) and a schema diagram, and in challenge mode
 * their output is graded against an expected result set (multiset or ordered,
 * with numeric tolerance). Passing marks the owning book exercise solved.
 *
 * The React view lives in sql-duckdb-lab-view.tsx (lazy, browser-only).
 *
 * @module extensions/sql-duckdb-lab
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
const cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const schema = z.object({
  ...blockMeta,
  mode: z.enum(['explore', 'challenge']).default('explore'),
  description: z.string().max(4000).optional().describe('Markdown task statement.'),
  tables: z.array(z.object({
    name: z.string().regex(IDENTIFIER, 'Table names are SQL identifiers.').max(40),
    columns: z.array(z.object({
      name: z.string().regex(IDENTIFIER).max(40),
      type: z.enum(['TEXT', 'INTEGER', 'DOUBLE', 'BOOLEAN', 'DATE']),
    })).min(1).max(12),
    rows: z.array(z.array(cell).max(12)).max(500),
  })).min(1).max(6),
  query: z.string().max(4000).optional().describe('Initial editor content; defaults to SELECT * FROM the first table.'),
  expected: z.object({
    columns: z.array(z.string().max(40)).max(12).optional().describe('When set, result column names must match.'),
    rows: z.array(z.array(cell).max(12)).max(500),
    ordered: z.boolean().default(false).describe('false = multiset comparison (row order free).'),
    tolerance: z.number().min(0).max(1).default(0.001).describe('Absolute tolerance for numeric cells.'),
  }).optional(),
}).superRefine((data, ctx) => {
  const names = new Set();
  data.tables.forEach((table, index) => {
    if (names.has(table.name)) {
      ctx.addIssue({ code: 'custom', path: ['tables', index, 'name'], message: `Duplicate table name "${table.name}".` });
    }
    names.add(table.name);
    const columnCount = table.columns.length;
    table.rows.forEach((row, rowIndex) => {
      if (row.length !== columnCount) {
        ctx.addIssue({ code: 'custom', path: ['tables', index, 'rows', rowIndex], message: `Row has ${row.length} cells but the table declares ${columnCount} columns.` });
      }
    });
  });
  if (data.mode === 'challenge' && !data.expected) {
    ctx.addIssue({ code: 'custom', path: ['expected'], message: 'Challenge mode requires an expected result set.' });
  }
  const expected = data.expected;
  if (expected?.columns) {
    const columnCount = expected.columns.length;
    if (expected.rows.some(row => row.length !== columnCount)) {
      ctx.addIssue({ code: 'custom', path: ['expected', 'rows'], message: 'Expected rows must match the expected column count.' });
    }
  }
});

/** @typedef {import('zod').infer<typeof schema>} Payload */

/**
 * Compare a query result against the expected set. Exported for unit tests.
 *
 * @param {unknown[][]} actual
 * @param {unknown[][]} expected
 * @param {{ ordered?: boolean, tolerance?: number }} [options]
 * @returns {{ match: boolean, reason?: string }}
 */
export function gradeRows(actual, expected, options = {}) {
  const tolerance = options.tolerance ?? 0.001;
  /** @param {unknown} value */
  const normalize = value => {
    if (typeof value === 'bigint') return Number(value);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return value;
  };
  /**
   * @param {unknown} a
   * @param {unknown} b
   */
  const cellEqual = (a, b) => {
    const x = normalize(a);
    const y = normalize(b);
    if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) <= tolerance;
    return x === y;
  };
  /**
   * @param {unknown[]} a
   * @param {unknown[]} b
   */
  const rowEqual = (a, b) => a.length === b.length && a.every((value, index) => cellEqual(value, b[index]));
  if (actual.length !== expected.length) {
    return { match: false, reason: `expected ${expected.length} row${expected.length === 1 ? '' : 's'}, got ${actual.length}` };
  }
  if (options.ordered) {
    for (let i = 0; i < expected.length; i += 1) {
      if (!rowEqual(actual[i], expected[i])) {
        return { match: false, reason: `row ${i + 1} differs: expected [${expected[i].join(', ')}], got [${actual[i].join(', ')}]` };
      }
    }
    return { match: true };
  }
  const remaining = [...actual];
  for (const expectedRow of expected) {
    const index = remaining.findIndex(row => rowEqual(row, expectedRow));
    if (index === -1) {
      return { match: false, reason: `no result row matches [${expectedRow.join(', ')}]` };
    }
    remaining.splice(index, 1);
  }
  return { match: true };
}

/** @type {BucherExtension} */
export const sqlDuckdbLabExtension = {
  id: 'ext-sql-duckdb-lab',
  name: 'DuckDB SQL Lab',
  version: '1.0.0',
  description: 'Real in-browser DuckDB database: seeded tables, schema diagram, SQL editor, sortable result tables, and graded query challenges.',
  category: 'hybrid',
  icon: 'database',
  skill: {
    instructions: `Use ext-sql-duckdb-lab for relational data work: SELECT/WHERE/GROUP BY/JOIN/window-function exercises over small seeded datasets, and exploratory data labs. It runs REAL DuckDB SQL in-browser (WASM). Rules:
- tables: 1–6 tables { name, columns: [{name, type}], rows: [[cells]] }. Types: TEXT, INTEGER, DOUBLE, BOOLEAN, DATE (ISO strings). Keep datasets small (≤60 rows total) and meaningful — names, dates, amounts. Row cell counts must equal the column count; null is allowed.
- description: Markdown task. For challenges state exactly what the result should contain (columns, ordering, rounding).
- mode challenge: add expected { columns?, rows, ordered?, tolerance? }. rows is the exact expected result set; ordered false (default) compares as a multiset, true requires ORDER BY. tolerance (default 0.001) applies to numeric cells — instruct ROUND(..., 2) in the task when you want exact decimals. Set columns when column names matter.
- query: optional starting SQL (a skeleton like SELECT ... FROM ... is good pedagogy; never give the full solution in challenge mode).
- DuckDB dialect: standard SQL plus QUALIFY, LIST aggregates, etc. Prefer portable SQL for teaching.
- Set a stable id and title; place challenge blocks in chapters (embed in a > [!exercise] callout).`,
    syntaxSpec: `Fence info string: ext-sql-duckdb-lab. YAML fields:
- mode: explore | challenge (default explore). description: Markdown (optional).
- tables: [{ name, columns: [{ name, type: TEXT|INTEGER|DOUBLE|BOOLEAN|DATE }], rows: [[string|number|bool|null]] }] (1–6 tables, ≤500 rows each).
- query: initial SQL (optional).
- expected (challenge, required): { columns?: [names], rows: [[cells]], ordered?: bool (default false), tolerance?: number (default 0.001) }.`,
    fewShotExamples: [
      {
        title: 'Explore a seeded sales table',
        yaml: `id: duckdb-explore-sales
title: Explore regional sales
mode: explore
description: |
  A small sales dataset. Run queries, sort the result table by clicking
  column headers, and inspect the schema below.
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
  SELECT * FROM sales;`,
      },
      {
        title: 'Challenge: revenue per region',
        yaml: `id: duckdb-revenue-by-region
title: Total revenue per region
mode: challenge
description: |
  Write a query returning each region's **total revenue**, with columns
  \`region\` and \`total\`, rounded to 2 decimals. Row order does not matter.
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
  SELECT region
  FROM sales;
expected:
  columns: [region, total]
  rows:
    - [EU, 160.0]
    - [US, 205.0]
    - [APAC, 120.0]
  ordered: false`,
      },
    ],
  },
  dependencies: {
    webPackages: [
      { name: '@duckdb/duckdb-wasm', version: '^1.32.0', purpose: 'Real DuckDB SQL engine (WASM), self-hosted eh/mvp bundles; lockfile pins the exact stable build.', lazyLoad: true },
      { name: '@tanstack/react-table', version: '^8.21.3', purpose: 'Headless sortable result tables.', lazyLoad: true },
      { name: '@codemirror/lang-sql', version: '^6.10.0', purpose: 'SQL syntax highlighting in the query editor.', lazyLoad: true },
      { name: 'react', version: '^19.3.1', purpose: 'UI runtime for the lab island (shared React island).', lazyLoad: true },
      { name: 'react-dom', version: '^19.3.1', purpose: 'React root rendering into the extension frame.', lazyLoad: true },
    ],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    host.replaceChildren(el('p', 'muted', 'Loading SQL lab…'));
    /** @type {ReactMount | null} */
    let handle = null;
    let destroyed = false;
    (async () => {
      try {
        const { SqlDuckdbLab } = await import('./sql-duckdb-lab-view.tsx');
        if (destroyed) return;
        handle = await mountReactComponent(host, SqlDuckdbLab, { data: props.data, host: props });
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
