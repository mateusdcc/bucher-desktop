const { test } = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const { ExtensionRegistry } = require('../src/extensions/registry');
const { createValidator, jsonSchemaFor, blockMeta } = require('../src/extensions/validate');
const { blockKey, isExtensionInfo, payloadId, payloadTitle } = require('../src/extensions/keys');
const { composeSkills, skillArgs } = require('../src/extensions/skills');
const { fenceBody, fenceInfo } = require('../src/extensions/keys');
const { createLibrary } = require('../src/model/library');
const { listBuches } = require('../src/model/catalog');
const { LearningIndex } = require('../src/model/learning');
const { BookProgress, countsFor } = require('../src/model/progress');

function memoryStorage() {
  const map = new Map();
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), dump: () => map };
}

function fakeExtension(overrides = {}) {
  const schema = z.object({ ...blockMeta, value: z.number() });
  return {
    id: 'ext-fake',
    name: 'Fake',
    version: '1.0.0',
    description: 'Test extension',
    category: 'visualization',
    icon: 'puzzle',
    skill: {
      instructions: 'Use the fake block for tests.',
      syntaxSpec: 'value: <number>',
      fewShotExamples: [{ title: 'Example', yaml: 'value: 1' }],
    },
    dependencies: { webPackages: [] },
    schema,
    validate: createValidator(schema),
    mount: () => ({ destroy() {} }),
    ...overrides,
  };
}

test('registry enforces the extension contract and rejects duplicates', () => {
  const registry = new ExtensionRegistry({ storage: null });
  registry.register(fakeExtension());
  assert.throws(() => registry.register(fakeExtension()), /already registered/);
  assert.throws(() => registry.register(fakeExtension({ id: 'bad-id' })), /id must look like/);
  assert.throws(() => registry.register(fakeExtension({ id: 'ext-other', category: 'widget' })), /category/);
  assert.throws(() => registry.register(fakeExtension({ id: 'ext-other', skill: { instructions: '', syntaxSpec: 'x', fewShotExamples: [] } })), /instructions/);
  assert.throws(() => registry.register(fakeExtension({ id: 'ext-other', skill: { instructions: 'x', syntaxSpec: 'x', fewShotExamples: [{ title: 't', yaml: ' ' }] } })), /fewShotExamples/);
  assert.throws(() => registry.register(fakeExtension({ id: 'ext-other', mount: null })), /mount/);
  assert.throws(() => registry.register(fakeExtension({ id: 'ext-other', dependencies: undefined })), /dependencies/);
  assert.throws(() => registry.register(fakeExtension({ id: 'ext-other', dependencies: { webPackages: [{ name: 'x', version: '1', purpose: 'p', lazyLoad: 'yes' }] } })), /dependencies/);
  assert.throws(() => registry.register(fakeExtension({ id: 'ext-other', dependencies: { webPackages: [], tauriDependencies: [{ type: 'magic', name: 'n', fallbackBehavior: 'degrade-gracefully', purpose: 'p' }] } })), /dependencies/);
  assert.equal(registry.list().length, 1);
});

test('enablement persists, notifies subscribers, and filters the enabled set', () => {
  const storage = memoryStorage();
  const registry = new ExtensionRegistry({ storage });
  registry.register(fakeExtension());
  registry.register(fakeExtension({ id: 'ext-other', category: 'exercise' }));
  let notifications = 0;
  const unsubscribe = registry.subscribe(() => { notifications += 1; });
  assert.deepEqual(registry.enabled().map(extension => extension.id), ['ext-fake', 'ext-other']);
  assert.equal(registry.isExercise('ext-other'), true);
  assert.equal(registry.isExercise('ext-fake'), false);
  registry.setEnabled('ext-fake', false);
  assert.equal(registry.isEnabled('ext-fake'), false);
  assert.deepEqual(registry.enabled().map(extension => extension.id), ['ext-other']);
  assert.deepEqual(JSON.parse(storage.getItem('bucher/extensions-disabled')), ['ext-fake']);
  const restored = new ExtensionRegistry({ storage });
  restored.register(fakeExtension());
  assert.equal(restored.isEnabled('ext-fake'), false);
  restored.setEnabled('ext-fake', true);
  assert.equal(restored.isEnabled('ext-fake'), true);
  assert.deepEqual(JSON.parse(storage.getItem('bucher/extensions-disabled')), []);
  assert.equal(notifications, 1);
  unsubscribe();
  registry.setEnabled('ext-fake', false);
  assert.equal(notifications, 1);
});

