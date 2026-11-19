/**
 * ext-desmos-lab — 60fps interactive math, calculus & parametric studio.
 *
 * A high-DPI canvas engine powered by mathjs (lazy-loaded) for evaluation and
 * symbolic derivatives, with KaTeX equation labels. Supports multiple
 * simultaneous curves, draggable control points wired to parameters, an
 * animated time parameter t (play/pause), shaded integral regions, derivative
 * tangent-line scrubbing, and a Challenge Mode where the reader tunes
 * parameters until the curve passes through target points (live geometric
 * verification marks the exercise solved).
 *
 * @module extensions/desmos-lab
 */
import { z } from 'zod';
import katex from 'katex';
import { el, icon, iconButton } from '../ui.js';
import { blockMeta, createValidator } from './validate.js';
import { trackRuntime } from './runtime.js';

/**
 * @typedef {import('./types.js').BucherExtension} BucherExtension
 * @typedef {import('./types.js').MountProps} MountProps
 * @typedef {import('./types.js').MountedExtension} MountedExtension
 * @typedef {{ xMin: number, xMax: number, yMin: number, yMax: number }} View
 * @typedef {{ evaluate: (scope: Record<string, number>) => number }} Compiled
 * @typedef {Object} FunctionCurve
 * @property {'function'} kind
 * @property {string} label
 * @property {string} tex
 * @property {string} color
 * @property {Compiled} compiled
 * @property {Compiled | null} derivative
 * @property {{ from: number, to: number } | null} area
 * @property {boolean} tangent
 * @typedef {Object} ParametricCurve
 * @property {'parametric'} kind
 * @property {string} label
 * @property {string} tex
 * @property {string} color
 * @property {Compiled} xCompiled
 * @property {Compiled} yCompiled
 * @property {[number, number]} tRange
 */

const expression = z.string().min(1).max(500);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb color.');
const range = z.tuple([z.number(), z.number()]).refine(([min, max]) => max > min, 'Range max must exceed min.');

const paramSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Parameter names are identifiers.').max(20),
  min: z.number(),
  max: z.number(),
  step: z.number().positive().optional(),
  value: z.number().optional().describe('Initial value; defaults to the midpoint.'),
}).refine(param => param.max > param.min, 'Parameter max must exceed min.');

const curveSchema = z.object({
  kind: z.enum(['function', 'parametric']).default('function'),
  expr: expression.optional().describe('Function curve: y = f(x, t, params).'),
  xExpr: expression.optional().describe('Parametric curve: x(t).'),
  yExpr: expression.optional().describe('Parametric curve: y(t).'),
  tRange: range.optional().describe('Parametric t domain; defaults to [0, 2*pi].'),
  label: z.string().max(60).optional(),
  color: color.optional(),
  area: z.object({ from: z.number(), to: z.number() }).optional()
    .describe('Shade the signed area under a function curve between from and to.'),
  tangent: z.boolean().optional().describe('Enable hover tangent-line scrubbing (function curves).'),
}).refine(
  curve => curve.kind === 'function' ? Boolean(curve.expr) : Boolean(curve.xExpr && curve.yExpr),
  'Function curves need expr; parametric curves need xExpr and yExpr.',
);

const draggableSchema = z.object({
  paramX: z.string().max(20).optional().describe('Parameter whose value the point\u2019s x-coordinate drives.'),
  paramY: z.string().max(20).optional().describe('Parameter whose value the point\u2019s y-coordinate drives.'),
  x: z.number().optional().describe('Fixed x when paramX is absent.'),
  y: z.number().optional().describe('Fixed y when paramY is absent.'),
  label: z.string().max(40).optional(),
  color: color.optional(),
}).refine(point => Boolean(point.paramX || point.paramY), 'A draggable must drive paramX and/or paramY.');

const targetSchema = z.object({
  x: z.number(),
  y: z.number(),
  tolerance: z.number().positive().max(5).default(0.2),
  label: z.string().max(40).optional(),
});

