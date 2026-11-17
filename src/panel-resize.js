import { el } from './ui';

/** Attach a keyboard and pointer separator and restore the user's preferred panel width. */
export function panelResize(layout, panel, { name, property, width, min, max, fraction, edge }) {
  const handle = el('div', 'panel-resizer');
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', name);
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-controls', panel.id);
  handle.title = name;
  const key = 'bucher/' + property;
  const saved = Number(localStorage.getItem(key));
  layout.style.setProperty('--' + property, (saved >= min && saved <= max ? saved : width) + 'px');

  const maximum = () => Math.max(1, Math.min(max, Math.floor(layout.clientWidth * fraction)));
  const minimum = () => Math.min(min, maximum());
  const current = () => Math.round(panel.getBoundingClientRect().width);
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

  const direction = edge === 'left' ? -1 : 1;
  let drag;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    handle.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, width: current(), next: null };
    handle.classList.add('dragging');
  });
  handle.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const delta = event.clientX - drag.x;
    if (delta || drag.next !== null) drag.next = setWidth(drag.width + direction * delta);
  });
  handle.addEventListener('lostpointercapture', event => {
    if (drag?.id !== event.pointerId) return;
    if (drag.next !== null) localStorage.setItem(key, String(drag.next));
    drag = null;
    handle.classList.remove('dragging');
  });
  handle.addEventListener('keydown', event => {
    const steps = { ArrowLeft: -16 * direction, ArrowRight: 16 * direction };
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
