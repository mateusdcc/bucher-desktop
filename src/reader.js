import progressModel from './model/progress';
import solutions from './model/solution-notes';
import intro from './model/intro-model';
import language from './model/language';
import { headingId } from './markdown';
import { inlineSolutionEditor } from './solution-editor';
import { button, el, icon, iconButton, notice } from './ui';

const { countsFor, statusFor } = progressModel;
const { appendSolutionTab, materializeSolution, primaryKind, primarySolution, removeSolutionTab, resolveEmbed, solutionTabs } = solutions;
const { stripFrontmatter } = intro;
const { bookLanguage, speakText } = language;
const languageBlocks = new Set(['vocab', 'phrase', 'grammar', 'dialogue', 'usage', 'culture', 'conjugation']);
const calloutIcons = {
  definition: 'book-open', theorem: 'diamond', lemma: 'diamond', proposition: 'diamond',
  corollary: 'diamond', example: 'flask-conical', exercise: 'clipboard-list', hint: 'lightbulb',
  vocab: 'languages', phrase: 'message-circle', grammar: 'languages', dialogue: 'messages-square',
};
const labelFor = word => word[0].toUpperCase() + word.slice(1);
const calloutBody = unit => unit.markdown.split('\n').slice(1).map(line => line.replace(/^ {0,3}> ?/, '')).join('\n');

export function statusIndicator(read, total, title) {
  if (!read || !total) return null;
  const status = read === total ? el('span', 'tree-status checked', icon('check')) : el('span', 'tree-status partial');
  status.title = title ?? `${read} of ${total} chapters read`;
  status.setAttribute('role', 'img');
  status.setAttribute('aria-label', status.title);
  if (read < total) status.style.setProperty('--percent', `${read / total * 100}%`);
  return status;
}

export function readingProgress(counts) {
  const line = el('div', 'progress-track', el('span'));
  const progress = counts.chapters ? counts.read / counts.chapters : 0;
  line.firstChild.style.width = `${progress * 100}%`;
  line.setAttribute('role', 'progressbar');
  line.setAttribute('aria-label', 'Chapters read');
  line.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  return line;
}

function content(source, title) {
  const first = /^#[ \t]+([^\r\n]+)(?:\r?\n|$)/.exec(source);
  return first?.[1].trim().toLowerCase() === title.toLowerCase() ? source.slice(first[0].length).trim() : source;
}

export function showNote(host, file, title, markdown) {
  const body = markdown(content(stripFrontmatter(file.source), title), file.path);
  for (const paragraph of body.querySelectorAll(':scope > p')) {
    if (paragraph.childElementCount) continue;
    const anchor = /^\^([\w-]+)$/.exec(paragraph.textContent);
    if (!anchor) continue;
    const marker = el('span', 'note-anchor');
    marker.id = '^' + anchor[1];
    body.insertBefore(marker, paragraph.previousElementSibling ?? paragraph);
    paragraph.remove();
  }
  host.append(el('h1', 'page-title', title), body);
}

export function showOverview(host, ctx) {
  const { model, book, records, markdown, openFile, openMode } = ctx;
  const counts = countsFor(model, records);
  const next = model.chapters.find(chapter => !statusFor(model, records, chapter)) ?? model.chapters[0];
  const body = content(stripFrontmatter(book.index.source), book.title);
  host.append(el('h1', 'page-title', book.title));
  if (book.index.frontmatter.description) host.append(el('p', 'description', String(book.index.frontmatter.description)));
  host.append(el('div', 'page-actions',
    next ? button(counts.read && counts.read < counts.chapters ? 'Continue reading' : 'Start reading', 'arrow-right',
      () => openFile(next.path), 'accent-button') : button('Add chapter', 'plus', () => ctx.addChapter(book)),
    counts.exercises ? button('Exercises', 'clipboard-list', () => openMode('exercises')) : null));
  if (counts.chapters) {
    host.append(el('div', 'book-progress',
      el('div', 'book-progress-label',
        el('span', '', `${counts.read} of ${counts.chapters} chapters read`),
        counts.exercises ? el('span', '', `${counts.solved} of ${counts.exercises} exercises solved`) : null),
      readingProgress(counts)));
  }
  if (body) host.append(el('section', 'introduction', markdown(body, book.index.path)));
  if (model.chapters.length) {
    const list = el('div', 'contents');
    function add(concepts, depth) {
      for (const concept of concepts) {
        const chapter = model.byPath.get(concept.file.path);
        const read = statusFor(model, records, chapter);
        const row = button(concept.name, null, () => openFile(chapter.path), 'contents-row');
        row.style.setProperty('--depth', depth);
        row.prepend(icon(concept.icon || 'file-text', true));
        row.append(el('span', 'contents-trailing', read ? statusIndicator(1, 1, 'Read') : icon('arrow-up-right')));
        list.append(row);
        add(concept.children, depth + 1);
      }
    }
    add(book.concepts, 0);
    host.append(el('h2', 'contents-title', 'Contents'), list);
  }
}

