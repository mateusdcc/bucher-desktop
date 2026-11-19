/**
 * Zod-backed runtime validation shared by every extension.
 *
 * @module extensions/validate
 */
import { z } from 'zod';

/**
 * @typedef {import('./types').ValidationResult} ValidationResult
 * @typedef {import('./types').ValidationIssue} ValidationIssue
 */

/**
 * Build a `validate` function from a zod schema. Malformed payloads produce
 * structured issues that the extension frame renders as a graceful fallback.
 *
 * @param {import('zod').ZodType} schema
 * @returns {(data: unknown) => ValidationResult}
 */
export function createValidator(schema) {
  return data => {
    const result = schema.safeParse(data);
    if (result.success) return { ok: true, data: result.data };
    return { ok: false, issues: formatIssues(result.error) };
  };
}

/**
 * Flatten a ZodError into displayable issues.
 *
 * @param {import('zod').ZodError} error
 * @returns {ValidationIssue[]}
 */
export function formatIssues(error) {
  return error.issues.map(issue => ({
    path: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

/**
 * Derive a JSON Schema for the AI skill prompt. Returns null when the schema
 * uses constructs zod cannot convert (the syntax spec still covers authoring).
 *
 * @param {import('zod').ZodType} schema
 * @returns {Record<string, unknown> | null}
 */
export function jsonSchemaFor(schema) {
  try {
    return /** @type {Record<string, unknown>} */ (z.toJSONSchema(schema));
  } catch {
    return null;
  }
}

/** Common payload fields every extension block may declare. */
export const blockMeta = {
  id: z.string().min(1).max(120).regex(/^[\w.-]+$/, 'Use letters, digits, dot, dash, or underscore.').optional(),
  title: z.string().min(1).max(200).optional(),
};
