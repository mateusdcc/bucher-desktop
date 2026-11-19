// @ts-nocheck — legacy DOM helpers; extension code is typechecked against these via JSDoc.
import { createElement, icons } from 'lucide';

export function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.flat().filter(child => child !== undefined && child !== null));
  return node;
}

export function icon(name, source = false) {
  const key = name.replace(/^lucide:/i, '').split('-').map(part => part[0]?.toUpperCase() + part.slice(1)).join('');
  const definition = Object.hasOwn(icons, key) && icons[key];
  if (definition) return createElement(definition, { 'aria-hidden': 'true', 'stroke-width': 1.7 });
  if (source && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(name)) return el('span', 'emoji-icon', name);
  return createElement(icons.FileText, { 'aria-hidden': 'true', 'stroke-width': 1.7 });
}

let noticeTimer;
export function notice(message, error = false) {
  const node = document.getElementById('notice');
  node.classList.toggle('error', error);
  node.textContent = message;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { node.textContent = ''; }, error ? 9000 : 4600);
}

export function report(error) {
  notice(error?.message || String(error), true);
}

export function button(label, glyph, action, className = '') {
  const node = el('button', className, glyph ? icon(glyph) : null, label);
  node.type = 'button';
  if (action) node.addEventListener('click', async event => {
    try {
      const pending = action(event);
      if (!pending?.then) return;
      node.disabled = true;
      await pending;
    } catch (error) {
      report(error);
    } finally {
      node.disabled = false;
    }
  });
  return node;
}

export function iconButton(label, glyph, action) {
  const node = button('', glyph, action, 'icon-button');
  node.title = label;
  node.setAttribute('aria-label', label);
  return node;
}

export function dialog(title, populate) {
  const panel = el('dialog', 'dialog');
  const titleId = 'dialog-' + crypto.randomUUID();
  const heading = el('h2', '', title);
  heading.id = titleId;
  panel.setAttribute('aria-labelledby', titleId);
  panel.append(el('div', 'dialog-heading', heading, iconButton('Close', 'x', () => panel.close())));
  populate(panel);
  panel.addEventListener('close', () => panel.remove(), { once: true });
  document.body.append(panel);
  panel.showModal();
  return panel;
}

export function editor(title, initial, save) {
  return dialog(title, panel => {
    panel.classList.add('editor');
    const textarea = el('textarea', 'source-editor');
    textarea.value = initial;
    textarea.spellcheck = false;
    textarea.setAttribute('aria-label', 'Markdown source');
    textarea.autofocus = true;
    const submit = button('Save changes', 'check', async () => {
      textarea.readOnly = true;
      try {
        await save(textarea.value);
        panel.close();
      } finally {
        textarea.readOnly = false;
      }
    }, 'accent-button');
    textarea.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        submit.click();
      }
    });
    panel.addEventListener('cancel', event => {
      if (textarea.readOnly || (textarea.value !== initial && !confirm('Discard unsaved changes?'))) event.preventDefault();
    });
    panel.querySelector('.icon-button').hidden = true;
    panel.append(textarea, el('div', 'dialog-actions',
      button('Cancel', '', () => {
        if (!textarea.readOnly && (textarea.value === initial || confirm('Discard unsaved changes?'))) panel.close();
      }), submit));
  });
}

export function formDialog(title, fields, submitLabel, save) {
  return dialog(title, panel => {
    const form = el('form', 'form');
    for (const field of fields) {
      const input = el(field.multiline ? 'textarea' : 'input');
      input.name = field.name;
      input.required = Boolean(field.required);
      input.value = field.value ?? '';
      input.maxLength = field.maxLength ?? 120;
      if (field.placeholder) input.placeholder = field.placeholder;
      form.append(el('label', 'field', field.label, input));
    }
    const submit = button(submitLabel, '', null, 'accent-button');
    submit.type = 'submit';
    form.append(el('div', 'dialog-actions', button('Cancel', '', () => panel.close()), submit));
    form.addEventListener('submit', async event => {
      event.preventDefault();
      submit.disabled = true;
      try {
        await save(Object.fromEntries(new FormData(form)));
        panel.close();
      } catch (error) {
        report(error);
      } finally {
        submit.disabled = false;
      }
    });
    panel.append(form);
  });
}
