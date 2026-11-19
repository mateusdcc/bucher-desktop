/**
 * React view for ext-interactive-graph (browser-only; loaded lazily at mount).
 * React Flow v13 canvas + dagre layout, node inspection, dependency tracing,
 * wire-edges and classify-nodes exercise modes.
 *
 * @module extensions/interactive-graph-view
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow,
  type Connection, type Edge, type EdgeChangeset, type Node, type NodeChangeset, type NodeProps,
} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import { edgeKey, type Payload } from './interactive-graph.js';
import type { MountProps } from './types.js';

type GraphNodeData = {
  label: string;
  kind?: string;
  note?: string;
  visual: 'normal' | 'traced' | 'dimmed' | 'correct' | 'incorrect';
  connectable: boolean;
  layout: 'TB' | 'LR';
  options?: string[];
  assigned?: string;
  onKindChange?: (id: string, kind: string) => void;
  [key: string]: unknown;
};
type BucherNode = Node<GraphNodeData, 'bucher'>;

const NODE_W = 180;
const NODE_H = 48;

/** Hierarchical auto-layout via dagre; saved positions override it. */
function layoutNodes(data: Payload, positions: Record<string, { x: number; y: number }>): BucherNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: data.layout, nodesep: 46, ranksep: 70 });
  for (const node of data.nodes) graph.setNode(node.id, { width: NODE_W, height: NODE_H });
  for (const edge of data.edges) graph.setEdge(edge.from, edge.to);
  dagre.layout(graph);
  return data.nodes.map(node => {
    const placed = graph.node(node.id);
    const saved = positions[node.id];
    return {
      id: node.id,
      type: 'bucher',
      position: saved ?? { x: placed.x - NODE_W / 2, y: placed.y - NODE_H / 2 },
      data: {
        label: node.label,
        kind: node.kind,
        note: node.note,
        visual: 'normal',
        connectable: false,
        layout: data.layout,
      },
    };
  });
}

const KIND_COLORS: Record<string, string> = {
  definition: '#6fb7e8',
  theorem: '#73d695',
  lemma: '#b48fe8',
  claim: '#e8d06f',
  step: '#e8a86f',
  concept: '#9c9d95',
};

function BucherNodeView({ id, data, selected }: NodeProps<BucherNode>) {
  const border = data.visual === 'correct' ? '#73d695'
    : data.visual === 'incorrect' ? '#e8927c'
      : data.visual === 'traced' || selected ? '#73d695'
        : data.visual === 'dimmed' ? '#2c312c' : '#4a504a';
  const opacity = data.visual === 'dimmed' ? 0.45 : 1;
  const horizontal = data.layout === 'LR';
  return (
    <div
      className="igraph-node"
      style={{ borderColor: border, opacity, width: NODE_W, minHeight: NODE_H }}
      title={data.label}
    >
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} isConnectable={data.connectable} />
      {data.kind && (
        <span className="igraph-kind" style={{ color: KIND_COLORS[data.kind] ?? '#9c9d95' }}>{data.kind}</span>
      )}
      <span className="igraph-label">{data.label}</span>
      {data.options && (
        <select
          className="igraph-kind-select"
          value={data.assigned ?? ''}
          aria-label={`Classify ${data.label}`}
          onClick={event => event.stopPropagation()}
          onChange={event => data.onKindChange?.(id, event.target.value)}
        >
          <option value="">kind…</option>
          {data.options.map(option => <option key={option} value={option}>{option}</option>)}
        </select>
      )}
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} isConnectable={data.connectable} />
    </div>
  );
}

const nodeTypes = { bucher: BucherNodeView };

export interface GraphProps {
  data: Payload;
  host: MountProps;
}

