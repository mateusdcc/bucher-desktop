/**
 * Extension registry: registration, enablement, and change notification.
 *
 * Enablement persists in localStorage so the Extension Manager, the renderer,
 * and the AI skill composer all observe the same set of active extensions.
 *
 * @module extensions/registry
 */
import { manifestProblem } from './dependencies.js';

/**
 * @typedef {import('./types').BucherExtension} BucherExtension
 * @typedef {import('./types').ExtensionCategory} ExtensionCategory
 * @typedef {import('./dependencies.js').WebPackageDependency} WebPackageDependency
 * @typedef {import('./dependencies.js').TauriDependency} TauriDependency
 */

const STORAGE_KEY = 'bucher/extensions-disabled';
const CATEGORIES = new Set(['visualization', 'exercise', 'hybrid']);

/**
 * @typedef {Object} RegistryStorage
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 */

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function disabledList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((/** @type {unknown} */ id) => typeof id === 'string');
}

export class ExtensionRegistry {
  /** @param {{ storage?: RegistryStorage | null }} [options] */
  constructor(options = {}) {
    /** @type {Map<string, BucherExtension>} */
    this.extensions = new Map();
    /** @type {Set<(registry: ExtensionRegistry) => void>} */
    this.listeners = new Set();
    this.storage = options.storage === undefined
      ? (typeof localStorage === 'undefined' ? null : localStorage)
      : options.storage;
    /** @type {Set<string>} */
    this.disabled = new Set();
    /** @type {Map<string, import('./capability.js').CapabilityStatus>} */
    this.capabilityStatuses = new Map();
    if (this.storage) {
      try {
        this.disabled = new Set(disabledList(JSON.parse(this.storage.getItem(STORAGE_KEY) ?? '[]')));
      } catch {
        this.disabled = new Set();
      }
    }
  }

  /**
   * Register an extension, enforcing the contract up front so a broken plugin
   * fails loudly at startup instead of mid-render.
   *
   * @param {BucherExtension} extension
   */
  register(extension) {
    const problem = contractProblem(extension);
    if (problem) throw new Error(`Invalid extension${extension?.id ? ` ${extension.id}` : ''}: ${problem}`);
    if (this.extensions.has(extension.id)) throw new Error(`Extension ${extension.id} is already registered.`);
    this.extensions.set(extension.id, extension);
    this.notify();
    return extension;
  }

  /**
   * @param {string} id
   * @returns {BucherExtension | undefined}
   */
  get(id) {
    return this.extensions.get(id);
  }

  /** @returns {BucherExtension[]} */
  list() {
    return [...this.extensions.values()];
  }

  /** @param {string} id */
  isEnabled(id) {
    return this.extensions.has(id) && !this.disabled.has(id);
  }

  /** @returns {BucherExtension[]} */
  enabled() {
    return this.list().filter(extension => this.isEnabled(extension.id));
  }

  /**
   * @param {string} id
   * @returns {boolean} whether the extension is an exercise (or hybrid)
   */
  isExercise(id) {
    const category = this.extensions.get(id)?.category;
    return category === 'exercise' || category === 'hybrid';
  }

  /**
   * @param {string} id
   * @param {boolean} on
   */
  setEnabled(id, on) {
    if (!this.extensions.has(id)) return;
    if (on) this.disabled.delete(id);
    else this.disabled.add(id);
    if (this.storage) {
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify([...this.disabled]));
      } catch {
        // Storage may be unavailable (private mode); enablement stays in memory.
      }
    }
    this.notify();
  }

  /**
   * @param {(registry: ExtensionRegistry) => void} listener
   * @returns {() => void} unsubscribe
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Aggregate declared web packages across registered extensions, deduplicated
   * by name with the list of extensions using each package.
   *
   * @returns {Array<WebPackageDependency & { usedBy: string[] }>}
   */
  webPackages() {
    /** @type {Map<string, WebPackageDependency & { usedBy: string[] }>} */
    const merged = new Map();
    for (const extension of this.extensions.values()) {
      for (const dep of extension.dependencies.webPackages) {
        const existing = merged.get(dep.name);
        if (existing) existing.usedBy.push(extension.id);
        else merged.set(dep.name, { ...dep, usedBy: [extension.id] });
      }
    }
    return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Store a capability health-check result (key = `type:name`).
   *
   * @param {string} key
   * @param {import('./capability.js').CapabilityStatus} status
   */
  setCapabilityStatus(key, status) {
    this.capabilityStatuses.set(key, status);
  }

  /**
   * @param {TauriDependency} dependency
   * @returns {import('./capability.js').CapabilityStatus | null} null until audited
   */
  capabilityFor(dependency) {
    return this.capabilityStatuses.get(dependency.type + ':' + dependency.name) ?? null;
  }

  /**
   * Aggregate declared native Tauri dependencies across registered extensions.
   *
   * @returns {Array<TauriDependency & { usedBy: string[] }>}
   */
  tauriDependencies() {
    /** @type {Map<string, TauriDependency & { usedBy: string[] }>} */
    const merged = new Map();
    for (const extension of this.extensions.values()) {
      for (const dep of extension.dependencies.tauriDependencies ?? []) {
        const key = dep.type + ':' + dep.name;
        const existing = merged.get(key);
        if (existing) existing.usedBy.push(extension.id);
        else merged.set(key, { ...dep, usedBy: [extension.id] });
      }
    }
    return [...merged.values()];
  }

  notify() {
    for (const listener of [...this.listeners]) listener(this);
  }
}

/**
 * @param {BucherExtension} extension
 * @returns {string | null} a contract violation, or null when valid
 */
function contractProblem(extension) {
  if (!extension || typeof extension !== 'object') return 'expected an object.';
  if (typeof extension.id !== 'string' || !/^ext-[a-z0-9][a-z0-9-]*$/.test(extension.id)) {
    return 'id must look like "ext-name" (lowercase letters, digits, dashes).';
  }
  for (const field of /** @type {const} */ (['name', 'version', 'description', 'icon'])) {
    if (typeof extension[field] !== 'string' || !extension[field].trim()) return `${field} must be a non-empty string.`;
  }
  if (!CATEGORIES.has(extension.category)) return 'category must be visualization, exercise, or hybrid.';
  const skill = extension.skill;
  if (!skill || typeof skill.instructions !== 'string' || !skill.instructions.trim()) return 'skill.instructions is required.';
  if (typeof skill.syntaxSpec !== 'string' || !skill.syntaxSpec.trim()) return 'skill.syntaxSpec is required.';
  if (!Array.isArray(skill.fewShotExamples) || !skill.fewShotExamples.length
    || skill.fewShotExamples.some(example => !example || typeof example.title !== 'string' || typeof example.yaml !== 'string' || !example.yaml.trim())) {
    return 'skill.fewShotExamples needs at least one { title, yaml } example.';
  }
  const manifestIssue = manifestProblem(extension.dependencies);
  if (manifestIssue) return 'dependencies: ' + manifestIssue;
  if (!extension.schema || typeof extension.schema.safeParse !== 'function') return 'schema must be a zod schema.';
  if (typeof extension.validate !== 'function') return 'validate must be a function.';
  if (typeof extension.mount !== 'function') return 'mount must be a function.';
  return null;
}

/** App-wide singleton. */
export const registry = new ExtensionRegistry();
