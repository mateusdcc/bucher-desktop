/**
 * ext-mermaid — Mermaid diagrams with zoom/pan and theme synchronization.
 *
 * Renders flowcharts, sequence diagrams, state machines, class diagrams, and
 * every other Mermaid grammar inside a pannable, zoomable viewport. View state
 * (zoom and pan) persists with the book progress.
 *
 * @module extensions/mermaid
 */
import { z } from 'zod';
import { el, iconButton } from '../ui.js';
import { blockMeta, createValidator } from './validate.js';

/**
 * @typedef {import('./types.js').BucherExtension} BucherExtension
 * @typedef {import('./types.js').MountProps} MountProps
 * @typedef {import('./types.js').MountedExtension} MountedExtension
 */

const schema = z.object({
  ...blockMeta,
  diagram: z.string().min(1).max(20000).describe('Mermaid diagram source, e.g. "graph TD; A-->B".'),
  caption: z.string().max(500).optional().describe('Optional caption shown under the diagram.'),
});

/** @typedef {import('zod').infer<typeof schema>} Payload */

const DARK_VARIABLES = {
  background: '#1b1d1b',
  primaryColor: '#243024',
  primaryTextColor: '#deded9',
  primaryBorderColor: '#4a5a4a',
  lineColor: '#8b8e85',
  secondaryColor: '#2a2d2a',
  tertiaryColor: '#202320',
  clusterBkg: '#202320',
  clusterBorder: '#353b36',
  edgeLabelBackground: '#1b1d1b',
  nodeTextColor: '#deded9',
  actorBkg: '#243024',
  actorBorder: '#4a5a4a',
  actorTextColor: '#deded9',
  signalColor: '#8b8e85',
  signalTextColor: '#deded9',
  labelBoxBkgColor: '#202320',
  labelBoxBorderColor: '#353b36',
  labelTextColor: '#deded9',
  loopTextColor: '#deded9',
  noteBkgColor: '#32301f',
  noteTextColor: '#deded9',
  activationBkgColor: '#2a2d2a',
  fontFamily: 'Inter Variable, system-ui, sans-serif',
  fontSize: '14px',
};

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

/** @type {BucherExtension} */
export const mermaidExtension = {
  id: 'ext-mermaid',
  name: 'Mermaid Diagram',
  version: '1.0.0',
  description: 'Flowcharts, sequence diagrams, state machines, and class diagrams with zoom, pan, and theme-synced colors.',
  category: 'visualization',
  icon: 'workflow',
  skill: {
    instructions: `Use ext-mermaid to visualize structure and flow: decision procedures, algorithm control flow, state machines, class hierarchies, request/response sequences, and entity relationships. Prefer a diagram whenever a process or relationship is easier to see than to read. Rules:
- Write valid Mermaid syntax in the diagram field (graph/flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, gantt, pie, mindmap).
- Keep node labels short; wrap labels containing spaces or punctuation in double quotes.
- Do not use click handlers, links, or HTML labels — the reader renders in strict security mode.
- One diagram per block. Set a stable id and a short title. Add a caption only when it adds information.`,
    syntaxSpec: `Fence info string: ext-mermaid. YAML fields:
- diagram (string, required): the Mermaid source. Use a | block scalar for multi-line diagrams.
- id (string, recommended): stable block id for progress persistence.
- title (string, optional): shown in the frame header.
- caption (string, optional): plain-text caption under the diagram.`,
    fewShotExamples: [
      {
        title: 'Binary search decision flow',
        yaml: `id: binary-search-flow
title: Binary search control flow
diagram: |
  flowchart TD
    A["lo = 0, hi = n - 1"] --> B{"lo <= hi?"}
    B -- no --> C["return -1"]
    B -- yes --> D["mid = (lo + hi) / 2"]
    D --> E{"a[mid] == target?"}
    E -- yes --> F["return mid"]
    E -- "a[mid] < target" --> G["lo = mid + 1"]
    E -- "a[mid] > target" --> H["hi = mid - 1"]
    G --> B
    H --> B
caption: Each iteration halves the search interval.`,
      },
      {
        title: 'HTTP request lifecycle',
        yaml: `id: http-sequence
title: Request lifecycle
diagram: |
  sequenceDiagram
    participant C as Client
    participant S as Server
    participant D as Database
    C->>S: GET /books
    S->>D: SELECT * FROM books
    D-->>S: rows
    S-->>C: 200 OK (JSON)`,
      },
    ],
  },
  schema,
  validate: createValidator(schema),
  mount(host, props) {
    return mountMermaid(host, props);
  },
};

/**
 * @param {HTMLElement} host
 * @param {MountProps} props
 * @returns {MountedExtension}
 */
