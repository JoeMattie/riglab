// Konva vs raw Canvas 2D, rendering the 100-node truss driven live by the
// custom XPBD adapter (available regardless of which solver wins).
// Konva is used imperatively (shapes created once, attrs mutated per frame +
// batchDraw) — the pattern a real editor would use for 60 fps updates; the
// react-konva binding is a thin layer over exactly these objects.
import Konva from 'konva';
import { useEffect, useRef, useState } from 'react';
import { XpbdAdapter } from '../candidates/xpbd';
import { DT } from '../harness/run';
import { trussScenario } from '../harness/scenarios';
import type { Scenario, Vec2 } from '../harness/types';
import { fitView, percentile, type View } from './view';

const W = 900;
const H = 420;
const FRAMES = 600;
const DRAG_NODE = 't49';

export interface BenchStats {
  renderer: string;
  frames: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
}

interface Renderer {
  render(positions: Record<string, Vec2>, hover: string | null): void;
  teardown(): void;
}

function labelText(scenario: Scenario, rodIdx: number): string {
  const rod = scenario.rods[rodIdx]!;
  return `${rod.id} 0.10 m`;
}

function makeCanvasRenderer(canvas: HTMLCanvasElement, scenario: Scenario, view: View): Renderer {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  return {
    render(pos, hover) {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = '#334';
      ctx.lineWidth = 2;
      scenario.rods.forEach((rod, i) => {
        const a = pos[rod.a];
        const b = pos[rod.b];
        if (!a || !b) return;
        const sa = view.toScreen(a);
        const sb = view.toScreen(b);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
        if (i % 5 === 0) {
          ctx.fillStyle = '#777';
          ctx.font = '10px system-ui';
          ctx.fillText(labelText(scenario, i), (sa.x + sb.x) / 2 + 3, (sa.y + sb.y) / 2 - 3);
        }
      });
      for (const n of scenario.nodes) {
        const p = pos[n.id];
        if (!p) continue;
        const s = view.toScreen(p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = n.id === hover ? '#d22' : n.kind === 'anchor' ? '#222' : '#28d';
        ctx.fill();
      }
    },
    teardown() {
      ctx.clearRect(0, 0, W, H);
    },
  };
}

function makeKonvaRenderer(host: HTMLDivElement, scenario: Scenario, view: View): Renderer {
  const stage = new Konva.Stage({ container: host, width: W, height: H });
  const layer = new Konva.Layer({ listening: true });
  stage.add(layer);
  const lines = scenario.rods.map(
    () => new Konva.Line({ points: [0, 0, 0, 0], stroke: '#334', strokeWidth: 2, listening: false }),
  );
  const labels = scenario.rods.map((_, i) =>
    i % 5 === 0
      ? new Konva.Text({ text: labelText(scenario, i), fontSize: 10, fill: '#777', listening: false })
      : null,
  );
  const circles = new Map(
    scenario.nodes.map((n) => [
      n.id,
      new Konva.Circle({
        radius: 4,
        fill: n.kind === 'anchor' ? '#222' : '#28d',
        id: n.id,
        listening: true,
      }),
    ]),
  );
  lines.forEach((l) => layer.add(l));
  labels.forEach((t) => t && layer.add(t));
  circles.forEach((c) => layer.add(c));
  return {
    render(pos, hover) {
      scenario.rods.forEach((rod, i) => {
        const a = pos[rod.a];
        const b = pos[rod.b];
        if (!a || !b) return;
        const sa = view.toScreen(a);
        const sb = view.toScreen(b);
        lines[i]!.points([sa.x, sa.y, sb.x, sb.y]);
        const label = labels[i];
        if (label) label.position({ x: (sa.x + sb.x) / 2 + 3, y: (sa.y + sb.y) / 2 - 13 });
      });
      for (const n of scenario.nodes) {
        const p = pos[n.id];
        if (!p) continue;
        const s = view.toScreen(p);
        const c = circles.get(n.id)!;
        c.position({ x: s.x, y: s.y });
        c.fill(n.id === hover ? '#d22' : n.kind === 'anchor' ? '#222' : '#28d');
      }
      layer.batchDraw();
    },
    teardown() {
      stage.destroy();
    },
  };
}

export function RendererBench() {
  const [stats, setStats] = useState<BenchStats[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const konvaRef = useRef<HTMLDivElement>(null);
  const runnerRef = useRef<(mode: 'canvas2d' | 'konva') => Promise<BenchStats>>(null);

  useEffect(() => {
    const run = async (mode: 'canvas2d' | 'konva'): Promise<BenchStats> => {
      setRunning(mode);
      const scenario = trussScenario(50);
      const view = fitView(scenario, W, H);
      const adapter = new XpbdAdapter();
      await adapter.init(scenario);
      const renderer =
        mode === 'canvas2d'
          ? makeCanvasRenderer(canvasRef.current!, scenario, view)
          : makeKonvaRenderer(konvaRef.current!, scenario, view);
      const deltas: number[] = [];
      const base = { x: 4.9, y: 0.1 };
      let frame = 0;
      let last = performance.now();
      const result = await new Promise<BenchStats>((resolve) => {
        const loop = (now: number) => {
          deltas.push(now - last);
          last = now;
          const t = (frame / FRAMES) * 4 * Math.PI;
          adapter.setDragTarget(DRAG_NODE, { x: base.x - 0.8 * (1 - Math.cos(t / 2)), y: base.y + 1.6 * Math.sin(t) });
          adapter.step(DT);
          renderer.render(adapter.positions(), frame % 60 < 30 ? 'b25' : null);
          frame++;
          if (frame >= FRAMES) {
            const sorted = [...deltas.slice(2)].sort((a, b) => a - b);
            resolve({
              renderer: mode,
              frames: FRAMES,
              meanMs: sorted.reduce((a, b) => a + b, 0) / sorted.length,
              p50Ms: percentile(sorted, 0.5),
              p95Ms: percentile(sorted, 0.95),
            });
            return;
          }
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      renderer.teardown();
      adapter.dispose();
      setStats((prev) => [...prev, result]);
      setRunning(null);
      return result;
    };
    runnerRef.current = run;
    (window as unknown as { __bench: object }).__bench = {
      run: (mode: 'canvas2d' | 'konva') => run(mode),
    };
  }, []);

  return (
    <div>
      <div className="row">
        <button disabled={running !== null} onClick={() => void runnerRef.current?.('canvas2d')}>
          run canvas2d bench
        </button>
        <button disabled={running !== null} onClick={() => void runnerRef.current?.('konva')}>
          run konva bench
        </button>
        {running ? ` running ${running}…` : ''}
      </div>
      <pre>
        {stats
          .map(
            (s) =>
              `${s.renderer}: mean ${s.meanMs.toFixed(2)} ms · p50 ${s.p50Ms.toFixed(2)} ms · p95 ${s.p95Ms.toFixed(2)} ms (${s.frames} frames, 100-node truss, drag-solve + render)`,
          )
          .join('\n') || 'no runs yet'}
      </pre>
      <div style={{ display: running === 'konva' || true ? 'block' : 'none' }}>
        <canvas ref={canvasRef} width={W} height={H} style={{ display: 'block', marginBottom: 8 }} />
        <div ref={konvaRef} className="konva-host" style={{ width: W, height: H }} />
      </div>
    </div>
  );
}
