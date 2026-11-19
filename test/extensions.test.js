const { test } = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const { ExtensionRegistry } = require('../src/extensions/registry');
const { createValidator, jsonSchemaFor, blockMeta } = require('../src/extensions/validate');
const { blockKey, isExtensionInfo, payloadId, payloadTitle } = require('../src/extensions/keys');
const { composeSkills, skillArgs } = require('../src/extensions/skills');

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