test('validation returns structured issues and json schema for skills', () => {
  const extension = fakeExtension();
  const good = extension.validate({ id: 'demo', title: 'Demo', value: 3 });
  assert.deepEqual(good, { ok: true, data: { id: 'demo', title: 'Demo', value: 3 } });
  const bad = extension.validate({ value: 'three', extra: true });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.ok(bad.issues.some(issue => issue.path === 'value'));
    assert.ok(bad.issues.every(issue => typeof issue.message === 'string' && issue.message.length));
  }
  assert.equal(extension.validate(null).ok, false);
  const jsonSchema = jsonSchemaFor(extension.schema);
  assert.equal(jsonSchema?.type, 'object');
  assert.ok(jsonSchema?.properties && Object.hasOwn(jsonSchema.properties, 'value'));
});

test('block keys prefer explicit ids, then anchors, then positional fallbacks', () => {
  assert.equal(blockKey({ id: 'plot-1' }, { nodeId: '^anchor' }, 'ext-math-plot'), 'id:plot-1');
  assert.equal(blockKey({}, { nodeId: '^anchor' }, 'ext-math-plot'), '^anchor');
  assert.equal(blockKey({}, { unitIndex: 4, occurrence: 1 }, 'ext-mermaid'), 'u4:ext-mermaid:1');
  assert.equal(blockKey(null, {}, 'ext-mermaid'), 'u0:ext-mermaid:0');
  assert.equal(blockKey({ id: '  ' }, { nodeId: '^x' }, 'ext-mermaid'), '^x');
  assert.equal(payloadId({ id: 'ok' }), 'ok');
  assert.equal(payloadId([1, 2]), null);
  assert.equal(payloadTitle({ title: 'A plot' }), 'A plot');
  assert.equal(payloadTitle('nope'), null);
  assert.equal(isExtensionInfo('ext-mermaid'), true);
  assert.equal(isExtensionInfo(' ext-code-lab '), true);
  assert.equal(isExtensionInfo('javascript'), false);
  assert.equal(isExtensionInfo('ext-'), false);
});

test('skill composer aggregates enabled extensions only, with schemas and examples', () => {
  const registry = new ExtensionRegistry({ storage: null });
  assert.equal(composeSkills(registry), '');
  assert.deepEqual(skillArgs(registry), {});
  registry.register(fakeExtension());
  registry.register(fakeExtension({
    id: 'ext-other',
    name: 'Other',
    category: 'exercise',
    skill: {
      instructions: 'Author other blocks for practice.',
      syntaxSpec: 'value: <number>',
      fewShotExamples: [{ title: 'Practice', yaml: 'id: practice\nvalue: 2' }],
    },
  }));
  const skills = composeSkills(registry);
  assert.match(skills, /Interactive extension blocks/);
  assert.match(skills, /ext-fake/);
  assert.match(skills, /Use the fake block for tests\./);
  assert.match(skills, /```ext-fake\nvalue: 1\n```/);
  assert.match(skills, /Payload JSON Schema/);
  assert.match(skills, /ext-other/);
  registry.setEnabled('ext-other', false);
  const reduced = composeSkills(registry);
  assert.match(reduced, /ext-fake/);
  assert.doesNotMatch(reduced, /ext-other/);
  assert.deepEqual(skillArgs(registry), { skills: reduced });
  registry.setEnabled('ext-fake', false);
  assert.deepEqual(skillArgs(registry), {});
});

test('fence helpers extract info strings and payload bodies', () => {
  const fence = '```ext-fake\nid: x\nvalue: 1\n```\n';
  assert.equal(fenceInfo(fence), 'ext-fake');
  assert.equal(fenceBody(fence), 'id: x\nvalue: 1');
  assert.equal(fenceInfo('```javascript\ncode\n```'), 'javascript');
  assert.equal(fenceBody('~~~ext-fake\nvalue: 2\n~~~'), 'value: 2');
});

