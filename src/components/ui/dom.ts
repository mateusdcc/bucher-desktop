/**
 * Design-system DOM helpers. Typed replacements for the legacy `src/ui.js`
 * factories; every primitive builds on these. Erasable TypeScript only, so
 * Node's native type stripping can run the pure helpers in unit tests.
 *
 * @module components/ui/dom
 */
import { createElement, icons } from 'lucide';
import { ds } from './classes.ts';

export type Child = Node | string | null | undefined;

/** Create an element with a class name and flattened children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.append(...children.flat().filter((child): child is Node | string => child !== undefined && child !== null));
  return node;
}

/** Resolve a lucide glyph name (kebab-case) to an SVG; emoji fallback for book icons. */
export function icon(name: string, source = false): SVGElement | HTMLElement {
  const key = name.replace(/^lucide:/i, '').split('-').map(part => part[0]?.toUpperCase() + part.slice(1)).join('');
  const registry = icons as unknown as Record<string, Parameters<typeof createElement>[0]>;
  const definition = Object.hasOwn(registry, key) ? registry[key] : undefined;
  if (definition) return createElement(definition, { 'aria-hidden': 'true', 'stroke-width': 1.7 });
  if (source && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(name)) return el('span', 'emoji-icon', name);
  return createElement(registry.FileText, { 'aria-hidden': 'true', 'stroke-width': 1.7 });
}

/** Global async-error reporting hook; the app installs its toast reporter. */
let errorHandler: (error: unknown) => void = error => console.error(error);
export function setErrorHandler(handler: (error: unknown) => void): void {
  errorHandler = handler;
}
export function reportError(error: unknown): void {
  errorHandler(error);
}

/** Run a possibly-async click action with automatic pending-disable semantics. */
export function asyncAction(node: HTMLButtonElement, action: (event: MouseEvent) => void | Promise<void>): void {
  node.addEventListener('click', event => {
    let pending: void | Promise<void>;
    try {
      pending = action(event);
    } catch (error) {
      reportError(error);
      return;
    }
    if (!pending || typeof pending.then !== 'function') return;
    node.disabled = true;
    node.dataset.loading = 'true';
    let spin = node.querySelector(`:scope > .${ds.spinner}`);
    if (!spin) {
      spin = document.createElement('span');
      spin.className = ds.spinner;
      spin.setAttribute('aria-hidden', 'true');
      node.prepend(spin);
    }
    pending.catch(reportError).finally(() => {
      node.disabled = false;
      delete node.dataset.loading;
      spin.remove();
    });
  });
}