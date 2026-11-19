/**
 * Tauri capability bridge. Health-checks declared native dependencies over
 * IPC and applies graceful fallbacks when running outside the desktop shell.
 *
 * @module extensions/capability
 */
import { invoke } from '@tauri-apps/api/core';

/**
 * @typedef {import('./dependencies.js').TauriDependency} TauriDependency
 * @typedef {import('./registry.js').ExtensionRegistry} ExtensionRegistry
 */

/**
 * @typedef {Object} CapabilityStatus
 * @property {string} name
 * @property {string} kind
 * @property {boolean} available
 * @property {string} detail
 */

/** Whether the app runs inside the Tauri desktop shell. */
export function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Health-check one declared native dependency. Never throws: outside Tauri,
 * or when the command itself is missing, the result is an unavailable status
 * that extensions map to their declared fallbackBehavior.
 *
 * @param {TauriDependency} dependency
 * @returns {Promise<CapabilityStatus>}
 */
export async function checkTauriCapability(dependency) {
  if (!isTauri()) {
    return {
      name: dependency.name,
      kind: dependency.type,
      available: false,
      detail: 'Not running inside the Tauri desktop shell.',
    };
  }
  try {
    return /** @type {CapabilityStatus} */ (await invoke('check_capability', { name: dependency.name }));
  } catch (error) {
    return {
      name: dependency.name,
      kind: dependency.type,
      available: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Audit every native dependency declared by registered extensions and store
 * the results on the registry (the manager and frames read them from there).
 *
 * @param {ExtensionRegistry} registry
 * @returns {Promise<Map<string, CapabilityStatus>>}
 */
export async function auditCapabilities(registry) {
  const declarations = registry.tauriDependencies();
  const statuses = await Promise.all(declarations.map(async declaration => {
    const status = await checkTauriCapability(declaration);
    return /** @type {const} */ ([declaration.type + ':' + declaration.name, status]);
  }));
  for (const [key, status] of statuses) registry.setCapabilityStatus(key, status);
  return new Map(statuses);
}