const schema = z.object({
  ...blockMeta,
  mode: z.enum(['explore', 'challenge']).default('explore'),
  xRange: range.default([-10, 10]),
  yRange: range.optional(),
  curves: z.array(curveSchema).min(1).max(6),
  params: z.array(paramSchema).max(8).optional(),
  draggables: z.array(draggableSchema).max(6).optional(),
  targets: z.array(targetSchema).max(8).optional(),
  challengeCurve: z.number().int().min(0).optional().describe('Index of the function curve targets are checked against; defaults to 0.'),
  animate: z.object({
    min: z.number().default(0),
    max: z.number().default(2 * Math.PI),
    speed: z.number().positive().max(10).default(1),
  }).optional().describe('Animates the shared time parameter t from min to max.'),
}).superRefine((data, ctx) => {
  if (data.mode === 'challenge' && !(data.targets && data.targets.length)) {
    ctx.addIssue({ code: 'custom', path: ['targets'], message: 'Challenge mode requires at least one target point.' });
  }
  const names = new Set((data.params ?? []).map(param => param.name));
  (data.draggables ?? []).forEach((point, index) => {
    if (point.paramX && !names.has(point.paramX)) {
      ctx.addIssue({ code: 'custom', path: ['draggables', index, 'paramX'], message: `paramX "${point.paramX}" is not a declared parameter.` });
    }
    if (point.paramY && !names.has(point.paramY)) {
      ctx.addIssue({ code: 'custom', path: ['draggables', index, 'paramY'], message: `paramY "${point.paramY}" is not a declared parameter.` });
    }
  });
  if (data.challengeCurve != null) {
    const curve = data.curves[data.challengeCurve];
    if (!curve) ctx.addIssue({ code: 'custom', path: ['challengeCurve'], message: 'challengeCurve index is out of range.' });
    else if (curve.kind !== 'function') ctx.addIssue({ code: 'custom', path: ['challengeCurve'], message: 'challengeCurve must reference a function curve.' });
  }
});

/** @typedef {import('zod').infer<typeof schema>} Payload */

const PALETTE = ['#73d695', '#6fb7e8', '#e8a86f', '#b48fe8', '#e8d06f', '#e88f9f'];
const HEIGHT = 360;

/** @type {BucherExtension} */
export const desmosLabExtension = {
  id: 'ext-desmos-lab',
  name: 'Desmos Math Studio',
  version: '1.0.0',
  description: '60fps graphing studio: draggable control points, animated time, tangent scrubbing, shaded integrals, and fit-the-curve challenges.',
  category: 'hybrid',
  icon: 'sigma',
  skill: {
    instructions: `Use ext-desmos-lab for direct-manipulation mathematics: exploring how parameters reshape a curve, calculus visuals (tangent lines, signed area), parametric motion, and "fit the curve" challenges. Prefer it over ext-math-plot when the reader should DRAG points or hit target points, not just watch sliders. Rules:
- Expressions are mathjs syntax in x (function curves) or t (parametric), plus declared parameters and constants pi/e. Operators + - * / ^, functions sin cos tan asin acos atan exp ln log sqrt abs floor ceil round min max pow. Implicit multiplication (2x, a(x+1)) works.
- Every symbol must be x/t, a constant, or a parameter declared in params. Never reference undeclared symbols.
- curves: kind function needs expr (y=...); kind parametric needs xExpr and yExpr (in t). Add tangent: true to a function curve to let readers scrub a live tangent line; add area: {from, to} to shade a signed integral.
- draggables: points the reader drags on the canvas. paramX/paramY name the parameter each coordinate drives (must be declared in params). Dragging updates the parameter and re-plots every curve live — the core "wow" interaction. Use for vertices, intercepts, amplitude/phase handles.
- mode challenge: add targets [{x, y, tolerance}] and set challengeCurve to the function curve index that must pass through them. The reader tunes params/draggables until every target is within tolerance; solving marks the exercise complete. Choose reachable targets and generous tolerance (0.1–0.3).
- animate: {min, max, speed} animates the shared parameter t (play/pause). Reference t in expressions for motion.
- Keep xRange/yRange tight around the action. Declare 1–4 params with sensible ranges and initial values. Set a stable id and title; one idea per block.`,
    syntaxSpec: `Fence info string: ext-desmos-lab. YAML fields:
- mode: explore | challenge (default explore). xRange [min,max] (default [-10,10]); yRange optional (auto-fit).
- curves (1–6): { kind: function|parametric, expr (function) OR xExpr+yExpr (parametric), tRange?, label?, color?, area?: {from,to}, tangent?: bool }.
- params: [{ name, min, max, step?, value? }] — live sliders shared by all curves.
- draggables: [{ paramX?, paramY?, x?, y?, label?, color? }] — canvas points driving declared parameters.
- targets (challenge): [{ x, y, tolerance? (default 0.2), label? }]; challengeCurve: function-curve index (default 0).
- animate: { min?, max?, speed? } — animates parameter t.`,
    fewShotExamples: [
      {
        title: 'Draggable parabola vertex with tangent and area',
        yaml: `id: desmos-vertex
title: Drag the vertex of a parabola
mode: explore
xRange: [-6, 6]
yRange: [-4, 8]
curves:
  - kind: function
    expr: a*(x-h)^2 + k
    label: f(x)
    tangent: true
    area: { from: 0, to: 2 }
params:
  - { name: a, min: -3, max: 3, step: 0.1, value: 1 }
  - { name: h, min: -4, max: 4, step: 0.1, value: 0 }
  - { name: k, min: -3, max: 5, step: 0.1, value: 0 }
draggables:
  - { paramX: h, paramY: k, label: vertex, color: "#e8d06f" }`,
      },
      {
        title: 'Fit a line through two target points',
        yaml: `id: desmos-fit-line
title: Fit the line through P1 and P2
mode: challenge
xRange: [-1, 5]
yRange: [-1, 7]
curves:
  - kind: function
    expr: m*x + b
    label: y = m x + b
    color: "#73d695"
params:
  - { name: m, min: -4, max: 4, step: 0.05, value: 0 }
  - { name: b, min: -4, max: 6, step: 0.05, value: 0 }
draggables:
  - { paramY: b, x: 0, label: intercept, color: "#6fb7e8" }
targets:
  - { x: 1, y: 2, tolerance: 0.15, label: P1 }
  - { x: 3, y: 4, tolerance: 0.15, label: P2 }
challengeCurve: 0`,
      },
    ],
  },
  dependencies: {
    webPackages: [
      { name: 'mathjs', version: '^15.2.0', purpose: 'Expression evaluation, symbolic derivatives, and numeric calculus.', lazyLoad: true },
      { name: 'katex', version: '^0.19.1', purpose: 'Live LaTeX rendering of curve equations in the legend.', lazyLoad: false },
    ],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    return mountDesmos(host, props);
  },
};

