// Render placeholders after Markdown. Typst Mate intercepts Obsidian's regular
// math pipeline globally, so these formulas are routed per reader block.
const TOKENS = /^(?:[ \t]*> ?)*[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^(?:[ \t]*> ?)*[ \t]*\1[`~]*[ \t]*(?=\r?$)|(?![\s\S]))|<!--[^]*?-->|%%[^]*?%%|(`+)[\s\S]*?\2|\$\$([\s\S]+?)\$\$|\$((?:\\.|[^\r\n$\\])+?)\$|\\\[((?:\\(?!\])[\s\S]|[^\\])+?)\\\]|\\\(((?:\\(?!\))[^\r\n]|[^\\\r\n])+?)\\\)|\\[^\r\n]/gm;

function extractMath(source, allowLatexDelimiters = true) {
  const formulas = [];
  const prefix = `buches-${Math.random().toString(36).slice(2)}-`;
  const markdown = source.replace(TOKENS, (match, _fence, _code, display, inline, latexDisplay, latexInline) => {
    const block = display ?? (allowLatexDelimiters ? latexDisplay : undefined);
    const math = block ?? inline ?? (allowLatexDelimiters ? latexInline : undefined);
    if (math === undefined) return match;
    const id = prefix + formulas.length;
    formulas.push({
      id, source: block === undefined ? math : math.replace(/^(?:[ \t]*> ?)+/gm, ''),
      display: block !== undefined, literal: match,
    });
    return `<span data-buches-formula="${id}"></span>`;
  });
  return { markdown, formulas };
}

module.exports = { extractMath };
