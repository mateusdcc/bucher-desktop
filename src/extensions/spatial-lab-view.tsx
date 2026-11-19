/**
 * React view for ext-3d-spatial-lab (browser-only; loaded lazily at mount).
 * three.js scenes via @react-three/fiber: vector spaces with matrix morphing,
 * animated surfaces, solids; orbit camera, axes, labels, graded challenges.
 *
 * Coordinate convention: payload space is z-up mathematics (x, y, z); it maps
 * to three.js y-up as (x, z, y).
 *
 * @module extensions/spatial-lab-view
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Payload } from './spatial-lab.js';
import { trackRuntime } from './runtime.js';
import type { MountProps } from './types.js';

/**
 * Labels are canvas-texture sprites, NOT drei Html: Html renders children
 * into nested React roots, which (a) can silently fail to flush the first
 * root under React 19 and (b) crashed the renderer when re-rendered from a
 * deferred callback inside the app host. Sprites are pure three.js — no DOM,
 * no extra roots, always visible (depthTest off).
 */
function labelTexture(text: string, color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = '600 44px Inter Variable, system-ui, sans-serif';
  if (!ctx) return { texture: new THREE.CanvasTexture(canvas), aspect: 2 };
  ctx.font = font;
  const width = Math.ceil(ctx.measureText(text).width) + 32;
  canvas.width = width;
  canvas.height = 68;
  ctx.fillStyle = 'rgba(27, 29, 27, 0.88)';
  ctx.beginPath();
  ctx.roundRect(0, 0, width, 68, 14);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60, 66, 60, 0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 16, 36);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: width / 68 };
}

function Label({ text, position, color = '#deded9', size = 0.34 }: { text: string; position: Vec3; color?: string; size?: number }) {
  const { texture, aspect } = useMemo(() => labelTexture(text, color), [text, color]);
  useEffect(() => () => texture.dispose(), [texture]);
  return (
    <sprite position={position} scale={[size * aspect, size, 1]} renderOrder={999}>
      <spriteMaterial map={texture} transparent depthTest={false} depthWrite={false} />
    </sprite>
  );
}

type Vec3 = [number, number, number];
type Compiled = { evaluate: (scope: Record<string, number>) => number };

export interface SpatialProps {
  data: Payload;
  host: MountProps;
}

const PALETTE = ['#e88f9f', '#73d695', '#6fb7e8', '#e8d06f', '#b48fe8', '#e8a86f'];

/** math (x,y,z) → three (x,z,y). */
function toThree(v: Vec3): Vec3 {
  return [v[0], v[2], v[1]];
}

