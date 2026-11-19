/**
 * ext-interactive-graph — node-based systems, proofs, and concept flow canvas.
 *
 * React Flow + dagre auto-layout. Explore mode: pan/zoom, drag nodes, click to
 * inspect sub-notes, trace dependencies upstream/downstream. Exercise modes:
 * wire missing edges by dragging between nodes, or classify nodes by kind.
 * Solving marks the owning book exercise solved; layout and progress persist.
 *
 * The React view lives in interactive-graph-view.tsx and is loaded lazily at
 * mount, so Node tests and app startup never touch React or JSX.
 *
 * @module extensions/interactive-graph
 */
import { z } from 'zod';
import { el } from '../ui.js';
import { blockMeta, createValidator } from './validate.js';
import { mountReactComponent } from './react-runtime.js';

/**
 * @typedef {import('./types.js').BucherExtension} BucherExtension
 * @typedef {import('./types.js').MountProps} MountProps
 * @typedef {import('./types.js').MountedExtension} MountedExtension
 * @typedef {import('./react-runtime.js').ReactMount} ReactMount
 */

const KINDS = ['definition', 'theorem', 'lemma', 'claim', 'step', 'concept'];

const nodeSchema = z.object({
  id: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  kind: z.enum(KINDS).optional(),
  note: z.string().max(6000).optional().describe('Markdown sub-note shown when the node is clicked.'),
});

const edgeSchema = z.object({
  from: z.string().min(1).max(60),
  to: z.string().min(1).max(60),
  label: z.string().max(60).optional(),
});

/**
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function edgeKey(from, to) {
  return `${from}->${to}`;
}

const schema = z.object({
  ...blockMeta,
  mode: z.enum(['explore', 'exercise']).default('explore'),
  layout: z.enum(['TB', 'LR']).default('TB'),
  nodes: z.array(nodeSchema).min(2).max(40),
  edges: z.array(edgeSchema).min(1).max(80),
  exercise: z.object({
    type: z.enum(['wire-edges', 'classify-nodes']),
    hiddenEdges: z.array(edgeSchema).max(20).optional(),
    extraKinds: z.array(z.enum(KINDS)).max(6).optional(),
  }).optional(),
}).superRefine((data, ctx) => {
  const ids = new Set(data.nodes.map(node => node.id));
  data.edges.forEach((edge, index) => {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      ctx.addIssue({ code: 'custom', path: ['edges', index], message: `Edge ${edge.from}→${edge.to} references an unknown node.` });
    }
  });
  if (data.mode === 'exercise') {
    if (!data.exercise) {
      ctx.addIssue({ code: 'custom', path: ['exercise'], message: 'Exercise mode requires an exercise object.' });
      return;
    }
    if (data.exercise.type === 'wire-edges') {
      const hidden = data.exercise.hiddenEdges ?? [];
      if (!hidden.length) {
        ctx.addIssue({ code: 'custom', path: ['exercise', 'hiddenEdges'], message: 'wire-edges needs at least one hidden edge.' });
      }
      const declared = new Set(data.edges.map(edge => edgeKey(edge.from, edge.to)));
      hidden.forEach((edge, index) => {
        if (!declared.has(edgeKey(edge.from, edge.to))) {
          ctx.addIssue({ code: 'custom', path: ['exercise', 'hiddenEdges', index], message: 'Each hidden edge must also appear in edges.' });
        }
      });
    }
    if (data.exercise.type === 'classify-nodes' && data.nodes.some(node => !node.kind)) {
      ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'classify-nodes requires a kind on every node.' });
    }
  }
});

/** @typedef {import('zod').infer<typeof schema>} Payload */