/** @param {number[]} values @param {number} q */
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** @param {number} span @param {number} target */
function niceStep(span, target) {
  const raw = span / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / magnitude;
  return (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * magnitude;
}

/** @param {number} value */
function formatTick(value) {
  return Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)
    ? value.toExponential(1)
    : String(Number(value.toPrecision(6)));
}

/**
 * Composite Simpson integral of a sampled function.
 * @param {(x: number) => number} fn
 * @param {number} a
 * @param {number} b
 */
function integral(fn, a, b) {
  if (a === b) return 0;
  let lo = a; let hi = b; let sign = 1;
  if (lo > hi) { const tmp = lo; lo = hi; hi = tmp; sign = -1; }
  const n = 200;
  const h = (hi - lo) / n;
  let sum = fn(lo) + fn(hi);
  if (!Number.isFinite(sum)) return NaN;
  for (let i = 1; i < n; i += 1) {
    const value = fn(lo + i * h);
    if (!Number.isFinite(value)) return NaN;
    sum += (i % 2 ? 4 : 2) * value;
  }
  return sign * sum * h / 3;
}

/**
 * @param {HTMLElement} host
 * @param {MountProps} props
 * @returns {MountedExtension}
 */
function mountDesmos(host, props) {
  const data = /** @type {Payload} */ (props.data);
  const saved = props.savedState ?? {};
  let destroyed = false;
  /** @type {(() => void) | null} */
  let teardown = null;

  const loadingWrap = el('div', 'desmos-extension', el('p', 'muted desmos-loading', 'Loading math engine…'));
  host.append(loadingWrap);

  (async () => {
    try {
      const math = await trackRuntime('mathjs', () => import('mathjs'));
      if (destroyed) return;
      loadingWrap.remove();
      teardown = initEngine(host, props, data, saved, math);
    } catch (error) {
      if (!destroyed) props.onError(error);
    }
  })();

  return {
    destroy() {
      destroyed = true;
      teardown?.();
    },
  };
}

/**
 * @param {HTMLElement} host
 * @param {MountProps} props
 * @param {Payload} data
 * @param {Record<string, unknown>} saved
 * @param {any} math
 * @returns {() => void}
 */
