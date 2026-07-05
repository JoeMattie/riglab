// 2D-parity acceptance (PLANFILE-3d-conversion.md): dragging the crank of a
// four-bar lifted onto a TILTED plane (fully general quaternion) traces the
// planar analytic coupler solution within 1e-3 m. Shared nodes = spherical
// joints; the constraint gradients keep the linkage on its drawn plane, so
// the planar closed form remains the reference.
import { describe, expect, it } from 'vitest';
import type { Mechanism, Vec3 } from '../../schema';
import { solve } from '..';
import {
  crankTip,
  dist3,
  FOUR_BAR,
  fourBarB,
  fourBarInitial,
  link,
  mech,
  node,
  place,
  TILT,
} from './analytic';

// lifted well above the floor: every local point of the sweep has |p| < 0.85,
// so world y stays positive for any tilt
const ORIGIN: Vec3 = { x: 0, y: 1.5, z: 0 };
const lift = place(TILT, ORIGIN);

function fourBarMechanism(): Mechanism {
  const { A, B } = fourBarInitial(FOUR_BAR);
  return mech(
    [
      node('O2', lift(0, 0), 'anchor'),
      node('A', lift(A.x, A.y)),
      node('B', lift(B.x, B.y)),
      node('O4', lift(FOUR_BAR.d, 0), 'anchor'),
    ],
    [link('crank', 'O2', 'A'), link('coupler', 'A', 'B'), link('rocker', 'B', 'O4')],
  );
}

describe('ACCEPTANCE 3D parity — four-bar kinematic drag on a tilted plane', () => {
  it('coupler joint tracks the planar analytic solution within 1e-3 m over a full crank rotation', () => {
    const mechanism = fourBarMechanism();
    let prevB = fourBarInitial(FOUR_BAR).B;
    let maxErr = 0;
    for (let k = 1; k <= 72; k++) {
      const theta = Math.PI / 2 + (k * 2 * Math.PI) / 72;
      const tip = crankTip(FOUR_BAR, theta);
      const target = lift(tip.x, tip.y);
      const result = solve(
        mechanism,
        { channelValues: {}, dragTargets: { A: target } },
        'kinematic',
      );
      const expBLocal = fourBarB(FOUR_BAR, theta, prevB);
      prevB = expBLocal;
      const expB = lift(expBLocal.x, expBLocal.y);
      const gotA = result.positions.A;
      const gotB = result.positions.B;
      if (!gotA || !gotB) throw new Error('solver returned no positions');
      maxErr = Math.max(maxErr, dist3(gotA, target), dist3(gotB, expB));
      // feed the solved pose forward so the sweep is incremental like a drag
      mechanism.nodes = mechanism.nodes.map((n) => {
        const p = result.positions[n.id];
        return p ? { ...n, position: p } : n;
      });
    }
    expect(maxErr).toBeLessThanOrEqual(1e-3);
  });

  it('classifies the spherical-jointed four-bar as a 3-DOF spatial mechanism', () => {
    // shared nodes = ball joints: the planar 1 DOF plus two out-of-plane
    // swings (crank and rocker cones). Hinged grounding brings it back to 1 —
    // see the DOF cases in kinematic.acceptance.test.ts.
    const result = solve(fourBarMechanism(), { channelValues: {} }, 'kinematic');
    expect(result.diagnostics.dof).toBe(3);
    expect(result.diagnostics.classification).toBe('mechanism');
  });
});
