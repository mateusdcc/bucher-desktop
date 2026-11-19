/**
 * ext-parsons-puzzle — Parsons problems: order scrambled code/proof lines.
 *
 * Learners drag (or click) lines from a tray into an ordered solution,
 * optionally set indentation, and avoid distractor lines. Checking gives
 * per-line feedback; a fully correct arrangement passes the exercise.
 * Arrangement and status persist with the book progress.
 *
 * @module extensions/parsons-puzzle
 */
import { z } from 'zod';
import { button, el, icon, iconButton } from '../ui.js';
import { blockMeta, createValidator } from './validate.js';

/**
 * @typedef {import('./types.js').BucherExtension} BucherExtension
 * @typedef {import('./types.js').MountProps} MountProps
 * @typedef {import('./types.js').MountedExtension} MountedExtension
 * @typedef {{ line: number, indent: number }} Placed
 */

const lineSchema = z.object({
  text: z.string().min(1).max(300),
  indent: z.number().int().min(0).max(8).default(0),
});

const schema = z.object({
  ...blockMeta,
  prompt: z.string().max(4000).optional(),
  lines: z.array(lineSchema).min(2).max(20),
  distractors: z.array(z.string().min(1).max(300)).max(6).optional(),
  indentation: z.boolean().optional(),
  alternatives: z.array(z.array(z.number().int().min(0))).max(5).optional(),
}).superRefine((data, ctx) => {
  const count = data.lines.length;
  (data.alternatives ?? []).forEach((order, index) => {
    const sorted = [...order].sort((a, b) => a - b);
    const valid = sorted.length === count && sorted.every((value, i) => value === i);
    if (!valid) {
      ctx.addIssue({ code: 'custom', path: ['alternatives', index], message: 'Each alternative must be a permutation of all solution line indices.' });
    }
  });
});

/** @typedef {import('zod').infer<typeof schema>} Payload */

/** @type {BucherExtension} */
export const parsonsExtension = {
  id: 'ext-parsons-puzzle',
  name: 'Parsons Puzzle',
  version: '1.0.0',
  description: 'Reorder scrambled code lines, proof steps, or workflow stages — with optional indentation and distractor lines.',
  category: 'exercise',
  icon: 'list-ordered',
  skill: {
    instructions: `Use ext-parsons-puzzle to test structure without syntax burden: ordering code lines, proof steps, algorithm stages, or workflow steps. Rules:
- lines is the CORRECT order (top to bottom). The reader scrambles them. Each line: { text, indent? } where indent is the nesting level (0-based).
- Add 1–2 distractors: plausible but wrong lines that must stay in the tray. Never mark a distractor as part of the solution.
- Set indentation: true when nesting matters (Python, pseudocode, nested blocks); otherwise omit it.
- When several orderings are equally valid (independent steps), list them in alternatives as permutations of line indices [0..n-1].
- Keep 4–10 solution lines; split longer programs into several puzzles. The prompt is Markdown: say what the finished artifact should do.
- Set a stable id and title; place the block in a chapter.`,
    syntaxSpec: `Fence info string: ext-parsons-puzzle. YAML fields:
- prompt (Markdown, optional): task description.
- lines (required, 2–20): [{ text, indent? }] in correct order.
- distractors (optional, ≤6): [string] wrong lines that must not be used.
- indentation (boolean, optional): whether indent levels are graded (default: true when any line has indent > 0).
- alternatives (optional): [ [line indices…] ] additional accepted orderings.`,
    fewShotExamples: [
      {
        title: 'Order a Python loop',
        yaml: `id: parsons-python-sum
title: Build the sum function
prompt: |
  Arrange the lines so \`total(n)\` returns 1 + 2 + … + n. Indentation matters.
indentation: true
lines:
  - text: "def total(n):"
    indent: 0
  - text: "s = 0"
    indent: 1
  - text: "for i in range(1, n + 1):"
    indent: 1
  - text: "s += i"
    indent: 2
  - text: "return s"
    indent: 1
distractors:
  - "return n"`,
      },
      {
        title: 'Order a direct proof',
        yaml: `id: parsons-even-sum
title: Prove the sum of two evens is even
prompt: Arrange the proof steps in a valid logical order.
lines:
  - text: "Let m = 2a and n = 2b for integers a, b."
  - text: "Then m + n = 2a + 2b."
  - text: "Factor: m + n = 2(a + b)."
  - text: "Since a + b is an integer, m + n is even."
distractors:
  - "Therefore m + n is odd."
alternatives:
  - [0, 1, 2, 3]`,
      },
    ],
  },
  dependencies: {
    webPackages: [],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    return mountParsons(host, props);
  },
};

/**
 * Deterministic shuffle so an untouched puzzle looks the same after reload.
 *
 * @param {string} seed
 * @param {number} count
 * @returns {number[]}
 */
