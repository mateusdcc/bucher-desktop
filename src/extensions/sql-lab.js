/**
 * ext-sql-lab — interactive SQL playground (bonus extension).
 *
 * The author supplies a schema + seed data (setup SQL) and an expected result.
 * The learner writes SELECT queries in a CodeMirror editor; each run executes
 * against a fresh in-memory alasql database, renders the result table, and
 * grades it against the expected rows (order-insensitive by default).
 * Passing marks the owning book exercise solved; query and verdict persist.
 *
 * @module extensions/sql-lab
 */
import { z } from 'zod';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { sql } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { button, el, icon } from '../ui.js';
import { blockMeta, createValidator } from './validate.js';

/**
 * @typedef {import('./types.js').BucherExtension} BucherExtension
 * @typedef {import('./types.js').MountProps} MountProps
 * @typedef {import('./types.js').MountedExtension} MountedExtension
 * @typedef {Record<string, unknown>} Row
 * @typedef {{ exec: (sql: string) => unknown, tables: Record<string, { columns: { columnid: string }[] }> }} AlaDb
 */

const schema = z.object({
  ...blockMeta,
  prompt: z.string().max(8000).optional().describe('Markdown task description.'),
  setup: z.string().min(1).max(20000).describe('SQL run before every attempt: CREATE TABLE + INSERT statements.'),
  starter: z.string().max(4000).default('SELECT * FROM ').describe('Initial query in the editor.'),
  expected: z.array(z.record(z.string(), z.unknown())).min(1).max(200).describe('Expected result rows as objects keyed by column name.'),
  ordered: z.boolean().default(false).describe('When true, row order must match exactly.'),
});

/** @typedef {import('zod').infer<typeof schema>} Payload */

/** @type {BucherExtension} */
export const sqlLabExtension = {
  id: 'ext-sql-lab',
  name: 'SQL Lab',
  version: '1.0.0',
  description: 'Write SQL queries against a seeded in-memory database and check results against the expected rows.',
  category: 'exercise',
  icon: 'database',
  skill: {
    instructions: `Use ext-sql-lab for hands-on SQL practice: filtering, joining, grouping, and aggregating small datasets. Rules:
- setup runs before EVERY attempt on a fresh database: write CREATE TABLE and INSERT statements only (alasql SQL dialect; INT/STRING/REAL types). Keep 2–4 tables with 3–10 rows each.
- expected is the exact result of the intended query: a list of row objects whose keys are the output column names (aliases included). Values must match alasql's output types (numbers for aggregates).
- Set ordered: true only when the task requires ORDER BY; otherwise row order is ignored.
- The prompt is Markdown: describe the question in words, name the tables/columns, and do NOT write the solution query.
- starter may be an empty SELECT skeleton. Set a stable id and title; place the block in a chapter.`,
    syntaxSpec: `Fence info string: ext-sql-lab. YAML fields:
- prompt (Markdown, optional): the task.
- setup (string, required): CREATE TABLE / INSERT SQL, use a | block scalar.
- starter (string, optional): initial editor query.
- expected (required, 1–200): [ { column: value, … }, … ] result rows.
- ordered (boolean, optional, default false): grade row order strictly.`,
    fewShotExamples: [
      {
        title: 'Filter with WHERE',
        yaml: `id: sql-where
title: Early science fiction
prompt: |
  The \`books\` table holds a small library. List the \`title\` of every book
  published before 1970.
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
  - { title: Foundation }`,
      },
      {
        title: 'Join and aggregate',
        yaml: `id: sql-join-count
title: Orders per customer
prompt: |
  Return each customer's \`name\` and the number of their orders as \`orders\`.
setup: |
  CREATE TABLE customers (id INT, name STRING);
  CREATE TABLE orders (id INT, customer_id INT);
  INSERT INTO customers VALUES (1, 'Ada');
  INSERT INTO customers VALUES (2, 'Grace');
  INSERT INTO orders VALUES (10, 1);
  INSERT INTO orders VALUES (11, 1);
  INSERT INTO orders VALUES (12, 2);
starter: |
  SELECT c.name, COUNT(*) AS orders
  FROM customers c
expected:
  - { name: Ada, orders: 2 }
  - { name: Grace, orders: 1 }`,
      },
    ],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    return mountSqlLab(host, props);
  },
};

