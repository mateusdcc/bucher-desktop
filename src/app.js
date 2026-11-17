import '@fontsource-variable/inter';
import '@fontsource/spectral/latin-400.css';
import '@fontsource/spectral/latin-600.css';
import 'katex/dist/katex.css';
import './styles.css';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import libraryModel from './model/library';
import catalog from './model/catalog';
import learningModel from './model/learning';
import progressModel from './model/progress';
import bookModel from './model/buch-model';
import storage from './model/storage';
import intro from './model/intro-model';
import memory from './model/book-memory';
import { headingId, renderMarkdown } from './markdown';
import { showChapter, showExercises, showOutline, showOverview, statusIndicator } from './reader';
import { capture, showCards, showNotes } from './study';
import { button, dialog, editor, el, formDialog, icon, iconButton, notice, report } from './ui';

const { listBuches } = catalog;
const { flattenConcepts } = bookModel;
const { BookProgress, statusFor } = progressModel;
const { stripFrontmatter } = intro;
const library = libraryModel.createLibrary(
  (path, text, expected) => invoke('save_markdown', { path, text, expected }),
  (path, expected) => invoke('discard_solution', { path, expected }),
);
const learning = new learningModel.LearningIndex(library.app);
const progress = new BookProgress(library.app, {});
const plugin = { app: library.app, learning, solutionWrites: new Map() };
const states = new Map();
const expanded = new Set();
const collapsed = new Set();
const root = document.querySelector('#app');
const shortcut = /Mac/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K';
const nav = el('nav', 'tree');
nav.setAttribute('aria-label', 'Book navigation');
const toolbar = el('header', 'toolbar');
const article = el('article', 'article');
const outline = el('aside', 'outline');
const scroll = el('main', 'reading-scroll', el('div', 'reading-layout', article, outline));
scroll.id = 'reading-scroll';
const shell = el('div', 'shell');
let data = new Map();
let route = { path: '', mode: 'read', scope: '' };
let searchPanel;
let renderId = 0;
let quiz = false;

const asset = path => convertFileSrc(library.basePath + '/' + path);
function markdown(source, path) {
  const body = el('div', 'markdown');
  body.innerHTML = renderMarkdown(source, { library, path, asset, quiz });
  return body;
}

function saveLocation() {
  localStorage.setItem('bucher/location', route.path);
}

function findBook(path) {
  return data.get(path.split('/').slice(0, 2).join('/'));
}

function showSelection(path) {
  for (const [key, { book }] of data) {
    if (!path.startsWith(key + '/')) continue;
    collapsed.delete(book.index.path);
    for (const concept of flattenConcepts(book.concepts)) {
      const parent = concept.file.path;
      if (path.startsWith(parent.slice(0, -3) + '/')) expanded.add(parent);
    }
  }
}

function jump(fragment) {
  if (!fragment) return;
  const target = document.getElementById(fragment) ?? document.getElementById(headingId(fragment));
  if (target && article.contains(target)) target.scrollIntoView({ block: 'start' });
}

async function openFile(path, fragment = '') {
  const entry = findBook(path);
  if (!entry) return;
  if (!entry.model.byPath.has(path) && path !== entry.book.index.path) {
    const file = library.file(path);
    if (file?.extension === 'md') {
      dialog(file.frontmatter.name || file.name.replace(/\.md$/i, ''), panel => panel.append(markdown(stripFrontmatter(file.source), path)));
    }
    return;
  }
  route = { path, mode: 'read', scope: '' };
  shell.classList.remove('nav-open');
  quiz = false;
  showSelection(path);
  saveLocation();
  await render();
  jump(fragment);
}

function openMode(mode, scope = '') {
  route = { ...route, mode: route.mode === mode && scope === route.scope ? 'read' : mode, scope };
  shell.classList.remove('nav-open');
  return render();
}

function editFile(file, title) {
  const original = file.source;
  editor(title, original, async text => {
    if (text === original) return;
    await library.app.vault.process(file, existing => {
      if (existing !== original) throw new Error('The file was updated. Reopen the editor.');
      return text;
    });
    await refresh();
  });
}

