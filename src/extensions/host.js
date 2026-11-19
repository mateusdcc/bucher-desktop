/**
 * Extension host runtime: hydrates Markdown placeholders into framed,
 * error-bounded extension mounts; wires debounced state persistence and
 * exercise completion; destroys mounts when their DOM leaves the document.
 *
 * @module extensions/host
 */
import { parse as parseYaml } from 'yaml';
import { button, el, icon, iconButton } from '../ui.js';
import { blockKey, payloadTitle } from './keys.js';
import {
  mountGuarded, renderDisabledCard, renderErrorFallback, renderUnknownCard, renderValidationFallback, showSource,
} from './boundary.js';

/**
 * @typedef {import('./types.js').BucherExtension} BucherExtension
 * @typedef {import('./types.js').MountedExtension} MountedExtension
 * @typedef {import('./registry.js').ExtensionRegistry} ExtensionRegistry
 */

/**
 * @typedef {Object} HostEntry
 * @property {{ path: string }} book
 * @property {unknown} model
 * @property {Record<string, { solved?: string[] }>} records
 * @property {Record<string, Record<string, unknown> | null>} extStates
 */

/**
 * Everything the host needs to mount the placeholders inside one rendered
 * Markdown body. Built by the app for each reader unit; previews and dialogs
 * pass null entry/chapter, which forces read-only ephemeral mounts.
 *
 * @typedef {Object} HostContext
 * @property {ExtensionRegistry} registry
 * @property {HostEntry | null} entry
 * @property {{ path: string } | null} chapter
 * @property {string | null} nodeId      Owning exercise node id or block anchor.
 * @property {number} unitIndex
 * @property {boolean} readOnly
 * @property {(source: string) => HTMLElement} renderMarkdown
 * @property {(key: string, state: Record<string, unknown> | null) => void} persist
 * @property {(nodeId: string) => void} complete
 */

/** @type {Map<Element, { destroy: () => void }>} */
const active = new Map();
/** Collapse chrome is session UI state, keyed by block identity. */
const collapsed = new Set();
let observing = false;

