/**
 * ext-state-stepper — step-by-step algorithm, proof, and state-machine player.
 *
 * Authors supply an array of full snapshots (array cells with pointers and
 * highlights, variable chips, and/or a node/edge state diagram plus prose).
 * The learner steps with Prev/Next/Auto-Play/Speed; position persists.
 *
 * @module extensions/state-stepper
 */
import { z } from 'zod';
import { button, el, icon, iconButton } from '../ui.js';
import { blockMeta, createValidator } from './validate.js';

/**
 * @typedef {import('./types.js').BucherExtension} BucherExtension
 * @typedef {import('./types.js').MountProps} MountProps
 * @typedef {import('./types.js').MountedExtension} MountedExtension
 */

const cellValue = z.union([z.number(), z.string().max(24)]);
const arraySchema = z.object({
  name: z.string().max(40),
  values: z.array(cellValue).min(1).max(64),
  highlight: z.array(z.number().int().min(0)).max(64).optional(),
  pointers: z.record(z.string().max(12), z.number().int().min(0)).optional(),
}).superRefine((array, ctx) => {
  for (const index of array.highlight ?? []) {
    if (index >= array.values.length) {
      ctx.addIssue({ code: 'custom', path: ['highlight'], message: `Highlight index ${index} is outside the array.` });
    }
  }
  for (const [label, index] of Object.entries(array.pointers ?? {})) {
    if (index >= array.values.length) {
      ctx.addIssue({ code: 'custom', path: ['pointers', label], message: `Pointer ${label} points outside the array.` });
    }
  }
});

const stepSchema = z.object({
  title: z.string().max(120).optional(),
  explanation: z.string().max(4000).optional(),
  arrays: z.array(arraySchema).max(6).optional(),
  variables: z.record(z.string().max(24), z.union([z.number(), z.string().max(40), z.boolean()])).optional(),
  nodes: z.array(z.object({
    id: z.string().max(24),
    label: z.string().max(40).optional(),
    active: z.boolean().optional(),
  })).max(10).optional(),
  edges: z.array(z.object({
    from: z.string().max(24),
    to: z.string().max(24),
    label: z.string().max(24).optional(),
    active: z.boolean().optional(),
  })).max(20).optional(),
});

const schema = z.object({
  ...blockMeta,
  steps: z.array(stepSchema).min(1).max(200),
}).superRefine((data, ctx) => {
  data.steps.forEach((step, index) => {
    const ids = new Set((step.nodes ?? []).map(node => node.id));
    for (const edge of step.edges ?? []) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) {
        ctx.addIssue({ code: 'custom', path: ['steps', index, 'edges'], message: `Edge ${edge.from}→${edge.to} references an unknown node.` });
      }
    }
  });
});

/** @typedef {import('zod').infer<typeof schema>} Payload */
/** @typedef {import('zod').infer<typeof stepSchema>} Step */

const SPEEDS = [
  { label: '0.5×', ms: 1600 },
  { label: '1×', ms: 800 },
  { label: '2×', ms: 400 },
  { label: '4×', ms: 200 },
];