function editBookNote(book, name, title) {
  const path = book.path + '/' + name;
  const file = library.file(path);
  if (file) return editFile(file, title);
  const initial = name === '_cards.md' ? '# Flashcards\n\n' : '# Quick Notes & Vocabulary Inbox\n\n';
  editor(title, initial, async text => {
    await library.app.vault.create(path, text);
    await refresh();
  });
}

function addBook() {
  formDialog('New book', [{ name: 'name', label: 'Book title', required: true }], 'Create book', async ({ name }) => {
    const note = await storage.createBuch(library.app.vault, name.trim());
    await refresh(false);
    await openFile(note.path);
    editFile(note, 'Edit book introduction');
  });
}

function addChapter(book, parent) {
  formDialog(parent ? 'New subchapter' : 'New chapter', [{ name: 'name', label: 'Chapter title', required: true }], 'Create chapter', async ({ name }) => {
    const { vault, metadataCache } = library.app;
    const note = parent
      ? await storage.createSubconcept(vault, parent.file.path, name.trim(), metadataCache)
      : await storage.createConcept(vault, book.path, name.trim(), metadataCache);
    await refresh(false);
    await openFile(note.path);
    editFile(note, 'Edit chapter');
  });
}

async function load() {
  library.load(await invoke('load_library'));
  await refresh(false);
  const last = localStorage.getItem('bucher/location') || '';
  const previous = findBook(last);
  const first = data.values().next().value;
  const path = previous?.model.byPath.has(last) || previous?.book.index.path === last ? last : first?.book.index.path;
  if (path) await openFile(path);
  else await render();
}

async function importBooks() {
  const result = await invoke('import_books');
  if (!result) return;
  const last = route.path;
  library.load(await invoke('load_library'));
  await refresh(false);
  const imported = data.get('Buches/' + (result.imported?.[0] || ''));
  if (imported) await openFile(imported.book.index.path);
  else if (last) await openFile(last);
  const importedText = result.imported.length ? `Imported ${result.imported.length} ${result.imported.length === 1 ? 'book' : 'books'}.` : '';
  const skipped = result.skipped.length ? `${result.skipped.length} already in your library.` : '';
  notice([importedText, skipped].filter(Boolean).join(' '));
}

async function refresh(redraw = true) {
  const entries = await Promise.all(listBuches(library.app).map(async book => {
    const model = await learning.book(book);
    let records = {};
    try {
      records = await progress.read(model);
    } catch (error) {
      report(error);
    }
    return [book.path, { book, model, records }];
  }));
  data = new Map(entries);
  if (redraw) await render(true);
}

function renderNav() {
  const scrollTop = nav.scrollTop;
  nav.replaceChildren();
  function row({ path, name, glyph, depth, children, toggle, open, status, add, sheet }) {
    const line = el('div', 'tree-row');
    line.style.setProperty('--depth', depth);
    const current = route.path === path;
    line.classList.toggle('active', current);
    let chevron;
    if (children) {
      chevron = iconButton(`${open ? 'Collapse' : 'Expand'} ${name}`, open ? 'chevron-down' : 'chevron-right', () => {
        toggle();
        renderNav();
        const replacement = [...nav.querySelectorAll('.tree-row')].find(item => item.dataset.path === path);
        replacement?.querySelector('.tree-chevron')?.focus({ preventScroll: true });
      });
      chevron.classList.add('tree-chevron');
      chevron.setAttribute('aria-expanded', String(open));
    }
    const link = button('', null, () => openFile(path), 'tree-link');
    link.append(icon(glyph, true), el('span', 'tree-name', name));
    link.title = name;
    if (current) link.setAttribute('aria-current', 'page');
    const options = el('div', 'tree-options', status, sheet ? iconButton(`Exercises for ${name}`, 'clipboard-list', sheet) : null,
      iconButton(depth ? `Add subchapter to ${name}` : `Add chapter to ${name}`, 'plus', add));
    line.dataset.path = path;
    line.append(chevron ?? el('span', 'tree-indent'), link, options);
    nav.append(line);
  }
  for (const { book, model, records } of data.values()) {
    function completed(concepts) {
      const chapters = flattenConcepts(concepts);
      const read = chapters.filter(concept => statusFor(model, records, { path: concept.file.path })).length;
      return statusIndicator(read, chapters.length);
    }
    function scopedExercises(concept) {
      return async () => {
        if (route.path !== concept.file.path) await openFile(concept.file.path);
        await openMode('exercises', concept.file.path);
      };
    }
    function branch(concepts, depth) {
      for (const concept of concepts) {
        const path = concept.file.path;
        const open = expanded.has(path);
        row({ path, name: concept.name, glyph: concept.icon || 'file-text', depth,
          children: concept.children.length, open,
          toggle: () => open ? expanded.delete(path) : expanded.add(path),
          status: completed([concept]), add: () => addChapter(book, concept), sheet: scopedExercises(concept) });
        if (open) branch(concept.children, depth + 1);
      }
    }
    const open = !collapsed.has(book.index.path);
    row({ path: book.index.path, name: book.title, glyph: book.icon || 'book-open', depth: 0,
      children: book.concepts.length, open, toggle: () => open ? collapsed.add(book.index.path) : collapsed.delete(book.index.path),
      status: completed(book.concepts), add: () => addChapter(book) });
    if (open) branch(book.concepts, 1);
  }
  nav.scrollTop = scrollTop;
}

