/**
 * ext-math-plot — interactive function, parametric, and data plotter.
 *
 * Canvas engine with a safe expression interpreter (no eval), live parameter
 * sliders, hover readouts, and wheel/drag navigation. Slider values and the
 * viewport persist with the book progress.
 *
 * @module extensions/math-plot
 */
import { z } from 'zod';
import { el, iconButton } from '../ui.js';
import { compileExpression } from './lib/expression.js';
import { blockMeta, createValidator } from './validate.js';

/**
 * @typedef {import('./types.js').BucherExtension} BucherExtension
 * @typedef {import('./types.js').MountProps} MountProps
 * @typedef {import('./types.js').MountedExtension} MountedExtension
 */

const expression = z.string().min(1).max(500);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #rrggbb color.');
const range = z.tuple([z.number(), z.number()]).refine(([min, max]) => max > min, 'Range max must exceed min.');

const schema = z.object({
  ...blockMeta,
  xRange: range.default([-10, 10]),
  yRange: range.optional(),
  functions: z.array(z.object({
    expr: expression.describe('Expression in x and declared parameters, e.g. "a*sin(b*x)".'),
    label: z.string().max(60).optional(),
    color: color.optional(),
  })).max(6).optional(),
  parametric: z.array(z.object({
    x: expression.describe('x(t) expression.'),
    y: expression.describe('y(t) expression.'),
    tRange: range.optional().describe('Defaults to [0, 2*pi].'),
    label: z.string().max(60).optional(),
    color: color.optional(),
  })).max(4).optional(),
  data: z.array(z.object({
    name: z.string().max(60),
    points: z.array(z.tuple([z.number(), z.number()])).min(1).max(2000),
    color: color.optional(),
  })).max(6).optional(),
  params: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Parameter names are identifiers.').max(20),
    min: z.number(),
    max: z.number(),
    step: z.number().positive().optional(),
    value: z.number().optional().describe('Initial value; defaults to the midpoint.'),
  }).refine(param => param.max > param.min, 'Parameter max must exceed min.')).max(8).optional(),
}).refine(
  data => Boolean(data.functions?.length || data.parametric?.length || data.data?.length),
  'Provide at least one of functions, parametric, or data.',
);

/** @typedef {import('zod').infer<typeof schema>} Payload */
/** @typedef {{ xMin: number, xMax: number, yMin: number, yMax: number }} View */

const PALETTE = ['#73d695', '#6fb7e8', '#e8a86f', '#b48fe8', '#e8d06f', '#e88f9f'];
const HEIGHT = 320;

/** @type {BucherExtension} */
export const mathPlotExtension = {
  id: 'ext-math-plot',
  name: 'Function & Data Plotter',
  version: '1.0.0',
  description: 'Plot functions, parametric curves, and datasets on an interactive canvas with live parameter sliders.',
  category: 'visualization',
  icon: 'line-chart',
  skill: {
    instructions: `Use ext-math-plot whenever seeing a curve beats reading about it: function families, the effect of parameters, parametric motion, convergence of sequences, or small datasets. Rules:
- Expressions use x (or t for parametric), declared parameters, constants pi/e/tau, operators + - * / % ^, and functions sin cos tan asin acos atan sinh cosh tanh exp ln log log10 log2 sqrt abs floor ceil round sign min max pow atan2. Implicit multiplication like 2x or a(x+1) works.
- Every symbol in an expression must be x/t, a constant, or a parameter declared in params with a slider range. Never reference undeclared symbols.
- Declare 1–4 parameters with sensible min/max/step and an initial value so the default view is instructive.
- Keep xRange tight around the interesting region. Omit yRange to auto-fit.
- Use functions for y=f(x), parametric for (x(t), y(t)), data for explicit point lists. One block per idea; set a stable id and title.`,
    syntaxSpec: `Fence info string: ext-math-plot. YAML fields:
- xRange ([min, max], optional, default [-10, 10]); yRange ([min, max], optional, auto-fit when omitted).
- functions: list of { expr (required), label?, color? (#rrggbb) }.
- parametric: list of { x, y (expressions in t), tRange? (default [0, 6.283185]), label?, color? }.
- data: list of { name, points: [[x, y], …], color? }.
- params: list of { name, min, max, step?, value? } — live sliders shared by all expressions.
At least one of functions / parametric / data is required.`,
    fewShotExamples: [
      {
        title: 'Quadratic family with live coefficients',
        yaml: `id: quadratic-family
title: Exploring a·x² + b·x + c
xRange: [-6, 6]
functions:
  - expr: a*x^2 + b*x + c
    label: f(x)
params:
  - name: a
    min: -3
    max: 3
    step: 0.1
    value: 1
  - name: b
    min: -5
    max: 5
    step: 0.1
    value: 0
  - name: c
    min: -5
    max: 5
    step: 0.1
    value: 0`,
      },
      {
        title: 'Lissajous curve',
        yaml: `id: lissajous
title: Lissajous figure
xRange: [-1.4, 1.4]
yRange: [-1.4, 1.4]
parametric:
  - x: sin(a*t + pi/2)
    y: sin(b*t)
    tRange: [0, 6.283185]
    label: trace
params:
  - name: a
    min: 1
    max: 5
    step: 1
    value: 3
  - name: b
    min: 1
    max: 5
    step: 1
    value: 2`,
      },
    ],
  },
  dependencies: {
    webPackages: [],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    return mountPlot(host, props);
  },
};