function prerequisites(targets, ctx) {
  const links = targets.filter(Boolean);
  if (!links.length) return null;
  const section = el('details', 'prerequisites', el('summary', '', 'Prerequisites'));
  section.append(el('div', 'prerequisite-links', links.map(target =>
    button(target.title ?? target.name, 'arrow-up-right', event => ctx.openReference(target.path, target.id ?? '', event.currentTarget), 'quiet-link'))));
  if (targets.includes(null)) section.append(el('span', 'muted', 'Some prerequisites could not be found.'));
  return section;
}

function callout(unit, chapter, ctx) {
  const kind = unit.callout || 'exercise';
  const title = unit.title || labelFor(kind);
  const block = el('section', `callout ${kind === 'exercise' ? 'exercise' : ''}`);
  block.id = unit.anchor ? '^' + unit.anchor : unit.node?.id || headingId(title);
  const row = el('div', 'callout-kind', icon(calloutIcons[kind] || 'quote'), labelFor(kind));
  if (!ctx.referenceOnly && languageBlocks.has(kind) && bookLanguage(ctx.library.app, ctx.book).speechLang) {
    row.append(iconButton('Pronounce', 'volume-2', () => speakText(calloutBody(unit) || title, bookLanguage(ctx.library.app, ctx.book).speechLang)));
  }
  block.append(row, el('h2', 'callout-title', title));
  const body = unit.callout ? calloutBody(unit) : '';
  if (body.trim()) {
    if (!ctx.referenceOnly) {
      const explanation = el('div', 'explanation-anchor');
      row.append(iconButton('Explain ' + title + ' with AI', 'message-circle-question-mark',
        () => ctx.ai.explain(explanation, title + '\n\n' + body, chapter.path, title)));
      block.prepend(explanation);
    }
    block.append(ctx.markdown(body, chapter.path, {
      chapter, unit, unitIndex: chapter.units.indexOf(unit), referenceOnly: ctx.referenceOnly,
    }));
  }
  return block;
}