function searchLibrary() {
  if (searchPanel?.open) return;
  const records = new Map();
  for (const { model, book, records: progress } of data.values()) {
    const entries = memory.bookRecords(model, progress, stripFrontmatter(book.index.source) || book.title);
    for (const [key, record] of entries) records.set(key, { ...record, book: book.title });
  }
  searchPanel = dialog('Search library', panel => {
    const search = el('input', 'search-input');
    search.type = 'search';
    search.placeholder = 'Search books, chapters, and exercises';
    search.setAttribute('aria-label', 'Search books, chapters, and exercises');
    search.autofocus = true;
    const list = el('div', 'search-results');
    function showResults() {
      const query = search.value.trim();
      const results = query ? memory.searchRecords(records, query).slice(0, 12).map(match => records.get(match.id))
        : [...records.values()].filter(record => record.kind === 'index');
      list.replaceChildren(...results.map(record => {
        const result = button('', null, () => {
          panel.close();
          const [path, fragment] = record.id.split(/#(.*)/s);
          return openFile(path, fragment || '');
        }, 'search-result');
        result.append(icon(record.kind === 'index' ? 'book-open' : 'file-text'), el('span', '',
          el('span', 'result-title', record.title),
          el('span', 'result-context', record.kind === 'index' ? 'Book' : [record.book, record.chapter].filter(Boolean).join(' / '))));
        return result;
      }));
      if (!results.length) list.append(el('p', 'muted', query ? 'No matching passages.' : 'Your library is empty.'));
    }
    search.addEventListener('input', showResults);
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') list.querySelector('button')?.click();
      if (event.key === 'ArrowDown') list.querySelector('button')?.focus();
    });
    list.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') document.activeElement.nextElementSibling?.focus();
      if (event.key === 'ArrowUp') (document.activeElement.previousElementSibling ?? search).focus();
    });
    panel.append(search, list);
    showResults();
  });
}

