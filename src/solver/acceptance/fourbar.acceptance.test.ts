// Phase 1 acceptance (§11): dragging the crank of a four-bar traces the
// analytic coupler solution within 1e-3 m.
import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../../schema';
import { solve } from '..';
import { crankTip, FOUR_BAR, fourBarB, fourBarInitial } from './analytic';

// the crank sweeps a full circle, dipping to y = -a in ground frame — the
// mechanism is raised LIFT above the floor (slice C) so the sweep is clear,
// and the analytic ground-frame solution is compared with the same offset
const LIFT = 1;
const raise = (p: { x: number; y: number }): { x: number; y: number } => ({
  x: p.x,
  y: p.y + LIFT,
});

function fourBarMechanism(): Mechanism {
  const { A, B } = fourBarInitial(FOUR_BAR);
  const link = (id: string, nodeA: string, nodeB: string): Mechanism['elements'][number] => ({
    id,
    type: 'link',
    maturity: 'sketch',
    nodeA,
    nodeB,
    pointMasses: [],
  });
  return {
    id: 'fourbar',
    name: 'four-bar',
    viewOrientation: 'side-left',
    gravityOn: false,
    nodes: [
      { id: 'O2', kind: 'anchor', position: { x: 0, y: LIFT } },
      { id: 'A', kind: 'free', position: raise(A) },
      { id: 'B', kind: 'free', position: raise(B) },
      { id: 'O4', kind: 'anchor', position: { x: FOUR_BAR.d, y: LIFT } },
    ],
    elements: [link('crank', 'O2', 'A'), link('coupler', 'A', 'B'), link('rocker', 'B', 'O4')],
    pointMasses: [],
    skeletonBindings: [],
    anchorBindings: [],
    inputs: [],
    namedStates: [],
  };
}

describe('ACCEPTANCE Phase 1 — four-bar kinematic drag', () => {
  it('coupler joint tracks the analytic solution within 1e-3 m over a full crank rotation', () => {
    const mechanism = fourBarMechanism();
    let prevB = fourBarInitial(FOUR_BAR).B;
    let maxErr = 0;
    for (let k = 1; k <= 72; k++) {
      const theta = Math.PI / 2 + (k * 2 * Math.PI) / 72;
      const target = raise(crankTip(FOUR_BAR, theta));
      const result = solve(
        mechanism,
        { channelValues: {}, dragTargets: { A: target } },
        'kinematic',
      );
      const expBGround = fourBarB(FOUR_BAR, theta, prevB);
      prevB = expBGround;
      const expB = raise(expBGround);
      const gotA = result.positions.A;
      const gotB = result.positions.B;
      if (!gotA || !gotB) throw new Error('solver returned no positions');
      maxErr = Math.max(
        maxErr,
        Math.hypot(gotA.x - target.x, gotA.y - target.y),
        Math.hypot(gotB.x - expB.x, gotB.y - expB.y),
      );
      // feed the solved pose forward so the sweep is incremental like a drag
      mechanism.nodes = mechanism.nodes.map((n) => {
        const p = result.positions[n.id];
        return p ? { ...n, position: p } : n;
      });
    }
    expect(maxErr).toBeLessThanOrEqual(1e-3);
  });

  it('classifies the four-bar as a 1-DOF mechanism', () => {
    const result = solve(fourBarMechanism(), { channelValues: {} }, 'kinematic');
    expect(result.diagnostics.dof).toBe(1);
    expect(result.diagnostics.classification).toBe('mechanism');
  });
});
