function stripFrontmatter(text, trim = true) {
  const body = text.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '');
  return trim ? body.trim() : body;
}
module.exports = { stripFrontmatter };
