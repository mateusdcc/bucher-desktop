import { invoke } from '@tauri-apps/api/core';
import intro from './model/intro-model';
import { patchDiff } from './patch-view';
import { selectedModel } from './settings';
import { button, el, icon, iconButton, notice } from './ui';

const { stripFrontmatter } = intro;
const prompt = (name, label, required = true) => ({ name, label, required, multiline: true });

function field({ name, label, required, multiline, fitContent, value = '' }) {
  const control = el(multiline ? 'textarea' : 'input');
  control.name = name;
  control.required = Boolean(required);
  control.value = value;
  const row = el('label', 'field', label);
  if (fitContent) {
    control.rows = 1;
    const fit = el('span', 'fit-field', control);
    const syncHeight = () => { fit.dataset.value = control.value; };
    control.addEventListener('input', syncHeight);
    syncHeight();
    row.append(fit);
  } else row.append(control);
  return [row, control];
}

function importPreview(draft, markdown) {
  function editable(parent, key, label, type, display) {
    const section = el('section', 'draft-section');
    function show() {
      const edit = iconButton('Edit ' + label.toLowerCase(), 'pencil', () => {
        const [row, input] = field({ name: key, label, multiline: type === 'markdown', value: parent[key] });
        input.addEventListener('input', () => { parent[key] = type === 'text' ? input.value.trim() : input.value; });
        const finish = button('Done editing ' + label.toLowerCase(), 'check', () => {
          show();
          section.querySelector('button').focus();
        });
        section.replaceChildren(row, finish);
        input.focus();
      });
      section.replaceChildren(display(parent[key]), edit);
    }
    show();
    return section;
  }
  const draftTitle = editable(draft, 'title', 'Book title', 'text', title => el('h3', 'draft-book-title', title || 'Untitled book'));
  const introduction = editable(draft, 'introduction', 'Introduction', 'markdown',
    source => source ? markdown(source, '') : el('p', 'muted', 'No introduction'));
  return el('div', 'import-draft', draftTitle, introduction, draft.chapters.map(chapter => el('div', 'draft-chapter',
    editable(chapter, 'title', 'Chapter title', 'text', title => el('h4', '', title || 'Untitled chapter')),
    editable(chapter, 'markdown', 'Chapter Markdown', 'markdown', text => markdown(text, '')))));
}

function requestPanel(model, options, close) {
  const { title, scope, fields, submitLabel, request, preview, accept, acceptLabel,
    resultTitle, canAccept, closeLabel = 'Close', kind } = options;
  const heading = el('h2', '', icon('sparkles'), title);
  heading.id = 'ai-' + crypto.randomUUID();
  const panel = el('section', 'ai-panel ' + kind,
    el('div', 'ai-heading', heading, iconButton('Dismiss ' + title.toLowerCase(), 'x', close)));
  panel.setAttribute('aria-labelledby', heading.id);
  if (scope) panel.append(el('p', 'ai-scope muted', scope));

  const form = el('form', 'ai-form');
  const status = el('p', 'ai-status muted');
  status.setAttribute('role', 'status');
  const result = el('div', 'ai-result');
  result.hidden = true;
  const send = button(submitLabel, null, null, 'accent-button');
  send.type = 'submit';
  const inputs = fields.map(field);
  form.append(...inputs.map(([row]) => row), el('div', 'ai-actions', send));
  const showError = error => {
    status.textContent = error?.message || String(error);
    status.classList.add('error-text');
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (send.disabled) return;
    const values = Object.fromEntries(new FormData(form));
    if (fields.some(({ name, required }) => required && !values[name].trim())) {
      showError('Fill in the required fields.');
      return;
    }
    send.disabled = true;
    for (const [, input] of inputs) input.readOnly = true;
    status.textContent = 'Waiting for Ollama…';
    status.classList.remove('error-text');
    try {
      const response = await request(model, values);
      if (!panel.isConnected) return;
      const content = preview(response);
      result.replaceChildren(content);
      if (resultTitle) heading.replaceChildren(icon('sparkles'), resultTitle);
      if (accept) {
        const actions = el('div', 'ai-actions', button(closeLabel, null, close));
        if (!canAccept || canAccept(response)) actions.append(button(acceptLabel, 'check', async () => {
          status.textContent = 'Saving…';
          status.classList.remove('error-text');
          try {
            await accept(response);
            await close();
          } catch (error) {
            showError(error);
          }
        }, 'accent-button'));
        result.append(actions);
      }
      status.textContent = '';
      form.hidden = true;
      result.hidden = false;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    } catch (error) {
      showError(error);
    } finally {
      send.disabled = false;
      for (const [, input] of inputs) input.readOnly = false;
    }
  });
  panel.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
  });
  panel.append(form, result, status);
  return panel;
}

