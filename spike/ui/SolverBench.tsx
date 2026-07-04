import { useEffect, useRef, useState } from 'react';
import { PlanckAdapter } from '../candidates/planck';
import { RapierAdapter } from '../candidates/rapier';
import { XpbdAdapter } from '../candidates/xpbd';
import { DT } from '../harness/run';
import {
  bowdenScenario,
  fourBarScenario,
  hangingSlackScenario,
  hangingTautScenario,
  pulleyScenario,
  trussScenario,
} from '../harness/scenarios';
import type { Scenario, SpikeAdapter, Vec2 } from '../harness/types';
import { fitView } from './view';

const CANDIDATES = {
  'custom-xpbd': () => new XpbdAdapter(),
  rapier2d: () => new RapierAdapter(),
  planck: () => new PlanckAdapter(),
} as const;

const SCENARIOS = {
  'four-bar': fourBarScenario,
  'hanging-taut': hangingTautScenario,
  'hanging-slack': hangingSlackScenario,
  'rope-eyelet': pulleyScenario,
  bowden: bowdenScenario,
  'truss-100': () => trussScenario(50),
} as const;

const W = 900;
const H = 560;

export function SolverBench() {
  const [candidate, setCandidate] = useState<keyof typeof CANDIDATES>('custom-xpbd');
  const [scenarioName, setScenarioName] = useState<keyof typeof SCENARIOS>('four-bar');
  const [stepMs, setStepMs] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const forceRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const scenario = SCENARIOS[scenarioName]();
    const view = fitView(scenario, W, H);
    const adapter: SpikeAdapter = CANDIDATES[candidate]();
    let raf = 0;
    let disposed = false;
    let dragging: string | null = null;
    const stepTimes: number[] = [];

    const nearestNode = (world: Vec2): string | null => {
      let best: string | null = null;
      let bestD = 20 / 900; // ~20 px in world units, refined below
      const pos = adapter.positions();
      for (const [id, p] of Object.entries(pos)) {
        const s = view.toScreen(p);
        const m = view.toScreen(world);
        const d = Math.hypot(s.x - m.x, s.y - m.y);
        if (d < 20 && (best === null || d < bestD)) {
          best = id;
          bestD = d;
        }
      }
      return best;
    };

    const onDown = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const world = view.toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      dragging = nearestNode(world);
      if (dragging) adapter.setDragTarget(dragging, world);
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const rect = canvas.getBoundingClientRect();
      adapter.setDragTarget(
        dragging,
        view.toWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top }),
      );
    };
    const onUp = () => {
      if (dragging) adapter.setDragTarget(dragging, null);
      dragging = null;
    };
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    const draw = () => {
      const pos = adapter.positions();
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#334';
      for (const rod of scenario.rods) {
        const a = pos[rod.a];
        const b = pos[rod.b];
        if (!a || !b) continue;
        const sa = view.toScreen(a);
        const sb = view.toScreen(b);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
      }
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#b60';
      ctx.setLineDash([6, 4]);
      for (const rope of scenario.ropes) {
        ctx.beginPath();
        rope.path.forEach((id, i) => {
          const p = pos[id];
          if (!p) return;
          const s = view.toScreen(p);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
      }
      ctx.strokeStyle = '#086';
      for (const bw of scenario.bowdens) {
        for (const [p1, p2] of [
          [bw.a1, bw.a2],
          [bw.b1, bw.b2],
        ] as const) {
          const a = pos[p1];
          const b = pos[p2];
          if (!a || !b) continue;
          const sa = view.toScreen(a);
          const sb = view.toScreen(b);
          ctx.beginPath();
          ctx.moveTo(sa.x, sa.y);
          ctx.lineTo(sb.x, sb.y);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);
      for (const n of scenario.nodes) {
        const p = pos[n.id];
        if (!p) continue;
        const s = view.toScreen(p);
        ctx.beginPath();
        ctx.arc(s.x, s.y, n.kind === 'anchor' ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = n.kind === 'anchor' ? '#222' : dragging === n.id ? '#d22' : '#28d';
        ctx.fill();
        if (scenario.nodes.length <= 12) {
          ctx.fillStyle = '#555';
          ctx.font = '12px system-ui';
          ctx.fillText(n.id, s.x + 8, s.y - 8);
        }
      }
    };

    const loop = () => {
      if (disposed) return;
      const t0 = performance.now();
      adapter.step(DT);
      const ms = performance.now() - t0;
      stepTimes.push(ms);
      if (stepTimes.length >= 30) {
        setStepMs(stepTimes.reduce((a, b) => a + b, 0) / stepTimes.length);
        stepTimes.length = 0;
      }
      draw();
      if (forceRef.current) {
        const f = adapter.forces();
        forceRef.current.textContent = Object.entries(f)
          .filter(([, v]) => Number.isFinite(v))
          .map(([id, v]) => `${id}: ${v.toFixed(2)} N`)
          .join('\n');
      }
      raf = requestAnimationFrame(loop);
    };

    void adapter.init(scenario).then(() => {
      if (!disposed) loop();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      adapter.dispose();
    };
  }, [candidate, scenarioName]);

  return (
    <div>
      <div className="row">
        {Object.keys(CANDIDATES).map((c) => (
          <button
            key={c}
            style={{ fontWeight: c === candidate ? 'bold' : 'normal' }}
            onClick={() => setCandidate(c as keyof typeof CANDIDATES)}
          >
            {c}
          </button>
        ))}
        {' | '}
        {Object.keys(SCENARIOS).map((s) => (
          <button
            key={s}
            style={{ fontWeight: s === scenarioName ? 'bold' : 'normal' }}
            onClick={() => setScenarioName(s as keyof typeof SCENARIOS)}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="row">
        drag any blue node · mean step time: {stepMs.toFixed(2)} ms
      </div>
      <canvas ref={canvasRef} width={W} height={H} />
      <pre ref={forceRef} />
    </div>
  );
}