function ensureObserver() {
  if (observing || typeof document === 'undefined') return;
  observing = true;
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.removedNodes) {
        if (node instanceof Element) destroyWithin(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * @param {Element} node
 */
function destroyWithin(node) {
  if (node.classList.contains('bucher-extension')) destroyMount(node);
  for (const child of node.querySelectorAll('.bucher-extension')) destroyMount(child);
}

/**
 * @param {Element} placeholder
 */
function destroyMount(placeholder) {
  const handle = active.get(placeholder);
  if (!handle) return;
  active.delete(placeholder);
  handle.destroy();
}

/**
 * Mount every extension placeholder in a freshly rendered Markdown body.
 *
 * @param {HTMLElement} body
 * @param {HostContext} ctx
 */
export function hydrateExtensions(body, ctx) {
  ensureObserver();
  /** @type {Map<string, number>} */
  const occurrences = new Map();
  for (const placeholder of body.querySelectorAll('.bucher-extension')) {
    const id = placeholder.getAttribute('data-extension') ?? '';
    const occurrence = occurrences.get(id) ?? 0;
    occurrences.set(id, occurrence + 1);
    mountBlock(/** @type {HTMLElement} */ (placeholder), ctx, id, occurrence);
  }
}

/**
 * @param {HTMLElement} placeholder
 * @param {HostContext} ctx
 * @param {string} id
 * @param {number} occurrence
 */
function mountBlock(placeholder, ctx, id, occurrence) {
  destroyMount(placeholder);
  const source = placeholder.getAttribute('data-source') ?? '';
  const extension = ctx.registry.get(id);
  if (!extension) {
    renderUnknownCard(placeholder, id, source);
    return;
  }
  if (!ctx.registry.isEnabled(id)) {
    renderDisabledCard(placeholder, { extension, onEnable: () => ctx.registry.setEnabled(id, true) });
    return;
  }
  /** @type {unknown} */
  let payload;
  try {
    payload = parseYaml(source);
  } catch (error) {
    renderValidationFallback(placeholder, {
      extension,
      issues: [{ path: '', message: 'Invalid YAML: ' + (error instanceof Error ? error.message : String(error)) }],
      source,
    });
    return;
  }
  const validation = extension.validate(payload);
  if (!validation.ok) {
    renderValidationFallback(placeholder, { extension, issues: validation.issues, source });
    return;
  }
  /** @type {BucherExtension} */
  const ext = extension;
  const data = validation.data;
  const key = blockKey(payload, { nodeId: ctx.nodeId ?? undefined, unitIndex: ctx.unitIndex, occurrence }, id);
  const relative = ctx.entry && ctx.chapter ? ctx.chapter.path.slice(ctx.entry.book.path.length + 1) : null;
  const stateKey = relative !== null ? relative + '#' + key : null;
  const title = payloadTitle(payload);
  const isExercise = extension.category !== 'visualization';
  const frameKey = stateKey ?? `${id}:${occurrence}`;

  /** @type {Record<string, unknown> | null} */
  let currentSaved = stateKey && ctx.entry ? ctx.entry.extStates[stateKey] ?? null : null;
  /** @type {MountedExtension | null} */
  let handle = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let timer = null;
  /** @type {Record<string, unknown> | null | undefined} */
  let pending;

  const frame = el('section', `extension-frame category-${extension.category}`);
  frame.dataset.extension = id;
  frame.dataset.blockKey = key;
  const bodyHost = el('div', 'extension-frame-body');
  const badge = isExercise ? el('span', 'extension-badge') : null;

  function solvedInBook() {
    if (!stateKey || !ctx.entry || !ctx.chapter || !ctx.nodeId) return false;
    const row = ctx.entry.records[ctx.chapter.path.slice(ctx.entry.book.path.length + 1)];
    return Array.isArray(row?.solved) && row.solved.includes(ctx.nodeId);
  }

  function updateBadge() {
    if (!badge) return;
    // Block state wins; the book's solved list is the fallback for blocks
    // without saved state (e.g. marked solved by hand).
    const status = currentSaved?.status === 'passed' ? 'Passed'
      : currentSaved ? (currentSaved.status === 'in-progress' ? 'In Progress' : 'Unsolved')
        : solvedInBook() ? 'Passed' : 'Unsolved';
    badge.textContent = status;
    badge.dataset.status = status.toLowerCase().replace(' ', '-');
    frame.dataset.status = badge.dataset.status;
  }

  function flush() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending !== undefined && stateKey && !ctx.readOnly) {
      const state = pending;
      pending = undefined;
      ctx.persist(key, state);
    }
  }

  /** @param {Record<string, unknown> | null} state */
  function save(state) {
    currentSaved = state;
    if (stateKey && ctx.entry) {
      if (state === null) delete ctx.entry.extStates[stateKey];
      else ctx.entry.extStates[stateKey] = state;
    }
    updateBadge();
    if (ctx.readOnly || !stateKey) return;
    pending = state;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, 400);
  }

  function doMount() {
    handle?.destroy();
    bodyHost.replaceChildren();
    handle = mountGuarded(ext, bodyHost, {
      data,
      savedState: currentSaved,
      onSaveState: save,
      onComplete() {
        flush();
        updateBadge();
        if (!ctx.readOnly && ctx.nodeId && ctx.entry && ctx.chapter) ctx.complete(ctx.nodeId);
      },
      onError(error) {
        renderErrorFallback(bodyHost, { extension: ext, error, source, onRetry: doMount });
      },
      theme: 'dark',
      readOnly: ctx.readOnly,
      renderMarkdown: ctx.renderMarkdown,
    });
  }

  const collapse = button('', null, () => {
    const open = bodyHost.hidden;
    bodyHost.hidden = !open;
    if (open) collapsed.delete(frameKey);
    else collapsed.add(frameKey);
    collapse.setAttribute('aria-expanded', String(open));
    collapse.replaceChild(icon(open ? 'chevron-down' : 'chevron-right'), collapse.firstChild);
  }, 'extension-collapse');
  collapse.setAttribute('aria-expanded', String(!collapsed.has(frameKey)));
  collapse.append(icon(collapsed.has(frameKey) ? 'chevron-right' : 'chevron-down'),
    icon(extension.icon), el('span', 'extension-name', extension.name),
    title ? el('span', 'extension-title', title) : null);
  const tools = el('div', 'extension-frame-tools',
    iconButton('Reset state', 'rotate-ccw', () => {
      flush();
      save(null);
      doMount();
    }),
    iconButton('View source and data', 'braces', () => showSource(source, currentSaved)));
  const header = el('header', 'extension-frame-header', collapse, badge, tools);
  bodyHost.hidden = collapsed.has(frameKey);
  frame.append(header, bodyHost);
  placeholder.replaceChildren(frame);
  active.set(placeholder, {
    destroy() {
      flush();
      handle?.destroy();
      handle = null;
    },
  });
  updateBadge();
  doMount();
}
