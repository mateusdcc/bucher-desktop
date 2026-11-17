const MarkdownIt = require('markdown-it');
const { parseYaml } = require('./yaml');

const parser = new MarkdownIt();
const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

function frontmatter(source) {
  const header = FRONTMATTER.exec(source);
  if (!header) return {};
  try {
    const value = parseYaml(header[1]);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function metadata(source) {
  const tokens = parser.parse(source, {});
  const chunks = source.split(/(?<=\n)/);
  const offsets = [0];
  for (const chunk of chunks) offsets.push(offsets.at(-1) + chunk.length);
  const headings = [];
  const sections = [];
  for (const [i, token] of tokens.entries()) {
    if (token.level !== 0 || !token.map || token.type === 'inline') continue;
    const [first, last] = token.map;
    const start = { line: first, offset: offsets[first] };
    const end = { line: last, offset: offsets[last] ?? source.length };
    const position = { start, end };
    const type = token.type.replace(/_open$/, '');
    const text = tokens[i + 1]?.content;
    const anchor = type === 'paragraph' && /^\^([\w-]+)$/.exec(text ?? '');
    if (anchor) {
      if (sections.length) sections.at(-1).id = anchor[1];
      continue;
    }
    if (type === 'heading') headings.push({ position, heading: text, level: Number(token.tag[1]) });
    sections.push({ type, position });
  }
  return { sections, headings };
}

module.exports = { frontmatter, metadata, FRONTMATTER };
