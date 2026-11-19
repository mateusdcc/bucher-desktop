/**
 * Stable block keys and fence parsing shared by the renderer, the learning
 * index, and the persistence layer. Keys must be derivable from the source
 * alone so a block keeps its saved state across reloads and re-renders.
 *
 * Priority: explicit payload `id` > block anchor / exercise node id >
 * positional fallback (edit-fragile; the AI skill tells authors to set `id`).
 *
 * @module extensions/keys
 */

const FENCE_INFO = /^ext-[a-z0-9][a-z0-9-]*$/;

/**
 * Whether a fence info string names an extension block.
 *
 * @param {string} info
 */
export function isExtensionInfo(info) {
  return FENCE_INFO.test(info.trim());
}

/**
 * @param {string} info
 * @returns {string} the trimmed extension id
 */
export function extensionIdFromInfo(info) {
  return info.trim();
}

/**
 * Compute the persistence key for a block within its chapter.
 *
 * @param {unknown} payload           Parsed YAML payload (may be malformed).
 * @param {Object} context
 * @param {string} [context.nodeId]   Owning exercise node id or block anchor ('^…').
 * @param {number} [context.unitIndex] Position of the unit in the chapter.
 * @param {number} [context.occurrence] Occurrence of this extension id within the unit.
 * @param {string} extensionId
 * @returns {string}
 */
export function blockKey(payload, context, extensionId) {
  const id = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? /** @type {Record<string, unknown>} */ (payload).id
    : undefined;
  if (typeof id === 'string' && id.trim()) return 'id:' + id.trim();
  if (context.nodeId) return context.nodeId;
  return `u${context.unitIndex ?? 0}:${extensionId}:${context.occurrence ?? 0}`;
}

/**
 * Read the optional `id` field without a full parse (used before validation).
 *
 * @param {unknown} payload
 * @returns {string | null}
 */
export function payloadId(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const id = /** @type {Record<string, unknown>} */ (payload).id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

/**
 * Read the optional display `title` without a full parse.
 *
 * @param {unknown} payload
 * @returns {string | null}
 */
export function payloadTitle(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const title = /** @type {Record<string, unknown>} */ (payload).title;
  return typeof title === 'string' && title.trim() ? title.trim() : null;
}
