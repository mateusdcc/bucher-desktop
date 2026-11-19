import { invoke } from '@tauri-apps/api/core';
import { button, dialog, el, icon } from './ui';

const MODEL_KEY = 'bucher/ollama-model';
const CHATGPT_MODEL = 'bucher/chatgpt-model';
const PROVIDER = 'bucher/ai-provider';
const PLAN_SEEN = 'bucher/chatgpt-plan-seen';
const reasoningKey = model => 'bucher/chatgpt-reasoning/' + model;

function selectedModel() {
  return localStorage.getItem(MODEL_KEY) || '';
}

export function selectedAi() {
  const provider = localStorage.getItem(PROVIDER) === 'chatgpt' ? 'chatgpt' : 'ollama';
  const model = provider === 'chatgpt' ? localStorage.getItem(CHATGPT_MODEL) : selectedModel();
  if (!model) return null;
  const reasoningEffort = provider === 'chatgpt' ? localStorage.getItem(reasoningKey(model)) : null;
  return reasoningEffort ? { provider, model, reasoningEffort } : { provider, model };
}

export function manageChatGptUsage() {
  return button('Manage usage', 'external-link', () => invoke('chatgpt_usage'));
}

function chatGptSettings() {
  const state = el('p', 'settings-account');
  const message = el('p', 'settings-message muted');
  message.setAttribute('role', 'status');
  const models = el('select');
  const modelField = el('label', 'field settings-field', 'ChatGPT model', models);
  modelField.hidden = true;
  const reasoning = el('select');
  for (const [value, label] of [
    ['', 'Model default'], ['none', 'None'], ['minimal', 'Minimal'], ['low', 'Low'],
    ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max'],
  ]) {
    const option = el('option', '', label);
    option.value = value;
    reasoning.append(option);
  }
  const reasoningField = el('div', 'settings-field',
    el('label', 'field', 'Reasoning level', reasoning),
    el('p', 'settings-message muted', 'Supported levels vary by model.'));
  reasoningField.hidden = true;

  function showReasoning() {
    reasoningField.hidden = !models.value;
    reasoning.value = localStorage.getItem(reasoningKey(models.value)) || '';
    if (reasoning.selectedIndex < 0) reasoning.value = '';
  }

  models.addEventListener('change', () => {
    if (models.value) localStorage.setItem(CHATGPT_MODEL, models.value);
    else localStorage.removeItem(CHATGPT_MODEL);
    showReasoning();
  });
  reasoning.addEventListener('change', () => {
    const key = reasoningKey(models.value);
    if (reasoning.value) localStorage.setItem(key, reasoning.value);
    else localStorage.removeItem(key);
  });
  const actions = el('div', 'settings-chatgpt-actions');
  const section = el('details', 'settings-section provider-settings chatgpt-settings',
    el('summary', '', icon('chevron-right'), 'ChatGPT'),
    el('p', 'muted', 'Connect your account to use your ChatGPT plan for AI. Bücher sends the text needed for each ChatGPT request to OpenAI.'),
    state, actions, modelField, reasoningField, message);

  const errorText = error => error?.message || String(error);
  async function login(newAccount = false) {
    for (const action of actions.querySelectorAll('button')) action.disabled = true;
    message.textContent = 'Finish signing in with ChatGPT in your browser.';
    try {
      const result = await invoke('chatgpt_login', { newAccount });
      if (result.state === 'connected' && section.isConnected && !localStorage.getItem(PLAN_SEEN)) {
        localStorage.setItem(PLAN_SEEN, '1');
        dialog('You’re using your ChatGPT plan', panel => {
          panel.append(el('p', '', 'Eligible AI requests with the ChatGPT provider use your plan or available credits. You can manage this in ChatGPT settings.'),
            el('div', 'dialog-actions', manageChatGptUsage(),
              button('Got it', null, () => panel.close(), 'accent-button')));
        });
      }
      await show(result);
    } catch (error) {
      for (const action of actions.querySelectorAll('button')) action.disabled = false;
      message.textContent = errorText(error);
    }
  }

  async function logout() {
    let warning;
    try {
      await invoke('chatgpt_logout');
      localStorage.removeItem(CHATGPT_MODEL);
    } catch (error) {
      warning = errorText(error);
    }
    await check();
    if (warning) message.textContent = warning;
  }

  async function show({ state: connection, email }, loadModels = true) {
    const connected = connection === 'connected';
    const needsConsent = connection === 'plan-disabled';
    state.textContent = connected ? `Signed in · ${email || 'ChatGPT account'}`
      : needsConsent ? `Plan usage is off · ${email || 'ChatGPT account'}`
        : email ? `Signed out · ${email}` : 'Signed out';
    modelField.hidden = !connected;
    models.disabled = true;
    reasoningField.hidden = true;
    message.textContent = needsConsent ? 'Enable plan usage to use this provider.' : '';
    const loginButton = button(needsConsent ? 'Enable plan usage' : 'Continue with ChatGPT',
      null, () => login(), 'chatgpt-login-button');
    loginButton.setAttribute('data-oai-siwc-button', '');
    actions.replaceChildren(...[
      connected ? null : loginButton,
      connected || needsConsent ? button('Sign out', 'log-out', logout) : null,
      connection === 'signed-out' ? button('Use another account', null, () => login(true)) : null,
      connected || needsConsent ? manageChatGptUsage() : null,
    ].filter(Boolean));
    if (!connected || !loadModels) return;
    message.textContent = 'Loading ChatGPT models…';
    const placeholder = el('option', '', 'Choose a model');
    placeholder.value = '';
    models.replaceChildren(placeholder);
    try {
      const catalog = await invoke('chatgpt_models');
      if (modelField.hidden) return;
      for (const { slug, display_name } of catalog) {
        const option = el('option', '', display_name);
        option.value = slug;
        models.append(option);
      }
      models.value = catalog.some(({ slug }) => slug === localStorage.getItem(CHATGPT_MODEL))
        ? localStorage.getItem(CHATGPT_MODEL) : '';
      if (!models.value) localStorage.removeItem(CHATGPT_MODEL);
      models.disabled = !catalog.length;
      showReasoning();
      message.textContent = catalog.length ? '' : 'No models are available to this account.';
    } catch (error) {
      await show(await invoke('chatgpt_status'), false);
      message.textContent = errorText(error);
      if (!modelField.hidden) actions.append(button('Retry model list', 'refresh-cw', check));
    }
  }

  async function check() {
    try {
      await show(await invoke('chatgpt_status'));
    } catch (error) {
      message.textContent = errorText(error);
    }
  }

  section.addEventListener('toggle', function checkOnOpen() {
    if (!section.open) return;
    section.removeEventListener('toggle', checkOnOpen);
    void check();
  });
  return section;
}