function solutionEditor(panel, state, chapter, exercise, ctx) {
  const unit = exercise.solution ?? { virtual: true, exercise, markdown: '' };
  const { book, plugin, library, markdown, changed, ai } = ctx;
  const primary = exercise.solution && resolveEmbed(library.app, chapter.file, unit);
  const tabs = exercise.solution ? [
    { title: primaryKind(unit) === 'ai' ? 'AI solution' : 'Solution', path: primary?.path ?? '', body: primarySolution(unit) },
    ...solutionTabs(unit).map(({ path, kind }, i) => ({
      title: kind === 'ai' ? `AI solution ${i + 2}` : `Solution ${i + 2}`, path, body: '',
    })),
  ] : [];
  state.tab = Math.min(state.tab, Math.max(0, tabs.length - 1));
  const question = (exercise.unit.callout && calloutBody(exercise.unit)) || exercise.title;
  const scope = exercise.title;
  function startDraft({ initial, typst, path, save }) {
    const text = initial.replace(/\r\n?/g, '\n');
    state.draft = { initial: text, text, typst, path, save };
    draw();
    body.querySelector('.cm-content').focus();
  }
  const startAttempt = () => startDraft({
    initial: '', path: chapter.path,
    async save(text) {
      if (exercise.solution) {
        await appendSolutionTab(plugin, chapter.file, book, unit, 'manual', 'mathjax', text);
      } else {
        await materializeSolution(plugin, chapter.file, book, unit, 'mathjax', text);
      }
      state.tab = tabs.length;
    },
  });
  const newAttempt = button('New attempt', 'plus', startAttempt);
  function editAttempt(selected) {
    const file = selected.path ? library.resolve(selected.path, chapter.path) : null;
    if (selected.path && !file) throw new Error('The solution note is missing.');
    const original = file?.source;
    const initial = file ? stripFrontmatter(original, false) : selected.body;
    const typst = file ? file.frontmatter.renderer === 'typst' : unit.engine === 'typst';
    startDraft({
      initial, typst, path: file?.path ?? chapter.path,
      async save(text) {
        if (file) {
          await library.app.vault.process(file, latest => {
            if (latest !== original) throw new Error('The solution changed. Reopen it before editing.');
            return original.slice(0, original.length - initial.length) + text;
          });
        } else if (!await materializeSolution(plugin, chapter.file, book, unit, typst ? 'typst' : 'mathjax', text)) {
          throw new Error('The solution note is missing.');
        }
      },
    });
  }
  function proof(tab, compare = false) {
    const note = tab.path ? library.resolve(tab.path, chapter.path) : null;
    const body = note ? stripFrontmatter(note.source) : tab.body;
    const typst = (note?.frontmatter.renderer === 'typst') || (!tab.path && unit.engine === 'typst');
    const box = el('div', 'proof',
      compare ? el('div', 'eyebrow', tab.title) : null,
      typst ? el('p', 'muted', 'Typst source') : null,
      body && typst ? el('pre', 'typst-source', body) : null,
      body && !typst ? markdown(body, note?.path ?? chapter.path) : null,
      !body ? el('p', 'muted', tab.path && !note ? 'The solution note is missing.' : 'No solution text yet.') : null);
    return box;
  }
  const aiHost = el('div', 'solution-ai');
  const generate = () => ai.solve(aiHost, question, stripFrontmatter(chapter.file.source), chapter.path, scope,
    async text => {
      const note = await appendSolutionTab(plugin, chapter.file, book, unit, 'ai', 'mathjax', text);
      const latest = await plugin.learning.page(chapter.file, chapter.file.source);
      const updated = latest.nodes.find(node => node.type === 'exercise' && node.id === exercise.id)?.solution;
      const index = updated ? solutionTabs(updated).findIndex(tab => tab.path === note.path) : -1;
      state.tab = index + 1;
      state.compare = false;
      await changed();
    });
  let body;
  function draw() {
    body?.remove();
    body = el('div', 'solution-inner');
    if (state.draft) {
      const draft = state.draft;
      body.append(inlineSolutionEditor(draft,
        text => draft.typst ? el('pre', 'typst-source', text) : markdown(text, draft.path),
        async text => {
          if (text !== draft.initial) await draft.save(text);
          state.draft = null;
          await changed();
        }, () => {
          state.draft = null;
          draw();
        }));
      panel.append(body);
      return;
    }
    if (tabs.length > 1) {
      const tabBar = el('div', 'solution-tabs');
      for (const [index, tab] of tabs.entries()) {
        const control = button(tab.title, '', () => {
          state.tab = index;
          draw();
        }, index === state.tab ? 'selected' : '');
        control.setAttribute('aria-pressed', String(index === state.tab));
        tabBar.append(control);
      }
      const comparison = button(state.compare ? 'Close comparison' : 'Compare', 'columns-2', () => {
        state.compare = !state.compare;
        draw();
      });
      tabBar.append(comparison);
      body.append(tabBar);
    }
    const selected = tabs[state.tab];
    const controls = el('div', 'solution-actions', exercise.solution ? [
      newAttempt, button('Generate solution with AI', 'sparkles', generate),
    ] : []);
    if (selected) {
      controls.append(button('Edit', 'pencil', () => editAttempt(selected)));
      const note = selected.path ? library.resolve(selected.path, chapter.path) : null;
      const attempt = note ? stripFrontmatter(note.source) : selected.body;
      if (attempt.trim()) controls.append(button('Review attempt with AI', 'clipboard-check', () => {
        const rubric = book.index.frontmatter.grading;
        return ai.review(question, attempt, rubric ? JSON.stringify(rubric) : null,
          note?.path ?? chapter.path, scope + ' · ' + selected.title);
      }));
    }
    if (tabs.length > 1 && selected) {
      controls.append(iconButton('Remove attempt', 'x', async () => {
        if (!confirm('Remove this attempt from the exercise? Its Markdown file will be kept.')) return;
        await removeSolutionTab(plugin, chapter.file, book, unit, selected.path, 'mathjax');
        state.tab = Math.max(0, state.tab - 1);
        await changed();
      }));
    }
    if (selected) {
      if (state.compare && tabs.length > 1) {
        const others = tabs.map((tab, index) => ({ tab, index })).filter(({ index }) => index !== state.tab);
        const picker = el('select', 'compare-select');
        picker.setAttribute('aria-label', 'Compare with');
        for (const { tab, index } of others) {
          const option = el('option', '', tab.title);
          option.value = String(index);
          picker.append(option);
        }
        picker.value = others.some(({ index }) => index === state.other) ? String(state.other) : String(others[0].index);
        picker.addEventListener('change', () => { state.other = Number(picker.value); draw(); });
        body.append(picker, el('div', 'proof-columns', proof(selected, true), proof(tabs[Number(picker.value)], true)));
      } else {
        body.append(proof(selected));
      }
    }
    body.append(controls, aiHost);
    panel.append(body);
  }
  draw();
  return { startAttempt, generate };
}