function seededOrder(seed, count) {
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  let state = hash >>> 0;
  const random = () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * @param {HTMLElement} host
 * @param {MountProps} props
 * @returns {MountedExtension}
 */
function mountParsons(host, props) {
  const data = /** @type {Payload} */ (props.data);
  const saved = props.savedState ?? {};
  const solutionCount = data.lines.length;
  const distractors = data.distractors ?? [];
  const totalCount = solutionCount + distractors.length;
  const useIndent = data.indentation ?? data.lines.some(line => line.indent > 0);
  /** @type {Map<number, string>} */
  const texts = new Map();
  data.lines.forEach((line, index) => texts.set(index, line.text));
  distractors.forEach((text, index) => texts.set(solutionCount + index, text));

  /** @type {number[]} */
  let tray = seededOrder(String(data.id ?? data.title ?? 'parsons'), totalCount);
  /** @type {Placed[]} */
  let answer = [];
  if (Array.isArray(saved.tray) && Array.isArray(saved.answer)) {
    const savedAnswer = /** @type {Placed[]} */ (/** @type {unknown[]} */ (saved.answer)
      .filter(entry => Boolean(entry) && typeof entry === 'object'
        && typeof (/** @type {Placed} */ (entry)).line === 'number'
        && typeof (/** @type {Placed} */ (entry)).indent === 'number'));
    const savedTray = /** @type {number[]} */ (/** @type {unknown[]} */ (saved.tray)
      .filter(line => typeof line === 'number'));
    const used = new Set([...savedAnswer.map(entry => entry.line), ...savedTray]);
    if (used.size === totalCount && savedAnswer.length + savedTray.length === totalCount
      && [...used].every(line => line >= 0 && line < totalCount)) {
      answer = savedAnswer;
      tray = savedTray;
    }
  }
  let status = saved.status === 'passed' ? 'passed' : answer.length ? 'in-progress' : 'unsolved';
  /** @type {boolean[] | null} */
  let feedback = Array.isArray(saved.feedback) && saved.feedback.length === answer.length
    ? /** @type {unknown[]} */ (saved.feedback).map(Boolean)
    : null;

  const summary = el('p', 'parsons-summary muted');
  const trayZone = el('div', 'parsons-tray');
  const answerZone = el('div', 'parsons-answer');
  const check = button('Check order', 'check', () => checkOrder(), 'accent-button');
  const shuffle = button('Shuffle / reset', 'shuffle', () => {
    tray = seededOrder(String(data.id ?? data.title ?? 'parsons') + ':' + Date.now(), totalCount);
    answer = [];
    feedback = null;
    status = 'unsolved';
    render();
    persist();
  });
  const root = el('div', 'parsons-extension',
    data.prompt ? el('div', 'parsons-prompt', props.renderMarkdown(data.prompt)) : null,
    el('div', 'parsons-pools',
      el('div', 'parsons-pool', el('h4', 'parsons-pool-title', 'Available lines'), trayZone),
      el('div', 'parsons-pool', el('h4', 'parsons-pool-title', 'Your solution'), answerZone)),
    el('div', 'parsons-controls', check, shuffle, summary));
  host.append(root);

  function persist() {
    props.onSaveState({ tray, answer, status, feedback });
  }

  /**
   * @param {number} line
   * @returns {HTMLElement}
   */
  function trayChip(line) {
    const chip = el('div', 'parsons-line tray-line', el('code', '', texts.get(line) ?? ''));
    chip.draggable = true;
    chip.dataset.line = String(line);
    chip.tabIndex = 0;
    chip.setAttribute('role', 'button');
    chip.setAttribute('aria-label', `Add line: ${texts.get(line)}`);
    const move = () => {
      tray = tray.filter(item => item !== line);
      answer = [...answer, { line, indent: 0 }];
      feedback = null;
      status = 'in-progress';
      render();
      persist();
    };
    chip.addEventListener('click', move);
    chip.addEventListener('keydown', /** @param {KeyboardEvent} event */ event => {
      if (event.key === 'Enter' || event.key === ' ') { move(); event.preventDefault(); }
    });
    chip.addEventListener('dragstart', /** @param {DragEvent} event */ event => {
      event.dataTransfer?.setData('text/plain', JSON.stringify({ line, from: 'tray' }));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    return chip;
  }

  /**
   * @param {Placed} placed
   * @param {number} position
   * @returns {HTMLElement}
   */
  function answerRow(placed, position) {
    const correct = feedback ? feedback[position] : null;
    const row = el('div', 'parsons-line answer-line'
      + (correct === true ? ' correct' : correct === false ? ' incorrect' : ''));
    row.draggable = true;
    row.dataset.line = String(placed.line);
    row.style.setProperty('--indent', String(useIndent ? placed.indent : 0));
    const handle = el('span', 'parsons-handle', icon('grip-vertical'));
    const code = el('code', '', texts.get(placed.line) ?? '');
    row.append(handle, code);
    const tools = el('span', 'parsons-line-tools');
    if (useIndent) {
      tools.append(
        iconButton('Decrease indent', 'arrow-left-to-line', () => {
          placed.indent = Math.max(0, placed.indent - 1);
          feedback = null;
          render();
          persist();
        }),
        iconButton('Increase indent', 'arrow-right-to-line', () => {
          placed.indent = Math.min(8, placed.indent + 1);
          feedback = null;
          render();
          persist();
        }));
    }
    tools.append(
      iconButton('Move line up', 'arrow-up', () => {
        if (position === 0) return;
        [answer[position - 1], answer[position]] = [answer[position], answer[position - 1]];
        feedback = null;
        render();
        persist();
      }),
      iconButton('Move line down', 'arrow-down', () => {
        if (position >= answer.length - 1) return;
        [answer[position + 1], answer[position]] = [answer[position], answer[position + 1]];
        feedback = null;
        render();
        persist();
      }),
      iconButton('Return line to tray', 'x', () => {
        answer = answer.filter((_, index) => index !== position);
        tray = [...tray, placed.line];
        feedback = null;
        status = answer.length ? 'in-progress' : 'unsolved';
        render();
        persist();
      }));
    row.append(tools);
    row.addEventListener('dragstart', /** @param {DragEvent} event */ event => {
      event.dataTransfer?.setData('text/plain', JSON.stringify({ line: placed.line, from: 'answer', position }));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragover', /** @param {DragEvent} event */ event => {
      event.preventDefault();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', /** @param {DragEvent} event */ event => {
      event.preventDefault();
      event.stopPropagation();
      row.classList.remove('drop-target');
      const payload = parseDrag(event);
      if (payload === null) return;
      insertAt(payload, position);
    });
    return row;
  }

  /**
   * @param {DragEvent} event
   * @returns {{ line: number, from: string, position?: number } | null}
   */
  function parseDrag(event) {
    try {
      const payload = JSON.parse(event.dataTransfer?.getData('text/plain') ?? '');
      return typeof payload?.line === 'number' ? payload : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {{ line: number, from: string, position?: number }} payload
   * @param {number | null} position  null = append to the answer
   */
  function insertAt(payload, position) {
    const { line, from } = payload;
    const previousIndent = answer.find(item => item.line === line)?.indent ?? 0;
    if (from === 'answer') {
      answer = answer.filter(item => item.line !== line);
    } else {
      tray = tray.filter(item => item !== line);
    }
    const placed = { line, indent: from === 'answer' ? previousIndent : 0 };
    if (position === null || position >= answer.length) answer = [...answer, placed];
    else answer = [...answer.slice(0, position), placed, ...answer.slice(position)];
    feedback = null;
    status = 'in-progress';
    render();
    persist();
  }

  answerZone.addEventListener('dragover', /** @param {DragEvent} event */ event => {
    event.preventDefault();
    answerZone.classList.add('drop-target');
  });
  answerZone.addEventListener('dragleave', () => answerZone.classList.remove('drop-target'));
  answerZone.addEventListener('drop', /** @param {DragEvent} event */ event => {
    event.preventDefault();
    answerZone.classList.remove('drop-target');
    const payload = parseDrag(event);
    if (payload !== null) insertAt(payload, null);
  });
  trayZone.addEventListener('dragover', /** @param {DragEvent} event */ event => event.preventDefault());
  trayZone.addEventListener('drop', /** @param {DragEvent} event */ event => {
    event.preventDefault();
    const payload = parseDrag(event);
    if (!payload || payload.from !== 'answer') return;
    answer = answer.filter(item => item.line !== payload.line);
    tray = [...tray, payload.line];
    feedback = null;
    status = answer.length ? 'in-progress' : 'unsolved';
    render();
    persist();
  });

  function checkOrder() {
    const order = answer.map(placed => placed.line);
    const expectedOrders = [[...Array(solutionCount).keys()], ...(data.alternatives ?? [])];
    const orderOk = answer.length === solutionCount
      && expectedOrders.some(expected => expected.every((line, index) => order[index] === line));
    const marks = answer.map((placed, index) => {
      const lineOk = orderOk || (placed.line < solutionCount && expectedOrders[0][index] === placed.line);
      const indentOk = !useIndent || (placed.line < solutionCount && data.lines[placed.line].indent === placed.indent);
      return lineOk && indentOk && placed.line < solutionCount;
    });
    feedback = marks;
    const allCorrect = orderOk && marks.every(Boolean);
    status = allCorrect ? 'passed' : 'in-progress';
    render();
    persist();
    if (allCorrect) props.onComplete();
  }

  function render() {
    trayZone.replaceChildren(...tray.map(line => trayChip(line)));
    if (!tray.length) trayZone.append(el('p', 'muted parsons-empty', 'All lines placed.'));
    answerZone.replaceChildren(...answer.map((placed, position) => answerRow(placed, position)));
    if (!answer.length) answerZone.append(el('p', 'muted parsons-empty', 'Drag or click lines here in the correct order.'));
    const correctCount = feedback ? feedback.filter(Boolean).length : 0;
    summary.textContent = feedback
      ? (status === 'passed' ? 'Correct — well done!' : `${correctCount} of ${answer.length} placed lines correct`)
      : `${answer.length} of ${solutionCount} lines placed${distractors.length ? ` · ${distractors.length} distractor${distractors.length > 1 ? 's' : ''} hidden in the tray` : ''}`;
    check.disabled = answer.length === 0;
  }

  render();
  return { destroy() {} };
}
