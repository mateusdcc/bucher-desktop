import { diffLines } from 'diff';
import { el, icon } from './ui';

function row(line, before, after, kind) {
  const marker = kind === 'added' ? '+' : kind === 'removed' ? '−' : '';
  const gutter = el('span', 'diff-gutter', [before, after, marker].map(value => el('span', '', value)));
  gutter.setAttribute('aria-hidden', 'true');
  const text = line.replace(/\r?\n$/, '');
  const ending = marker && !line.endsWith('\n') ? el('small', 'diff-ending', 'No newline at end of file') : null;
  return el('div', 'diff-row ' + kind, gutter,
    el('div', 'diff-text',
      marker ? el('span', 'diff-kind', kind === 'added' ? 'Added line: ' : 'Removed line: ') : null,
      el('code', '', text || '\u00a0'), ending));
}

/** Render a line diff without interpreting the Markdown being reviewed. */
export function patchDiff({ original, replacement }) {
  const computed = diffLines(original, replacement, { timeout: 250 });
  const chunks = computed ?? [{ value: original, removed: true }, { value: replacement, added: true }];
  const lines = el('div', 'diff-lines');
  lines.tabIndex = 0;
  lines.setAttribute('aria-label', 'Markdown changes');
  lines.setAttribute('role', 'region');
  let before = 1;
  let after = 1;
  let added = 0;
  let removed = 0;
  for (const { value, added: isAdded, removed: isRemoved } of chunks) {
    const block = value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const kind = isAdded ? 'added' : isRemoved ? 'removed' : 'unchanged';
    const render = i => row(block[i], isAdded ? '' : before + i, isRemoved ? '' : after + i, kind);
    if (kind === 'unchanged' && block.length > 9) {
      const old = before;
      const revised = after;
      const count = block.length - 6;
      const fold = el('details', 'diff-fold',
        el('summary', '', icon('chevrons-up-down'), count + ' unchanged lines'));
      fold.addEventListener('toggle', () => {
        if (!fold.open || fold.childElementCount > 1) return;
        const fragment = document.createDocumentFragment();
        for (let i = 3; i < block.length - 3; i++) fragment.append(row(block[i], old + i, revised + i, kind));
        fold.append(fragment);
      });
      lines.append(render(0), render(1), render(2), fold,
        render(block.length - 3), render(block.length - 2), render(block.length - 1));
    } else {
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < block.length; i++) fragment.append(render(i));
      lines.append(fragment);
    }
    if (isAdded) added += block.length;
    else before += block.length;
    if (isRemoved) removed += block.length;
    else after += block.length;
  }
  if (!added && !removed) return el('div', 'patch-diff', el('p', 'muted', 'The proposal contains no changes.'));
  return el('div', 'patch-diff',
    el('div', 'diff-header',
      el('span', 'diff-heading', icon('file-diff'), 'Markdown changes'),
      el('div', 'diff-counts',
        el('span', 'added', '+' + added + ' added'),
        el('span', 'removed', '−' + removed + ' removed'))),
    computed ? null : el('p', 'diff-fallback muted', 'Showing the original and revised text in full.'),
    lines);
}