test('exercise fences become exercise nodes and extension state persists in _progress.md', async () => {
  const chapterSource = [
    '---', 'name: Algorithms', 'order: 1', '---', '', '# Algorithms', '', 'Intro.', '',
    '```ext-fake', 'id: demo-block', 'title: Demo exercise', 'value: 1', '```', '',
    '^demo-anchor', '',
    '> [!hint]- Hint', '> Think.', '',
    '```ext-viz', 'id: viz-1', 'value: 2', '```', '',
    '```ext-fake', 'value: 9', '```', '',
  ].join('\n');
  const disk = new Map([
    ['Buches/Algorithms/_index.md', '---\ntitle: Algorithms\n---\n\n# Algorithms\n'],
    ['Buches/Algorithms/concepts/Algorithms.md', chapterSource],
  ]);
  const library = createLibrary(async (path, text, expected) => {
    assert.equal(disk.get(path) ?? null, expected);
    disk.set(path, text);
  }, async () => {});
  const reload = () => library.load({ basePath: '/data', entries: [...disk].map(([path, source]) => ({ path, source })) });
  reload();
  const book = listBuches(library.app)[0];
  const learning = new LearningIndex(library.app, id => id === 'ext-fake');
  const model = await learning.book(book);
  const chapter = model.chapters[0];
  const exercises = chapter.nodes.filter(node => node.type === 'exercise');
  assert.equal(exercises.length, 2);
  assert.equal(exercises[0].id, '^demo-anchor');
  assert.equal(exercises[0].title, 'Demo exercise');
  assert.equal(exercises[0].hints.length, 1);
  assert.equal(exercises[1].id, 'extension:ext-fake#1');
  const vizUnit = chapter.units.find(unit => unit.markdown.startsWith('```ext-viz'));
  assert.equal(vizUnit.node, undefined);

  const progress = new BookProgress(library.app, {});
  assert.equal(countsFor(model, await progress.read(model)).exercises, 2);
  await progress.set(model, { ...exercises[0], path: chapter.path }, true);
  assert.equal(countsFor(model, await progress.read(model)).solved, 1);

  const key = 'concepts/Algorithms.md#id:demo-block';
  await progress.setExtensionState(book, key, { status: 'passed', code: 'return 1;' });
  assert.deepEqual(await progress.readExtensions(book), { [key]: { status: 'passed', code: 'return 1;' } });
  await progress.setExtensionState(book, key, null);
  assert.deepEqual(await progress.readExtensions(book), {});

  disk.set('Buches/Algorithms/_progress.md', '---\nbuches_progress: 1\nchapters: {}\n---\n');
  reload();
  assert.deepEqual(await progress.readExtensions(book), {});
});

test('expression engine parses, evaluates, and rejects safely', () => {
  const { compileExpression, parseExpression, freeSymbols } = require('../src/extensions/lib/expression');
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
  const scope = { x: 3, a: 2, b: -1, t: 0 };
  close(compileExpression('a*x^2 + b*x + 1', ['x', 'a', 'b'])(scope), 16);
  close(compileExpression('2x + 3(x - 1)', ['x'])(scope), 12);
  close(compileExpression('-x^2', ['x'])(scope), -9);
  close(compileExpression('2^3^2', [])(scope), 512);
  close(compileExpression('sin(pi/2) + cos(0)', [])(scope), 2);
  close(compileExpression('sqrt(abs(-16)) + log10(1000)', [])(scope), 7);
  close(compileExpression('min(2, 5) + max(1, 3) + pow(2, 4)', [])(scope), 21);
  close(compileExpression('a(x + 1)', ['x', 'a'])(scope), 8);
  close(compileExpression('(x + 1)(x - 1)', ['x'])(scope), 8);
  close(compileExpression('1e-3 * 1000', [])(scope), 1);
  assert.throws(() => compileExpression('y + 1', ['x']), /Unknown symbol/);
  assert.throws(() => compileExpression('2 +', []), /Unexpected end/);
  assert.throws(() => compileExpression('foo(x)', ['x']), /Unknown symbol “foo”/);
  assert.throws(() => compileExpression('min(1)', []), /expects 2/);
  assert.throws(() => compileExpression('x @ 2', ['x']), /Unexpected character/);
  assert.throws(() => compileExpression('x)(', ['x']), /trailing input/);
  assert.deepEqual([...freeSymbols(parseExpression('a*x + sin(t)'))].sort(), ['a', 't', 'x']);
});

