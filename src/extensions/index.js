/**
 * Public surface of the extension SDK. Built-in extensions register themselves
 * here as they are implemented; the registry singleton is shared by the
 * renderer, the Extension Manager, and the AI skill composer.
 *
 * @module extensions/index
 */
export { ExtensionRegistry, registry } from './registry.js';
export { createValidator, formatIssues, jsonSchemaFor, blockMeta } from './validate.js';
export { blockKey, extensionIdFromInfo, isExtensionInfo, payloadId, payloadTitle } from './keys.js';
export { mountGuarded, renderDisabledCard, renderErrorFallback, renderValidationFallback, showSource } from './boundary.js';

/**
 * @typedef {import('./types').BucherExtension} BucherExtension
 * @typedef {import('./types').ExtensionSkill} ExtensionSkill
 * @typedef {import('./types').ExtensionCategory} ExtensionCategory
 * @typedef {import('./types').MountProps} MountProps
 * @typedef {import('./types').MountedExtension} MountedExtension
 * @typedef {import('./types').ValidationResult} ValidationResult
 * @typedef {import('./types').ValidationIssue} ValidationIssue
 */
