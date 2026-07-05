// Equilibrium treatment of drag-held nodes (§5.2 + §7): a drag target — how
// the canvas feeds wearer skeleton bindings into the solver — acts as an
// external holder. The body (or a hand) holds that node wherever the pose
// says, supplying whatever reaction is needed, so a linkage attached to the
// shoulder dangles from it under gravity and re-dangles when the target
// moves with the animation. Targets are Vec3 now — the shoulder moves in
// depth too.
import { describe, expect, it } from 'vitest';
import type { Mechanism, Vec3 } from '../../schema';
import { solve } from '..';
import { dist3, link, mech, node } from './analytic';

const G = 9.81;
const TIP_KG = 2;
// high enough that the ~2.04 m chain dangles clear of the floor
const SHOULDER: Vec3 = { x: 2, y: 3, z: 0.5 };

/** Two bars pinned in the middle, drawn roughly level off the shoulder —
 * the sketch from the bug report. No anchors anywhere. */
function shoulderBoom(): Mechanism {
  return mech(
    [
      node('S', SHOULDER), // bound to the shoulder
      node('P', { x: 1, y: 3.2, z: 0.5 }),
      node('E', { x: 0, y: 3, z: 0.5 }),
    ],
    [link('l1', 'S', 'P'), link('l2', 'P', 'E')],
    {
      pointMasses: [{ id: 'm', name: 'tip', massKg: TIP_KG, nodeId: 'E' }],
      skeletonBindings: [{ id: 'b', point: 'shoulderR', nodeId: 'S' }],
    },
  );
}

const L1 = dist3(SHOULDER, { x: 1, y: 3.2, z: 0.5 });
const L2 = dist3({ x: 1, y: 3.2, z: 0.5 }, { x: 0, y: 3, z: 0.5 });

function expectDangleBelow(m: Mechanism, hold: Vec3): void {
  const result = solve(m, { channelValues: {}, dragTargets: { S: hold } }, 'equilibrium');
  expect(result.diagnostics.converged).toBe(true);
  const s = result.positions.S!;
  const p = result.positions.P!;
  const e = result.positions.E!;
  // the body holds the bound node exactly where the pose says
  expect(dist3(s, hold)).toBeLessThanOrEqual(1e-9);
  // the chain hangs straight down from it
  expect(dist3(p, { x: hold.x, y: hold.y - L1, z: hold.z })).toBeLessThanOrEqual(5e-3);
  expect(dist3(e, { x: hold.x, y: hold.y - L1 - L2, z: hold.z })).toBeLessThanOrEqual(5e-3);
  // both bars carry the tip weight in tension
  expect(Math.abs((result.forces.elements.l1 ?? NaN) - TIP_KG * G)).toBeLessThanOrEqual(
    0.02 * TIP_KG * G,
  );
  expect(Math.abs((result.forces.elements.l2 ?? NaN) - TIP_KG * G)).toBeLessThanOrEqual(
    0.02 * TIP_KG * G,
  );
}

describe('ACCEPTANCE — drag-held node is a moving anchor in equilibrium', () => {
  it('a boom bound to the shoulder dangles straight down from it', () => {
    expectDangleBelow(shoulderBoom(), SHOULDER);
  });

  it('re-dangles below the target when the animation moves the shoulder in 3D', () => {
    expectDangleBelow(shoulderBoom(), { x: 2.3, y: 3.15, z: 0.7 });
  });

  it('anchor and driven nodes ignore drag targets (kinematic-mode parity)', () => {
    const m = shoulderBoom();
    m.nodes = m.nodes.map((n) => (n.id === 'S' ? { ...n, kind: 'anchor' as const } : n));
    const result = solve(
      m,
      { channelValues: {}, dragTargets: { S: { x: 5, y: 5, z: 5 } } },
      'equilibrium',
    );
    expect(dist3(result.positions.S!, SHOULDER)).toBeLessThanOrEqual(1e-9);
  });

  it('does not flag rope compression at a body-held node (the holder takes the load)', () => {
    // a massed node held by the body, with a taut rope running down to a
    // ground anchor: the static check must not demand the rope push upward
    const m = mech(
      [node('H', { x: 0, y: 1, z: 0.2 }), node('A', { x: 0, y: 0.3, z: 0.2 }, 'anchor')],
      [{ id: 'rope', type: 'rope', maturity: 'sketch', path: ['H', 'A'], lengthM: 0.7 }],
      {
        pointMasses: [{ id: 'm', name: 'pack', massKg: 3, nodeId: 'H' }],
        skeletonBindings: [{ id: 'b', point: 'shoulderR', nodeId: 'H' }],
      },
    );
    const result = solve(
      m,
      { channelValues: {}, dragTargets: { H: { x: 0, y: 1, z: 0.2 } } },
      'equilibrium',
    );
    expect(result.diagnostics.ropesRequiringCompression).toEqual([]);
  });
});
