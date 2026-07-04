import type { SpikeAdapter, Vec2 } from './types';
import { dist } from './types';

export const DT = 1 / 60;

export function stepN(adapter: SpikeAdapter, n: number): void {
  for (let i = 0; i < n; i++) adapter.step(DT);
}

export interface SettleResult {
  steps: number;
  converged: boolean;
}

/** Step until no node moves more than eps per step (checked over a few
 * consecutive steps), or maxSteps is hit. */
export function settle(
  adapter: SpikeAdapter,
  // eps is loose enough that engine candidates with persistent solver
  // micro-motion (~1e-7 m/step) can converge; correctness is asserted on
  // positions/forces afterwards, not on this criterion.
  { eps = 1e-6, maxSteps = 8000, quietSteps = 5 } = {},
): SettleResult {
  let prev = adapter.positions();
  let quiet = 0;
  for (let i = 1; i <= maxSteps; i++) {
    adapter.step(DT);
    const cur = adapter.positions();
    let maxMove = 0;
    for (const id of Object.keys(cur)) {
      const p = prev[id];
      const c = cur[id];
      if (p && c) maxMove = Math.max(maxMove, dist(p, c));
    }
    quiet = maxMove < eps ? quiet + 1 : 0;
    if (quiet >= quietSteps) return { steps: i, converged: true };
    prev = cur;
  }
  return { steps: maxSteps, converged: false };
}

/** Move a drag target smoothly to `target` over `steps` steps, then hold. */
export function dragTo(
  adapter: SpikeAdapter,
  nodeId: string,
  from: Vec2,
  target: Vec2,
  steps = 30,
): void {
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    adapter.setDragTarget(nodeId, {
      x: from.x + (target.x - from.x) * t,
      y: from.y + (target.y - from.y) * t,
    });
    adapter.step(DT);
  }
}

/** Flattened position snapshot for determinism comparisons. */
export function snapshot(adapter: SpikeAdapter): number[] {
  const pos = adapter.positions();
  const out: number[] = [];
  for (const id of Object.keys(pos).sort()) {
    const p = pos[id];
    if (p) out.push(p.x, p.y);
  }
  return out;
}
