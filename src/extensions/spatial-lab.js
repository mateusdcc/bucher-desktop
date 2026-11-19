/**
 * ext-3d-spatial-lab — interactive 3D geometry, linear algebra & surfaces.
 *
 * three.js + @react-three/fiber + drei, lazily loaded as a React island.
 * Three scene kinds: vector spaces with a live matrix-transformation morph
 * slider (I → M interpolation, 3Blue1Brown style), animated z=f(x,y) surfaces
 * (mathjs), and geometric solids — all with orbit camera, axes, and labels.
 * Challenge mode grades matrix entries: transformed vector tips must land on
 * target points. Solving marks the owning book exercise solved.
 *
 * The React view lives in spatial-lab-view.tsx (lazy, browser-only).
 *
 * @module extensions/spatial-lab
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

const expression = z.string().min(1).max(200);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb color.');
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const range = z.tuple([z.number(), z.number()]).refine(([min, max]) => max > min, 'Range max must exceed min.');

const paramSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Parameter names are identifiers.').max(20),
  min: z.number(),
  max: z.number(),
  step: z.number().positive().optional(),
  value: z.number().optional(),
}).refine(param => param.max > param.min, 'Parameter max must exceed min.');

const schema = z.object({
  ...blockMeta,
  kind: z.enum(['vectors', 'surface', 'solids']),
  mode: z.enum(['explore', 'challenge']).default('explore'),
  description: z.string().max(4000).optional(),
  vectors: z.array(z.object({
    to: vec3.describe('Vector tip; vectors start at the origin.'),
    label: z.string().max(40).optional(),
    color: color.optional(),
  })).min(1).max(8).optional(),
  transform: z.object({
    matrix: z.array(z.array(expression).length(3)).length(3)
      .describe('3×3 matrix; entries are mathjs expressions in the declared parameters.'),
    label: z.string().max(40).optional(),
  }).optional().describe('Morph slider interpolates I → M and applies it to every vector.'),
  targets: z.array(z.object({
    vector: z.number().int().min(0).describe('Index into vectors.'),
    position: vec3,
    tolerance: z.number().positive().max(2).default(0.15),
    label: z.string().max(40).optional(),
  })).min(1).max(8).optional(),
  surface: z.object({
    expr: expression.describe('z = f(x, y, params, t), mathjs syntax.'),
    xRange: range.default([-3, 3]),
    yRange: range.default([-3, 3]),
    resolution: z.number().int().min(8).max(80).default(40),
  }).optional(),
  solids: z.array(z.object({
    shape: z.enum(['box', 'sphere', 'cylinder', 'cone', 'torus']),
    position: vec3.default([0, 0, 0]),
    size: vec3.optional().describe('box [w,h,d]; sphere [r,0,0]; cylinder [rTop,rBottom,h]; cone [r,h,0]; torus [r,tube,0].'),
    color: color.optional(),
    label: z.string().max(40).optional(),
  })).min(1).max(10).optional(),
  params: z.array(paramSchema).max(6).optional(),
  animate: z.object({
    min: z.number().default(0),
    max: z.number().default(2 * Math.PI),
    speed: z.number().positive().max(10).default(1),
  }).optional().describe('Animates t (surface scenes).'),
}).superRefine((data, ctx) => {
  if (data.kind === 'vectors' && !(data.vectors && data.vectors.length)) {
    ctx.addIssue({ code: 'custom', path: ['vectors'], message: 'vectors kind requires at least one vector.' });
  }
  if (data.kind === 'surface' && !data.surface) {
    ctx.addIssue({ code: 'custom', path: ['surface'], message: 'surface kind requires a surface object.' });
  }
  if (data.kind === 'solids' && !(data.solids && data.solids.length)) {
    ctx.addIssue({ code: 'custom', path: ['solids'], message: 'solids kind requires at least one solid.' });
  }
  if (data.mode === 'challenge') {
    if (data.kind !== 'vectors' || !data.transform || !(data.targets && data.targets.length)) {
      ctx.addIssue({ code: 'custom', path: ['mode'], message: 'Challenge mode requires kind vectors with a transform and targets.' });
    }
  }
  (data.targets ?? []).forEach((target, index) => {
    if (!data.vectors || target.vector >= data.vectors.length) {
      ctx.addIssue({ code: 'custom', path: ['targets', index, 'vector'], message: 'target.vector index is out of range.' });
    }
  });
  const reserved = new Set(['x', 'y', 't', 'z', 'e', 'pi', 'i']);
  (data.params ?? []).forEach((param, index) => {
    if (reserved.has(param.name)) {
      ctx.addIssue({ code: 'custom', path: ['params', index, 'name'], message: `"${param.name}" is reserved (x/y/z/t/e/pi/i).` });
    }
  });
});

/** @typedef {import('zod').infer<typeof schema>} Payload */