/**
 * @param {number[]} values
 * @param {number} q
 */
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/**
 * @param {number} span
 * @param {number} target
 */
function niceStep(span, target) {
  const raw = span / target;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / magnitude;
  return (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * magnitude;
}

/**
 * @param {number} value
 */
function formatTick(value) {
  return Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.01)
    ? value.toExponential(1)
    : String(Number(value.toPrecision(6)));
}

/**
 * @param {HTMLElement} host
 * @param {MountProps} props
 * @returns {MountedExtension}
 */
function mountPlot(host, props) {
  const data = /** @type {Payload} */ (props.data);
  const saved = props.savedState ?? {};
  const paramDefs = data.params ?? [];
  /** @type {Record<string, number>} */
  const params = {};
  for (const param of paramDefs) {
    const stored = /** @type {Record<string, unknown>} */ (saved.params ?? {})[param.name];
    params[param.name] = typeof stored === 'number' && stored >= param.min && stored <= param.max
      ? stored
      : param.value ?? (param.min + param.max) / 2;
  }
  const variables = ['x', 't', ...paramDefs.map(param => param.name)];
  const functions = (data.functions ?? []).map((curve, index) => ({
    label: curve.label ?? `f${index + 1}(x)`,
    color: curve.color ?? PALETTE[index % PALETTE.length],
    fn: compileExpression(curve.expr, variables),
  }));
  const parametric = (data.parametric ?? []).map((curve, index) => ({
    label: curve.label ?? `curve ${index + 1}`,
    color: curve.color ?? PALETTE[(functions.length + index) % PALETTE.length],
    fx: compileExpression(curve.x, variables),
    fy: compileExpression(curve.y, variables),
    tRange: curve.tRange ?? [0, 2 * Math.PI],
  }));
  const series = (data.data ?? []).map((set, index) => ({
    label: set.name,
    color: set.color ?? PALETTE[(functions.length + parametric.length + index) % PALETTE.length],
    points: set.points,
  }));

  /** @type {View | null} */
  let view = isView(saved.view) ? saved.view : null;
  /** @type {number | null} */
  let hoverX = null;
  let destroyed = false;

  const legend = el('div', 'plot-legend',
    ...[...functions, ...parametric, ...series].map(curve =>
      el('span', 'plot-legend-item', el('span', 'plot-swatch'), curve.label)));
  [...legend.children].forEach((chip, index) => {
    /** @type {HTMLElement} */ (chip.firstChild).style.background =
      [...functions, ...parametric, ...series][index].color;
  });
  const canvas = /** @type {HTMLCanvasElement} */ (el('canvas', 'plot-canvas'));
  canvas.style.height = HEIGHT + 'px';
  const readout = el('div', 'plot-readout');
  readout.hidden = true;
  const wrap = el('div', 'plot-wrap', canvas, readout);
  const toolbar = el('div', 'plot-toolbar',
    iconButton('Reset view', 'scan', () => {
      view = null;
      draw();
      persist();
    }),
    el('span', 'muted plot-hint', 'Drag to pan · scroll to zoom'));
  const sliders = el('div', 'plot-sliders');
  for (const param of paramDefs) {
    const valueLabel = el('span', 'plot-param-value', formatTick(params[param.name]));
    const input = /** @type {HTMLInputElement} */ (el('input', 'plot-param-slider'));
    input.type = 'range';
    input.min = String(param.min);
    input.max = String(param.max);
    input.step = String(param.step ?? (param.max - param.min) / 200);
    input.value = String(params[param.name]);
    input.setAttribute('aria-label', `Parameter ${param.name}`);
    input.addEventListener('input', () => {
      params[param.name] = Number(input.value);
      valueLabel.textContent = formatTick(params[param.name]);
      draw();
      persist();
    });
    sliders.append(el('label', 'plot-param',
      el('span', 'plot-param-name', param.name), input, valueLabel));
  }
  host.append(el('div', 'plot-extension', legend, toolbar, wrap, sliders));

  function persist() {
    props.onSaveState({ params: { ...params }, view });
  }

  /** @param {unknown} value @returns {value is View} */
  function isView(value) {
    if (!value || typeof value !== 'object') return false;
    const candidate = /** @type {Record<string, unknown>} */ (value);
    return ['xMin', 'xMax', 'yMin', 'yMax'].every(key => typeof candidate[key] === 'number')
      && /** @type {number} */ (candidate.xMax) > /** @type {number} */ (candidate.xMin)
      && /** @type {number} */ (candidate.yMax) > /** @type {number} */ (candidate.yMin);
  }

  /** @returns {View} */
  function autoView() {
    const [xMin, xMax] = data.xRange;
    if (data.yRange) return { xMin, xMax, yMin: data.yRange[0], yMax: data.yRange[1] };
    /** @type {number[]} */
    const ys = [];
    const sample = (/** @type {number} */ y) => { if (Number.isFinite(y)) ys.push(y); };
    for (const curve of functions) {
      for (let i = 0; i <= 240; i += 1) {
        const x = xMin + (xMax - xMin) * i / 240;
        sample(safeEval(curve.fn, x));
      }
    }
    for (const curve of parametric) {
      for (let i = 0; i <= 240; i += 1) {
        const t = curve.tRange[0] + (curve.tRange[1] - curve.tRange[0]) * i / 240;
        sample(safeEval(curve.fy, t));
      }
    }
    for (const set of series) for (const [, y] of set.points) sample(y);
    if (!ys.length) return { xMin, xMax, yMin: -1, yMax: 1 };
    let yMin = quantile(ys, 0.02);
    let yMax = quantile(ys, 0.98);
    if (yMax - yMin < 1e-9) { yMin -= 1; yMax += 1; }
    const pad = (yMax - yMin) * 0.08;
    return { xMin, xMax, yMin: yMin - pad, yMax: yMax + pad };
  }

  /**
   * @param {(scope: Record<string, number>) => number} fn
   * @param {number} input
   */
  function safeEval(fn, input) {
    try {
      return fn({ ...params, x: input, t: input });
    } catch {
      return NaN;
    }
  }

  function draw() {
    if (destroyed) return;
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
    // Axes.
    ctx.strokeStyle = '#4a504a';
    if (box.yMin < 0 && box.yMax > 0) {
      const py = sy(0);
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(width, py); ctx.stroke();
    }
    if (box.xMin < 0 && box.xMax > 0) {
      const px = sx(0);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, HEIGHT); ctx.stroke();
    }

    /**
     * @param {{ x: number, y: number }[]} points
     * @param {string} stroke
     * @param {boolean} dots
     */
    function polyline(points, stroke, dots) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let pen = false;
      for (const point of points) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) { pen = false; continue; }
        const px = sx(point.x);
        const py = sy(point.y);
        if (py < -HEIGHT * 2 || py > HEIGHT * 3) { pen = false; continue; }
        if (!pen) { ctx.moveTo(px, py); pen = true; }
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      if (dots) {
        ctx.fillStyle = stroke;
        for (const point of points) {
          if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
          ctx.beginPath();
          ctx.arc(sx(point.x), sy(point.y), 3, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
    }

    for (const curve of functions) {
      /** @type {{ x: number, y: number }[]} */
      const points = [];
      for (let px = 0; px <= width; px += 1) {
        const x = box.xMin + (box.xMax - box.xMin) * px / width;
        points.push({ x, y: safeEval(curve.fn, x) });
      }
      polyline(points, curve.color, false);
    }
    for (const curve of parametric) {
      /** @type {{ x: number, y: number }[]} */
      const points = [];
      for (let i = 0; i <= 600; i += 1) {
        const t = curve.tRange[0] + (curve.tRange[1] - curve.tRange[0]) * i / 600;
        points.push({ x: safeEval(curve.fx, t), y: safeEval(curve.fy, t) });
      }
      polyline(points, curve.color, false);
    }
    for (const set of series) {
      polyline(set.points.map(([x, y]) => ({ x, y })), set.color, true);
    }

    // Hover crosshair + readout.
    if (hoverX !== null && functions.length) {
      const px = sx(hoverX);
      ctx.strokeStyle = '#5a605a';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, HEIGHT); ctx.stroke();
      ctx.setLineDash([]);
      const lines = [`x = ${formatTick(hoverX)}`];
      for (const curve of functions) {
        const y = safeEval(curve.fn, hoverX);
        lines.push(`${curve.label} = ${Number.isFinite(y) ? formatTick(y) : '—'}`);
        if (Number.isFinite(y)) {
          ctx.fillStyle = curve.color;
          ctx.beginPath(); ctx.arc(px, sy(y), 4, 0, 2 * Math.PI); ctx.fill();
        }
      }
      readout.textContent = lines.join('\n');
      readout.hidden = false;
    } else readout.hidden = true;
  }

  // Navigation: wheel zoom about the cursor, drag to pan.
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

  /** @type {{ px: number, py: number, box: View } | null} */
  let drag = null;
  wrap.addEventListener('pointerdown', /** @param {PointerEvent} event */ event => {
    if (event.button !== 0) return;
    drag = { px: event.clientX, py: event.clientY, box: view ?? autoView() };
    wrap.setPointerCapture(event.pointerId);
    wrap.classList.add('dragging');
  });
  wrap.addEventListener('pointermove', /** @param {PointerEvent} event */ event => {
    const rect = canvas.getBoundingClientRect();
    if (drag) {
      const dx = (event.clientX - drag.px) / rect.width * (drag.box.xMax - drag.box.xMin);
      const dy = (event.clientY - drag.py) / rect.height * (drag.box.yMax - drag.box.yMin);
      view = { xMin: drag.box.xMin - dx, xMax: drag.box.xMax - dx, yMin: drag.box.yMin + dy, yMax: drag.box.yMax + dy };
      draw();
      persist();
      return;
    }
    const box = view ?? autoView();
    hoverX = box.xMin + (event.clientX - rect.left) / rect.width * (box.xMax - box.xMin);
    draw();
  });
  const endDrag = () => {
    drag = null;
    wrap.classList.remove('dragging');
  };
  wrap.addEventListener('pointerup', endDrag);
  wrap.addEventListener('pointercancel', endDrag);
  wrap.addEventListener('pointerleave', () => {
    hoverX = null;
    draw();
  });

  const resizeObserver = new ResizeObserver(() => draw());
  resizeObserver.observe(wrap);
  draw();

  return {
    destroy() {
      destroyed = true;
      resizeObserver.disconnect();
    },
  };
}