function applyMatrix(m: number[][], v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function lerpMatrix(m: number[][], t: number): number[][] {
  return m.map((row, i) => row.map((value, j) => (i === j ? (1 - t) + t * value : t * value)));
}

function formatNum(value: number): string {
  return String(Number(value.toPrecision(4)));
}

function Arrow({ tip, color, origin = [0, 0, 0] }: { tip: Vec3; color: string; origin?: Vec3 }) {
  const arrow = useMemo(() => {
    const from = new THREE.Vector3(...toThree(origin));
    const to = new THREE.Vector3(...toThree(tip));
    const dir = to.clone().sub(from);
    const length = dir.length();
    if (length < 1e-6) return null;
    return new THREE.ArrowHelper(
      dir.normalize(), from, length, new THREE.Color(color),
      Math.min(0.4, length * 0.22), Math.min(0.22, length * 0.14),
    );
  }, [tip, color, origin]);
  useEffect(() => () => { arrow?.dispose(); }, [arrow]);
  if (!arrow) return null;
  return <primitive object={arrow} />;
}

function Axes({ extent }: { extent: number }) {
  const len = extent;
  const axes: { dir: Vec3; color: string; label: string }[] = [
    { dir: [len, 0, 0], color: '#e88f9f', label: 'x' },
    { dir: [0, len, 0], color: '#73d695', label: 'y' },
    { dir: [0, 0, len], color: '#6fb7e8', label: 'z' },
  ];
  return (
    <group>
      {axes.map(axis => (
        <group key={axis.label}>
          <Line points={[[0, 0, 0], toThree(axis.dir)]} color={axis.color} lineWidth={1.2} transparent opacity={0.65} />
          <Label text={axis.label} position={toThree([axis.dir[0] * 1.08, axis.dir[1] * 1.08, axis.dir[2] * 1.08])} color={axis.color} size={0.4} />
        </group>
      ))}
    </group>
  );
}

function SurfaceMesh({ fn, scope, xRange, yRange, resolution }: {
  fn: Compiled; scope: Record<string, number>; xRange: [number, number]; yRange: [number, number]; resolution: number;
}) {
  const geometry = useMemo(() => {
    const n = resolution;
    const positions = new Float32Array(n * n * 3);
    const colors = new Float32Array(n * n * 3);
    const heights: number[] = [];
    const sample = (i: number, j: number) => {
      const x = xRange[0] + (xRange[1] - xRange[0]) * i / (n - 1);
      const y = yRange[0] + (yRange[1] - yRange[0]) * j / (n - 1);
      try {
        const value = fn.evaluate({ ...scope, x, y });
        return typeof value === 'number' && Number.isFinite(value) ? value : 0;
      } catch {
        return 0;
      }
    };
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) heights.push(sample(i, j));
    }
    const min = Math.min(...heights);
    const max = Math.max(...heights);
    const span = max - min || 1;
    const low = new THREE.Color('#6fb7e8');
    const mid = new THREE.Color('#73d695');
    const high = new THREE.Color('#e8d06f');
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        const index = i * n + j;
        const x = xRange[0] + (xRange[1] - xRange[0]) * i / (n - 1);
        const y = yRange[0] + (yRange[1] - yRange[0]) * j / (n - 1);
        const h = heights[index];
        positions[index * 3] = x;
        positions[index * 3 + 1] = h;
        positions[index * 3 + 2] = y;
        const q = (h - min) / span;
        if (q < 0.5) tmp.lerpColors(low, mid, q * 2);
        else tmp.lerpColors(mid, high, (q - 0.5) * 2);
        colors[index * 3] = tmp.r;
        colors[index * 3 + 1] = tmp.g;
        colors[index * 3 + 2] = tmp.b;
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < n - 1; i += 1) {
      for (let j = 0; j < n - 1; j += 1) {
        const a = i * n + j;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }, [fn, scope, xRange, yRange, resolution]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors side={THREE.DoubleSide} roughness={0.55} metalness={0.05} />
    </mesh>
  );
}

function Solid({ shape, position, size, color, label }: {
  shape: 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus'; position: Vec3; size?: Vec3; color: string; label?: string;
}) {
  const s = size ?? [1, 1, 1];
  return (
    <group position={toThree(position)}>
      <mesh>
        {shape === 'box' && <boxGeometry args={[s[0], s[1], s[2]]} />}
        {shape === 'sphere' && <sphereGeometry args={[s[0] || 1, 32, 16]} />}
        {shape === 'cylinder' && <cylinderGeometry args={[s[0], s[1], s[2], 32]} />}
        {shape === 'cone' && <coneGeometry args={[s[0], s[1], 32]} />}
        {shape === 'torus' && <torusGeometry args={[s[0], s[1] || 0.3, 16, 48]} />}
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.1} />
      </mesh>
      {label && (
        <Label text={label} position={[0, (s[1] || s[0] || 1) * 0.75 + 0.3, 0]} />
      )}
    </group>
  );
}

