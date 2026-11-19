/**
 * Shared contracts for the Bücher extension system.
 *
 * Every extension is a plain object satisfying {@link BucherExtension}. The host
 * validates payloads with the extension's zod schema before mounting, persists
 * state through `onSaveState`, and records exercise completion via `onComplete`.
 *
 * @module extensions/types
 */

/**
 * @typedef {'visualization' | 'exercise' | 'hybrid'} ExtensionCategory
 */

/**
 * AI authoring skill exposed to the book-generation pipeline.
 *
 * @typedef {Object} ExtensionSkill
 * @property {string} instructions
 *   System-prompt rules teaching the book-creator AI when and how to use the block.
 * @property {string} syntaxSpec
 *   Human-readable description of the exact fence + YAML structure the AI must emit.
 * @property {Array<{ title: string, yaml: string }>} fewShotExamples
 *   One or two concrete, valid payloads (YAML body of the fence, without the fence itself).
 */

/**
 * Result of validating a raw block payload.
 *
 * @typedef {{ ok: true, data: unknown } | { ok: false, issues: ValidationIssue[] }} ValidationResult
 */

/**
 * @typedef {Object} ValidationIssue
 * @property {string} path   Dot-joined field path ('' for the root).
 * @property {string} message
 */

/**
 * Props handed to every extension mount. `data` is already validated against the
 * extension schema; cast it to the schema's inferred type inside the extension.
 *
 * @typedef {Object} MountProps
 * @property {unknown} data
 * @property {Record<string, unknown> | null} savedState
 *   Previously persisted state for this block, or null when none exists.
 * @property {(state: Record<string, unknown> | null) => void} onSaveState
 *   Persist state (debounced by the host). Pass null to clear it (Reset State).
 * @property {() => void} onComplete
 *   Mark the owning book exercise solved. No-op for blocks without an exercise target.
 * @property {(error: unknown) => void} onError
 *   Report an async failure; the host replaces the block with the error fallback.
 * @property {'dark' | 'light'} theme
 * @property {boolean} readOnly
 *   True in reference panes, previews, and dialogs: interact locally, never persist.
 * @property {(source: string) => HTMLElement} renderMarkdown
 *   Host Markdown renderer (KaTeX, wiki links) for author-supplied prose.
 */

/**
 * Handle returned by a mount. `destroy` must release editors, workers, timers,
 * and listeners; the host calls it whenever the block leaves the DOM.
 *
 * @typedef {Object} MountedExtension
 * @property {() => void} destroy
 */

/**
 * The extension contract (manifest-shaped so third-party bundles can register).
 *
 * @typedef {Object} BucherExtension
 * @property {string} id                 Unique 'ext-…' id; also the Markdown fence info string.
 * @property {string} name
 * @property {string} version
 * @property {string} description
 * @property {ExtensionCategory} category
 * @property {string} icon               Lucide icon name.
 * @property {ExtensionSkill} skill
 * @property {import('./dependencies.js').ExtensionDependencyManifest} dependencies
 * @property {import('zod').ZodType} schema
 * @property {(data: unknown) => ValidationResult} validate
 * @property {(host: HTMLElement, props: MountProps) => MountedExtension} mount
 */

export {};
