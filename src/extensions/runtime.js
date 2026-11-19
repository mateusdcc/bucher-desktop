/**
 * Lazy runtime status tracker. Heavy engines (mermaid, alasql, Pyodide,
 * DuckDB, React, three, …) report cold/loading/warm/error here so the
 * Extension Manager can show live runtime health and frames can surface
 * loading state. `trackRuntime` also caches the loader promise so every
 * block shares one engine instance.
 *
 * @module extensions/runtime
 */

/**
 * @typedef {'cold' | 'loading' | 'warm' | 'error'} RuntimeState
 */

/**
 * @typedef {Object} RuntimeStatus
 * @property {string} name
 * @property {RuntimeState} state
 * @property {string} detail
 * @property {number} since  epoch ms of the last state change
 */

/** @type {Map<string, RuntimeStatus>} */
const statuses = new Map();
/** @type {Map<string, Promise<unknown>>} */
const loaders = new Map();
/** @type {Set<(status: RuntimeStatus) => void>} */
const listeners = new Set();

/**
 * @param {string} name
 * @returns {RuntimeStatus}
 */
export function runtimeStatus(name) {
  return statuses.get(name) ?? { name, state: 'cold', detail: 'Not loaded yet.', since: 0 };
}

/** @returns {RuntimeStatus[]} */
export function allRuntimes() {
  return [...statuses.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * @param {string} name
 * @param {RuntimeState} state
 * @param {string} [detail]
 */
export function setRuntimeStatus(name, state, detail = '') {
  const status = { name, state, detail, since: Date.now() };
  statuses.set(name, status);
  for (const listener of [...listeners]) listener(status);
}

/**
 * @param {(status: RuntimeStatus) => void} listener
 * @returns {() => void} unsubscribe
 */
export function subscribeRuntime(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Run (and cache) a lazy engine loader with live status reporting.
 *
 * @template T
 * @param {string} name
 * @param {() => Promise<T>} loader
 * @returns {Promise<T>}
 */
export function trackRuntime(name, loader) {
  const cached = loaders.get(name);
  if (cached) return /** @type {Promise<T>} */ (cached);
  setRuntimeStatus(name, 'loading', 'Loading runtime…');
  const promise = loader().then(
    value => {
      setRuntimeStatus(name, 'warm', 'Runtime ready.');
      return value;
    },
    error => {
      loaders.delete(name);
      setRuntimeStatus(name, 'error', error instanceof Error ? error.message : String(error));
      throw error;
    },
  );
  loaders.set(name, promise);
  return promise;
}