test('code-lab worker runs tests, captures console, and shadows dangerous globals', async () => {
  const vm = require('node:vm');
  const { readFileSync } = require('node:fs');
  const source = readFileSync(require.resolve('../src/extensions/code-lab/worker.js'), 'utf8');
  async function run(code, tests) {
    const messages = [];
    const sandbox = { self: { postMessage: message => messages.push(message) } };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    await sandbox.self.onmessage({ data: { code, tests } });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(messages.length, 1);
    // Normalize cross-realm objects so deepStrictEqual compares prototypes fairly.
    return JSON.parse(JSON.stringify(messages[0]));
  }
  const good = await run('function add(a, b) { return a + b; }', [
    { name: 'sums', fn: 'add', args: [2, 3], expected: 5 },
    { name: 'negatives', fn: 'add', args: [-2, -3], expected: -5, hidden: true },
  ]);
  assert.equal(good.type, 'result');
  assert.deepEqual(good.results.map(result => result.pass), [true, true]);
  assert.equal(good.results[1].hidden, true);

  const bad = await run('function add(a, b) { return a - b; }', [
    { name: 'sums', fn: 'add', args: [2, 3], expected: 5 },
  ]);
  assert.equal(bad.results[0].pass, false);
  assert.equal(bad.results[0].actual, '-1');
  assert.equal(bad.results[0].expected, '5');

  const missing = await run('const x = 1;', [{ name: 't', fn: 'nope', args: [], expected: 1 }]);
  assert.match(missing.results[0].error, /not defined/);

  const syntax = await run('function broken( {', [{ name: 't', fn: 'broken', args: [], expected: 1 }]);
  assert.equal(syntax.type, 'fatal');

  const deep = await run('function pair(x) { return { list: [x, { ok: true }] }; }', [
    { name: 'deep', fn: 'pair', args: [7], expected: { list: [7, { ok: true }] } },
  ]);
  assert.equal(deep.results[0].pass, true);

  const logged = await run('function hello() { console.log("hi", 42); return 1; }', [
    { name: 't', fn: 'hello', args: [], expected: 1 },
  ]);
  assert.deepEqual(logged.logs, [{ level: 'log', text: '"hi" 42' }]);

  const isolated = await run('function probe() { return [typeof fetch, typeof window, typeof importScripts]; }', [
    { name: 'isolated', fn: 'probe', args: [], expected: ['undefined', 'undefined', 'undefined'] },
  ]);
  assert.equal(isolated.results[0].pass, true);

  const asyncFn = await run('async function twice(x) { return x * 2; }', [
    { name: 'async', fn: 'twice', args: [4], expected: 8 },
  ]);
  assert.equal(asyncFn.results[0].pass, true);

  const injected = await run('function x() { return 1; }', [
    { name: 'evil', fn: 'x; process.exit(1)', args: [], expected: 1 },
  ]);
  assert.equal(injected.type, 'fatal');
  assert.match(injected.error, /invalid function name/);
});

test('sql-lab row grading compares multisets unless order is required', () => {
  const { rowsMatch } = require('../src/extensions/sql-lab');
  const expected = [{ title: 'Dune', year: 1965 }, { title: 'Foundation', year: 1951 }];
  assert.equal(rowsMatch([expected[1], expected[0]], expected, false), true);
  assert.equal(rowsMatch([expected[1], expected[0]], expected, true), false);
  assert.equal(rowsMatch(expected, expected, true), true);
  assert.equal(rowsMatch([expected[0]], expected, false), false);
  assert.equal(rowsMatch([expected[0], expected[0]], expected, false), false);
  assert.equal(rowsMatch([{ year: 1965, title: 'Dune' }, { title: 'Foundation', year: 1951 }], expected, false), true);
  assert.equal(rowsMatch([{ title: 'Dune' }, { title: 'Foundation' }], expected, false), false);
});