/** @type {BucherExtension} */
export const spatialLabExtension = {
  id: 'ext-3d-spatial-lab',
  name: '3D Spatial Lab',
  version: '1.0.0',
  description: 'Orbitable 3D scenes: vector spaces with live matrix-transformation morphing, animated surfaces, and geometric solids — with graded transformation challenges.',
  category: 'hybrid',
  icon: 'box',
  skill: {
    instructions: `Use ext-3d-spatial-lab for spatial intuition: linear transformations of vector spaces, 3D surfaces z=f(x,y), and geometric solids. Readers orbit/zoom the camera; everything updates live. Rules:
- kind vectors: vectors [{ to: [x,y,z], label?, color? }] from the origin. Add transform { matrix: 3×3 of mathjs expressions in declared params } to get the morph slider: it interpolates identity → M and transforms every vector live (ghost originals stay visible). This is the flagship linear-algebra visual.
- kind surface: surface { expr: "sin(x)*cos(y)", xRange?, yRange?, resolution? } — mathjs in x, y, params, t. Add animate {min,max,speed} for motion and params for live sliders (amplitude, frequency…).
- kind solids: solids [{ shape: box|sphere|cylinder|cone|torus, position?, size?, color?, label? }]. size semantics: box [w,h,d]; sphere [r,0,0]; cylinder [rTop,rBottom,h]; cone [r,h,0]; torus [r,tube,0].
- mode challenge (vectors only): targets [{ vector: index, position: [x,y,z], tolerance? }] — the reader tunes the matrix parameters until each transformed vector tip (at morph=1) lands on its target. Choose targets reachable by the declared parameter ranges; tolerance 0.1–0.2.
- params: shared sliders; names must not be x/y/z/t/e/pi/i. Matrix entries and surface exprs reference them.
- Keep scenes focused: ≤4 vectors, ≤6 solids, resolution ≤48. Set a stable id and title; challenge blocks belong in chapters.`,
    syntaxSpec: `Fence info string: ext-3d-spatial-lab. YAML fields:
- kind: vectors | surface | solids (required). mode: explore | challenge (default explore). description: Markdown (optional).
- vectors: [{ to: [x,y,z], label?, color? }]; transform: { matrix: [[expr×3]×3], label? }.
- targets (challenge): [{ vector: int, position: [x,y,z], tolerance? (default 0.15), label? }].
- surface: { expr, xRange? ([-3,3]), yRange? ([-3,3]), resolution? (8–80, default 40) }.
- solids: [{ shape, position?, size?, color?, label? }].
- params: [{ name, min, max, step?, value? }]; animate: { min?, max?, speed? } (t animation, surfaces).`,
    fewShotExamples: [
      {
        title: 'Challenge: find the transformation matrix',
        yaml: `id: spatial-find-matrix
title: "Find the matrix A"
mode: challenge
kind: vectors
description: |
  Tune the entries of $A$ until the transformed basis vectors (solid arrows,
  morph slider at 1) land on the ghost targets. Drag the morph slider to watch
  the space deform.
vectors:
  - { to: [1, 0, 0], label: e1, color: "#e88f9f" }
  - { to: [0, 1, 0], label: e2, color: "#73d695" }
transform:
  label: A
  matrix:
    - [a, b, "0"]
    - [c, d, "0"]
    - ["0", "0", "1"]
params:
  - { name: a, min: -3, max: 3, step: 0.1, value: 1 }
  - { name: b, min: -3, max: 3, step: 0.1, value: 0 }
  - { name: c, min: -3, max: 3, step: 0.1, value: 0 }
  - { name: d, min: -3, max: 3, step: 0.1, value: 1 }
targets:
  - { vector: 0, position: [2, 1, 0], tolerance: 0.15, label: "A·e1" }
  - { vector: 1, position: [1, 2, 0], tolerance: 0.15, label: "A·e2" }`,
      },
      {
        title: 'Animated ripple surface',
        yaml: `id: spatial-ripple
title: "Ripple surface"
kind: surface
description: An animated wave surface — orbit with the mouse, scrub amplitude.
surface:
  expr: a * sin(x - t) * cos(y)
  xRange: [-4, 4]
  yRange: [-4, 4]
  resolution: 44
params:
  - { name: a, min: 0.2, max: 2, step: 0.05, value: 1 }
animate: { min: 0, max: 6.283185, speed: 1.5 }`,
      },
    ],
  },
  dependencies: {
    webPackages: [
      { name: 'three', version: '^0.187.0', purpose: 'WebGL 3D engine (scenes, meshes, arrows).', lazyLoad: true },
      { name: '@react-three/fiber', version: '^9.8.2', purpose: 'React renderer for three.js scenes.', lazyLoad: true },
      { name: '@react-three/drei', version: '^10.7.9', purpose: 'OrbitControls, Grid, Line, Html labels.', lazyLoad: true },
      { name: 'mathjs', version: '^15.2.0', purpose: 'Surface expressions and matrix-entry evaluation (shared runtime).', lazyLoad: true },
      { name: 'react', version: '^19.3.1', purpose: 'UI runtime for the 3D island (shared React island).', lazyLoad: true },
      { name: 'react-dom', version: '^19.3.1', purpose: 'React root rendering into the extension frame.', lazyLoad: true },
    ],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    host.replaceChildren(el('p', 'muted', 'Loading 3D engine…'));
    /** @type {ReactMount | null} */
    let handle = null;
    let destroyed = false;
    (async () => {
      try {
        const { SpatialLab } = await import('./spatial-lab-view.tsx');
        if (destroyed) return;
        handle = await mountReactComponent(host, SpatialLab, { data: props.data, host: props });
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
