import { el } from './ui';
import { Button, Input, Modal } from './components/ui/index.ts';

/** Open a modal command picker. Each command supplies a label, icon, action, and optional search terms. */
export function showCommandPalette(commands) {
  const modal = Modal({ title: 'Command palette', size: 'md', className: 'command-palette' });
  const panel = modal.dialog;
  const input = Input({
    type: 'search', placeholder: 'Search commands…', ariaLabel: 'Search commands', className: 'search-input',
  }).input;
  const list = el('div', 'search-results');
  const empty = el('p', 'muted', 'No matching commands.');
  empty.setAttribute('role', 'status');
  list.id = panel.getAttribute('aria-labelledby') + '-commands';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Commands');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  let items = [];
  let selected = -1;

  function select(index) {
    items[selected]?.setAttribute('aria-selected', 'false');
    selected = index;
    const item = items[index];
    if (item) {
      item.setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', item.id);
    } else input.removeAttribute('aria-activedescendant');
  }

  function filter() {
    const terms = input.value.toLowerCase().trim().split(/\s+/);
    items = commands.filter(({ label, keywords = '' }) =>
      terms.every(term => (label + ' ' + keywords).toLowerCase().includes(term))
    ).map(({ label, glyph, run }, index) => {
      const item = Button({
        label, leftIcon: glyph, className: 'search-result',
        onClick: () => {
          modal.close();
          return run();
        },
      });
      item.id = `${list.id}-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');
      item.tabIndex = -1;
      item.addEventListener('pointermove', () => select(index));
      return item;
    });
    selected = -1;
    list.replaceChildren(...items);
    list.hidden = items.length === 0;
    empty.hidden = !list.hidden;
    input.setAttribute('aria-expanded', String(!list.hidden));
    select(items.length ? 0 : -1);
  }

  input.addEventListener('input', filter);
  input.addEventListener('keydown', event => {
    if (!items.length) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      items[selected].click();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      select((selected + direction + items.length) % items.length);
      items[selected].scrollIntoView({ block: 'nearest' });
    }
  });
  modal.body.append(input, list, empty);
  filter();
  input.focus();
  return panel;
}