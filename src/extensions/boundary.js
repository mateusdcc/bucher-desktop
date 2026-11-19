/**
 * Error boundary and fallback UI for extension blocks. Malformed payloads,
 * mount failures, and async errors render an informative card instead of
 * breaking the reading flow.
 *
 * @module extensions/boundary
 */
import { button, dialog, el, icon } from '../ui';

/**
 * @typedef {import('./types').BucherExtension} BucherExtension
 * @typedef {import('./types').MountProps} MountProps
 * @typedef {import('./types').MountedExtension} MountedExtension
 * @typedef {import('./types').ValidationIssue} ValidationIssue
 */

/**
 * @param {string} source raw YAML payload
 * @param {Record<string, unknown> | null} [state] current saved state
 */
export function showSource(source, state = null) {
  dialog('Extension source', /** @param {HTMLElement} panel */ panel => {
    panel.classList.add('extension-source-dialog');
    panel.append(
      el('p', 'muted', 'The block payload exactly as written in the book.'),
      el('pre', 'extension-source', source));
    if (state) {
      panel.append(el('h3', '', 'Saved state'),
        el('pre', 'extension-source', JSON.stringify(state, null, 2)));
    }
  });
}

/**
 * @param {BucherExtension | null} extension
 * @param {string} heading
 * @param {Node[]} body
 * @param {string} source
 * @returns {HTMLElement}
 */
function fallbackCard(extension, heading, body, source) {
  const card = el('section', 'extension-fallback',
    el('div', 'extension-fallback-heading',
      icon(extension?.icon || 'puzzle'),
      el('strong', '', extension ? `${extension.name} — ${heading}` : heading)),
    ...body,
    el('details', 'extension-fallback-source',
      el('summary', '', 'View source'),
      el('pre', 'extension-source', source)));
  return card;
}

/**
 * Graceful fallback for payloads that fail schema validation.
 *
 * @param {HTMLElement} host
 * @param {Object} options
 * @param {BucherExtension | null} options.extension
 * @param {ValidationIssue[]} options.issues
 * @param {string} options.source
 */
export function renderValidationFallback(host, { extension, issues, source }) {
  const list = el('ul', 'extension-issues',
    ...issues.slice(0, 8).map(issue => el('li', '',
      el('code', '', issue.path || '(root)'), ' ', issue.message)));
  host.replaceChildren(fallbackCard(extension, 'invalid block data', [
    el('p', 'muted', 'This block does not match the extension schema, so it was not rendered. Fix the YAML payload in the chapter.'),
    list,
  ], source));
}

/**
 * Fallback for mount/runtime failures, with a retry action.
 *
 * @param {HTMLElement} host
 * @param {Object} options
 * @param {BucherExtension | null} options.extension
 * @param {unknown} options.error
 * @param {string} options.source
 * @param {() => void} options.onRetry
 */
export function renderErrorFallback(host, { extension, error, source, onRetry }) {
  const message = error instanceof Error ? error.message : String(error);
  host.replaceChildren(fallbackCard(extension, 'could not render', [
    el('p', 'extension-error-message', message),
    el('div', 'extension-fallback-actions', button('Retry', 'refresh-cw', onRetry)),
  ], source));
}

/**
 * Inert card shown when an extension is disabled in the Extension Manager.
 *
 * @param {HTMLElement} host
 * @param {Object} options
 * @param {BucherExtension} options.extension
 * @param {() => void} options.onEnable
 */
export function renderDisabledCard(host, { extension, onEnable }) {
  host.replaceChildren(el('section', 'extension-fallback extension-disabled-card',
    el('div', 'extension-fallback-heading', icon(extension.icon), el('strong', '', extension.name)),
    el('p', 'muted', 'This extension is turned off. Its blocks stay inert and its AI skill is not injected into book generation.'),
    el('div', 'extension-fallback-actions', button('Enable extension', 'power', onEnable))));
}

/**
 * Mount an extension behind the error boundary. Synchronous mount failures are
 * caught here; extensions report async failures through `props.onError`.
 *
 * @param {BucherExtension} extension
 * @param {HTMLElement} host
 * @param {MountProps} props
 * @returns {MountedExtension}
 */
export function mountGuarded(extension, host, props) {
  try {
    const mounted = extension.mount(host, props);
    return {
      destroy() {
        try {
          mounted?.destroy();
        } catch {
          // A broken destroy must not break navigation.
        }
      },
    };
  } catch (error) {
    renderErrorFallback(host, { extension, error, source: '', onRetry: () => props.onError(error) });
    return { destroy() {} };
  }
}
