import cardModel from './model/flashcards';
import languageModel from './model/language';
import noteModel from './model/quick-notes';
import { button, el, formDialog, icon } from './ui';

const { checkTypedAnswer, collectBookCards, isDue, previewIntervals, reviewCard } = cardModel;
const { appendQuickNote, readQuickNotes, toggleQuickNoteDone } = noteModel;
const { bookLanguage, speakText } = languageModel;

export function capture(library, book, chapter, selected, changed) {
  formDialog('Quick capture', [
    { name: 'term', label: 'Note or flashcard prompt', value: selected.slice(0, 4000), multiline: true, required: true, maxLength: 4000 },
    { name: 'meaning', label: 'Answer', placeholder: 'Optional. Adds this to flashcards.', maxLength: 3000 },
  ], 'Save note', async ({ term, meaning }) => {
    if (!term.trim()) throw new Error('Enter a note or a flashcard prompt.');
    await appendQuickNote(library.app, book, {
      kind: meaning.trim() ? 'vocab' : 'note',
      chapterPath: chapter?.path,
      chapterName: chapter?.name,
      term: meaning.trim() ? term.trim().replace(/\s+/g, ' ') : '',
      meaning,
      note: meaning.trim() ? '' : term.trim().replace(/\s+/g, ' '),
      makeCard: Boolean(meaning.trim()),
    });
    await changed();
  });
}

export async function showNotes(host, context) {
  const { library, book, changed, markdown, openFile, editBookNote } = context;
  const notes = await readQuickNotes(library.app, book);
  const notesFile = library.file(book.path + '/_notes.md');
  const path = notesFile?.path ?? book.index.path;
  host.append(el('h1', 'page-title', 'Quick notes'),
    el('div', 'page-actions',
      button('Capture', 'plus', () => capture(library, book, null, '', changed)),
      button('Edit notes', 'pencil', () => editBookNote('_notes.md', 'Edit quick notes'))));
  if (!notes.length && !notesFile) host.append(el('p', 'muted', 'Capture a passage, a thought, or a flashcard as you read.'));
  if (notesFile) {
    const other = notesFile.source
      .replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '')
      .replace(/<!-- buches-note:start [^>]+ -->[\s\S]*?<!-- buches-note:end -->/g, '').trim();
    if (other && !/^# Quick Notes & Vocabulary Inbox$/i.test(other)) host.append(markdown(other, path));
  }
  for (const note of notes) {
    const title = note.term || note.note || 'Note';
    host.append(el('section', 'note-row',
      button(note.done ? 'Completed' : 'Mark complete', note.done ? 'check' : 'circle', async () => {
        await toggleQuickNoteDone(library.app, book, note.id);
        await changed();
      }, note.done ? 'accent note-status' : 'note-status'),
      el('div', '', markdown(title, path),
        note.meaning ? markdown(note.meaning, path) : null,
        note.example ? markdown(note.example, path) : null,
        note.note && note.note !== title ? markdown(note.note, path) : null,
        note.chapterPath && library.file(note.chapterPath)
          ? button(note.chapterName, 'arrow-up-right', () => openFile(note.chapterPath), 'quiet-link') : null)));
  }
}

export async function showCards(host, context) {
  const { library, book, progress, markdown, openFile, editBookNote, changed } = context;
  const [cards, records] = await Promise.all([collectBookCards(library.app, book), progress.readCards(book)]);
  const due = cards.filter(card => isDue(records[card.id]));
  host.append(el('h1', 'page-title', 'Flashcards'),
    el('div', 'page-actions', button('Edit deck', 'pencil', () => editBookNote('_cards.md', 'Edit flashcards'))),
    el('p', 'muted', `${due.length} due · ${cards.length} total`));
  const card = due[0];
  if (!card) {
    host.append(el('p', 'muted', cards.length ? 'All caught up for now.' : 'Add cards to a chapter, the deck, or Quick notes.'));
    return;
  }
  const audio = card.audio && library.resolve(card.audio, card.filePath);
  const lang = bookLanguage(library.app, book);
  const prompt = el('section', 'flashcard', markdown(card.front, card.filePath));
  if (card.hint) prompt.append(el('p', 'muted', card.hint));
  if (audio?.source === null) {
    const media = el('audio');
    media.controls = true;
    media.src = context.asset(audio.path);
    prompt.append(media);
  } else if (lang?.speechLang) {
    prompt.append(button('Pronounce', 'volume-2', () => speakText(card.speakSource, lang.speechLang)));
  }
  const answer = el('input', 'recall-input');
  answer.placeholder = 'Type an answer (optional)';
  answer.setAttribute('aria-label', 'Your answer');
  const reveal = button('Show answer', 'eye', () => {
    if (answer.value.trim()) {
      const result = checkTypedAnswer(answer.value, card.clozeAnswer || card.back);
      prompt.append(el('p', result === 'exact' ? 'accent' : 'muted',
        { exact: 'Matched', close: 'Close · check accents', mismatch: 'Compare with the answer below' }[result]));
    }
    reveal.remove();
    answer.readOnly = true;
    prompt.append(markdown(card.back, card.filePath));
    if (card.example) prompt.append(markdown(card.example, card.filePath));
    const intervals = previewIntervals(records[card.id]);
    const choices = el('div', 'ratings', intervals.map(({ rating, label, labelText }) =>
      button(`${label} · ${labelText}`, '', async () => {
        choices.querySelectorAll('button').forEach(control => { control.disabled = true; });
        try {
          await progress.reviewCard(book, card.id, reviewCard(records[card.id], rating));
          await changed();
        } catch (error) {
          choices.querySelectorAll('button').forEach(control => { control.disabled = false; });
          throw error;
        }
      })));
    prompt.append(choices);
    choices.querySelector('button').focus();
  }, 'accent-button');
  answer.addEventListener('keydown', event => { if (event.key === 'Enter') reveal.click(); });
  prompt.append(answer, reveal);
  host.append(prompt, el('div', 'card-source', icon('file-text'),
    button(card.chapterName, '', () => card.filePath.includes('/concepts/') ? openFile(card.filePath) : editBookNote(card.file.name, 'Edit card source'))));
}
