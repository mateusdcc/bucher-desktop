/**
 * Shared React island runtime. The host stays vanilla; React-based extensions
 * load one cached copy of React lazily and render into a per-block root that
 * is unmounted when the block leaves the DOM.
 *
 * @module extensions/react-runtime
 */
import { trackRuntime } from './runtime.js';

/**
 * @typedef {Object} ReactRuntime
 * @property {typeof import('react')} React
 * @property {typeof import('react-dom/client')} ReactDOM
 */

/**
 * Load (and cache) React + react-dom/client as a tracked lazy runtime.
 *
 * @returns {Promise<ReactRuntime>}
 */
export function loadReact() {
  return trackRuntime('react', async () => {
    const [reactNs, reactDomNs] = await Promise.all([import('react'), import('react-dom/client')]);
    // react/react-dom re-export via `module.exports = require(...)`, so the
    // dynamic-import namespace may only expose `default`.
    const React = typeof (/** @type {Record<string, unknown>} */ (reactNs).createElement) === 'function'
      ? reactNs
      : /** @type {typeof import('react')} */ (/** @type {Record<string, unknown>} */ (reactNs).default);
    const ReactDOM = typeof (/** @type {Record<string, unknown>} */ (reactDomNs).createRoot) === 'function'
      ? reactDomNs
      : /** @type {typeof import('react-dom/client')} */ (/** @type {Record<string, unknown>} */ (reactDomNs).default);
    return { React, ReactDOM };
  });
}

/**
 * @typedef {Object} ReactMount
 * @property {() => void} destroy
 */

/**
 * Render a React component into a host element. Returns a destroy handle that
 * unmounts the root (releasing all component state, listeners, and effects).
 *
 * @param {HTMLElement} host
 * @param {import('react').ComponentType<any>} component
 * @param {Record<string, unknown>} props
 * @returns {Promise<ReactMount>}
 */
export async function mountReactComponent(host, component, props) {
  const { React, ReactDOM } = await loadReact();
  const root = ReactDOM.createRoot(host);
  root.render(React.createElement(component, props));
  return {
    destroy() {
      root.unmount();
    },
  };
}