/** @type {BucherExtension} */
export const stateStepperExtension = {
  id: 'ext-state-stepper',
  name: 'Step-by-Step Visualizer',
  version: '1.0.0',
  description: 'Play through algorithm traces, proof steps, and state machines with arrays, pointers, highlights, and explanations.',
  category: 'visualization',
  icon: 'play-circle',
  skill: {
    instructions: `Use ext-state-stepper to animate a process one snapshot at a time: sorting/searching traces, pointer walks, induction steps, protocol state machines, or any ordered workflow. Rules:
- Each step is a FULL snapshot, not a delta: repeat unchanged arrays/variables so every frame stands alone.
- Keep arrays to ≤ 12 cells and traces to ≤ 20 steps; split longer algorithms into several blocks.
- Use arrays[].highlight for the cells being compared/changed and arrays[].pointers for named indices (i, j, lo, hi…). Pointer and highlight indices must be valid for that step's values.
- Use variables for scalars worth watching (swaps, comparisons, accumulator).
- For state machines use nodes (mark the current one active: true) and edges (mark the taken transition active: true); every edge must reference declared node ids.
- Write a one-sentence explanation per step telling the learner WHAT changes and WHY. Set a stable id and title.`,
    syntaxSpec: `Fence info string: ext-state-stepper. YAML fields:
- steps (required, 1–200): list of snapshots, each with optional:
  - title (short step name), explanation (Markdown prose).
  - arrays: [{ name, values: […], highlight?: [indices], pointers?: { label: index } }]
  - variables: { name: scalar }
  - nodes: [{ id, label?, active? }], edges: [{ from, to, label?, active? }]`,
    fewShotExamples: [
      {
        title: 'Bubble sort first pass',
        yaml: `id: bubble-sort-pass
title: Bubble sort — first pass
steps:
  - title: Start
    explanation: Compare the first two cells; swap them if they are out of order.
    arrays:
      - name: a
        values: [5, 2, 8, 1]
        highlight: [0, 1]
        pointers: { i: 0, j: 1 }
    variables: { swaps: 0 }
  - title: Swap 5 and 2
    explanation: 5 > 2, so the pair is swapped. The larger value bubbles right.
    arrays:
      - name: a
        values: [2, 5, 8, 1]
        highlight: [0, 1]
        pointers: { i: 0, j: 1 }
    variables: { swaps: 1 }
  - title: Advance
    explanation: 5 < 8, no swap. Move the window one cell right.
    arrays:
      - name: a
        values: [2, 5, 8, 1]
        highlight: [1, 2]
        pointers: { i: 1, j: 2 }
    variables: { swaps: 1 }
  - title: Swap 8 and 1
    explanation: 8 > 1, swap. After this pass the maximum (8) sits at the end.
    arrays:
      - name: a
        values: [2, 5, 1, 8]
        highlight: [2, 3]
        pointers: { i: 2, j: 3 }
    variables: { swaps: 2 }`,
      },
      {
        title: 'Connection state machine',
        yaml: `id: tcp-states
title: Opening a connection
steps:
  - title: Closed
    explanation: The socket starts closed; nothing is listening yet.
    nodes:
      - { id: closed, label: CLOSED, active: true }
      - { id: listen, label: LISTEN }
      - { id: established, label: ESTABLISHED }
    edges:
      - { from: closed, to: listen, label: open }
      - { from: listen, to: established, label: handshake }
  - title: Listening
    explanation: A passive open moves the socket to LISTEN, waiting for a SYN.
    nodes:
      - { id: closed, label: CLOSED }
      - { id: listen, label: LISTEN, active: true }
      - { id: established, label: ESTABLISHED }
    edges:
      - { from: closed, to: listen, label: open, active: true }
      - { from: listen, to: established, label: handshake }
  - title: Established
    explanation: The three-way handshake completes; data can flow.
    nodes:
      - { id: closed, label: CLOSED }
      - { id: listen, label: LISTEN }
      - { id: established, label: ESTABLISHED, active: true }
    edges:
      - { from: closed, to: listen, label: open }
      - { from: listen, to: established, label: handshake, active: true }`,
      },
    ],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    return mountStepper(host, props);
  },
};

/**
 * @param {HTMLElement} host
 * @param {MountProps} props
 * @returns {MountedExtension}
 */
