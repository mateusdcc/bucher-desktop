/**
 * Dynamic AI skill composer. Aggregates the `skill` definitions of all
 * *enabled* extensions into one prompt section that the book-generation
 * pipeline injects into the model's system context. Toggling an extension in
 * the manager changes the very next generation.
 *
 * @module extensions/skills
 */
import { parse as parseYaml } from 'yaml';
import { registry as defaultRegistry } from './registry.js';
import { isExtensionInfo } from './keys.js';
import { jsonSchemaFor } from './validate.js';

/**
 * @typedef {import('./registry').ExtensionRegistry} ExtensionRegistry
 * @typedef {import('./types').BucherExtension} BucherExtension
 * @typedef {Object} ComposeSkillOptions
 * @property {Iterable<string> | null} [extensionIds] Explicit subset of extension ids to expose (overrides global enabled list when provided).
 * @property {boolean} [importMode] Emphasize active conversion of textbook exercises/visuals into the selected extension blocks.
 */

const PREAMBLE = `## Interactive extension blocks
This book supports interactive extension blocks authored as fenced code blocks. The fence info string is the extension id and the fence body is a YAML payload. Rules:
- Use a block only when it teaches better than prose (visualize a process, plot a function, run code, order a proof, query data).
- Use ONLY the extension ids listed below. Never invent ids or fields.
- Always set a stable \`id:\` field (letters, digits, dashes, dots) so learner progress survives later edits. Add a short \`title:\` when useful.
- Emit valid YAML. Use block scalars (|) for multiline code, diagrams, or SQL. Do not wrap the YAML in JSON.
- Follow each extension's schema exactly; malformed blocks render as error cards in the reader.
- Exercise blocks are auto-graded: learners solve them in the reader and passing marks the exercise solved. Place them in chapters, not the introduction.`;

const IMPORT_DIRECTIVE = `- The reader explicitly selected the extensions below for this book import. Actively convert matching textbook exercises, coding tasks, SQL queries, mathematical plots, proofs, and diagrams from the source into these interactive extension blocks instead of leaving them as static code blocks or plain text exercises.`;

/**
 * Resolve the list of extensions to include in a skill composition.
 *
 * @param {ExtensionRegistry} registry
 * @param {Iterable<string> | null | undefined} extensionIds
 * @returns {BucherExtension[]}
 */
function selectExtensions(registry, extensionIds) {
  if (extensionIds == null) return registry.enabled();
  const wanted = new Set(extensionIds);
  if (!wanted.size) return [];
  return registry.list().filter(extension => wanted.has(extension.id));
}

/**
 * Compose the skill section for the enabled (or explicitly selected) extensions
 * of a registry. Returns '' when nothing is selected (callers omit the argument).
 *
 * @param {ExtensionRegistry} [registry]
 * @param {ComposeSkillOptions} [options]
 * @returns {string}
 */
export function composeSkills(registry = defaultRegistry, options = {}) {
  const active = selectExtensions(registry, options.extensionIds);
  if (!active.length) return '';
  const sections = active.map(extension => {
    const parts = [
      `### ${extension.name} (\`${extension.id}\`, ${extension.category})`,
      extension.skill.instructions.trim(),
      'Syntax:',
      extension.skill.syntaxSpec.trim(),
    ];
    const jsonSchema = jsonSchemaFor(extension.schema);
    if (jsonSchema) {
      parts.push('Payload JSON Schema:', '```json', JSON.stringify(jsonSchema), '```');
    }
    for (const example of extension.skill.fewShotExamples.slice(0, 2)) {
      parts.push(`Example — ${example.title}:`, '```' + extension.id, example.yaml.trim(), '```');
    }
    return parts.join('\n');
  });
  const header = options.importMode ? `${PREAMBLE}\n${IMPORT_DIRECTIVE}` : PREAMBLE;
  return [header, ...sections].join('\n\n');
}

/**
 * Invoke arguments carrying the composed skills, or an empty object when no
 * extension is selected. Spread into authoring command payloads.
 *
 * @param {ExtensionRegistry} [registry]
 * @param {ComposeSkillOptions} [options]
 * @returns {{ skills?: string }}
 */
export function skillArgs(registry = defaultRegistry, options = {}) {
  const skills = composeSkills(registry, options);
  return skills ? { skills } : {};
}

/**
 * @typedef {Object} ExtensionBlockReport
 * @property {string} extensionId
 * @property {string} title
 * @property {boolean} ok
 * @property {string[]} issues
 */

/**
 * Scan Markdown (including callout-quoted blocks) for `ext-*` fenced code
 * blocks and validate each payload against its registered extension schema.
 *
 * @param {string} markdown
 * @param {ExtensionRegistry} [registry]
 * @returns {{ total: number, valid: number, invalid: ExtensionBlockReport[], blocks: ExtensionBlockReport[] }}
 */
export function validateExtensionBlocks(markdown, registry = defaultRegistry) {
  /** @type {ExtensionBlockReport[]} */
  const blocks = [];
  const lines = String(markdown || '').split(/\r?\n/);
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  let extId = '';
  /** @type {string[]} */
  let bodyLines = [];

  for (const rawLine of lines) {
    // Allow blocks embedded inside `> [!exercise]` callouts by unwrapping leading `>`.
    const line = rawLine.replace(/^(?: {0,3}> ?)+/, '');
    if (!inFence) {
      const open = /^ {0,3}(`{3,}|~{3,})([^\n]*)$/.exec(line);
      if (open) {
        const info = open[2].trim().split(/\s+/)[0] || '';
        inFence = true;
        fenceChar = open[1][0];
        fenceLen = open[1].length;
        extId = isExtensionInfo(info) ? info : '';
        bodyLines = [];
      }
      continue;
    }
    const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
    if (close && close[1][0] === fenceChar && close[1].length >= fenceLen) {
      if (extId) blocks.push(checkBlock(extId, bodyLines.join('\n'), registry));
      inFence = false;
      extId = '';
      bodyLines = [];
      continue;
    }
    if (extId) bodyLines.push(line);
  }
  if (inFence && extId) {
    blocks.push({ extensionId: extId, title: extId, ok: false, issues: ['Unclosed fenced code block.'] });
  }
  const invalid = blocks.filter(block => !block.ok);
  return { total: blocks.length, valid: blocks.length - invalid.length, invalid, blocks };
}

/**
 * @param {string} extensionId
 * @param {string} yamlText
 * @param {ExtensionRegistry} registry
 * @returns {ExtensionBlockReport}
 */
function checkBlock(extensionId, yamlText, registry) {
  const extension = registry.get(extensionId);
  if (!extension) {
    return { extensionId, title: extensionId, ok: false, issues: [`Unknown extension "${extensionId}".`] };
  }
  let parsed;
  try {
    parsed = parseYaml(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { extensionId, title: extension.name, ok: false, issues: [`YAML syntax error: ${message}`] };
  }
  const title = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && typeof parsed.title === 'string' && parsed.title.trim()
    ? parsed.title.trim()
    : extension.name;
  const result = extension.validate(parsed);
  if (result.ok) return { extensionId, title, ok: true, issues: [] };
  return {
    extensionId,
    title,
    ok: false,
    issues: result.issues.map(issue => (issue.path ? `${issue.path}: ${issue.message}` : issue.message)),
  };
}
