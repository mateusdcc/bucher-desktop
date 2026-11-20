import '@fontsource-variable/inter';
import '@fontsource/spectral/latin-400.css';
import '@fontsource/spectral/latin-600.css';
import 'katex/dist/katex.css';
// React Flow styles must live in the entry stylesheet: esbuild does not load
// CSS emitted for dynamically-imported chunks (the graph view is lazy).
import '@xyflow/react/dist/style.css';
import './components/ui/controls.css';
import './components/ui/inputs.css';
import './components/ui/containers.css';
import './components/ui/feedback.css';
import './components/ui/workbench.css';
import './styles.css';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { createAiActions } from './ai';
import { showCommandPalette } from './command-palette';
import libraryModel from './model/library';
import catalog from './model/catalog';
import learningModel from './model/learning';
import progressModel from './model/progress';
import bookModel from './model/buch-model';
import storage from './model/storage';
import intro from './model/intro-model';
import memory from './model/book-memory';
import { headingId, renderMarkdown } from './markdown';
import { registry } from './extensions/index.js';
import './extensions/builtins.js';
import { auditCapabilities } from './extensions/capability.js';
import { hydrateExtensions } from './extensions/host.js';
import { showChapter, showExercises, showNote, showOutline, showOverview, statusIndicator } from './reader';
import { panelResize } from './panel-resize';
import { settingsPage } from './settings';
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
const learning = new learningModel.LearningIndex(library.app, (id, payload) => {
  if (!registry.isExercise(id)) return false;
  // Explore-mode blocks are visualizations, not solvable exercises: explicit
  // mode: explore, or hybrid extensions whose mode defaults to explore.
  if (payload?.mode === 'explore') return false;
  if (registry.get(id)?.category === 'hybrid' && payload?.mode == null) return false;
  return true;
});
const progress = new BookProgress(library.app, {});
const plugin = { app: library.app, learning, solutionWrites: new Map() };
const states = new Map();
const expanded = new Set();
const collapsed = new Set();
const root = document.querySelector('#app');
const modifier = /Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl';
const nav = el('nav', 'tree');
nav.setAttribute('aria-label', 'Book navigation');
const toolbar = el('header', 'toolbar');
const article = el('article', 'article');
const outline = el('aside', 'outline');
const readerRail = el('aside', 'reader-rail');
readerRail.setAttribute('aria-label', 'Reader tools');
const readerSide = el('div', 'reader-side', outline, readerRail);
readerSide.id = 'reader-side';
const scroll = el('div', 'reading-scroll', article);
scroll.id = 'reading-scroll';
const jumpBar = el('div', 'jump-bar');
const jumpStack = [];
const readingLayout = el('main', 'reading-layout', scroll, readerSide);
const referenceScroll = el('div', 'reference-scroll');
referenceScroll.tabIndex = 0;
referenceScroll.setAttribute('aria-label', 'Reference text');
const closeReferenceButton = iconButton('Close reference pane', 'x', closeReference);
const referenceTitle = el('h2', 'eyebrow reference-title');
const referencePane = el('aside', 'reference-pane', el('header', 'reference-header',
  referenceTitle, closeReferenceButton), referenceScroll);
referencePane.setAttribute('aria-label', 'Reference pane');
const readerStage = el('div', 'reader-stage', readingLayout, referencePane);
const referenceLayouts = [
  { layout: 'vertical', glyph: 'columns-2', label: 'Split vertically from jumped', keywords: 'reference side by side right' },
  { layout: 'horizontal', glyph: 'rows-2', label: 'Split horizontally from jumped', keywords: 'reference stacked below bottom' },
  { layout: 'floating', glyph: 'panels-top-left', label: 'Float jumped reference', keywords: 'floating window popup' },
];
const shell = el('div', 'shell');
let data = new Map();
let route = { path: '', mode: 'read', scope: '' };
let searchPanel;
let renderId = 0;
let quiz = false;
let utility;
let reference;

function openWorkspace(content) {
  utility = content;
  readerRail.replaceChildren();
  shell.classList.remove('nav-open');
  return render();
}

function closeWorkspace() {
  utility = null;
  return render();
}