function mountStepper(host, props) {
  const data = /** @type {Payload} */ (props.data);
  const saved = props.savedState ?? {};
  const total = data.steps.length;
  let step = typeof saved.step === 'number' ? Math.min(Math.max(0, Math.round(saved.step)), total - 1) : 0;
  let speedIndex = typeof saved.speed === 'number' && SPEEDS[saved.speed] ? saved.speed : 1;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;

  const counter = el('span', 'stepper-counter', '');
  const speed = /** @type {HTMLSelectElement} */ (el('select', 'stepper-speed'));
  speed.setAttribute('aria-label', 'Auto-play speed');
  for (const [index, option] of SPEEDS.entries()) {
    const node = el('option', '', option.label);
    node.value = String(index);
    speed.append(node);
  }
  speed.value = String(speedIndex);
  const play = button('Auto-play', 'play', () => togglePlay());
  const prev = iconButton('Previous step', 'chevron-left', () => goto(step - 1));
  const next = iconButton('Next step', 'chevron-right', () => goto(step + 1));
  const track = el('div', 'stepper-track', el('span'));
  const stage = el('div', 'stepper-stage');
  const controls = el('div', 'stepper-controls', prev, play, next, counter, speed);
  const root = el('div', 'stepper-extension', controls, track, stage);
  root.tabIndex = 0;
  root.setAttribute('aria-label', 'Step player. Use arrow keys to step.');
  host.append(root);

  function persist() {
    props.onSaveState({ step, speed: speedIndex });
  }

  /** @param {number} index */
  function goto(index) {
    step = Math.min(Math.max(0, index), total - 1);
    draw();
    persist();
  }

  function togglePlay() {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
      play.replaceChildren(icon('play'), 'Auto-play');
      return;
    }
    if (step >= total - 1) goto(0);
    play.replaceChildren(icon('pause'), 'Pause');
    timer = setInterval(() => {
      if (step >= total - 1) {
        togglePlay();
        return;
      }
      goto(step + 1);
    }, SPEEDS[speedIndex].ms);
  }

  speed.addEventListener('change', () => {
    speedIndex = Number(speed.value);
    if (timer !== null) {
      clearInterval(timer);
      timer = setInterval(() => {
        if (step >= total - 1) {
          togglePlay();
          return;
        }
        goto(step + 1);
      }, SPEEDS[speedIndex].ms);
    }
    persist();
  });

  root.addEventListener('keydown', /** @param {KeyboardEvent} event */ event => {
    if (event.target instanceof HTMLSelectElement) return;
    if (event.key === 'ArrowRight') { goto(step + 1); event.preventDefault(); }
    else if (event.key === 'ArrowLeft') { goto(step - 1); event.preventDefault(); }
    else if (event.key === ' ' && !(event.target instanceof HTMLButtonElement)) { togglePlay(); event.preventDefault(); }
  });

  /** @param {Step} snapshot */
  function renderArrays(snapshot) {
    const wrap = el('div', 'stepper-arrays');
    for (const array of snapshot.arrays ?? []) {
      const highlights = new Set(array.highlight ?? []);
      const cells = el('div', 'stepper-cells',
        ...array.values.map((value, index) => {
          const cell = el('span', 'stepper-cell' + (highlights.has(index) ? ' highlighted' : ''), String(value));
          cell.dataset.index = String(index);
          return cell;
        }));
      const pointers = el('div', 'stepper-pointers',
        ...Object.entries(array.pointers ?? {}).map(([label, index]) => {
          const marker = el('span', 'stepper-pointer', el('span', 'stepper-pointer-arrow', '▲'), label);
          marker.style.gridColumn = String(index + 1);
          return marker;
        }));
      pointers.style.gridTemplateColumns = `repeat(${array.values.length}, var(--cell-size))`;
      wrap.append(el('div', 'stepper-array',
        el('span', 'stepper-array-name', array.name), cells,
        Object.keys(array.pointers ?? {}).length ? pointers : null));
    }
    return wrap;
  }

  /** @param {Step} snapshot */
  function renderGraph(snapshot) {
    const nodes = snapshot.nodes ?? [];
    const edges = snapshot.edges ?? [];
    const spacing = 150;
    const width = Math.max(nodes.length * spacing, 200);
    const height = 130;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'stepper-graph');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'State diagram');
    const defs = document.createElementNS(ns, 'defs');
    defs.innerHTML = '<marker id="stepper-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#8b8e85"/></marker>'
      + '<marker id="stepper-arrow-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#73d695"/></marker>';
    svg.append(defs);
    /** @type {Map<string, { x: number, y: number }>} */
    const positions = new Map();
    nodes.forEach((node, index) => {
      positions.set(node.id, { x: spacing * index + spacing / 2, y: height / 2 });
    });
    for (const edge of edges) {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) continue;
      const path = document.createElementNS(ns, 'path');
      const active = Boolean(edge.active);
      if (from.x === to.x) {
        path.setAttribute('d', `M ${from.x - 26} ${from.y - 20} C ${from.x - 70} ${from.y - 75}, ${from.x + 70} ${from.y - 75}, ${from.x + 26} ${from.y - 20}`);
      } else {
        const direction = to.x > from.x ? 1 : -1;
        const startX = from.x + direction * 46;
        const endX = to.x - direction * 46;
        const bend = from.y - 34;
        path.setAttribute('d', `M ${startX} ${from.y - 12} Q ${(startX + endX) / 2} ${bend}, ${endX} ${to.y - 12}`);
      }
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', active ? '#73d695' : '#5a605a');
      path.setAttribute('stroke-width', active ? '2.4' : '1.4');
      path.setAttribute('marker-end', active ? 'url(#stepper-arrow-active)' : 'url(#stepper-arrow)');
      svg.append(path);
      if (edge.label) {
        const text = document.createElementNS(ns, 'text');
        text.setAttribute('x', String((from.x + to.x) / 2));
        text.setAttribute('y', String(from.y - 44));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('class', 'stepper-edge-label' + (active ? ' active' : ''));
        text.textContent = edge.label;
        svg.append(text);
      }
    }
    for (const node of nodes) {
      const position = positions.get(node.id);
      if (!position) continue;
      const group = document.createElementNS(ns, 'g');
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(position.x - 46));
      rect.setAttribute('y', String(position.y - 20));
      rect.setAttribute('width', '92');
      rect.setAttribute('height', '40');
      rect.setAttribute('rx', '8');
      rect.setAttribute('class', 'stepper-node' + (node.active ? ' active' : ''));
      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', String(position.x));
      text.setAttribute('y', String(position.y + 4));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('class', 'stepper-node-label' + (node.active ? ' active' : ''));
      text.textContent = node.label ?? node.id;
      group.append(rect, text);
      svg.append(group);
    }
    return el('div', 'stepper-graph-wrap', svg);
  }

  function draw() {
    const snapshot = data.steps[step];
    counter.textContent = `Step ${step + 1} / ${total}`;
    /** @type {HTMLElement} */ (track.firstChild).style.width = `${((step + 1) / total) * 100}%`;
    prev.disabled = step === 0;
    next.disabled = step === total - 1;
    stage.replaceChildren();
    if (snapshot.title) stage.append(el('h3', 'stepper-step-title', snapshot.title));
    if (snapshot.arrays?.length) stage.append(renderArrays(snapshot));
    if (snapshot.nodes?.length) stage.append(renderGraph(snapshot));
    if (snapshot.variables && Object.keys(snapshot.variables).length) {
      stage.append(el('div', 'stepper-variables',
        ...Object.entries(snapshot.variables).map(([name, value]) =>
          el('span', 'stepper-variable', el('span', 'stepper-variable-name', name), String(value)))));
    }
    if (snapshot.explanation) {
      stage.append(el('div', 'stepper-explanation', props.renderMarkdown(snapshot.explanation)));
    }
  }

  draw();
  return {
    destroy() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