async function render(keepScroll = false) {
  const id = ++renderId;
  const scrollTop = keepScroll ? scroll.scrollTop : 0;
  renderNav();
  const entry = findBook(route.path);
  const sideToggle = iconButton('Toggle library', 'panel-left', () => shell.classList.toggle('nav-open'));
  sideToggle.classList.add('mobile-nav');
  if (!entry) {
    toolbar.replaceChildren(sideToggle);
    article.replaceChildren(el('h1', 'page-title', 'Your library'),
      el('div', 'page-actions', button('Import books', 'folder-open', importBooks, 'accent-button'), button('New book', 'plus', addBook)));
    outline.replaceChildren();
    return;
  }
  const { book, model } = entry;
  const chapter = model.byPath.get(route.path);
  const file = chapter?.file ?? book.index;
  const modeTitle = { exercises: 'Exercises', notes: 'Quick notes', cards: 'Flashcards' }[route.mode];
  const crumb = el('div', 'breadcrumb',
    sideToggle,
    button(book.title, 'book-open', () => openFile(book.index.path), 'crumb-book'),
    chapter || modeTitle ? icon('chevron-right') : null,
    chapter || modeTitle ? el('span', 'crumb-page', modeTitle || chapter.name) : null);
  const tools = el('div', 'toolbar-actions');
  for (const [glyph, label, mode] of [['clipboard-list', 'Exercises', 'exercises'], ['layers', 'Flashcards', 'cards'], ['notebook-pen', 'Quick notes', 'notes']]) {
    const control = iconButton(label, glyph, () => openMode(mode));
    control.setAttribute('aria-pressed', String(route.mode === mode));
    tools.append(control);
  }
  if (route.mode === 'read') {
    if (chapter) {
      if (/==[^=\n]+==/.test(file.source)) {
        const toggle = iconButton('Cloze quiz', 'brain', () => { quiz = !quiz; return render(true); });
        toggle.setAttribute('aria-pressed', String(quiz));
        tools.append(toggle);
      }
      tools.append(iconButton('Quick capture', 'plus', () => capture(library, book, chapter, window.getSelection()?.toString() ?? '', refresh)));
    }
    tools.append(iconButton('Edit Markdown', 'pencil', () => editFile(file, chapter ? 'Edit chapter' : 'Edit book introduction')));
  }
  const ctx = {
    ...entry, library, plugin, progress, states, markdown, asset, openFile, openMode, jump, editFile,
    changed: refresh, addChapter, editBookNote: (name, title) => editBookNote(book, name, title),
  };
  const content = el('div', 'page');
  const side = el('div', 'outline-inner');
  if (route.mode === 'exercises') showExercises(content, ctx, route.scope);
  else if (route.mode === 'cards') await showCards(content, ctx);
  else if (route.mode === 'notes') await showNotes(content, ctx);
  else if (chapter) {
    showChapter(content, chapter, ctx);
    showOutline(side, chapter, ctx);
  } else showOverview(content, ctx);
  if (id !== renderId) return;
  toolbar.replaceChildren(crumb, tools);
  article.replaceChildren(content);
  outline.replaceChildren(side);
  scroll.scrollTop = scrollTop;
}

function setup() {
  const search = button('', null, searchLibrary, 'library-search');
  search.append(icon('search'), el('span', '', 'Search library'), el('kbd', '', shortcut));
  const sidebar = el('aside', 'sidebar',
    el('div', 'sidebar-brand', icon('book-open'), el('span', '', 'Bücher')),
    search,
    el('div', 'library-heading', el('h2', 'eyebrow', 'Library'), iconButton('New book', 'plus', addBook),
      iconButton('Import books', 'folder-down', importBooks)),
    nav);
  shell.append(sidebar, el('section', 'workspace', toolbar, scroll));
  root.replaceChildren(shell);
}

document.addEventListener('click', event => {
  const link = event.target.closest('.markdown a');
  const blank = event.target.closest('[data-cloze]');
  if (blank) {
    const revealed = blank.getAttribute('aria-pressed') === 'true';
    blank.setAttribute('aria-pressed', String(!revealed));
    blank.children[0].hidden = !revealed;
    blank.children[1].hidden = revealed;
  }
  if (!link) return;
  event.preventDefault();
  if (link.hasAttribute('data-external')) openUrl(link.href).catch(report);
  else if (link.dataset.file) {
    if (link.dataset.file === route.path && route.mode === 'read') jump(link.dataset.fragment);
    else {
      link.closest('dialog')?.close();
      openFile(link.dataset.file, link.dataset.fragment).catch(report);
    }
  } else if (link.dataset.missing) notice(`Reference not found in the library: ${link.dataset.missing}`);
});

document.addEventListener('keydown', event => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !document.querySelector('dialog[open]')) {
    event.preventDefault();
    searchLibrary();
  }
});

setup();
article.append(el('p', 'muted', 'Opening library…'));
load().catch(error => {
  article.replaceChildren(el('h1', 'page-title', 'Could not open the library'), el('p', 'muted', error?.message || String(error)),
    button('Try again', 'refresh-cw', load));
});
