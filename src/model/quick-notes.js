
const NOTES_FILE = '_notes.md';
const CARDS_FILE = '_cards.md';
const INITIAL_NOTES = '---\nbuches_notes: 1\n---\n\n# Quick Notes & Vocabulary Inbox\n';
const INITIAL_CARDS = '---\nbuches_cards: 1\ntags:\n  - flashcards\n---\n\n# Flashcards\n';
const NOTE_BLOCK_RE = /<!-- buches-note:start ([^>]+) -->\r?\n([\s\S]*?)\r?\n<!-- buches-note:end -->/g;

const KINDS = {
  vocab: { label: 'Vocabulary / Phrase', callout: 'vocab', defaultCard: true, defaultReversible: true },
  sentence: { label: 'Sentence mine', callout: 'phrase', defaultCard: true, defaultReversible: false },
  note: { label: 'Quick note', callout: 'note', defaultCard: false, defaultReversible: false },
  grammar: { label: 'Grammar snippet', callout: 'grammar', defaultCard: true, defaultReversible: false },
};

function parseAttrs(raw) {
  const attrs = {};
  for (const match of raw.matchAll(/(\w+)="([^"]*)"/g)) attrs[match[1]] = match[2];
  return attrs;
}

function escapeAttr(value) {
  return String(value ?? '').replace(/["\r\n<>]/g, ' ').trim();
}

function parseQuickNoteBody(attrs, body) {
  const lines = body.split(/\r?\n/);
  const head = lines[0] ?? '';
  const done = /^- \[[xX]\] /.test(head);
  const sublines = lines.slice(1).map(line => line.replace(/^\s*-\s+/, '').trim()).filter(Boolean);
  let term = '', meaning = '', cardLine = '', example = '', note = '', tags = [];
  for (const line of sublines) {
    if (line.startsWith('Example:')) example = line.slice('Example:'.length).trim();
    else if (line.startsWith('Note:')) note = line.slice('Note:'.length).trim();
    else if (!cardLine && (line.includes(':::') || line.includes('::'))) {
      cardLine = line;
      const sep = line.includes(':::') ? ':::' : '::';
      const idx = line.indexOf(sep);
      term = line.slice(0, idx).trim();
      meaning = line.slice(idx + sep.length).trim();
    } else if (!term && line.startsWith('**')) {
      const boldMatch = line.match(/^\*\*([^*]+)\*\*(?:\s*\*\(([^)]+)\)\*)?(?:\s*—\s*(.+))?$/);
      if (boldMatch) {
        term = boldMatch[1].trim();
        meaning = [boldMatch[3]?.trim(), boldMatch[2]?.trim() ? `*(${boldMatch[2].trim()})*` : ''].filter(Boolean).join(' ');
      } else if (!note) {
        note = line;
      }
    } else if (!note) {
      note = line;
    }
  }
  if (!term) {
    const fallback = head.replace(/^- \[[ xX]\] \*\*[^*]+\*\*\s*·?\s*/, '').replace(/\[\[[^\]]+\]\]/g, '').trim();
    term = fallback.replace(/#[\w/-]+/g, '').trim();
  }
  tags = [...new Set((body.match(/(?:^|\s)(#[a-zA-Z][\w/-]*)/g) ?? []).map(t => t.trim()))];
  return {
    id: attrs.id || `${attrs.created}:${term}`,
    kind: attrs.kind || 'note',
    created: attrs.created || '',
    chapterPath: attrs.chapter || '',
    chapterName: attrs.chapter ? attrs.chapter.split('/').pop().replace(/\.md$/i, '') : '',
    done,
    term,
    meaning,
    cardLine,
    example,
    note,
    tags,
    raw: body,
  };
}

/** Read all quick notes from `Buches/<Book>/_notes.md`. */
async function readQuickNotes(app, book) {
  if (!book?.path) return [];
  const file = app.vault.getAbstractFileByPath(`${book.path}/${NOTES_FILE}`);
  if (!file || Array.isArray(file.children)) return [];
  const text = await (app.vault.cachedRead ?? app.vault.read).call(app.vault, file);
  const entries = [];
  for (const match of text.matchAll(NOTE_BLOCK_RE)) {
    entries.push(parseQuickNoteBody(parseAttrs(match[1]), match[2]));
  }
  return entries.reverse();
}

async function ensureBookNoteFile(vault, path, initial) {
  let file = vault.getAbstractFileByPath(path);
  if (file) return file;
  try {
    return await vault.create(path, initial);
  } catch (error) {
    file = vault.getAbstractFileByPath(path);
    if (file) return file;
    throw error;
  }
}

function formatTagList(tagText, defaultKind) {
  const tokens = String(tagText ?? '')
    .split(/[,\s]+/)
    .map(t => t.trim().replace(/^#/, ''))
    .filter(Boolean);
  if (!tokens.length && defaultKind) tokens.push(defaultKind);
  return [...new Set(tokens)].map(t => `#${t}`).join(' ');
}

function buildFlashcardText({ term, meaning, reading, reversible }) {
  const front = term.trim();
  const extra = reading?.trim() ? ` *(${reading.trim()})*` : '';
  const back = `${meaning.trim()}${extra}`;
  return `${front} ${reversible ? ':::' : '::'} ${back}`;
}

function formatQuickNoteBlock(entry) {
  const id = entry.id || crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const kind = Object.hasOwn(KINDS, entry.kind) ? entry.kind : 'note';
  const created = entry.created || new Date().toISOString();
  const chapter = entry.chapterPath ? ` chapter="${escapeAttr(entry.chapterPath)}"` : '';
  const label = KINDS[kind].label.split(' / ')[0];
  const link = entry.chapterPath
    ? ` · [[${entry.chapterPath}|${entry.chapterName || entry.chapterPath.split('/').pop().replace(/\.md$/i, '')}]]`
    : '';
  const tags = formatTagList(entry.tags, kind);
  const lines = [
    `<!-- buches-note:start id="${escapeAttr(id)}" kind="${kind}" created="${escapeAttr(created)}"${chapter} -->`,
    `- [ ] **${label}**${link}${tags ? ` ${tags}` : ''}`,
  ];
  if (entry.makeCard && entry.term?.trim() && entry.meaning?.trim()) {
    lines.push(`  - ${buildFlashcardText(entry)}`);
  } else if (entry.term?.trim()) {
    const reading = entry.reading?.trim() ? ` *(${entry.reading.trim()})*` : '';
    const pair = entry.meaning?.trim() ? ` — ${entry.meaning.trim()}` : '';
    lines.push(`  - **${entry.term.trim()}**${reading}${pair}`);
  } else if (entry.meaning?.trim()) {
    lines.push(`  - ${entry.meaning.trim()}`);
  }
  if (entry.example?.trim()) lines.push(`  - Example: ${entry.example.trim()}`);
  if (entry.note?.trim()) lines.push(`  - Note: ${entry.note.trim()}`);
  lines.push('<!-- buches-note:end -->');
  return lines.join('\n');
}

/** Save a quick note or flashcard into `_notes.md`, `_cards.md`, or the source chapter. */
async function appendQuickNote(app, book, entry, destination = 'notes') {
  if (!book?.path) throw new Error('Select a Buch first.');
  const vault = app.vault;
  if (destination === 'cards') {
    if (!entry.term?.trim() || !entry.meaning?.trim()) {
      throw new Error('Enter both a front prompt and an answer to save a flashcard.');
    }
    const cardsFile = await ensureBookNoteFile(vault, `${book.path}/${CARDS_FILE}`, INITIAL_CARDS);
    const lines = [buildFlashcardText(entry)];
    if (entry.example?.trim()) lines.push(`Example: ${entry.example.trim()}`);
    if (entry.note?.trim()) lines.push(`> Note: ${entry.note.trim()}`);
    const ref = entry.chapterPath ? ` *(from [[${entry.chapterPath}|${entry.chapterName || 'chapter'}]])*` : '';
    const tags = formatTagList(entry.tags, entry.kind);
    const block = `${lines[0]}${ref}${tags ? ` ${tags}` : ''}` + (lines.length > 1 ? '\n' + lines.slice(1).join('\n') : '');
    await vault.process(cardsFile, text => text.trimEnd() + '\n\n' + block + '\n');
    return cardsFile;
  }

  if (destination === 'chapter' && entry.chapterFile) {
    const kindInfo = KINDS[entry.kind] ?? KINDS.note;
    const title = entry.term?.trim() || kindInfo.label;
    const lines = [`> [!${kindInfo.callout}] ${title}`];
    if (entry.makeCard && entry.term?.trim() && entry.meaning?.trim()) {
      lines.push(`> ${buildFlashcardText(entry)}`);
    } else if (entry.meaning?.trim()) {
      lines.push(`> ${entry.meaning.trim()}`);
    }
    if (entry.example?.trim()) lines.push(`> Example: ${entry.example.trim()}`);
    if (entry.note?.trim()) lines.push(`> ${entry.note.trim()}`);
    await vault.process(entry.chapterFile, text => text.trimEnd() + '\n\n' + lines.join('\n') + '\n');
    return entry.chapterFile;
  }

  const notesFile = await ensureBookNoteFile(vault, `${book.path}/${NOTES_FILE}`, INITIAL_NOTES);
  const block = formatQuickNoteBlock(entry);
  await vault.process(notesFile, text => text.trimEnd() + '\n\n' + block + '\n');
  return notesFile;
}

async function mutateQuickNoteBlock(app, book, id, transform) {
  const file = app.vault.getAbstractFileByPath(`${book.path}/${NOTES_FILE}`);
  if (!file) return false;
  let changed = false;
  await app.vault.process(file, text => text.replace(NOTE_BLOCK_RE, (full, rawAttrs, body) => {
    const attrs = parseAttrs(rawAttrs);
    if (attrs.id !== id) return full;
    changed = true;
    const nextBody = transform(body, attrs);
    if (nextBody === null) return '';
    return `<!-- buches-note:start ${rawAttrs} -->\n${nextBody}\n<!-- buches-note:end -->`;
  }).replace(/\n{3,}/g, '\n\n'));
  return changed;
}

function toggleQuickNoteDone(app, book, id) {
  return mutateQuickNoteBlock(app, book, id, body => body.replace(/^- \[([ xX])\] /, (_, mark) =>
    mark === ' ' ? '- [x] ' : '- [ ] '));
}

module.exports = { readQuickNotes, appendQuickNote, toggleQuickNoteDone };
