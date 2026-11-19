import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { typst2tex } from 'tex2typst';
import math from './model/math';
import { extensionIdFromInfo, isExtensionInfo } from './extensions/keys.js';

const md = new MarkdownIt({ html: false, linkify: true });
const renderLabel = (tokens, i, options, env, renderer) => renderer.renderToken(tokens, i, options);
const safeExternal = value => /^(?:https?:\/\/|mailto:)/i.test(value);

export const headingId = title => title.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').trim().replace(/\s+/g, '-');

md.inline.ruler.before('image', 'wiki', (state, silent) => {
  const match = /^(!?)\[\[([^\]\r\n]+)\]\]/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) state.push('wiki', '', 0).meta = { embed: Boolean(match[1]), reference: match[2] };
  state.pos += match[0].length;
  return true;
});

md.inline.ruler.before('text', 'cloze', (state, silent) => {
  const match = /^==([^=\r\n]+)==/.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) state.push('cloze', '', 0).content = match[1];
  state.pos += match[0].length;
  return true;
});

const escape = md.utils.escapeHtml;
const renderFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, i, options, env, renderer) => {
  const { info, content } = tokens[i];
  if (isExtensionInfo(info)) {
    const id = extensionIdFromInfo(info);
    return `<div class="bucher-extension" data-extension="${escape(id)}" data-source="${escape(content)}"></div>`;
  }
  const equation = /^\$([^$]+)\$$/.exec(content.trim())?.[1].trim();
  if (info.trim() === 'typst' && equation) {
    try {
      const formula = katex.renderToString(typst2tex(equation), { displayMode: true });
      return '<div class="typst-math">' + formula + '</div>';
    } catch {
      // Keep unsupported Typst intact and visible as source.
    }
  }
  return renderFence(tokens, i, options, env, renderer);
};

md.renderer.rules.cloze = (tokens, i, _options, env) => {
  const [text, hint] = tokens[i].content.split(';;');
  return env.quiz
    ? `<button type="button" class="cloze" data-cloze aria-pressed="false"><span>${escape(hint || 'Reveal')}</span><span hidden>${escape(text)}</span></button>`
    : `<mark>${escape(text)}</mark>`;
};

function internal(value, env) {
  const hash = value.indexOf('#');
  const target = hash === -1 ? value : value.slice(0, hash);
  let fragment = hash === -1 ? '' : value.slice(hash + 1);
  try { fragment = decodeURIComponent(fragment); } catch {}
  const file = target ? env.library.resolve(target, env.path) : env.library.file(env.path);
  return { file, fragment };
}

function linkAttributes(value, env) {
  if (safeExternal(value)) return `href="${escape(value)}" data-external`;
  const { file, fragment } = internal(value, env);
  if (file?.extension === 'md') return `href="#${escape(fragment)}" data-file="${escape(file.path)}" data-fragment="${escape(fragment)}"`;
  return `href="#" data-missing="${escape(value)}"`;
}

md.renderer.rules.link_open = (tokens, i, _options, env) => {
  const value = tokens[i].attrGet('href') ?? '';
  return `<a ${linkAttributes(value, env)}>`;
};

function image(reference, label, env) {
  const { file } = internal(reference, env);
  if (file?.source !== null || file.children) return `<span class="muted">${escape(label || reference)}</span>`;
  return `<img src="${escape(env.asset(file.path))}" alt="${escape(label)}" loading="lazy">`;
}

md.renderer.rules.image = (tokens, i, _options, env) => image(tokens[i].attrGet('src'), tokens[i].content, env);
md.renderer.rules.wiki = (tokens, i, _options, env) => {
  const { embed, reference } = tokens[i].meta;
  const [value, alias] = reference.split('|');
  if (embed && /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(value)) return image(value, alias ?? '', env);
  return `<a ${linkAttributes(value, env)}>${escape(alias || value.split('/').at(-1)?.replace(/\.md(?=\b)/, '') || '')}</a>`;
};

md.renderer.rules.heading_open = (tokens, i, options, env, renderer) => {
  tokens[i].attrSet('id', headingId(tokens[i + 1]?.content ?? ''));
  return renderLabel(tokens, i, options, env, renderer);
};

export function renderMarkdown(source, env) {
  const extracted = math.extractMath(source.replace(/<!--[^]*?-->|%%[^]*?%%/g, ''));
  const markdown = extracted.markdown.replace(/<span data-buches-formula="([\w-]+)"><\/span>/g, '$1');
  let html = md.render(markdown, env);
  for (const formula of extracted.formulas) {
    html = html.replace(formula.id, () => katex.renderToString(formula.source, {
      displayMode: formula.display,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    }));
  }
  return html;
}

export function markdownBlockLines(source) {
  return md.parse(source, {}).flatMap(token => token.level === 0 && token.map ? [token.map] : []);
}
