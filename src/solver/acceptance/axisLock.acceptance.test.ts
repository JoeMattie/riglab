// Opt-in hinge axis lock (Joe's request): a hinge with axisLocked keeps its
// members NEAR the drawn axis plane during simulation even when the pivot is
// free, instead of coning out. Without the flag (default), an ungrounded
// hinge still carries its axis with the members — creature rigs depend on
// that out-of-plane freedom.
//
// The lock is COMPLIANT: the axis may lean up to HINGE_AXIS_SLOP_RAD (~4°) off
// plane ("allowed slop"), so an out-of-plane drag settles into the cone and
// CONVERGES instead of fighting an infinitely-stiff pin (the old hard
// placement overshot — a 5 cm drag flung to 20 cm — and never converged).
import { describe, expect, it } from 'vitest';
import type { Mechanism, PivotElement } from '../../schema';
import { solve } from '..';
import { HINGE_AXIS_SLOP_RAD } from '../hinge';
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

/** Elevation of a bar (pivot→node) off the drawn z=0 hinge plane, radians. */
function elevationRad(r: ReturnType<typeof solve>, nodeId: string): number {
  const p = r.positions[nodeId]!;
  const pv = r.positions.P!;
  const dx = p.x - pv.x;
  const dy = p.y - pv.y;
  const dz = p.z - pv.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return len < 1e-9 ? 0 : Math.asin(Math.min(1, Math.abs(dz) / len));
}

describe('ACCEPTANCE — opt-in hinge axis lock', () => {
  it('locked: an out-of-plane pull is held within the slop cone AND converges', () => {
    const r = solve(rig(true), { channelValues: {}, dragTargets: OUT_OF_PLANE }, 'kinematic');
    // the fix: the drag no longer flings the axis out and stalls the solve
    expect(r.diagnostics.converged).toBe(true);
    // both bars stay within the ~4° slop cone of the drawn plane (a small ε
    // over the exact half-angle for residual give), even though A was pulled
    // hard to z = 0.6 — the lock holds, it just isn't infinitely stiff
    expect(elevationRad(r, 'A')).toBeLessThanOrEqual(HINGE_AXIS_SLOP_RAD + 0.02);
    expect(elevationRad(r, 'B')).toBeLessThanOrEqual(HINGE_AXIS_SLOP_RAD + 0.02);
  });

  it('unlocked (default): the same pull cones the hinge out of plane', () => {
    const r = solve(rig(false), { channelValues: {}, dragTargets: OUT_OF_PLANE }, 'kinematic');
    // the bars leave a common plane — B does not follow A's z
    const spread =
      Math.max(r.positions.A!.z, r.positions.B!.z) - Math.min(r.positions.A!.z, r.positions.B!.z);
    expect(spread).toBeGreaterThan(0.1);
  });

  it('locked resists the out-of-plane pull far more than unlocked', () => {
    const locked = solve(rig(true), { channelValues: {}, dragTargets: OUT_OF_PLANE }, 'kinematic');
    const free = solve(rig(false), { channelValues: {}, dragTargets: OUT_OF_PLANE }, 'kinematic');
    // the free hinge lets A chase z = 0.6; the locked one holds it near plane
    expect(Math.abs(free.positions.A!.z)).toBeGreaterThan(3 * Math.abs(locked.positions.A!.z));
  });
});

// A hinge whose members already lie OFF its drawn axis plane still cone-limits
// cleanly (no divide-by-zero / NaN when the virtual starts far outside the
// cone) — guards the coneLimitVirtual edge where the initial lean > slop.
describe('ACCEPTANCE — axis lock converges from an off-plane start', () => {
  it('a hinge drawn with a bar out of plane still solves finite + converges', () => {
    const piv: PivotElement = {
      id: 'piv',
      type: 'pivot',
      maturity: 'sketch',
      nodeId: 'P',
      joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
      memberIds: ['barA', 'barB', 'stem'],
      welds: [],
      axisLocked: true,
    };
    const m = mech(
      [
        node('P', { x: 0, y: 1, z: 0 }),
        node('A', { x: -0.4, y: 1, z: 0.3 }), // starts well outside the 4° cone
        node('B', { x: 0.5, y: 1, z: 0 }),
        node('G', { x: 0, y: 0, z: 0 }, 'anchor'),
      ],
      [link('barA', 'P', 'A'), link('barB', 'P', 'B'), link('stem', 'P', 'G'), piv],
    );
    const r = solve(m, { channelValues: {}, dragTargets: {} }, 'kinematic');
    for (const id of ['P', 'A', 'B']) {
      expect(Number.isFinite(r.positions[id]!.z)).toBe(true);
    }
    expect(r.diagnostics.converged).toBe(true);
  });
});
