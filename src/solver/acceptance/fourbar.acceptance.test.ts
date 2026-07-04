// Phase 1 acceptance (§11): dragging the crank of a four-bar traces the
// analytic coupler solution within 1e-3 m.
//
// SKIP-MARKED until Phase 1 implements kinematic solve() — the agreed
// convention (DECISIONS.md): tests are the executable spec, CI stays green.
// UNSKIP at the START of Phase 1.
import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../../schema';
import { solve } from '..';
import { FOUR_BAR, crankTip, fourBarB, fourBarInitial } from './analytic';

export function fourBarMechanism(): Mechanism {
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
      { id: 'O2', kind: 'anchor', position: { x: 0, y: 0 } },
      { id: 'A', kind: 'free', position: A },
      { id: 'B', kind: 'free', position: B },
      { id: 'O4', kind: 'anchor', position: { x: FOUR_BAR.d, y: 0 } },
    ],
    elements: [link('crank', 'O2', 'A'), link('coupler', 'A', 'B'), link('rocker', 'B', 'O4')],
    pointMasses: [],
    inputs: [],
    namedStates: [],
  };
}

describe.skip('ACCEPTANCE Phase 1 — four-bar kinematic drag', () => {
  it('coupler joint tracks the analytic solution within 1e-3 m over a full crank rotation', () => {
    const mechanism = fourBarMechanism();
    let prevB = fourBarInitial(FOUR_BAR).B;
    let maxErr = 0;
    for (let k = 1; k <= 72; k++) {
      const theta = Math.PI / 2 + (k * 2 * Math.PI) / 72;
      const target = crankTip(FOUR_BAR, theta);
      const result = solve(mechanism, { channelValues: {}, dragTargets: { A: target } }, 'kinematic');
      const expB = fourBarB(FOUR_BAR, theta, prevB);
      prevB = expB;
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