function initEngine(host, props, data, saved, math) {
  const paramDefs = data.params ?? [];
  /** @type {Record<string, number>} */
  const params = {};
  for (const param of paramDefs) {
    const stored = /** @type {Record<string, unknown>} */ (saved.params ?? {})[param.name];
    params[param.name] = typeof stored === 'number' && stored >= param.min && stored <= param.max
      ? stored
      : param.value ?? (param.min + param.max) / 2;
  }
  const scope = () => ({ ...params, t });

  // Compile curves (and symbolic derivatives for tangent-enabled functions).
  /** @type {(FunctionCurve | ParametricCurve)[]} */
  const curves = data.curves.map((curve, index) => {
    const colorHex = curve.color ?? PALETTE[index % PALETTE.length];
    if (curve.kind === 'function') {
      const node = math.parse(/** @type {string} */ (curve.expr));
      const compiled = /** @type {Compiled} */ (node.compile());
      /** @type {Compiled | null} */
      let derivative = null;
      if (curve.tangent) {
        try { derivative = /** @type {Compiled} */ (math.derivative(node, 'x').compile()); } catch { derivative = null; }
      }
      /** @type {FunctionCurve} */
      const result = {
        kind: 'function',
        label: curve.label ?? `f${index + 1}(x)`,
        tex: node.toTex(),
        color: colorHex,
        compiled,
        derivative,
        area: curve.area ?? null,
        tangent: Boolean(curve.tangent),
      };
      return result;
    }
    /** @type {ParametricCurve} */
    const result = {
      kind: 'parametric',
      label: curve.label ?? `curve ${index + 1}`,
      tex: `(${math.parse(/** @type {string} */ (curve.xExpr)).toTex()},\\ ${math.parse(/** @type {string} */ (curve.yExpr)).toTex()})`,
      color: colorHex,
      xCompiled: /** @type {Compiled} */ (math.parse(/** @type {string} */ (curve.xExpr)).compile()),
      yCompiled: /** @type {Compiled} */ (math.parse(/** @type {string} */ (curve.yExpr)).compile()),
      tRange: curve.tRange ?? [0, 2 * Math.PI],
    };
    return result;
  });

  /** @type {View | null} */
  let view = isView(saved.view) ? saved.view : null;
  let t = typeof saved.t === 'number' ? saved.t : (data.animate?.min ?? 0);
  let playing = false;
  /** @type {number | null} */
  let tangentX = null;
  /** @type {number | null} */
  let hoverX = null;
  let rafId = /** @type {number | null} */ (null);
  let lastFrame = 0;
  const mountedStatus = typeof saved.status === 'string' ? saved.status : 'unsolved';
  let firedComplete = false;
  let touched = Boolean(saved.touched);

  /** @param {unknown} value @returns {value is View} */
  function isView(value) {
    if (!value || typeof value !== 'object') return false;
    const candidate = /** @type {Record<string, unknown>} */ (value);
    return ['xMin', 'xMax', 'yMin', 'yMax'].every(key => typeof candidate[key] === 'number')
      && /** @type {number} */ (candidate.xMax) > /** @type {number} */ (candidate.xMin)
      && /** @type {number} */ (candidate.yMax) > /** @type {number} */ (candidate.yMin);
  }

  /** @param {Compiled} compiled @param {number} x */
  function evalAt(compiled, x) {
    try {
      const value = compiled.evaluate({ ...scope(), x });
      return typeof value === 'number' && Number.isFinite(value) ? value : NaN;
    } catch {
      return NaN;
    }
  }

  /** @returns {View} */
  function autoView() {
    const [xMin, xMax] = data.xRange;
    if (data.yRange) return { xMin, xMax, yMin: data.yRange[0], yMax: data.yRange[1] };
    /** @type {number[]} */
    const ys = [];
    const sample = (/** @type {number} */ y) => { if (Number.isFinite(y)) ys.push(y); };
    for (const curve of curves) {
      if (curve.kind === 'function') {
        for (let i = 0; i <= 240; i += 1) sample(evalAt(curve.compiled, xMin + (xMax - xMin) * i / 240));
      } else {
        for (let i = 0; i <= 240; i += 1) {
          const tt = curve.tRange[0] + (curve.tRange[1] - curve.tRange[0]) * i / 240;
          try { sample(curve.yCompiled.evaluate({ ...scope(), t: tt })); } catch { /* skip */ }
        }
      }
    }
    for (const target of data.targets ?? []) sample(target.y);
    if (!ys.length) return { xMin, xMax, yMin: -1, yMax: 1 };
    let yMin = quantile(ys, 0.02);
    let yMax = quantile(ys, 0.98);
    if (yMax - yMin < 1e-9) { yMin -= 1; yMax += 1; }
    const pad = (yMax - yMin) * 0.1;
    return { xMin, xMax, yMin: yMin - pad, yMax: yMax + pad };
  }

  // ----- DOM -----
  const legend = el('div', 'desmos-legend');
  /** @type {{ curve: FunctionCurve, node: HTMLElement }[]} */
  const areaReadouts = [];
  for (const curve of curves) {
    const swatch = el('span', 'desmos-swatch');
    swatch.style.background = curve.color;
    const tex = el('span', 'desmos-tex');
    tex.innerHTML = katex.renderToString(curve.tex, { throwOnError: false });
    const item = el('span', 'desmos-legend-item', swatch, tex);
    if (curve.kind === 'function' && curve.area) {
      const value = el('span', 'desmos-area-value muted');
      item.append(value);
      areaReadouts.push({ curve, node: value });
    }
    legend.append(item);
  }
  const canvas = /** @type {HTMLCanvasElement} */ (el('canvas', 'desmos-canvas'));
  canvas.style.height = HEIGHT + 'px';
  const readout = el('div', 'desmos-readout');
  readout.hidden = true;
  const wrap = el('div', 'desmos-wrap', canvas, readout);
  const challengeLine = el('div', 'desmos-challenge');
  const sliders = el('div', 'desmos-sliders');
  /** @type {Record<string, { input: HTMLInputElement, label: HTMLElement }>} */
  const sliderRefs = {};
  for (const param of paramDefs) {
    const valueLabel = el('span', 'desmos-param-value', formatTick(params[param.name]));
    const input = /** @type {HTMLInputElement} */ (el('input', 'desmos-param-slider'));
    input.type = 'range';
    input.min = String(param.min);
    input.max = String(param.max);
    input.step = String(param.step ?? (param.max - param.min) / 200);
    input.value = String(params[param.name]);
    input.setAttribute('aria-label', `Parameter ${param.name}`);
    input.addEventListener('input', () => {
      params[param.name] = Number(input.value);
      valueLabel.textContent = formatTick(params[param.name]);
      touched = true;
      afterParamChange();
    });
    sliderRefs[param.name] = { input, label: valueLabel };
    sliders.append(el('label', 'desmos-param', el('span', 'desmos-param-name', param.name), input, valueLabel));
  }

  const playButton = iconButton('Play animation', 'play', () => togglePlay());
  const tLabel = el('span', 'muted desmos-t', `t = ${formatTick(t)}`);
  const toolbar = el('div', 'desmos-toolbar',
    data.animate ? playButton : null,
    data.animate ? tLabel : null,
    iconButton('Reset view', 'scan', () => { view = null; draw(); persist(); }),
    el('span', 'muted desmos-hint', data.mode === 'challenge'
      ? 'Drag points / sliders to hit every target'
      : 'Drag points · hover for tangent · scroll to zoom'));
  host.append(el('div', 'desmos-extension', legend, toolbar, wrap, challengeLine, sliders));

  function syncSliders() {
    for (const param of paramDefs) {
      const ref = sliderRefs[param.name];
      ref.input.value = String(params[param.name]);
      ref.label.textContent = formatTick(params[param.name]);
    }
  }

  function togglePlay() {
    if (!data.animate) return;
    playing = !playing;
    playButton.replaceChildren(icon(playing ? 'pause' : 'play'));
    playButton.setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
    playButton.title = playing ? 'Pause animation' : 'Play animation';
    if (playing) { lastFrame = performance.now(); startLoop(); }
    else persist();
  }

  function startLoop() {
    if (rafId == null) rafId = requestAnimationFrame(tick);
  }

  /** @param {number} now */
  function tick(now) {
    rafId = null;
    if (!playing || !data.animate) return;
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    const { min, max, speed } = data.animate;
    t += speed * dt;
    if (t > max) t = min + (t - max);
    tLabel.textContent = `t = ${formatTick(t)}`;
    draw();
    rafId = requestAnimationFrame(tick);
  }

  function afterParamChange() {
    draw();
    persist();
  }

  // ----- Challenge verification -----
  function checkChallenge() {
    if (data.mode !== 'challenge' || !(data.targets && data.targets.length)) return 'unsolved';
    const curveIndex = data.challengeCurve ?? 0;
    const curve = curves[curveIndex];
    if (!curve || curve.kind !== 'function') return 'unsolved';
    let allPass = true;
    const parts = [];
    for (const target of data.targets) {
      const y = evalAt(curve.compiled, target.x);
      const distance = Number.isFinite(y) ? Math.abs(y - target.y) : Infinity;
      const pass = distance <= target.tolerance;
      if (!pass) allPass = false;
      const name = target.label ?? `(${formatTick(target.x)}, ${formatTick(target.y)})`;
      parts.push(`${name}: ${pass ? '✓' : `Δ ${Number.isFinite(distance) ? formatTick(distance) : '—'}`}`);
    }
    challengeLine.textContent = parts.join('   ·   ');
    challengeLine.dataset.state = allPass ? 'passed' : 'open';
    if (allPass) return 'passed';
    return touched ? 'in-progress' : 'unsolved';
  }

  function persist() {
    const status = checkChallenge();
    props.onSaveState({ params: { ...params }, view, t, status, touched });
    if (status === 'passed' && mountedStatus !== 'passed' && !firedComplete) {
      firedComplete = true;
      props.onComplete();
    }
  }

  // ----- Drawing -----
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    if (!width) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    canvas.style.width = width + 'px';
    const maybeCtx = canvas.getContext('2d');
    if (!maybeCtx) return;
    const ctx = maybeCtx;
    ctx.scale(dpr, dpr);
    const box = view ?? autoView();
    const sx = (/** @type {number} */ x) => (x - box.xMin) / (box.xMax - box.xMin) * width;
    const sy = (/** @type {number} */ y) => HEIGHT - (y - box.yMin) / (box.yMax - box.yMin) * HEIGHT;

    ctx.clearRect(0, 0, width, HEIGHT);
    ctx.fillStyle = '#161816';
    ctx.fillRect(0, 0, width, HEIGHT);

    // Grid + ticks.
    ctx.font = '11px Inter Variable, system-ui, sans-serif';
    const xStep = niceStep(box.xMax - box.xMin, 8);
    const yStep = niceStep(box.yMax - box.yMin, 6);
    ctx.strokeStyle = '#242824';
    ctx.fillStyle = '#8b8e85';
    ctx.lineWidth = 1;
    for (let x = Math.ceil(box.xMin / xStep) * xStep; x <= box.xMax; x += xStep) {
      const px = sx(x);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, HEIGHT); ctx.stroke();
      ctx.fillText(formatTick(x), px + 3, HEIGHT - 5);
    }
    for (let y = Math.ceil(box.yMin / yStep) * yStep; y <= box.yMax; y += yStep) {
      const py = sy(y);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke();
      ctx.fillText(formatTick(y), 4, py - 3);
    }
    ctx.strokeStyle = '#4a504a';
    if (box.yMin < 0 && box.yMax > 0) {
      const py = sy(0); ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke();
    }
    if (box.xMin < 0 && box.xMax > 0) {
      const px = sx(0); ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, HEIGHT); ctx.stroke();
    }

    /**
     * @param {{x:number,y:number}[]} points
     * @param {string} stroke
     */
    function polyline(points, stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let pen = false;
      for (const point of points) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) { pen = false; continue; }
        const px = sx(point.x); const py = sy(point.y);
        if (py < -HEIGHT * 2 || py > HEIGHT * 3) { pen = false; continue; }
        if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // Integral shading + curves.
    for (const curve of curves) {
      if (curve.kind === 'function') {
        if (curve.area) {
          const { from, to } = curve.area;
          ctx.fillStyle = curve.color + '33';
          ctx.beginPath();
          const steps = 120;
          ctx.moveTo(sx(from), sy(0));
          for (let i = 0; i <= steps; i += 1) {
            const x = from + (to - from) * i / steps;
            const y = evalAt(curve.compiled, x);
            ctx.lineTo(sx(x), sy(Number.isFinite(y) ? y : 0));
          }
          ctx.lineTo(sx(to), sy(0));
          ctx.closePath();
          ctx.fill();
        }
        /** @type {{x:number,y:number}[]} */
        const points = [];
        for (let px = 0; px <= width; px += 1) {
          const x = box.xMin + (box.xMax - box.xMin) * px / width;
          points.push({ x, y: evalAt(curve.compiled, x) });
        }
        polyline(points, curve.color);
      } else {
        /** @type {{x:number,y:number}[]} */
        const points = [];
        for (let i = 0; i <= 600; i += 1) {
          const tt = curve.tRange[0] + (curve.tRange[1] - curve.tRange[0]) * i / 600;
          try {
            points.push({
              x: curve.xCompiled.evaluate({ ...scope(), t: tt }),
              y: curve.yCompiled.evaluate({ ...scope(), t: tt }),
            });
          } catch { points.push({ x: NaN, y: NaN }); }
        }
        polyline(points, curve.color);
      }
    }

    // Tangent scrubbing.
    const readoutLines = [];
    if (tangentX != null) {
      for (const curve of curves) {
        if (curve.kind !== 'function' || !curve.tangent || !curve.derivative) continue;
        const y0 = evalAt(curve.compiled, tangentX);
        let slope = NaN;
        try { slope = curve.derivative.evaluate({ ...scope(), x: tangentX }); } catch { slope = NaN; }
        if (!Number.isFinite(y0) || !Number.isFinite(slope)) continue;
        ctx.strokeStyle = '#e8d06f';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(sx(box.xMin), sy(y0 + slope * (box.xMin - tangentX)));
        ctx.lineTo(sx(box.xMax), sy(y0 + slope * (box.xMax - tangentX)));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#e8d06f';
        ctx.beginPath(); ctx.arc(sx(tangentX), sy(y0), 4, 0, 2 * Math.PI); ctx.fill();
        readoutLines.push(`${curve.label}: slope ${formatTick(slope)} at x=${formatTick(tangentX)}`);
      }
    } else if (hoverX != null) {
      for (const curve of curves) {
        if (curve.kind !== 'function') continue;
        const y = evalAt(curve.compiled, hoverX);
        if (Number.isFinite(y)) {
          ctx.fillStyle = curve.color;
          ctx.beginPath(); ctx.arc(sx(hoverX), sy(y), 3.5, 0, 2 * Math.PI); ctx.fill();
          readoutLines.push(`${curve.label}(${formatTick(hoverX)}) = ${formatTick(y)}`);
        }
      }
    }

    // Target points (challenge).
    if (data.mode === 'challenge') {
      const curveIndex = data.challengeCurve ?? 0;
      const curve = curves[curveIndex];
      for (const target of data.targets ?? []) {
        const y = curve && curve.kind === 'function' ? evalAt(curve.compiled, target.x) : NaN;
        const pass = Number.isFinite(y) && Math.abs(y - target.y) <= target.tolerance;
        const px = sx(target.x); const py = sy(target.y);
        ctx.strokeStyle = pass ? '#73d695' : '#e8927c';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, 8, 0, 2 * Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px - 4, py); ctx.lineTo(px + 4, py); ctx.moveTo(px, py - 4); ctx.lineTo(px, py + 4); ctx.stroke();
        if (target.label) {
          ctx.fillStyle = pass ? '#73d695' : '#e8927c';
          ctx.fillText(target.label, px + 10, py - 8);
        }
      }
    }

    // Draggable control points.
    for (const point of data.draggables ?? []) {
      const px = sx(point.paramX ? params[point.paramX] : (point.x ?? 0));
      const py = sy(point.paramY ? params[point.paramY] : (point.y ?? 0));
      ctx.fillStyle = point.color ?? '#e8d06f';
      ctx.strokeStyle = '#161816';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 8, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      if (point.label) {
        ctx.fillStyle = '#deded9';
        ctx.fillText(point.label, px + 11, py + 4);
      }
    }

    if (readoutLines.length) {
      readout.textContent = readoutLines.join('\n');
      readout.hidden = false;
    } else readout.hidden = true;

    // Live integral values in the legend.
    for (const { curve, node } of areaReadouts) {
      const area = /** @type {{ from: number, to: number }} */ (curve.area);
      const value = integral(x => evalAt(curve.compiled, x), area.from, area.to);
      node.textContent = `∫[${formatTick(area.from)}, ${formatTick(area.to)}] = ${Number.isFinite(value) ? formatTick(value) : '—'}`;
    }
  }

  // ----- Interaction -----
  /** @param {PointerEvent} event */
  function worldFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const box = view ?? autoView();
    return {
      x: box.xMin + (event.clientX - rect.left) / rect.width * (box.xMax - box.xMin),
      y: box.yMin + (1 - (event.clientY - rect.top) / rect.height) * (box.yMax - box.yMin),
      rect,
    };
  }

  /** @type {{ index: number } | null} */
  let dragPoint = null;
  /** @type {{ px: number, py: number, box: View } | null} */
  let pan = null;

  wrap.addEventListener('pointerdown', /** @param {PointerEvent} event */ event => {
    if (event.button !== 0) return;
    const { x, y, rect } = worldFromEvent(event);
    const box = view ?? autoView();
    // Hit-test draggable points (screen-space radius).
    const hit = (data.draggables ?? []).findIndex(point => {
      const wx = point.paramX ? params[point.paramX] : (point.x ?? 0);
      const wy = point.paramY ? params[point.paramY] : (point.y ?? 0);
      const dx = (wx - x) / (box.xMax - box.xMin) * rect.width;
      const dy = (wy - y) / (box.yMax - box.yMin) * rect.height;
      return Math.hypot(dx, dy) <= 14;
    });
    wrap.setPointerCapture(event.pointerId);
    if (hit >= 0) {
      dragPoint = { index: hit };
      wrap.classList.add('dragging');
    } else {
      pan = { px: event.clientX, py: event.clientY, box };
      wrap.classList.add('dragging');
    }
  });

  wrap.addEventListener('pointermove', /** @param {PointerEvent} event */ event => {
    const { x, y, rect } = worldFromEvent(event);
    if (dragPoint) {
      const point = (data.draggables ?? [])[dragPoint.index];
      if (point.paramX) {
        const def = paramDefs.find(param => param.name === point.paramX);
        if (def) params[point.paramX] = Math.min(def.max, Math.max(def.min, x));
      }
      if (point.paramY) {
        const def = paramDefs.find(param => param.name === point.paramY);
        if (def) params[point.paramY] = Math.min(def.max, Math.max(def.min, y));
      }
      touched = true;
      syncSliders();
      afterParamChange();
      return;
    }
    if (pan) {
      const dx = (event.clientX - pan.px) / rect.width * (pan.box.xMax - pan.box.xMin);
      const dy = (event.clientY - pan.py) / rect.height * (pan.box.yMax - pan.box.yMin);
      view = { xMin: pan.box.xMin - dx, xMax: pan.box.xMax - dx, yMin: pan.box.yMin + dy, yMax: pan.box.yMax + dy };
      draw();
      persist();
      return;
    }
    const hasTangent = curves.some(curve => curve.kind === 'function' && curve.tangent && curve.derivative);
    if (hasTangent) { tangentX = x; hoverX = null; }
    else { hoverX = x; tangentX = null; }
    draw();
  });

  const endDrag = () => {
    if (dragPoint) persist();
    dragPoint = null;
    pan = null;
    wrap.classList.remove('dragging');
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('pointerleave', () => {
    tangentX = null;
    hoverX = null;
    draw();
  });

  wrap.addEventListener('wheel', /** @param {WheelEvent} event */ event => {
    event.preventDefault();
    const box = view ?? autoView();
    const rect = canvas.getBoundingClientRect();
    const fx = (event.clientX - rect.left) / rect.width;
    const fy = 1 - (event.clientY - rect.top) / rect.height;
    const factor = event.deltaY < 0 ? 1 / 1.15 : 1.15;
    const xSpan = (box.xMax - box.xMin) * factor;
    const ySpan = (box.yMax - box.yMin) * factor;
    const xAt = box.xMin + fx * (box.xMax - box.xMin);
    const yAt = box.yMin + fy * (box.yMax - box.yMin);
    view = { xMin: xAt - fx * xSpan, xMax: xAt + (1 - fx) * xSpan, yMin: yAt - fy * ySpan, yMax: yAt + (1 - fy) * ySpan };
    draw();
    persist();
  }, { passive: false });

  const resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe(wrap);
  draw();
  // Initialize challenge feedback without firing completion for restored state.
  checkChallenge();

  return () => {
    playing = false;
    if (rafId != null) cancelAnimationFrame(rafId);
    resizeObserver.disconnect();
  };
}