function openSettings(section) {
  return openWorkspace(settingsPage(library, section));
}

const asset = path => convertFileSrc(library.basePath + '/' + path);
const ai = createAiActions({
  markdown, openSettings: () => openSettings('ai'), vault: library.app.vault,
  changed: refresh, openWorkspace, closeWorkspace, readerRail,
  async openImportedBook(path) {
    library.load(await invoke('load_library'));
    await refresh(false);
    await openFile(path);
    notice('Book imported.');
  },
});
function markdown(source, path, ext) {
  return renderText(source, path, quiz, ext);
}

function renderText(source, path, quiz = false, ext) {
  const body = el('div', 'markdown');
  body.innerHTML = renderMarkdown(source, { library, path, asset, quiz });
  hydrateExtensions(body, hostContext(path, ext));
  return body;
}

/** Build the extension host context for one rendered Markdown body. */
function hostContext(path, ext) {
  const entry = findBook(path);
  const chapter = ext?.chapter ?? entry?.model.byPath.get(path) ?? null;
  const unit = ext?.unit;
  const nodeId = unit?.node?.type === 'exercise' ? unit.node.id : unit?.anchor ? '^' + unit.anchor : null;
  return {
    registry,
    entry: entry && chapter ? entry : null,
    chapter,
    nodeId,
    unitIndex: ext?.unitIndex ?? 0,
    readOnly: !ext || !entry || !chapter || Boolean(ext.referenceOnly),
    renderMarkdown: source => renderText(source, path, false),
    persist(key, state) {
      if (!entry || !chapter) return;
      const mapKey = chapter.path.slice(entry.book.path.length + 1) + '#' + key;
      progress.setExtensionState(entry.book, mapKey, state).catch(report);
    },
    complete(exerciseId) {
      if (!entry || !chapter) return;
      progress.set(entry.model, { type: 'exercise', id: exerciseId, path: chapter.path }, true)
        .then(() => refresh())
        .catch(report);
    },
  };
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

function fragmentTarget(host, fragment, prefix = '') {
  if (!fragment) return null;
  const slug = headingId(fragment);
  return host.querySelector(`#${CSS.escape(prefix + fragment)}`)
    ?? (slug ? host.querySelector(`#${CSS.escape(prefix + slug)}`) : null);
}

function jump(fragment) {
  fragmentTarget(article, fragment)?.scrollIntoView({ block: 'start' });
}

function pageName(path) {
  const entry = findBook(path);
  if (entry?.book.index.path === path) return entry.book.title;
  const file = library.file(path);
  return entry?.model.byPath.get(path)?.name || file?.frontmatter.name || file?.name.replace(/\.md$/i, '') || '';
}

function passageBlocks(host) {
  return [...host.querySelectorAll('.page > :not(.chapter-body), .chapter-body > *')];
}

function rememberPassage(host) {
  const top = host.getBoundingClientRect().top;
  const blocks = passageBlocks(host);
  const index = blocks.findIndex(block => block.getBoundingClientRect().bottom > top);
  return { index, offset: index < 0 ? 0 : blocks[index].getBoundingClientRect().top - top, scrollTop: host.scrollTop };
}

function restorePassage(host, passage) {
  const block = passageBlocks(host)[passage.index];
  if (!block) {
    host.scrollTop = passage.scrollTop;
    return;
  }
  const offset = Math.min(passage.offset, host.clientHeight / 3);
  host.scrollTop += block.getBoundingClientRect().top - host.getBoundingClientRect().top - offset;
}

function renderJump() {
  const origin = !utility && jumpStack.at(-1);
  jumpBar.hidden = !origin;
  readingLayout.style.setProperty('--jump-border', origin ? jumpStack.map((_, index) =>
    `inset -${8 * (index + 1)}px 0 hsl(${(181 + index * 67) % 360} 55% 61%)`).join(', ') : 'none');
  if (!origin) return;
  const back = button('Go back', 'undo-2', goBack);
  jumpBar.replaceChildren(back, el('span', 'jump-origin', pageName(origin.route.path)),
    el('span', 'jump-depth', `${jumpStack.length} ${jumpStack.length === 1 ? 'jump' : 'jumps'}`));
}

/** Follow a reader reference and retain the source route, scroll position, and link for Go back. */
async function openReference(path, fragment, source) {
  if (utility || !route.path || !findBook(path)) return openFile(path, fragment);
  if (route.path === path && route.mode === 'read' && !fragmentTarget(article, fragment)) return;
  const host = article.contains(source) ? article : outline.contains(source) ? outline : null;
  jumpStack.push({
    route, quiz, passage: rememberPassage(scroll), outlineTop: outline.scrollTop, host, fragment,
    linkIndex: host ? [...host.querySelectorAll('a, button')].indexOf(source) : -1,
    linkText: source?.textContent,
  });
  if (path !== route.path || route.mode !== 'read') quiz = false;
  utility = null;
  readerRail.replaceChildren();
  route = { path, mode: 'read', scope: '' };
  shell.classList.remove('nav-open');
  showSelection(path);
  await render();
  jump(fragment);
  jumpBar.querySelector('button')?.focus({ preventScroll: true });
}

async function goBack() {
  const origin = jumpStack.pop();
  if (!origin) return;
  await restoreOrigin(origin);
}

async function restoreOrigin(origin, resized = false) {
  utility = null;
  readerRail.replaceChildren();
  route = origin.route;
  quiz = origin.quiz;
  showSelection(route.path);
  await render();
  const candidate = origin.host?.querySelectorAll('a, button')[origin.linkIndex];
  const link = candidate?.textContent === origin.linkText ? candidate : null;
  if (link) {
    for (let details = link.closest('details'); details; details = details.parentElement.closest('details')) details.open = true;
  }
  if (resized) restorePassage(scroll, origin.passage);
  else scroll.scrollTop = origin.passage.scrollTop;
  outline.scrollTop = origin.outlineTop;
  if (link?.getClientRects().length) {
    if (resized && scroll.contains(link)) link.scrollIntoView({ block: 'nearest' });
    link.focus({ preventScroll: true });
  } else jumpBar.querySelector('button')?.focus({ preventScroll: true });
}

function renderLayout() {
  const layout = !utility && reference?.layout;
  readerStage.dataset.layout = layout || '';
  referencePane.hidden = !layout;
}

function showReference(path, fragment, passage) {
  const file = library.file(path);
  if (file?.extension !== 'md') return;
  const entry = findBook(path);
  const chapter = entry?.model.byPath.get(path);
  const content = el('div', 'page');
  if (chapter) showChapter(content, chapter, { ...entry, markdown: renderText, referenceOnly: true });
  else showNote(content, file, pageName(path), renderText);
  for (const node of content.querySelectorAll('[id]')) node.id = 'reference-' + node.id;
  referenceTitle.textContent = 'Reference · ' + pageName(path);
  referenceScroll.replaceChildren(el('div', 'article', content));
  referenceScroll.scrollTop = 0;
  const target = fragmentTarget(referenceScroll, fragment, 'reference-');
  if (passage && !target) restorePassage(referenceScroll, passage);
  else target?.scrollIntoView({ block: 'start' });
}

/** Move the current reference into a reading pane and restore its immediate source in the main reader. */
async function detachReference(layout) {
  const origin = jumpStack.pop();
  if (!origin) return;
  const path = route.path;
  const passage = rememberPassage(scroll);
  const resized = layout !== 'floating' || (reference && reference.layout !== 'floating');
  reference = { layout };
  await restoreOrigin(origin, resized);
  showReference(path, origin.fragment, passage);
  if (!document.activeElement?.closest('.reading-layout, .jump-bar')) {
    referenceScroll.focus({ preventScroll: true });
  }
}

function closeReference() {
  const passage = rememberPassage(scroll);
  reference = null;
  renderLayout();
  restorePassage(scroll, passage);
  referenceScroll.replaceChildren();
  toolbar.querySelector('[aria-keyshortcuts]')?.focus({ preventScroll: true });
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
  jumpStack.length = 0;
  utility = null;
  readerRail.replaceChildren();
  route = { path, mode: 'read', scope: '' };
  shell.classList.remove('nav-open');
  quiz = false;
  showSelection(path);
  saveLocation();
  await render();
  jump(fragment);
}

function openMode(mode, scope = '') {
  readerRail.replaceChildren();
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
    let extStates = {};
    try {
      records = await progress.read(model);
      extStates = await progress.readExtensions(book);
    } catch (error) {
      report(error);
    }
    return [book.path, { book, model, records, extStates }];
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
    const current = !utility && route.path === path;
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

function openCommandPalette() {
  if (document.querySelector('dialog[open]')) return;
  const commands = [
    { label: 'Search library', glyph: 'search', run: searchLibrary },
    { label: 'Open settings', glyph: 'settings', run: () => openSettings() },
    { label: 'Manage extensions', glyph: 'puzzle', run: () => openSettings('extensions') },
  ];
  if (utility) commands.unshift({ label: 'Back to reader', glyph: 'arrow-left', run: closeWorkspace });
  else if (route.path) {
    for (const [mode, label, glyph] of [
      ['exercises', 'Open exercises', 'clipboard-list'],
      ['cards', 'Open flashcards', 'layers'],
      ['notes', 'Open quick notes', 'notebook-pen'],
    ]) {
      if (mode !== route.mode) commands.push({ label, glyph, run: () => openMode(mode) });
    }
    if (jumpStack.length) commands.unshift({ label: 'Go back', glyph: 'undo-2', run: goBack });
    if (jumpStack.length && route.mode === 'read') {
      commands.unshift(...referenceLayouts.map(({ layout, ...command }) => ({ ...command, run: () => detachReference(layout) })));
    }
    if (reference) commands.push({ label: 'Close reference pane', glyph: 'x', run: closeReference });
  }
  showCommandPalette(commands);
}

async function render(keepScroll = false) {
  const id = ++renderId;
  const scrollTop = keepScroll ? scroll.scrollTop : 0;
  renderNav();
  renderJump();
  renderLayout();
  const entry = findBook(route.path);
  const sideToggle = iconButton('Toggle library', 'panel-left', () => shell.classList.toggle('nav-open'));
  sideToggle.classList.add('mobile-nav');
  const palette = iconButton('Command palette', 'command', openCommandPalette);
  palette.title += ` (${modifier} P)`;
  palette.setAttribute('aria-keyshortcuts', 'Meta+P Control+P');
  if (utility) {
    toolbar.replaceChildren(el('div', 'breadcrumb', sideToggle,
      button('Back to reader', 'arrow-left', closeWorkspace)), palette);
    article.replaceChildren(utility);
    outline.replaceChildren();
    scroll.scrollTop = scrollTop;
    return;
  }
  if (!entry) {
    toolbar.replaceChildren(sideToggle, palette);
    article.replaceChildren(el('h1', 'page-title', 'Your library'),
      el('div', 'page-actions', button('Import books', 'folder-open', importBooks, 'accent-button'), button('New book', 'plus', addBook)));
    outline.replaceChildren();
    return;
  }
  const { book, model } = entry;
  const chapter = model.byPath.get(route.path);
  const file = library.file(route.path) ?? book.index;
  const pageTitle = file.path === book.index.path ? '' : pageName(file.path);
  const modeTitle = { exercises: 'Exercises', notes: 'Quick notes', cards: 'Flashcards' }[route.mode];
  const crumb = el('div', 'breadcrumb',
    sideToggle,
    button(book.title, 'book-open', () => openFile(book.index.path), 'crumb-book'),
    pageTitle || modeTitle ? icon('chevron-right') : null,
    pageTitle || modeTitle ? el('span', 'crumb-page', modeTitle || pageTitle) : null);
  const tools = el('div', 'toolbar-actions');
  const explanation = el('div', 'explanation-anchor');
  for (const [glyph, label, mode] of [['clipboard-list', 'Exercises', 'exercises'], ['layers', 'Flashcards', 'cards'], ['notebook-pen', 'Quick notes', 'notes']]) {
    const control = iconButton(label, glyph, () => openMode(mode));
    control.setAttribute('aria-pressed', String(route.mode === mode));
    tools.append(control);
  }
  if (route.mode === 'read') {
    const scope = `${book.title} · ${pageTitle || 'Introduction'}`;
    tools.append(
      iconButton('Explain with AI', 'message-circle-question-mark', () => ai.explain(explanation, stripFrontmatter(file.source), file.path, scope)),
      iconButton('Propose a patch', 'wand-sparkles', () => ai.proposePatch(file, scope)));
    if (chapter) {
      if (/==[^=\n]+==/.test(file.source)) {
        const toggle = iconButton('Cloze quiz', 'brain', () => { quiz = !quiz; return render(true); });
        toggle.setAttribute('aria-pressed', String(quiz));
        tools.append(toggle);
      }
      tools.append(iconButton('Quick capture', 'plus', () => capture(library, book, chapter, window.getSelection()?.toString() ?? '', refresh)));
    }
    tools.append(iconButton('Edit Markdown', 'pencil', () => editFile(file,
      chapter ? 'Edit chapter' : pageTitle ? `Edit ${pageTitle}` : 'Edit book introduction')));
  }
  tools.append(palette);
  const ctx = {
    ...entry, library, plugin, progress, states, markdown, asset, openFile, openMode, jump, openReference, editFile,
    changed: refresh, addChapter, ai, editBookNote: (name, title) => editBookNote(book, name, title),
  };
  const content = el('div', 'page');
  const side = el('div', 'outline-inner');
  if (route.mode === 'exercises') showExercises(content, ctx, route.scope);
  else if (route.mode === 'cards') await showCards(content, ctx);
  else if (route.mode === 'notes') await showNotes(content, ctx);
  else if (chapter) {
    showChapter(content, chapter, ctx);
    showOutline(side, chapter, ctx);
  } else if (pageTitle) showNote(content, file, pageTitle, markdown);
  else showOverview(content, ctx);
  if (id !== renderId) return;
  toolbar.replaceChildren(crumb, tools);
  article.replaceChildren(explanation, content);
  outline.replaceChildren(side);
  scroll.scrollTop = scrollTop;
}

function setup() {
  const search = button('', null, searchLibrary, 'library-search');
  search.append(icon('search'), el('span', '', 'Search library'), el('kbd', '', `${modifier} K`));
  const sidebar = el('aside', 'sidebar',
    el('div', 'sidebar-brand', icon('book-open'), el('span', '', 'Bücher')),
    search,
    el('div', 'library-heading', el('h2', 'eyebrow', 'Library'), iconButton('New book', 'plus', addBook),
      iconButton('Import books', 'folder-down', importBooks),
      iconButton('Import with AI', 'sparkles', ai.importBook)),
    nav,
    button('Settings', 'settings', () => openSettings(), 'sidebar-settings'));
  sidebar.id = 'library-sidebar';
  panelResize(shell, sidebar, { name: 'Resize library', property: 'library-width', width: 288,
    min: 215, max: 440, fraction: .37, edge: 'right' });
  panelResize(readingLayout, readerSide, { name: 'Resize reader tools', property: 'reader-width', width: 320,
    min: 185, max: 540, fraction: .44, edge: 'left' });
  shell.append(sidebar, el('section', 'workspace', toolbar, jumpBar, readerStage));
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
    if (referencePane.contains(link)) {
      showReference(link.dataset.file, link.dataset.fragment);
      referenceScroll.focus({ preventScroll: true });
    }
    else if (readingLayout.contains(link)) openReference(link.dataset.file, link.dataset.fragment, link).catch(report);
    else {
      link.closest('dialog')?.close();
      openFile(link.dataset.file, link.dataset.fragment).catch(report);
    }
  } else if (link.dataset.missing) notice(`Reference not found in the library: ${link.dataset.missing}`);
});

document.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.defaultPrevented || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase();
  if (key === 'p' && !event.shiftKey && !event.altKey) {
    event.preventDefault();
    openCommandPalette();
  } else if (key === 'k') {
    event.preventDefault();
    searchLibrary();
  }
});

setup();
registry.subscribe(() => render(true));
auditCapabilities(registry).then(() => registry.notify()).catch(report);
article.append(el('p', 'muted', 'Opening library…'));
load().catch(error => {
  article.replaceChildren(el('h1', 'page-title', 'Could not open the library'), el('p', 'muted', error?.message || String(error)),
    button('Try again', 'refresh-cw', load));
});