export function SpatialLab({ data, host }: SpatialProps) {
  const saved = (host.savedState ?? {}) as Record<string, unknown>;
  const paramDefs = data.params ?? [];
  const [params, setParams] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    const stored = (saved.params ?? {}) as Record<string, unknown>;
    for (const param of paramDefs) {
      const value = stored[param.name];
      initial[param.name] = typeof value === 'number' && value >= param.min && value <= param.max
        ? value
        : param.value ?? (param.min + param.max) / 2;
    }
    return initial;
  });
  const [morph, setMorph] = useState<number>(typeof saved.morph === 'number' ? saved.morph : (data.mode === 'challenge' ? 1 : 1));
  const [animT, setAnimT] = useState<number>(typeof saved.animT === 'number' ? saved.animT : (data.animate?.min ?? 0));
  const [playing, setPlaying] = useState(false);
  const [math, setMath] = useState<any>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);
  const mountedStatusRef = useRef<string | null>(null);
  const completedRef = useRef(false);
  const touchedRef = useRef(Boolean(saved.touched));

  // Load mathjs (shared runtime with desmos-lab) and compile expressions.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await trackRuntime('mathjs', () => import('mathjs'));
        if (!cancelled) setMath(loaded);
      } catch (error) {
        if (!cancelled) setEngineError(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const compiled = useMemo(() => {
    if (!math) return null;
    try {
      const matrix = data.transform
        ? data.transform.matrix.map(row => row.map(entry => math.parse(entry).compile() as Compiled))
        : null;
      const surface = data.surface ? math.parse(data.surface.expr).compile() as Compiled : null;
      return { matrix, surface };
    } catch (error) {
      setEngineError(error instanceof Error ? error.message : String(error));
      return null;
    }
  }, [math, data]);

  const scope = useMemo(() => ({ ...params, t: animT }), [params, animT]);

  const matrix = useMemo(() => {
    if (!compiled?.matrix) return null;
    try {
      return compiled.matrix.map(row => row.map(entry => {
        const value = entry.evaluate(scope);
        return typeof value === 'number' && Number.isFinite(value) ? value : 0;
      }));
    } catch {
      return null;
    }
  }, [compiled, scope]);

  const effectiveMatrix = useMemo(() => (matrix ? lerpMatrix(matrix, morph) : null), [matrix, morph]);

  const vectors = data.vectors ?? [];
  const transformedTips = useMemo(() => vectors.map(vector =>
    effectiveMatrix ? applyMatrix(effectiveMatrix, vector.to) : vector.to), [vectors, effectiveMatrix]);

  // Challenge verification at full morph (t = 1).
  const targetResults = useMemo(() => {
    if (data.mode !== 'challenge' || !data.targets || !matrix) return null;
    return data.targets.map(target => {
      const tip = applyMatrix(matrix, vectors[target.vector]?.to ?? [0, 0, 0]);
      const distance = Math.hypot(tip[0] - target.position[0], tip[1] - target.position[1], tip[2] - target.position[2]);
      return { target, tip, distance, pass: distance <= target.tolerance };
    });
  }, [data, matrix, vectors]);

  const status: 'unsolved' | 'in-progress' | 'passed' = useMemo(() => {
    if (data.mode !== 'challenge' || !targetResults) return 'unsolved';
    if (targetResults.every(result => result.pass)) return 'passed';
    return touchedRef.current ? 'in-progress' : 'unsolved';
  }, [data.mode, targetResults]);

  useEffect(() => {
    // Wait for the engine before status bookkeeping: targetResults is null
    // until mathjs compiles the matrix, so an early capture would see
    // 'unsolved' on a restored solved block and re-fire onComplete after
    // every refresh remount (infinite refresh loop).
    if (!compiled) return;
    if (mountedStatusRef.current === null) mountedStatusRef.current = status;
    host.onSaveState({ params, morph, animT, status, touched: touchedRef.current });
    if (status === 'passed' && mountedStatusRef.current !== 'passed' && !completedRef.current) {
      completedRef.current = true;
      host.onComplete();
    }
  }, [compiled, params, morph, animT, status, host]);

  // Surface animation loop.
  useEffect(() => {
    if (!playing || !data.animate) return;
    lastFrameRef.current = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      const { min, max, speed } = data.animate as { min: number; max: number; speed: number };
      setAnimT(current => {
        const next = current + speed * dt;
        return next > max ? min + (next - max) : next;
      });
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, data.animate]);

  const setParam = useCallback((name: string, value: number) => {
    touchedRef.current = true;
    setParams(current => ({ ...current, [name]: value }));
  }, []);

  const extent = useMemo(() => {
    let maxNorm = 3;
    for (const vector of vectors) maxNorm = Math.max(maxNorm, Math.hypot(...vector.to));
    for (const tip of transformedTips) maxNorm = Math.max(maxNorm, Math.hypot(...tip));
    for (const target of data.targets ?? []) maxNorm = Math.max(maxNorm, Math.hypot(...target.position));
    if (data.surface) maxNorm = Math.max(maxNorm, Math.abs(data.surface.xRange[1]), Math.abs(data.surface.yRange[1]));
    return Math.min(12, Math.ceil(maxNorm + 1));
  }, [vectors, transformedTips, data]);

  const descriptionHost = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (descriptionHost.current && data.description) {
      descriptionHost.current.replaceChildren(host.renderMarkdown(data.description));
    }
  }, [data.description, host]);

  if (engineError) {
    return <pre className="spatial-error" role="alert">{engineError}</pre>;
  }
  if (!math || !compiled) {
    return <p className="muted">Loading 3D engine…</p>;
  }

  return (
    <div className="spatial-extension">
      {data.description && <div className="spatial-description markdown" ref={descriptionHost} />}
      <div className="spatial-toolbar">
        {data.transform && (
          <label className="spatial-morph">
            <span className="spatial-param-name">morph</span>
            <input
              type="range" min={0} max={1} step={0.01} value={morph}
              aria-label="Transformation morph"
              disabled={host.readOnly}
              onChange={event => { touchedRef.current = true; setMorph(Number(event.target.value)); }}
            />
            <span className="spatial-param-value">{morph.toFixed(2)}</span>
          </label>
        )}
        {data.animate && (
          <button type="button" onClick={() => setPlaying(current => !current)}>
            {playing ? 'Pause' : 'Play'}
          </button>
        )}
        {data.animate && <span className="muted spatial-t">t = {formatNum(animT)}</span>}
        <span className="muted spatial-hint">Drag to orbit · scroll to zoom</span>
      </div>
      <div className="spatial-canvas">
        <Canvas camera={{ position: [extent * 1.4, extent * 1.1, extent * 1.6], fov: 45 }} dpr={[1, 1.5]}>
          <color attach="background" args={['#161816']} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[6, 10, 4]} intensity={1.1} />
          <Grid
            args={[extent * 2.5, extent * 2.5]}
            cellColor="#242824" sectionColor="#3a403a"
            cellSize={1} sectionSize={5} fadeDistance={extent * 6} fadeStrength={1.5}
            position={[0, -0.01, 0]}
          />
          <Axes extent={extent} />
          {data.kind === 'vectors' && (
            <group>
              {vectors.map((vector, index) => {
                const colorHex = vector.color ?? PALETTE[index % PALETTE.length];
                const tip = transformedTips[index];
                return (
                  <group key={index}>
                    {effectiveMatrix && morph < 1 && (
                      <Line points={[[0, 0, 0], toThree(vector.to)]} color={colorHex} lineWidth={1} dashed dashSize={0.12} gapSize={0.08} transparent opacity={0.5} />
                    )}
                    <Arrow tip={tip} color={colorHex} />
                    {vector.label && (
                      <Label text={vector.label} position={toThree([tip[0] * 1.12, tip[1] * 1.12, tip[2] * 1.12 + 0.15])} color={colorHex} />
                    )}
                  </group>
                );
              })}
              {(data.targets ?? []).map((target, index) => {
                const result = targetResults?.[index];
                const colorHex = result?.pass ? '#73d695' : '#e8927c';
                return (
                  <group key={`target-${index}`} position={toThree(target.position)}>
                    <mesh>
                      <sphereGeometry args={[target.tolerance, 20, 12]} />
                      <meshStandardMaterial color={colorHex} transparent opacity={0.22} />
                    </mesh>
                    <mesh>
                      <sphereGeometry args={[0.07, 12, 8]} />
                      <meshStandardMaterial color={colorHex} />
                    </mesh>
                    <Label
                      text={`${target.label ?? `T${index + 1}`}${result ? ` · ${formatNum(result.distance)}` : ''}`}
                      position={[0, target.tolerance + 0.25, 0]}
                      color={colorHex}
                    />
                  </group>
                );
              })}
            </group>
          )}
          {data.kind === 'surface' && compiled.surface && data.surface && (
            <SurfaceMesh
              fn={compiled.surface}
              scope={scope}
              xRange={data.surface.xRange}
              yRange={data.surface.yRange}
              resolution={data.surface.resolution}
            />
          )}
          {data.kind === 'solids' && (data.solids ?? []).map((solid, index) => (
            <Solid
              key={index}
              shape={solid.shape}
              position={solid.position}
              size={solid.size}
              color={solid.color ?? PALETTE[index % PALETTE.length]}
              label={solid.label}
            />
          ))}
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} />
        </Canvas>
      </div>
      {data.mode === 'challenge' && targetResults && (
        <div className={`spatial-challenge ${status === 'passed' ? 'passed' : ''}`} role="status">
          {targetResults.map((result, index) => (
            <span key={index} className={result.pass ? 'pass' : 'fail'}>
              {result.target.label ?? `T${index + 1}`}: {result.pass ? '✓ landed' : `${formatNum(result.distance)} away (≤ ${result.target.tolerance})`}
            </span>
          ))}
        </div>
      )}
      {paramDefs.length > 0 && (
        <div className="spatial-sliders">
          {paramDefs.map(param => (
            <label key={param.name} className="spatial-param">
              <span className="spatial-param-name">{param.name}</span>
              <input
                type="range"
                min={param.min} max={param.max}
                step={param.step ?? (param.max - param.min) / 200}
                value={params[param.name]}
                aria-label={`Parameter ${param.name}`}
                disabled={host.readOnly}
                onChange={event => setParam(param.name, Number(event.target.value))}
              />
              <span className="spatial-param-value">{formatNum(params[param.name])}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