test('dependency manifests aggregate and match the installed package.json', () => {
  require('../src/extensions/builtins');
  const { registry } = require('../src/extensions/registry');
  const { manifestProblem } = require('../src/extensions/dependencies');
  const pkg = require('../package.json');
  assert.equal(manifestProblem({ webPackages: [] }), null);
  assert.ok(manifestProblem({ webPackages: [{ name: 'x' }] }));
  assert.ok(manifestProblem(null));
  for (const extension of registry.list()) {
    assert.equal(manifestProblem(extension.dependencies), null, `${extension.id} manifest`);
    for (const dep of extension.dependencies.webPackages) {
      const installed = pkg.dependencies[dep.name] ?? pkg.devDependencies[dep.name];
      assert.ok(installed, `${extension.id} declares uninstalled package ${dep.name}`);
      assert.equal(dep.version, installed, `${extension.id} version drift for ${dep.name}`);
      assert.ok(dep.purpose.length > 10, `${dep.name} needs a real purpose`);
    }
  }
  const packages = registry.webPackages();
  const mermaid = packages.find(entry => entry.name === 'mermaid');
  assert.deepEqual(mermaid.usedBy, ['ext-mermaid']);
  assert.equal(mermaid.lazyLoad, true);
  const cmView = packages.find(entry => entry.name === '@codemirror/view');
  assert.deepEqual(cmView.usedBy.sort(), ['ext-code-lab', 'ext-sql-lab']);
  assert.deepEqual(registry.tauriDependencies(), []);
});

test('capability bridge falls back gracefully outside Tauri and stores audit results', async () => {
  const { isTauri, checkTauriCapability, auditCapabilities } = require('../src/extensions/capability');
  const { ExtensionRegistry } = require('../src/extensions/registry');
  assert.equal(isTauri(), false);
  const dependency = { type: 'ipc-command', name: 'workbench_git', fallbackBehavior: 'disable-on-web', purpose: 'Run git inside a sandboxed workspace.' };
  const status = await checkTauriCapability(dependency);
  assert.equal(status.available, false);
  assert.match(status.detail, /Tauri desktop shell/);
  const registry = new ExtensionRegistry({ storage: null });
  registry.register(fakeExtension({
    id: 'ext-native',
    dependencies: { webPackages: [], tauriDependencies: [dependency] },
  }));
  assert.equal(registry.capabilityFor(dependency), null);
  const audit = await auditCapabilities(registry);
  assert.equal(audit.size, 1);
  assert.equal(registry.capabilityFor(dependency).available, false);
  registry.setCapabilityStatus('ipc-command:workbench_git', { name: 'workbench_git', kind: 'ipc-command', available: true, detail: 'ok' });
  assert.equal(registry.capabilityFor(dependency).available, true);
});

