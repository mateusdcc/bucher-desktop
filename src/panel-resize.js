import { el } from './ui.js';

/**
 * Attach a keyboard and pointer separator and restore the user's preferred panel size.
 * @param {HTMLElement} layout
 * @param {HTMLElement} panel
 * @param {{ name: string, property: string, width: number, min: number, max: number, fraction: number, edge: 'left' | 'right' | 'top' | 'bottom', storageKey?: string }} options
 */
export function panelResize(layout, panel, { name, property, width, min, max, fraction, edge, storageKey }) {
  const vertical = edge === 'top' || edge === 'bottom';
  const handle = /** @type {HTMLElement} */ (el('div', 'panel-resizer' + (vertical ? ' panel-resizer--row' : '')));
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', name);
  handle.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
  handle.setAttribute('aria-controls', panel.id);
  handle.title = name;
  const key = 'bucher/' + (storageKey ?? property);
  const saved = Number(localStorage.getItem(key));
  layout.style.setProperty('--' + property, (saved >= min && saved <= max ? saved : width) + 'px');

  const maximum = () => Math.max(1, Math.min(max, Math.floor((vertical ? layout.clientHeight : layout.clientWidth) * fraction)));
  const minimum = () => Math.min(min, maximum());
  const current = () => Math.round(vertical ? panel.getBoundingClientRect().height : panel.getBoundingClientRect().width);
  /** @param {number} value */
  function setWidth(value) {
    const next = Math.round(Math.min(maximum(), Math.max(minimum(), value)));
    layout.style.setProperty('--' + property, next + 'px');
    return next;
  }
  function sync() {
    if (!panel.offsetWidth) return;
    handle.setAttribute('aria-valuemin', String(minimum()));
    handle.setAttribute('aria-valuemax', String(maximum()));
    handle.setAttribute('aria-valuenow', String(current()));
    handle.setAttribute('aria-valuetext', current() + ' pixels');
  }
  const observer = new ResizeObserver(sync);
  observer.observe(layout);
  observer.observe(panel);

  const direction = edge === 'left' || edge === 'top' ? -1 : 1;
  /** @type {{ id: number, x: number, width: number, next: number | null } | null} */
  let drag = null;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: vertical ? event.clientY : event.clientX, width: current(), next: null };
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const delta = (vertical ? event.clientY : event.clientX) - drag.x;
    if (delta || drag.next !== null) drag.next = setWidth(drag.width + direction * delta);
  });
  handle.addEventListener('lostpointercapture', event => {
    if (drag?.id !== event.pointerId) return;
    if (drag.next !== null) localStorage.setItem(key, String(drag.next));
    drag = null;
    handle.classList.remove('dragging');
  });
  handle.addEventListener('keydown', event => {
    /** @type {Record<string, number>} */
    const steps = vertical
      ? { ArrowUp: -16 * direction, ArrowDown: 16 * direction }
      : { ArrowLeft: -16 * direction, ArrowRight: 16 * direction };
    let value;
    if (Object.hasOwn(steps, event.key)) value = current() + steps[event.key];
    else if (event.key === 'Home') value = minimum();
    else if (event.key === 'End') value = maximum();
    else return;
    event.preventDefault();
    localStorage.setItem(key, String(setWidth(value)));
  });
  panel.append(handle);
}
