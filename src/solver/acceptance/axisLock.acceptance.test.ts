// Opt-in hinge axis lock (Joe's request): a hinge with axisLocked keeps its
// members in the drawn axis plane during simulation even when the pivot is
// free, instead of coning out. Without the flag (default), an ungrounded
// hinge still carries its axis with the members — creature rigs depend on
// that out-of-plane freedom.
import { describe, expect, it } from 'vitest';
import type { Mechanism, PivotElement } from '../../schema';
import { solve } from '..';
import { link, mech, node } from './analytic';

/** A free hinge at P (axis +z), P held to ground G by a stem, two bars A/B. */
function rig(axisLocked: boolean): Mechanism {
  const piv: PivotElement = {
    id: 'piv',
    type: 'pivot',
    maturity: 'sketch',
    nodeId: 'P',
    joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
    memberIds: ['barA', 'barB', 'stem'],
    welds: [],
    axisLocked: axisLocked || undefined,
  };
  return mech(
    [
      node('P', { x: 0, y: 1, z: 0 }),
      node('A', { x: -0.5, y: 1, z: 0 }),
      node('B', { x: 0.5, y: 1, z: 0 }),
      node('G', { x: 0, y: 0, z: 0 }, 'anchor'),
    ],
    [link('barA', 'P', 'A'), link('barB', 'P', 'B'), link('stem', 'P', 'G'), piv],
  );
}

const OUT_OF_PLANE = { A: { x: -0.4, y: 1.2, z: 0.6 } };

describe('ACCEPTANCE — opt-in hinge axis lock', () => {
  it('locked: members stay coplanar in the axis plane under an out-of-plane pull', () => {
    const r = solve(rig(true), { channelValues: {}, dragTargets: OUT_OF_PLANE }, 'kinematic');
    // A, B, P all share one z (a plane parallel to the drawn z=0 hinge plane)
    const zs = [r.positions.A!.z, r.positions.B!.z, r.positions.P!.z];
    const spread = Math.max(...zs) - Math.min(...zs);
    expect(spread).toBeLessThanOrEqual(1e-3); // coplanar ⇒ axis honored
  });

  it('unlocked (default): the same pull cones the hinge out of plane', () => {
    const r = solve(rig(false), { channelValues: {}, dragTargets: OUT_OF_PLANE }, 'kinematic');
    // the bars leave a common plane — B does not follow A's z
    const spread =
      Math.max(r.positions.A!.z, r.positions.B!.z) - Math.min(r.positions.A!.z, r.positions.B!.z);
    expect(spread).toBeGreaterThan(0.1);
  });
});