function exerciseTools(chapter, exercise, ctx) {
  const { model, records, progress, states, changed } = ctx;
  const target = { ...exercise, path: chapter.path };
  const solved = statusFor(model, records, target);
  const saved = model.targets.get(chapter.path + '#' + exercise.id);
  const key = chapter.path + '#' + exercise.id;
  if (!states.has(key)) states.set(key, { open: false, tab: 0, hints: new Set() });
  const state = states.get(key);
  const panel = el('div', 'exercise-tools');
  for (const [index, hint] of (exercise.solution?.hints ?? exercise.hints ?? []).entries()) {
    const open = el('details', 'hint',
      el('summary', '', icon('lightbulb'), `Hint ${index + 1}`, hint.title ? ` · ${hint.title}` : ''),
      ctx.markdown(calloutBody(hint), chapter.path));
    open.open = state.hints.has(index);
    open.addEventListener('toggle', () => open.open ? state.hints.add(index) : state.hints.delete(index));
    panel.append(open);
  }
  const required = prerequisites([...new Set([...(saved?.dependencies ?? []), ...chapter.dependencies])], ctx);
  if (required) panel.append(required);
  const controls = el('div', 'exercise-actions');
  const proof = el('div', 'solution-panel');
  const reveal = button('', null, () => {
      if (!exercise.solution) {
        state.open = true;
        const { startAttempt } = redraw();
        if (!state.draft) startAttempt();
        else proof.querySelector('.cm-content')?.focus();
        return;
      }
      state.open = !state.open;
      redraw();
    });
  controls.append(reveal, button(solved ? 'Solved' : 'Mark solved', solved ? 'check' : 'circle-check',
    async () => { await progress.set(model, target, !solved); await changed(); }, solved ? 'accent' : ''));
  if (!exercise.solution) controls.append(button('Generate solution with AI', 'sparkles', () => {
    if (state.draft) {
      notice('Save or discard the current draft first.');
      return;
    }
    state.open = true;
    redraw().generate();
  }));
  function redraw() {
    reveal.replaceChildren(icon(!exercise.solution ? 'pencil' : state.open ? 'eye-off' : 'eye'),
      !exercise.solution ? 'Write a solution' : state.open ? 'Hide solution' : 'Reveal solution');
    reveal.setAttribute('aria-expanded', String(state.open));
    proof.replaceChildren();
    proof.hidden = !state.open;
    if (state.open) return solutionEditor(proof, state, chapter, exercise, ctx);
  }
  redraw();
  panel.append(controls, proof);
  return panel;
}

