const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { createLibrary } = require('../src/model/library');
const { listBuches } = require('../src/model/catalog');
const { LearningIndex } = require('../src/model/learning');
const { BookProgress, countsFor } = require('../src/model/progress');
const { appendSolutionTab, materializeSolution, resolveEmbed, solutionTabs } = require('../src/model/solution-notes');
const { appendQuickNote } = require('../src/model/quick-notes');
const { collectBookCards, reviewCard } = require('../src/model/flashcards');

const demo = 'demo/Buches';
const root = 'Buches/Proofs in Linear Algebra';

test('opens a legacy book, keeps its anchors and persists study changes in Markdown', async () => {
  const disk = new Map(readdirSync(demo, { recursive: true })
    .filter(path => path.endsWith('.md'))
    .map(path => ['Buches/' + path, readFileSync(demo + '/' + path, 'utf8')]));
  disk.set(root + '/_progress.md', '---\nbuches_progress: 1\nchapters:\n  concepts/Vector spaces.md:\n    mastered: true\n---\n');
  const library = createLibrary(async (path, text, expected) => {
    assert.equal(disk.get(path) ?? null, expected);
    disk.set(path, text);
  }, async (path, expected) => {
    assert.equal(disk.get(path), expected);
    disk.delete(path);
  });
  function reload() {
    library.load({ basePath: '/app-data', entries: [...disk].map(([path, source]) => ({ path, source })) });
    // Select the legacy book by title: seeded showcase books sort before it.
    return listBuches(library.app).find(book => book.title === 'Proofs in Linear Algebra');
  }
  const book = reload();
  const learning = new LearningIndex(library.app);
  const progress = new BookProgress(library.app, {});
  const plugin = { app: library.app, learning, solutionWrites: new Map() };
  const model = await learning.book(book);
  assert.deepEqual(model.chapters.map(chapter => chapter.name), ['Vector spaces', 'Subspaces', 'Direct sums', 'Linear maps', 'Quotients']);
  assert.equal(model.issues.length, 0);
  assert.equal(countsFor(model, await progress.read(model)).read, 1);
  const chapter = model.chapters[1];
  const exercise = chapter.nodes.find(node => node.type === 'exercise');
  assert.equal(exercise.id, '^kernel-like-set');
  assert.equal(exercise.solution.hints.length, 2);
  assert.equal(model.targets.get(chapter.path + '#' + exercise.id).dependencies[0].id, '^subspace-test');

  await Promise.all([
    progress.setRead(model, [chapter.path], true),
    progress.set(model, { ...exercise, path: chapter.path }, true),
  ]);
  const note = await materializeSolution(plugin, chapter.file, book, exercise.solution, 'mathjax');
  assert.match(disk.get(note.path), /zero vector/);
  const updated = (await learning.page(chapter.file)).nodes.find(node => node.id === exercise.id);
  assert.equal(resolveEmbed(library.app, chapter.file, updated.solution), note);
  const attempt = await appendSolutionTab(plugin, chapter.file, book, updated.solution, 'manual', 'mathjax');
  assert.equal(solutionTabs((await learning.page(chapter.file)).nodes.find(node => node.id === exercise.id).solution)[0].path, attempt.path);

  await appendQuickNote(library.app, book, { kind: 'vocab', term: 'Kernel', meaning: 'Null space', makeCard: true });
  const [card] = await collectBookCards(library.app, book);
  await progress.reviewCard(book, card.id, reviewCard(undefined, 3, 10));
  const restoredBook = reload();
  const restored = await learning.book(restoredBook);
  assert.deepEqual(countsFor(restored, await progress.read(restored)), { chapters: 5, read: 2, exercises: 5, solved: 1 });
  assert.equal((await progress.readCards(restoredBook))[card.id].reps, 1);
});