export function GraphExtension({ data, host }: GraphProps) {
  const saved = (host.savedState ?? {}) as Record<string, unknown>;
  const exercise = data.exercise;
  const hiddenKeys = useMemo(
    () => (exercise?.hiddenEdges ?? []).map(edge => edgeKey(edge.from, edge.to)),
    [exercise],
  );
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>(
    (saved.positions as Record<string, { x: number; y: number }>) ?? {},
  );
  const [selected, setSelected] = useState<string | null>((saved.selected as string) ?? null);
  const [trace, setTrace] = useState<'none' | 'up' | 'down'>('none');
  const [found, setFound] = useState<string[]>((saved.found as string[]) ?? []);
  const [attempts, setAttempts] = useState<number>((saved.attempts as number) ?? 0);
  const [assignments, setAssignments] = useState<Record<string, string>>(
    (saved.assignments as Record<string, string>) ?? {},
  );
  const [checked, setChecked] = useState<boolean>(Boolean(saved.checked));
  const [message, setMessage] = useState('');
  const [nodes, setNodes] = useState<BucherNode[]>(() => layoutNodes(data, positions));
  const [edges, setEdges] = useState<Edge[]>([]);
  const completedRef = useRef(false);
  // Capture the status at first render: a block that mounts already-passed
  // (persisted state) must NOT re-fire onComplete — the host remounts solved
  // blocks, and re-firing would loop refresh → remount → complete forever.
  const mountedStatusRef = useRef<'unsolved' | 'in-progress' | 'passed' | null>(null);

  const kindOptions = useMemo(() => {
    const kinds = new Set<string>(data.nodes.map(node => node.kind ?? 'concept'));
    for (const extra of exercise?.extraKinds ?? []) kinds.add(extra);
    return [...kinds].sort();
  }, [data, exercise]);

  const classifyCorrect = useCallback((nodeId: string) => {
    const node = data.nodes.find(item => item.id === nodeId);
    return Boolean(node?.kind) && assignments[nodeId] === node?.kind;
  }, [data, assignments]);

  const status: 'unsolved' | 'in-progress' | 'passed' = useMemo(() => {
    if (data.mode !== 'exercise' || !exercise) return 'unsolved';
    if (exercise.type === 'wire-edges') {
      if (hiddenKeys.length > 0 && found.length >= hiddenKeys.length) return 'passed';
      return found.length || attempts ? 'in-progress' : 'unsolved';
    }
    if (checked && data.nodes.every(node => classifyCorrect(node.id))) return 'passed';
    return Object.keys(assignments).length ? 'in-progress' : 'unsolved';
  }, [data, exercise, hiddenKeys, found, attempts, checked, assignments, classifyCorrect]);

  // Persist state and report completion once, only on a live solve transition.
  useEffect(() => {
    if (mountedStatusRef.current === null) mountedStatusRef.current = status;
    host.onSaveState({ positions, selected, found, attempts, assignments, checked, status });
    if (status === 'passed' && mountedStatusRef.current !== 'passed' && !completedRef.current) {
      completedRef.current = true;
      host.onComplete();
    }
  }, [positions, selected, found, attempts, assignments, checked, status, host]);

  // Trace sets: BFS upstream/downstream from the selected node.
  const traced = useMemo(() => {
    const nodesHit = new Set<string>();
    const edgesHit = new Set<string>();
    if (trace === 'none' || !selected) return { nodesHit, edgesHit };
    nodesHit.add(selected);
    const queue = [selected];
    while (queue.length) {
      const current = queue.shift() as string;
      for (const edge of data.edges) {
        const matches = trace === 'down' ? edge.from === current : edge.to === current;
        if (!matches) continue;
        const next = trace === 'down' ? edge.to : edge.from;
        edgesHit.add(edgeKey(edge.from, edge.to));
        if (!nodesHit.has(next)) {
          nodesHit.add(next);
          queue.push(next);
        }
      }
    }
    return { nodesHit, edgesHit };
  }, [trace, selected, data]);

  // Rebuild display edges: visible solution edges + found hidden edges.
  useEffect(() => {
    const hiddenSet = new Set(hiddenKeys);
    const foundSet = new Set(found);
    const display: Edge[] = [];
    for (const edge of data.edges) {
      const key = edgeKey(edge.from, edge.to);
      if (hiddenSet.has(key) && !foundSet.has(key)) continue;
      const isTraced = traced.edgesHit.has(key);
      const isFound = hiddenSet.has(key);
      display.push({
        id: key,
        source: edge.from,
        target: edge.to,
        label: edge.label,
        animated: isTraced,
        style: {
          stroke: isFound || isTraced ? '#73d695' : traced.edgesHit.size ? '#3a403a' : '#8b8e85',
          strokeWidth: isTraced || isFound ? 2.2 : 1.4,
        },
        labelStyle: { fill: '#deded9', fontSize: 11 },
        labelBgStyle: { fill: '#1b1d1b' },
        labelBgPadding: [4, 2],
      });
    }
    setEdges(display);
  }, [data, hiddenKeys, found, traced]);

  // Refresh node visuals from selection/trace/exercise feedback.
  useEffect(() => {
    setNodes(current => current.map(node => {
      let visual: GraphNodeData['visual'] = 'normal';
      if (traced.nodesHit.size) visual = traced.nodesHit.has(node.id) ? 'traced' : 'dimmed';
      if (data.mode === 'exercise' && exercise?.type === 'classify-nodes' && checked) {
        visual = classifyCorrect(node.id) ? 'correct' : 'incorrect';
      }
      const base = data.nodes.find(item => item.id === node.id);
      return {
        ...node,
        selected: node.id === selected,
        data: {
          ...node.data,
          label: base?.label ?? node.data.label,
          kind: exercise?.type === 'classify-nodes' && !checked ? undefined : base?.kind,
          visual,
          connectable: data.mode === 'exercise' && exercise?.type === 'wire-edges' && !host.readOnly && status !== 'passed',
          options: exercise?.type === 'classify-nodes' && !host.readOnly ? kindOptions : undefined,
          assigned: assignments[node.id],
          onKindChange: (id: string, kind: string) => {
            setAssignments(currentAssignments => ({ ...currentAssignments, [id]: kind }));
            setChecked(false);
          },
        },
      };
    }));
  }, [data, exercise, selected, traced, checked, assignments, kindOptions, classifyCorrect, host.readOnly, status]);

  const onNodesChange = useCallback((changes: NodeChangeset<BucherNode>) => {
    setNodes(current => changes.applyTo(current));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChangeset<Edge>) => {
    setEdges(current => changes.applyTo(current));
  }, []);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || exercise?.type !== 'wire-edges') return;
    const key = edgeKey(connection.source, connection.target);
    if (found.includes(key)) {
      setMessage('That link is already connected.');
      return;
    }
    if (hiddenKeys.includes(key)) {
      setFound(current => [...current, key]);
      setMessage(`Correct link! ${found.length + 1} of ${hiddenKeys.length} found.`);
      return;
    }
    setAttempts(current => current + 1);
    setMessage('Not a valid dependency — check the direction and the proof structure.');
  }, [exercise, found, hiddenKeys]);

  const onNodeClick = useCallback((_: ReactMouseEvent, node: Node) => {
    setSelected(node.id);
    setTrace('none');
  }, []);

  const onNodeDragStop = useCallback((_: MouseEvent | TouchEvent, node: Node) => {
    setPositions(current => ({ ...current, [node.id]: node.position }));
  }, []);

  const selectedNode = data.nodes.find(node => node.id === selected);
  const noteHost = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (noteHost.current && selectedNode?.note) {
      noteHost.current.replaceChildren(host.renderMarkdown(selectedNode.note));
    }
  }, [selectedNode, host]);

  const wireProgress = exercise?.type === 'wire-edges'
    ? `${found.length} of ${hiddenKeys.length} hidden links wired${attempts ? ` · ${attempts} missed attempt${attempts === 1 ? '' : 's'}` : ''}`
    : '';

  return (
    <div className="igraph-extension">
      <div className="igraph-toolbar">
        {data.mode === 'explore' && selected && (
          <>
            <button type="button" className={trace === 'up' ? 'accent-button' : ''} onClick={() => setTrace(trace === 'up' ? 'none' : 'up')}>
              Trace prerequisites
            </button>
            <button type="button" className={trace === 'down' ? 'accent-button' : ''} onClick={() => setTrace(trace === 'down' ? 'none' : 'down')}>
              Trace dependencies
            </button>
          </>
        )}
        {exercise?.type === 'classify-nodes' && (
          <button
            type="button"
            className="accent-button"
            disabled={host.readOnly || data.nodes.some(node => !assignments[node.id])}
            onClick={() => setChecked(true)}
          >
            Check classification
          </button>
        )}
        <button type="button" onClick={() => { setPositions({}); setNodes(layoutNodes(data, {})); }}>
          Re-layout
        </button>
        <span className="muted igraph-status">
          {data.mode === 'exercise'
            ? (status === 'passed' ? 'Solved — well done!' : wireProgress || (exercise?.type === 'classify-nodes' ? 'Assign a kind to every node, then check.' : ''))
            : 'Click a node to inspect it; drag to rearrange.'}
        </span>
      </div>
      <div className="igraph-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          fitView
          minZoom={0.2}
          maxZoom={2}
          nodesConnectable={data.mode === 'exercise' && exercise?.type === 'wire-edges'}
          elementsSelectable
        >
          <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#2c312c" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={node => KIND_COLORS[(node.data as GraphNodeData).kind ?? ''] ?? '#4a504a'}
            maskColor="#171717cc"
            style={{ backgroundColor: '#1b1d1b' }}
          />
        </ReactFlow>
      </div>
      {message && <p className="igraph-message muted" role="status">{message}</p>}
      {data.mode === 'explore' && selectedNode && (
        <div className="igraph-inspector">
          <div className="igraph-inspector-head">
            <strong>{selectedNode.label}</strong>
            {selectedNode.kind && <span className="igraph-kind" style={{ color: KIND_COLORS[selectedNode.kind] }}>{selectedNode.kind}</span>}
            <button type="button" onClick={() => { setSelected(null); setTrace('none'); }}>Close</button>
          </div>
          {selectedNode.note
            ? <div className="igraph-note" ref={noteHost} />
            : <p className="muted">No sub-note for this node.</p>}
        </div>
      )}
    </div>
  );
}
