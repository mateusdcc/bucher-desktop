import { invoke } from '@tauri-apps/api/core';
import { button, el, icon } from './ui';

const MODEL_KEY = 'bucher/ollama-model';

export function selectedModel() {
  return localStorage.getItem(MODEL_KEY) || '';
}

function ollamaSettings() {
  const installed = el('span');
  const connection = el('span');
  const message = el('p', 'settings-message muted');
  message.setAttribute('role', 'status');
  const models = el('select');
  const modelField = el('label', 'field settings-field', 'Local model', models);
  models.addEventListener('change', () => {
    if (models.value) localStorage.setItem(MODEL_KEY, models.value);
    else localStorage.removeItem(MODEL_KEY);
  });

  function update(result) {
    installed.textContent = result ? (result.installed ? 'Detected' : 'Not found') : 'Checking…';
    connection.textContent = result ? (result.connected ? 'Connected' : 'Unavailable') : 'Checking…';
    connection.classList.toggle('accent', Boolean(result?.connected));
    const names = result?.models ?? [];
    const placeholder = el('option', '', names.length ? 'Choose a model' : 'No models available');
    placeholder.value = '';
    models.replaceChildren(placeholder, ...names.map(name => el('option', '', name)));
    models.value = names.includes(selectedModel()) ? selectedModel() : '';
    models.disabled = !names.length;
    message.textContent = result?.connected
      ? (names.length ? '' : 'Install a text model in Ollama, then check the connection again.')
      : (result?.error || '');
  }

  async function check() {
    update();
    checkButton.disabled = true;
    try {
      update(await invoke('ai_ollama_status'));
    } catch (error) {
      update({ error: error?.message || String(error) });
    } finally {
      checkButton.disabled = false;
    }
  }

  const checkButton = button('Check connection', 'refresh-cw', check);
  const section = el('details', 'settings-section ollama-settings',
    el('summary', '', icon('chevron-right'), 'Ollama'),
    el('dl', 'settings-status',
      el('div', '', el('dt', '', 'Installation'), el('dd', '', installed)),
      el('div', '', el('dt', '', 'Connection'), el('dd', '', connection))),
    modelField,
    el('div', 'settings-check', message, checkButton));
  section.addEventListener('toggle', function checkOnOpen() {
    if (!section.open) return;
    section.removeEventListener('toggle', checkOnOpen);
    void check();
  });
  return section;
}

export function settingsPage(library, initial = 'library') {
  const panel = el('div', 'page settings', el('h1', 'page-title', 'Settings'));
  const content = el('div', 'settings-content');
  const categories = el('div', 'settings-tabs');
  categories.setAttribute('role', 'group');
  categories.setAttribute('aria-label', 'Settings categories');
  const tabs = [
    ['library', button('Library', 'folder', () => select('library'))],
    ['ai', button('AI', 'sparkles', () => select('ai'))],
  ];
  let current;
  function select(section) {
    if (current === section) return;
    current = section;
    for (const [id, tab] of tabs) tab.setAttribute('aria-pressed', String(id === section));
    content.replaceChildren(section === 'ai' ? ollamaSettings() :
      el('section', 'settings-section',
        el('h3', '', 'Library'),
        el('p', 'muted', 'Book storage'),
        el('code', 'settings-path', library.basePath ? library.basePath + '/Buches' : 'Library unavailable')));
  }
  categories.append(...tabs.map(([, tab]) => tab));
  panel.append(categories, content);
  select(initial);
  return panel;
}
