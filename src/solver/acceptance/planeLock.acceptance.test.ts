// Shift-drag plane locks (SolveInputs.planeLocks): a transient, drag-time
// constraint holding chosen nodes on a view plane while the geometry
// resolves — the UI arms one per dragged node while shift is held. It must
// bind the locked node to its plane without perturbing lengths, and it must
// stay invisible to the diagnostics (DOF / residual / violated), because it
// is a gesture, not document geometry.
import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../../schema';
import { solve } from '..';
import { dist3, link, mech, node, spherical } from './analytic';

// A two-link chain on ball joints, anchored at G: without a lock, a drag
// with a z component swings the free end out of the z = 0 sketch plane.
function chain(): Mechanism {
  return mech(
    [
      node('G', { x: 0, y: 1, z: 0 }, 'anchor'),
      node('M', { x: 1, y: 1, z: 0 }),
      node('T', { x: 2, y: 1, z: 0 }),
    ],
    [link('a', 'G', 'M'), link('b', 'M', 'T'), spherical('piv', 'M', ['a', 'b'])],
  );
}

const PLANE = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 1 } };

describe('ACCEPTANCE — shift-drag plane lock', () => {
  it('without a lock, the drag pulls the free end out of the sketch plane', () => {
    const r = solve(
      chain(),
      { channelValues: {}, dragTargets: { T: { x: 1.8, y: 1.2, z: 0.5 } } },
      'kinematic',
    );
    expect(r.diagnostics.converged).toBe(true);
    expect(r.positions.T!.z).toBeGreaterThan(0.1);
  });

  it('with a lock, the dragged end stays on the plane and lengths hold', () => {
    const r = solve(
      chain(),
      {
        channelValues: {},
        dragTargets: { T: { x: 1.8, y: 1.2, z: 0.5 } },
        planeLocks: { T: PLANE },
      },
      'kinematic',
    );
    expect(r.diagnostics.converged).toBe(true);
    const t = r.positions.T!;
    expect(Math.abs(t.z)).toBeLessThanOrEqual(1e-6); // pinned to the view plane
    expect(dist3(t, r.positions.M!)).toBeCloseTo(1, 4); // rod lengths hold
    expect(dist3(r.positions.M!, r.positions.G!)).toBeCloseTo(1, 4);
    // and the in-plane part of the wish was followed
    expect(t.y).toBeGreaterThan(1.05);
  });

  it('is invisible to diagnostics: same DOF, nothing violated, non-unit normals accepted', () => {
    const base = solve(chain(), { channelValues: {} }, 'kinematic');
    const locked = solve(
      chain(),
      {
        channelValues: {},
        dragTargets: { T: { x: 1.8, y: 1.2, z: 0.5 } },
        // scaled normal: the solver normalizes
        planeLocks: { T: { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 7 } } },
      },
      'kinematic',
    );
    expect(locked.diagnostics.dof).toBe(base.diagnostics.dof);
    expect(locked.diagnostics.violated).toEqual([]);
    expect(Math.abs(locked.positions.T!.z)).toBeLessThanOrEqual(1e-6);
  });

  it('locks on unknown or anchored nodes are ignored', () => {
    const r = solve(
      chain(),
      {
        channelValues: {},
        dragTargets: { T: { x: 1.8, y: 1.2, z: 0.5 } },
        planeLocks: {
          nope: PLANE,
          G: { point: { x: 0, y: 0, z: 0.4 }, normal: { x: 0, y: 0, z: 1 } },
        },
      },
      'kinematic',
    );
    expect(r.diagnostics.converged).toBe(true);
    expect(r.positions.G!.z).toBe(0); // the anchor never moved onto z=0.4
  });
});
