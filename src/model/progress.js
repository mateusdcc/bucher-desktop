const { parseYaml, stringifyYaml } = require('./yaml');

const PROGRESS_NAME = '_progress.md';
const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?=\r?\n|$)/;
const initialNote = '---\nbuches_progress: 1\nchapters: {}\ncards: {}\n---\n\n# Reading progress\n';
const relative = (book, path) => path.slice(book.path.length + 1);

function readProgress(text) {
  const match = text.match(FRONTMATTER);
  const yaml = match && parseYaml(match[1]);
  if (yaml?.buches_progress !== 1 || !yaml.chapters || typeof yaml.chapters !== 'object' || Array.isArray(yaml.chapters)) {
    throw new Error('The book progress note has invalid frontmatter.');
  }
  yaml.cards = (yaml.cards && typeof yaml.cards === 'object' && !Array.isArray(yaml.cards)) ? yaml.cards : {};
  return { match, yaml };
}

function updateProgress(text, update) {
  const { match, yaml } = readProgress(text);
  update(yaml);
  return `---\n${stringifyYaml(yaml).trimEnd()}\n---${text.slice(match[0].length)}`;
}

function statusFor(model, chapters, target) {
  const row = chapters[relative(model.book, target.path)];
  if (target.type !== 'exercise') return (row?.read ?? row?.mastered) === true;
  return Array.isArray(row?.solved) && row.solved.includes(target.id);
}

function countsFor(model, chapters, selected = model.chapters) {
  const counts = { chapters: selected.length, read: 0, exercises: 0, solved: 0 };
  for (const chapter of selected) {
    if (statusFor(model, chapters, chapter)) counts.read++;
    for (const node of chapter.nodes) {
      if (node.type !== 'exercise') continue;
      counts.exercises++;
      if (statusFor(model, chapters, { ...node, path: chapter.path })) counts.solved++;
    }
  }
  return counts;
}

class BookProgress {
  constructor(app, legacy) { this.app = app; this.legacy = legacy; this.pending = new Map(); }

  queue(path, operation) {
    const result = (this.pending.get(path) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.pending.set(path, result);
    const clean = () => { if (this.pending.get(path) === result) this.pending.delete(path); };
    result.then(clean, clean);
    return result;
  }

  async read(model) {
    const path = `${model.book.path}/${PROGRESS_NAME}`;
    await this.pending.get(path)?.catch(() => {});
    const vault = this.app.vault;
    const file = vault.getAbstractFileByPath(path);
    const state = file ? readProgress(await vault.cachedRead(file)).yaml : { chapters: {} };
    if (state.legacy_imported) return state.chapters;
    if (!model.chapters.some(chapter => this.legacy[chapter.path]?.length)) return state.chapters;
    const migrated = await this.write(model.book, yaml => this.importLegacy(model, yaml));
    return migrated.chapters;
  }

  importLegacy(model, yaml) {
    if (yaml.legacy_imported) return;
    for (const chapter of model.chapters) {
      const key = relative(model.book, chapter.path);
      const existing = yaml.chapters[key];
      if (existing && Object.hasOwn(existing, 'solved')) continue;
      const old = this.legacy[chapter.path];
      if (!Array.isArray(old)) continue;
      const solved = chapter.nodes.filter(node => node.legacyId && old.includes(node.legacyId)).map(node => node.id);
      if (solved.length) yaml.chapters[key] = { ...existing, solved };
    }
    yaml.legacy_imported = true;
  }

  write(book, update) {
    const path = `${book.path}/${PROGRESS_NAME}`;
    return this.queue(path, async () => {
      const vault = this.app.vault;
      let file = vault.getAbstractFileByPath(path);
      if (!file) {
        try { file = await vault.create(path, initialNote); }
        catch (error) {
          file = vault.getAbstractFileByPath(path);
          if (!file) throw error;
        }
      }
      let state;
      await vault.process(file, text => updateProgress(text, yaml => {
        update(yaml);
        state = yaml;
      }));
      return state;
    });
  }

  setRead(model, paths, read) {
    return this.write(model.book, yaml => {
      this.importLegacy(model, yaml);
      for (const path of paths) {
        const key = relative(model.book, path);
        const row = yaml.chapters[key] ??= {};
        row.read = read;
      }
    });
  }

  set(model, target, done) {
    if (target.type !== 'exercise') return this.setRead(model, [target.path], done);
    return this.write(model.book, yaml => {
      this.importLegacy(model, yaml);
      const key = relative(model.book, target.path);
      const row = yaml.chapters[key] ??= {};
      const entries = new Set(Array.isArray(row.solved) ? row.solved : []);
      if (done) entries.add(target.id);
      else entries.delete(target.id);
      row.solved = [...entries];
    });
  }

  async readCards(book) {
    const path = `${book.path}/${PROGRESS_NAME}`;
    await this.pending.get(path)?.catch(() => {});
    const file = this.app.vault.getAbstractFileByPath(path);
    return file ? readProgress(await this.app.vault.cachedRead(file)).yaml.cards : {};
  }

  reviewCard(book, cardId, state) {
    return this.write(book, yaml => {
      yaml.cards ??= {};
      yaml.cards[cardId] = state;
    });
  }

}

module.exports = { BookProgress, countsFor, statusFor };