/** @type {BucherExtension} */
export const interactiveGraphExtension = {
  id: 'ext-interactive-graph',
  name: 'Interactive Graph',
  version: '1.0.0',
  description: 'Pannable, zoomable node-edge canvases for systems, proofs, and concept maps — with inspectable notes, dependency tracing, and wiring/classification exercises.',
  category: 'hybrid',
  icon: 'waypoints',
  skill: {
    instructions: `Use ext-interactive-graph for structure that benefits from spatial exploration: proof dependency graphs, concept maps, system architectures, and pipelines. Rules:
- nodes: 2–40 items { id, label, kind?, note? }. kind is one of definition/theorem/lemma/claim/step/concept; note is Markdown shown when the reader clicks the node — put the deep explanation there, not in the label.
- edges: { from, to, label? } meaning "from supports/feeds to". Keep labels short.
- mode explore (default): readers pan/zoom, drag nodes, click to inspect notes, and trace prerequisites/dependencies. Use for exposition.
- mode exercise with exercise.type wire-edges: list the FULL edge set in edges, then repeat the subset the reader must discover in exercise.hiddenEdges. Readers drag from node to node to wire them; wrong links are rejected with feedback.
- mode exercise with exercise.type classify-nodes: give EVERY node its correct kind; readers assign kinds from dropdowns (add extraKinds as distractors) and check.
- Set layout TB (top-down) or LR (left-right). Set a stable id and title; place exercise blocks in chapters.`,
    syntaxSpec: `Fence info string: ext-interactive-graph. YAML fields:
- mode: explore | exercise (default explore); layout: TB | LR (default TB).
- nodes: [{ id, label, kind?, note? }] (2–40).
- edges: [{ from, to, label? }] (1–80), referencing declared node ids.
- exercise (required in exercise mode): { type: wire-edges, hiddenEdges: [{from,to}] } or { type: classify-nodes, extraKinds?: [kinds] }.`,
    fewShotExamples: [
      {
        title: 'Proof dependency map',
        yaml: `id: graph-even-proof
title: How the even-sum proof fits together
mode: explore
layout: TB
nodes:
  - id: def-even
    label: "Definition: even"
    kind: definition
    note: |
      An integer $n$ is **even** when $n = 2k$ for some integer $k$.
  - id: closure
    label: "Integers closed under +"
    kind: lemma
    note: The sum of two integers is an integer.
  - id: sum-even
    label: "Sum of evens is even"
    kind: theorem
    note: |
      Let $m = 2a$, $n = 2b$. Then $m + n = 2(a+b)$, and $a+b$ is an integer.
edges:
  - { from: def-even, to: sum-even, label: unfolds }
  - { from: closure, to: sum-even, label: justifies }`,
      },
      {
        title: 'Wire the missing links',
        yaml: `id: graph-wire-pipeline
title: Wire the compilation pipeline
mode: exercise
layout: LR
nodes:
  - { id: src, label: Source, kind: concept }
  - { id: lex, label: Lexer, kind: step }
  - { id: parse, label: Parser, kind: step }
  - { id: ir, label: IR, kind: concept }
  - { id: codegen, label: Codegen, kind: step }
edges:
  - { from: src, to: lex }
  - { from: lex, to: parse }
  - { from: parse, to: ir }
  - { from: ir, to: codegen }
exercise:
  type: wire-edges
  hiddenEdges:
    - { from: lex, to: parse }
    - { from: ir, to: codegen }`,
      },
    ],
  },
  dependencies: {
    webPackages: [
      { name: 'react', version: '^19.3.1', purpose: 'UI runtime for the React Flow canvas (shared React island).', lazyLoad: true },
      { name: 'react-dom', version: '^19.3.1', purpose: 'React root rendering into the extension frame.', lazyLoad: true },
      { name: '@xyflow/react', version: '^13.0.2', purpose: 'Interactive node-edge canvas with pan, zoom, dragging, and connections.', lazyLoad: true },
      { name: '@dagrejs/dagre', version: '^3.1.3', purpose: 'Hierarchical automatic graph layout.', lazyLoad: true },
    ],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    host.replaceChildren(el('p', 'muted', 'Loading graph runtime…'));
    /** @type {ReactMount | null} */
    let handle = null;
    let destroyed = false;
    (async () => {
      try {
        const { GraphExtension } = await import('./interactive-graph-view.tsx');
        if (destroyed) return;
        handle = await mountReactComponent(host, GraphExtension, { data: props.data, host: props });
      } catch (error) {
        if (!destroyed) props.onError(error);
      }
    })();
    return {
      destroy() {
        destroyed = true;
        handle?.destroy();
      },
    };
  },
};