/** Mount local Ollama actions beside the passage or exercise they act on. */
export function createAiActions({ markdown, openSettings, openWorkspace, closeWorkspace, vault, changed, openImportedBook, readerRail }) {
  function run(host, options, afterClose) {
    const model = selectedModel();
    if (!model) return openSettings();
    const previous = document.activeElement;
    const close = () => {
      if (!host.contains(panel) || !panel.isConnected) return;
      panel.remove();
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      return afterClose?.();
    };
    const panel = requestPanel(model, options, close);
    host.replaceChildren(panel);
    const inRail = host === readerRail;
    if (inRail) host.scrollTop = 0;
    panel.querySelector('textarea, input, button[type=submit]').focus({ preventScroll: inRail });
    if (!options.fields.length) panel.querySelector('form').requestSubmit();
  }
  return {
    explain(host, context, path, scope) {
      document.querySelector('.explanation-anchor > .ai-panel')?.remove();
      run(host, {
        title: 'Explain with AI', scope, kind: 'ai-explanation', submitLabel: 'Explain',
        fields: [{ ...prompt('question', 'Question'), fitContent: true }],
        request: (model, { question }) => invoke('ai_explain', { model, question, context }),
        preview: text => markdown(text, path),
      });
    },
    proposePatch(file, scope) {
      const snapshot = file.source;
      const original = stripFrontmatter(snapshot, false);
      const prefix = snapshot.slice(0, snapshot.length - original.length);
      run(readerRail, {
        title: 'Propose a patch', scope, kind: 'patch-rail', submitLabel: 'Generate patch',
        resultTitle: 'Review patch', closeLabel: 'Discard',
        fields: [prompt('instructions', 'What should change?')],
        request: (model, { instructions }) => invoke('ai_propose_patch', { model, instructions, markdown: original }),
        preview: patch => {
          if (patch.original !== original) throw new Error('The patch does not match the original Markdown.');
          return patchDiff(patch);
        },
        canAccept: ({ original, replacement }) => original !== replacement,
        acceptLabel: 'Apply patch',
        accept: async ({ replacement }) => {
          await vault.process(file, latest => {
            if (latest !== snapshot) throw new Error('The file changed. Generate a new patch from the latest version.');
            return prefix + replacement;
          });
          await changed();
          notice('Patch applied.');
        },
      });
    },
    solve(host, exercise, context, path, scope, save) {
      run(host, {
        title: 'Generate a solution', scope, kind: 'exercise-ai-panel', submitLabel: 'Generate solution',
        fields: [prompt('instructions', 'Instructions (optional)', false)],
        request: (model, { instructions }) => invoke('ai_generate_solution', { model, exercise, context, instructions }),
        preview: text => markdown(text, path),
        acceptLabel: 'Save as AI solution',
        accept: save,
      });
    },
    review(exercise, attempt, rubric, path, scope) {
      run(readerRail, {
        title: 'Review attempt with AI', scope, kind: 'review-rail', submitLabel: 'Review attempt',
        fields: [],
        request: model => invoke('ai_review_solution', { model, exercise, attempt, rubric }),
        preview: text => markdown(text, path),
      });
    },
    async importBook() {
      if (!selectedModel()) return openSettings();
      const host = el('div', 'import-host');
      await openWorkspace(el('div', 'page ai-import-page', el('h1', 'page-title', 'Import a book'), host));
      run(host, {
        title: 'Prepare from Markdown', kind: 'ai-import', submitLabel: 'Prepare draft', resultTitle: 'Review draft',
        fields: [{ name: 'title', label: 'Book title', required: true }, prompt('markdown', 'Source Markdown')],
        request: (model, source) => invoke('ai_prepare_import', { model, ...source }),
        preview: draft => importPreview(draft, markdown),
        acceptLabel: 'Import book',
        accept: async draft => openImportedBook(await invoke('ai_import_book', { draft })),
      }, closeWorkspace);
    },
  };
}
