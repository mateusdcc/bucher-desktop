/**
 * Dynamic AI skill composer. Aggregates the `skill` definitions of all
 * *enabled* extensions into one prompt section that the book-generation
 * pipeline injects into the model's system context. Toggling an extension in
 * the manager changes the very next generation.
 *
 * @module extensions/skills
 */
import { registry as defaultRegistry } from './registry.js';
import { jsonSchemaFor } from './validate.js';

/**
 * @typedef {import('./registry').ExtensionRegistry} ExtensionRegistry
 */

const PREAMBLE = `## Interactive extension blocks
This book supports interactive extension blocks authored as fenced code blocks. The fence info string is the extension id and the fence body is a YAML payload. Rules:
- Use a block only when it teaches better than prose (visualize a process, plot a function, run code, order a proof, query data).
- Use ONLY the extension ids listed below. Never invent ids or fields.
- Always set a stable \`id:\` field (letters, digits, dashes, dots) so learner progress survives later edits. Add a short \`title:\` when useful.
- Emit valid YAML. Use block scalars (|) for multiline code, diagrams, or SQL. Do not wrap the YAML in JSON.
- Follow each extension's schema exactly; malformed blocks render as error cards in the reader.
- Exercise blocks are auto-graded: learners solve them in the reader and passing marks the exercise solved. Place them in chapters, not the introduction.`;

/**
 * Compose the skill section for the enabled extensions of a registry.
 * Returns '' when nothing is enabled (callers then omit the argument).
 *
 * @param {ExtensionRegistry} [registry]
 * @returns {string}
 */
export function composeSkills(registry = defaultRegistry) {
  const enabled = registry.enabled();
  if (!enabled.length) return '';
  const sections = enabled.map(extension => {
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
  return [PREAMBLE, ...sections].join('\n\n');
}

/**
 * Invoke arguments carrying the composed skills, or an empty object when no
 * extension is enabled. Spread into authoring command payloads.
 *
 * @param {ExtensionRegistry} [registry]
 * @returns {{ skills?: string }}
 */
export function skillArgs(registry = defaultRegistry) {
  const skills = composeSkills(registry);
  return skills ? { skills } : {};
}