export function showChapter(host, chapter, ctx) {
  const { book, model, records, progress, markdown, openFile, states, changed } = ctx;
  const read = statusFor(model, records, chapter);
  const index = model.chapters.indexOf(chapter);
  const next = model.chapters[index + 1];
  const previous = model.chapters[index - 1];
  host.append(el('h1', 'page-title', chapter.name));
  if (chapter.description) host.append(el('p', 'description', chapter.description));
  const chapterBody = el('div', 'chapter-body');
  const ownedHints = new Set(chapter.nodes.flatMap(node => node.solution?.hints ?? node.hints ?? []));
  for (const [unitIndex, unit] of chapter.units.entries()) {
    if (ownedHints.has(unit)) continue;
    if (unit.type === 'heading' && unit.level === 1 && unit.title?.trim().toLowerCase() === chapter.name.toLowerCase()) continue;
    if (unit.type === 'solution') {
      if (unit.exercise?.unit === unit) chapterBody.append(callout({ title: unit.exercise.title }, chapter, ctx));
      if (unit.exercise && !ctx.referenceOnly) chapterBody.append(exerciseTools(chapter, unit.exercise, ctx));
    } else if (unit.callout) {
      chapterBody.append(callout(unit, chapter, ctx));
    } else {
      const body = markdown(unit.markdown, chapter.path, { chapter, unit, unitIndex, referenceOnly: ctx.referenceOnly });
      if (unit.anchor) body.id = '^' + unit.anchor;
      if (unit.node && !unit.anchor) body.id = unit.node.id;
      chapterBody.append(body);
    }
    if (!ctx.referenceOnly && unit.node?.type === 'exercise' && !unit.node.solution) {
      chapterBody.append(exerciseTools(chapter, unit.node, ctx));
    }
  }
  host.append(chapterBody);
  if (ctx.referenceOnly) return;
  const footer = el('div', 'chapter-footer',
    button(previous?.name || book.title, 'arrow-left', () => openFile(previous?.path ?? book.index.path), 'previous-chapter'),
    button(read ? 'Read' : 'Mark as read', read ? 'check' : 'circle-check',
      async () => { await progress.setRead(model, [chapter.path], !read); await changed(); }, read ? 'accent read-chapter' : 'read-chapter'),
    button(next?.name || 'Finish book', 'arrow-right', async () => {
      if (!read) await progress.setRead(model, [chapter.path], true);
      await changed(false);
      await openFile(next?.path ?? book.index.path);
      if (!next) notice('Last chapter marked as read.');
    }, 'accent-button next-chapter'));
  host.append(footer);
}

export function showExercises(host, ctx, scope) {
  const { model, markdown, openFile, records } = ctx;
  const chapters = scope ? model.chapters.filter(chapter => chapter.path === scope || chapter.path.startsWith(scope.slice(0, -3) + '/')) : model.chapters;
  const counts = countsFor(model, records, chapters);
  host.append(el('h1', 'page-title', 'Exercises'),
    el('p', 'description', `${counts.solved} of ${counts.exercises} solved`));
  if (!counts.exercises) host.append(el('p', 'muted', 'This selection has no exercises yet.'));
  for (const chapter of chapters) {
    for (const exercise of chapter.nodes.filter(node => node.type === 'exercise')) {
      const block = el('section', 'sheet-exercise',
        button(chapter.name, 'arrow-up-right', () => openFile(chapter.path, exercise.unit.anchor ? '^' + exercise.unit.anchor : exercise.unit.node?.id ?? headingId(exercise.title)), 'quiet-link'),
        callout(exercise.unit.type !== 'solution' ? exercise.unit : { title: exercise.title }, chapter, ctx));
      if (exercise.prompt?.length) block.append(markdown(exercise.prompt.join('\n\n'), chapter.path, {
        chapter, unit: exercise.unit, unitIndex: chapter.units.indexOf(exercise.unit), referenceOnly: ctx.referenceOnly,
      }));
      block.append(exerciseTools(chapter, exercise, ctx));
      host.append(block);
    }
  }
}

export function showOutline(host, chapter, ctx) {
  if (!chapter) return;
  const entries = chapter.units.filter(unit => !unit.inSolution && unit.callout !== 'hint' &&
    (unit.callout || (unit.type === 'heading' && unit.level > 1)));
  if (entries.length) {
    host.append(el('h2', 'eyebrow', 'On this page'));
    for (const unit of entries) {
      const label = unit.title || labelFor(unit.callout);
      const fragment = unit.anchor ? '^' + unit.anchor : unit.node?.id || headingId(label);
      host.append(button(label, '', () => ctx.jump(fragment), 'outline-link'));
    }
  }
  const dependencies = chapter.dependencies.filter(Boolean);
  if (dependencies.length) {
    host.append(el('h2', 'eyebrow', 'Prerequisites'));
    for (const target of dependencies) {
      host.append(button(target.title ?? target.name, 'arrow-up-right',
        event => ctx.openReference(target.path, target.id ?? '', event.currentTarget), 'outline-link'));
    }
  }
}