const EDITOR_THEME = EditorView.theme({
  '&': { backgroundColor: '#141614', color: '#deded9', fontSize: '13px', border: '1px solid #2c312c' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', caretColor: '#73d695' },
  '.cm-cursor': { borderLeftColor: '#73d695' },
  '&.cm-focused': { outline: 'none', borderColor: '#4a5a4a' },
  '.cm-gutters': { backgroundColor: '#141614', color: '#5a605a', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#1b1d1b66' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: '#36574466' },
}, { dark: true });

const HIGHLIGHT = HighlightStyle.define([
  { tag: tags.keyword, color: '#b48fe8' },
  { tag: tags.comment, color: '#6a706a', fontStyle: 'italic' },
  { tag: tags.string, color: '#e8d06f' },
  { tag: tags.number, color: '#e8a86f' },
  { tag: tags.operator, color: '#9c9d95' },
]);

/**
 * @param {Row} row
 * @returns {string}
 */
function canonical(row) {
  return JSON.stringify(Object.keys(row).sort().map(key => [key, row[key]]));
}

/**
 * @param {Row[]} actual
 * @param {Row[]} expected
 * @param {boolean} ordered
 * @returns {boolean}
 */
export function rowsMatch(actual, expected, ordered) {
  if (actual.length !== expected.length) return false;
  if (ordered) return actual.every((row, index) => canonical(row) === canonical(expected[index]));
  const pool = expected.map(canonical);
  for (const row of actual) {
    const key = canonical(row);
    const index = pool.indexOf(key);
    if (index === -1) return false;
    pool.splice(index, 1);
  }
  return true;
}

/**
 * @param {Row[]} rows
 * @returns {HTMLElement}
 */
function resultTable(rows) {
  if (!rows.length) return el('p', 'muted sql-empty', 'The query returned no rows.');
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  const table = el('table', 'sql-table',
    el('thead', '', el('tr', '', ...columns.map(column => el('th', '', column)))),
    el('tbody', '', ...rows.slice(0, 100).map(row =>
      el('tr', '', ...columns.map(column => el('td', '', formatCell(row[column])))))));
  return el('div', 'sql-table-wrap', table,
    rows.length > 100 ? el('p', 'muted', `Showing 100 of ${rows.length} rows.`) : null);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function formatCell(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * @param {HTMLElement} host
 * @param {MountProps} props
 * @returns {MountedExtension}
 */
function mountSqlLab(host, props) {
  const data = /** @type {Payload} */ (props.data);
  const saved = props.savedState ?? {};
  let query = typeof saved.query === 'string' ? saved.query : data.starter;
  let status = saved.status === 'passed' ? 'passed' : saved.verdict ? 'in-progress' : 'unsolved';
  /** @type {Row[] | null} */
  let rows = Array.isArray(saved.rows) ? /** @type {Row[]} */ (saved.rows) : null;
  let verdict = saved.verdict === 'pass' || saved.verdict === 'fail' || saved.verdict === 'error' ? saved.verdict : null;
  let message = typeof saved.message === 'string' ? saved.message : '';
  let destroyed = false;
  /** @type {(() => Promise<AlaDb>) | null} */
  let newDatabase = null;

  const schemaInfo = el('div', 'sql-schema');
  const verdictBanner = el('div', 'sql-verdict');
  const resultHost = el('div', 'sql-result');
  const expectedDetails = el('details', 'sql-expected', el('summary', '', 'Reveal expected result'), resultTable(data.expected));
  const editorHost = el('div', 'sql-editor');
  const run = button('Run query', 'play', () => runQuery(), 'accent-button');
  const reset = button('Reset query', 'rotate-ccw', () => {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: data.starter } });
    query = data.starter;
    rows = null;
    verdict = null;
    message = '';
    status = 'unsolved';
    renderOutcome();
    persist();
  });
  const root = el('div', 'sql-extension',
    data.prompt ? el('div', 'sql-prompt', props.renderMarkdown(data.prompt)) : null,
    schemaInfo, editorHost,
    el('div', 'sql-controls', run, reset),
    verdictBanner, resultHost, expectedDetails);
  host.append(root);

  const readOnly = new Compartment();
  const view = new EditorView({
    parent: editorHost,
    doc: query,
    extensions: [
      keymap.of([
        { key: 'Mod-Enter', run: () => { runQuery(); return true; } },
        ...defaultKeymap, ...historyKeymap,
      ]),
      history(), sql(), EDITOR_THEME, syntaxHighlighting(HIGHLIGHT),
      EditorView.lineWrapping,
      readOnly.of(EditorState.readOnly.of(props.readOnly)),
      EditorView.contentAttributes.of({ 'aria-label': 'SQL query', spellcheck: 'false' }),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        query = update.state.doc.toString();
        if (status === 'passed') status = 'in-progress';
        persist();
      }),
    ],
  });

  function persist() {
    props.onSaveState({ query, status, rows, verdict, message });
  }

  function renderOutcome() {
    verdictBanner.replaceChildren();
    verdictBanner.className = 'sql-verdict' + (verdict ? ' ' + verdict : '');
    verdictBanner.hidden = !verdict;
    if (verdict === 'pass') verdictBanner.append(icon('check-circle-2'), 'Correct — your query returns the expected rows.');
    else if (verdict === 'fail') verdictBanner.append(icon('x-circle'), message || 'Not quite — compare your result with the expected rows.');
    else if (verdict === 'error') verdictBanner.append(icon('alert-triangle'), message || 'The query failed.');
    resultHost.replaceChildren();
    if (rows) resultHost.append(resultTable(rows));
  }

  async function runQuery() {
    if (!newDatabase) return;
    const currentQuery = view.state.doc.toString();
    query = currentQuery;
    let completed = false;
    try {
      // Fresh database per attempt so setup is deterministic.
      const fresh = await newDatabase();
      fresh.exec(data.setup);
      const outcome = fresh.exec(currentQuery);
      if (!Array.isArray(outcome)) {
        rows = null;
        verdict = 'error';
        message = 'Write a SELECT query that returns rows.';
        status = 'in-progress';
      } else {
        rows = /** @type {Row[]} */ (outcome).slice(0, 200);
        const pass = rowsMatch(rows, data.expected, data.ordered);
        verdict = pass ? 'pass' : 'fail';
        message = pass ? '' : `Your query returned ${rows.length} row${rows.length === 1 ? '' : 's'}; expected ${data.expected.length}.`;
        status = pass ? 'passed' : 'in-progress';
        completed = pass;
      }
    } catch (error) {
      rows = null;
      verdict = 'error';
      message = error instanceof Error ? error.message : String(error);
      status = 'in-progress';
    }
    renderOutcome();
    persist();
    // Complete only after the new state is persisted: completion triggers a
    // reader refresh that remounts this block from the saved state.
    if (completed) props.onComplete();
  }

  (async () => {
    try {
      const alasql = (await import('alasql')).default;
      if (destroyed) return;
      newDatabase = async () => /** @type {AlaDb} */ (new alasql.Database());
      const intro = await newDatabase();
      intro.exec(data.setup);
      if (destroyed) return;
      const tables = Object.entries(intro.tables).map(([name, table]) =>
        el('span', 'sql-table-chip', el('strong', '', name),
          el('span', 'muted', table.columns.map(column => column.columnid).join(', '))));
      schemaInfo.replaceChildren(el('span', 'eyebrow', 'Schema'), ...tables);
    } catch (error) {
      if (!destroyed) props.onError(error);
    }
  })();

  renderOutcome();
  return {
    destroy() {
      destroyed = true;
      view.destroy();
    },
  };
}