test('runtime tracker caches loaders and reports cold/loading/warm/error', async () => {
  const { trackRuntime, runtimeStatus, setRuntimeStatus, subscribeRuntime, allRuntimes } = require('../src/extensions/runtime');
  assert.equal(runtimeStatus('test-engine').state, 'cold');
  const seen = [];
  const unsubscribe = subscribeRuntime(status => seen.push(status.state));
  let loads = 0;
  const loader = async () => { loads += 1; return { ok: true }; };
  const first = await trackRuntime('test-engine', loader);
  const second = await trackRuntime('test-engine', loader);
  assert.equal(first, second);
  assert.equal(loads, 1);
  assert.equal(runtimeStatus('test-engine').state, 'warm');
  assert.deepEqual(seen, ['loading', 'warm']);
  await assert.rejects(trackRuntime('test-failing', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(runtimeStatus('test-failing').state, 'error');
  assert.match(runtimeStatus('test-failing').detail, /boom/);
  const retry = await trackRuntime('test-failing', async () => 'recovered');
  assert.equal(retry, 'recovered');
  assert.equal(runtimeStatus('test-failing').state, 'warm');
  setRuntimeStatus('test-engine', 'cold', 'reset');
  assert.ok(allRuntimes().some(status => status.name === 'test-engine'));
  unsubscribe();
});

test('interactive-graph schema enforces graph and exercise invariants', () => {
  const { interactiveGraphExtension } = require('../src/extensions/interactive-graph');
  const base = {
    id: 'g', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
    edges: [{ from: 'a', to: 'b' }],
  };
  assert.equal(interactiveGraphExtension.validate(base).ok, true);
  assert.equal(interactiveGraphExtension.validate({ ...base, edges: [{ from: 'a', to: 'ghost' }] }).ok, false);
  assert.equal(interactiveGraphExtension.validate({ ...base, mode: 'exercise' }).ok, false);
  const wire = { ...base, mode: 'exercise', exercise: { type: 'wire-edges', hiddenEdges: [{ from: 'a', to: 'b' }] } };
  assert.equal(interactiveGraphExtension.validate(wire).ok, true);
  const badWire = { ...base, mode: 'exercise', exercise: { type: 'wire-edges', hiddenEdges: [{ from: 'b', to: 'a' }] } };
  assert.equal(interactiveGraphExtension.validate(badWire).ok, false);
  const classify = { ...base, mode: 'exercise', exercise: { type: 'classify-nodes' } };
  assert.equal(interactiveGraphExtension.validate(classify).ok, false);
  const classifyOk = {
    ...base, mode: 'exercise',
    nodes: [{ id: 'a', label: 'A', kind: 'definition' }, { id: 'b', label: 'B', kind: 'theorem' }],
    exercise: { type: 'classify-nodes', extraKinds: ['lemma'] },
  };
  assert.equal(interactiveGraphExtension.validate(classifyOk).ok, true);
});

test('desmos-lab schema enforces challenge and draggable invariants', () => {
  const { desmosLabExtension } = require('../src/extensions/desmos-lab');
  const base = {
    id: 'd', curves: [{ kind: 'function', expr: 'm*x + b' }],
    params: [{ name: 'm', min: -4, max: 4 }, { name: 'b', min: -4, max: 6 }],
  };
  assert.equal(desmosLabExtension.validate(base).ok, true);
  assert.equal(desmosLabExtension.validate({ ...base, mode: 'challenge' }).ok, false);
  const challenge = { ...base, mode: 'challenge', targets: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
  assert.equal(desmosLabExtension.validate(challenge).ok, true);
  assert.equal(desmosLabExtension.validate({ ...base, draggables: [{ paramX: 'ghost' }] }).ok, false);
  assert.equal(desmosLabExtension.validate({ ...base, draggables: [{ paramY: 'b', x: 0 }] }).ok, true);
  assert.equal(desmosLabExtension.validate({ ...base, curves: [{ kind: 'parametric', xExpr: 'cos(t)' }] }).ok, false);
  const parametric = { ...base, curves: [{ kind: 'parametric', xExpr: 'cos(t)', yExpr: 'sin(t)' }] };
  assert.equal(desmosLabExtension.validate(parametric).ok, true);
  assert.equal(desmosLabExtension.validate({ ...parametric, mode: 'challenge', targets: [{ x: 1, y: 2 }], challengeCurve: 0 }).ok, false);
});

test('polyglot-studio schema enforces test and language invariants', () => {
  const { polyglotStudioExtension } = require('../src/extensions/polyglot-studio');
  const base = {
    id: 'p', language: 'python', starter: 'def f(x):\n    pass\n',
    tests: [{ name: 't', fn: 'f', args: [1], expected: 2 }],
  };
  assert.equal(polyglotStudioExtension.validate(base).ok, true);
  assert.equal(polyglotStudioExtension.validate({ ...base, language: 'ruby' }).ok, false);
  assert.equal(polyglotStudioExtension.validate({ ...base, tests: [] }).ok, false);
  assert.equal(polyglotStudioExtension.validate({ ...base, tests: [{ name: 't', fn: 'not an identifier', expected: 1 }] }).ok, false);
  assert.equal(polyglotStudioExtension.validate({ ...base, language: 'javascript', starter: 'function f(x){return x+1;}' }).ok, true);
});

test('duckdb-lab grader handles multiset, ordered, and tolerance comparisons', () => {
  const { gradeRows, sqlDuckdbLabExtension } = require('../src/extensions/sql-duckdb-lab');
  assert.equal(gradeRows([['EU', 160], ['US', 205]], [['US', 205], ['EU', 160]]).match, true);
  assert.equal(gradeRows([['EU', 160], ['US', 205]], [['US', 205], ['EU', 160]], { ordered: true }).match, false);
  assert.equal(gradeRows([['EU', 160.0004]], [['EU', 160]], { tolerance: 0.001 }).match, true);
  assert.equal(gradeRows([['EU', 161]], [['EU', 160]], { tolerance: 0.001 }).match, false);
  assert.equal(gradeRows([['EU', 160]], [['EU', 160], ['US', 205]]).match, false);
  assert.equal(gradeRows([[1n, null]], [[1, null]]).match, true);
  assert.equal(gradeRows([['a', 'b']], [['a', 'b'], ['a', 'b']]).match, false);
  const base = {
    id: 's', tables: [{ name: 't', columns: [{ name: 'a', type: 'INTEGER' }], rows: [[1], [2]] }],
  };
  assert.equal(sqlDuckdbLabExtension.validate(base).ok, true);
  assert.equal(sqlDuckdbLabExtension.validate({ ...base, mode: 'challenge' }).ok, false);
  assert.equal(sqlDuckdbLabExtension.validate({ ...base, mode: 'challenge', expected: { rows: [[1], [2]] } }).ok, true);
  assert.equal(sqlDuckdbLabExtension.validate({ ...base, tables: [{ name: 't', columns: [{ name: 'a', type: 'INTEGER' }], rows: [[1, 2]] }] }).ok, false);
  assert.equal(sqlDuckdbLabExtension.validate({ ...base, mode: 'challenge', expected: { columns: ['a', 'b'], rows: [[1]] } }).ok, false);
});

test('spatial-lab schema enforces scene-kind and challenge invariants', () => {
  const { spatialLabExtension } = require('../src/extensions/spatial-lab');
  const vectors = { id: 's', kind: 'vectors', vectors: [{ to: [1, 0, 0] }, { to: [0, 1, 0] }] };
  assert.equal(spatialLabExtension.validate(vectors).ok, true);
  assert.equal(spatialLabExtension.validate({ id: 's', kind: 'vectors' }).ok, false);
  assert.equal(spatialLabExtension.validate({ id: 's', kind: 'surface' }).ok, false);
  assert.equal(spatialLabExtension.validate({ id: 's', kind: 'surface', surface: { expr: 'sin(x)*cos(y)' } }).ok, true);
  assert.equal(spatialLabExtension.validate({ id: 's', kind: 'solids', solids: [{ shape: 'box' }] }).ok, true);
  const transform = { ...vectors, transform: { matrix: [['a', '0', '0'], ['0', '1', '0'], ['0', '0', '1']] }, params: [{ name: 'a', min: -3, max: 3 }] };
  assert.equal(spatialLabExtension.validate(transform).ok, true);
  assert.equal(spatialLabExtension.validate({ ...transform, mode: 'challenge' }).ok, false);
  const challenge = { ...transform, mode: 'challenge', targets: [{ vector: 0, position: [2, 0, 0] }] };
  assert.equal(spatialLabExtension.validate(challenge).ok, true);
  assert.equal(spatialLabExtension.validate({ ...challenge, targets: [{ vector: 9, position: [2, 0, 0] }] }).ok, false);
  assert.equal(spatialLabExtension.validate({ ...vectors, params: [{ name: 'x', min: 0, max: 1 }] }).ok, false);
});

test('every built-in extension registers and its few-shot examples validate', () => {
  require('../src/extensions/builtins');
  const { registry } = require('../src/extensions/registry');
  const { parse } = require('yaml');
  assert.ok(registry.list().length >= 1);
  for (const extension of registry.list()) {
    assert.ok(extension.skill.instructions.length > 40, `${extension.id} needs real instructions`);
    for (const example of extension.skill.fewShotExamples) {
      const result = extension.validate(parse(example.yaml));
      assert.equal(result.ok, true, `${extension.id} example "${example.title}" must validate: ${!result.ok && result.issues.map(issue => issue.path + ': ' + issue.message).join('; ')}`);
    }
  }
});