function mountMermaid(host, props) {
  const data = /** @type {Payload} */ (props.data);
  const saved = props.savedState ?? {};
  const view = {
    zoom: typeof saved.zoom === 'number' ? clamp(saved.zoom, MIN_ZOOM, MAX_ZOOM) : 1,
    x: typeof saved.x === 'number' ? saved.x : 0,
    y: typeof saved.y === 'number' ? saved.y : 0,
  };
  const viewport = el('div', 'mermaid-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', 'Diagram viewport. Drag to pan, scroll to zoom.');
  const stage = el('div', 'mermaid-stage');
  viewport.append(stage);
  const toolbar = el('div', 'mermaid-toolbar',
    iconButton('Zoom in', 'zoom-in', () => zoomAtCenter(1.25)),
    iconButton('Zoom out', 'zoom-out', () => zoomAtCenter(1 / 1.25)),
    iconButton('Reset view', 'scan', () => {
      view.zoom = 1; view.x = 0; view.y = 0;
      apply();
    }),
    el('span', 'mermaid-zoom-label', ''));
  const zoomLabel = /** @type {HTMLElement} */ (toolbar.lastChild);
  const root = el('div', 'mermaid-extension', toolbar, viewport,
    data.caption ? el('p', 'muted mermaid-caption', data.caption) : null);
  host.append(root);

  /**
   * @param {number} value
   * @param {number} min
   * @param {number} max
   */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function apply() {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    zoomLabel.textContent = Math.round(view.zoom * 100) + '%';
    props.onSaveState({ zoom: view.zoom, x: view.x, y: view.y });
  }

  /**
   * @param {number} px viewport-relative point
   * @param {number} py
   * @param {number} factor
   */
  function zoomAt(px, py, factor) {
    const next = clamp(view.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    view.x = px - (px - view.x) * (next / view.zoom);
    view.y = py - (py - view.y) * (next / view.zoom);
    view.zoom = next;
    apply();
  }

  /** @param {number} factor */
  function zoomAtCenter(factor) {
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, factor);
  }

  viewport.addEventListener('wheel', /** @param {WheelEvent} event */ event => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    zoomAt(event.clientX - rect.left, event.clientY - rect.top, event.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  /** @type {{ px: number, py: number, x: number, y: number } | null} */
  let drag = null;
  viewport.addEventListener('pointerdown', /** @param {PointerEvent} event */ event => {
    if (event.button !== 0) return;
    drag = { px: event.clientX, py: event.clientY, x: view.x, y: view.y };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('dragging');
  });
  viewport.addEventListener('pointermove', /** @param {PointerEvent} event */ event => {
    if (!drag) return;
    view.x = drag.x + event.clientX - drag.px;
    view.y = drag.y + event.clientY - drag.py;
    apply();
  });
  const endDrag = () => {
    drag = null;
    viewport.classList.remove('dragging');
  };
  viewport.addEventListener('pointerup', endDrag);
  viewport.addEventListener('pointercancel', endDrag);
  viewport.addEventListener('keydown', /** @param {KeyboardEvent} event */ event => {
    const step = 40;
    if (event.key === '+' || event.key === '=') zoomAtCenter(1.25);
    else if (event.key === '-') zoomAtCenter(1 / 1.25);
    else if (event.key === '0') { view.zoom = 1; view.x = 0; view.y = 0; apply(); }
    else if (event.key === 'ArrowLeft') { view.x += step; apply(); }
    else if (event.key === 'ArrowRight') { view.x -= step; apply(); }
    else if (event.key === 'ArrowUp') { view.y += step; apply(); }
    else if (event.key === 'ArrowDown') { view.y -= step; apply(); }
    else return;
    event.preventDefault();
  });

  let destroyed = false;
  /** @type {ResizeObserver | null} */
  let fitObserver = null;
  (async () => {
    try {
      const mermaid = (await import('mermaid')).default;
      if (destroyed) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: props.theme === 'light' ? 'default' : 'base',
        themeVariables: props.theme === 'light' ? { fontFamily: 'Inter Variable, system-ui, sans-serif' } : DARK_VARIABLES,
        flowchart: { htmlLabels: false, curve: 'basis' },
        suppressErrorRendering: true,
      });
      const id = 'mmd-' + crypto.randomUUID();
      const { svg } = await mermaid.render(id, data.diagram);
      if (destroyed) return;
      stage.innerHTML = svg;
      const svgNode = stage.querySelector('svg');
      if (svgNode) {
        svgNode.style.maxWidth = '100%';
        svgNode.style.height = 'auto';
        svgNode.removeAttribute('height');
        // Fit the diagram into the viewport on first open (no saved view yet).
        // Hydration can run while detached, so wait for a real layout box.
        if (props.savedState == null) {
          const fit = () => {
            const rect = svgNode.getBoundingClientRect();
            const vw = viewport.clientWidth;
            const vh = viewport.clientHeight;
            if (!rect.width || !rect.height || !vw || !vh) return false;
            const scale = Math.min(1, (vw - 40) / rect.width, (vh - 40) / rect.height);
            view.zoom = scale;
            view.x = (vw - rect.width * scale) / 2 - 18 * scale;
            view.y = (vh - rect.height * scale) / 2 - 18 * scale;
            stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
            zoomLabel.textContent = Math.round(view.zoom * 100) + '%';
            return true;
          };
          if (!fit() && typeof ResizeObserver !== 'undefined') {
            fitObserver = new ResizeObserver(() => {
              if (fit()) fitObserver?.disconnect();
            });
            fitObserver.observe(viewport);
          }
        }
      }
      stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
      zoomLabel.textContent = Math.round(view.zoom * 100) + '%';
    } catch (error) {
      if (!destroyed) props.onError(error);
    }
  })();

  return {
    destroy() {
      destroyed = true;
      fitObserver?.disconnect();
    },
  };
}