function aiSettings() {
  const provider = el('select', '', el('option', '', 'Ollama'), el('option', '', 'ChatGPT'));
  provider.options[0].value = 'ollama';
  provider.options[1].value = 'chatgpt';
  provider.value = localStorage.getItem(PROVIDER) === 'chatgpt' ? 'chatgpt' : 'ollama';
  const ollama = ollamaSettings();
  const chatgpt = chatGptSettings();
  chatgpt.open = provider.value === 'chatgpt';
  provider.addEventListener('change', () => {
    localStorage.setItem(PROVIDER, provider.value);
    (provider.value === 'chatgpt' ? chatgpt : ollama).open = true;
  });
  return [
    el('label', 'field settings-field settings-provider', 'AI provider', provider),
    ollama, chatgpt,
  ];
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
  const section = el('details', 'settings-section provider-settings ollama-settings',
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
    content.replaceChildren(...(section === 'ai' ? aiSettings() : [
      el('section', 'settings-section',
        el('h3', '', 'Library'),
        el('p', 'muted', 'Book storage'),
        el('code', 'settings-path', library.basePath ? library.basePath + '/Buches' : 'Library unavailable'))]));
  }
  categories.append(...tabs.map(([, tab]) => tab));
  panel.append(categories, content);
  select(initial);
  return panel;
}
