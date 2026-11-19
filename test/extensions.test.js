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
