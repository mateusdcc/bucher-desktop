const MiniSearch = require('minisearch');
const { statusFor } = require('./progress');

const fold = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const clip = (text, length) => text.length <= length ? text : text.slice(0, length) + '…';

function bookRecords(model, progress, introduction = '') {
  const records = new Map();
  const put = (ref, entry) => records.set(ref, { id: ref, ...entry });
  if (introduction.trim()) put(model.book.index.path, {
    path: model.book.index.path, title: model.book.title, kind: 'index', text: introduction, read: false,
  });
  for (const chapter of model.chapters) {
    const { path, name, category } = chapter;
    const read = Boolean(statusFor(model, progress, chapter));
    const blocks = chapter.units.filter(unit => unit.type !== 'solution' && !unit.inSolution && unit.callout !== 'hint');
    const visible = new Set(blocks);
    const base = { path, category, read, chapter: name };
    put(path, { ...base, title: name, kind: 'chapter', text: [chapter.description, ...blocks.map(unit => unit.markdown)].filter(Boolean).join('\n\n') });
    let heading;
    for (const block of blocks) {
      if (block.type === 'heading' && !block.node) {
        heading = { title: block.title, blocks: [] };
      } else if (heading && !block.node) {
        heading.blocks.push(block.markdown);
      } else {
        heading = null;
      }
      if (!heading?.title) continue;
      put(path + '#' + heading.title, { ...base, title: heading.title, kind: 'section', text: heading.blocks.join('\n\n') });
    }
    for (const node of chapter.nodes) {
      if (!visible.has(node.unit)) continue;
      const ref = path + '#' + (node.id.startsWith('^') ? node.id : node.title);
      put(ref, { ...base, title: node.title, kind: node.type, text: [node.unit.markdown, ...(node.prompt ?? [])].join('\n\n') });
    }
  }
  return records;
}

function searchRecords(records, query) {
  const index = new MiniSearch({
    fields: ['title', 'chapter', 'category', 'text'],
    processTerm: term => fold(term),
  });
  index.addAll([...records.values()]);
  return index.search(query ?? '', {
    boost: { title: 4, chapter: 2, category: 1.5 },
    prefix: term => term.length >= 4,
    fuzzy: term => term.length >= 6 ? 0.15 : false,
  });
}

module.exports = { bookRecords, searchRecords };
