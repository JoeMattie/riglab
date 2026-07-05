// Equilibrium treatment of drag-held nodes (§5.2 + §7): a drag target — how
// the canvas feeds wearer skeleton bindings into the solver — acts as an
// external holder. The body (or a hand) holds that node wherever the pose
// says, supplying whatever reaction is needed, so a linkage attached to the
// shoulder dangles from it under gravity and re-dangles when the target
// moves with the animation.
import { describe, expect, it } from 'vitest';
import type { Mechanism, Vec2 } from '../../schema';
import { solve } from '..';

const G = 9.81;
const TIP_KG = 2;
// high enough that the ~2.04 m chain dangles clear of the floor (slice C)
const SHOULDER: Vec2 = { x: 2, y: 3 };

/** Two bars pinned in the middle, drawn roughly level off the shoulder —
 * the sketch from the bug report. No anchors anywhere. */
function shoulderBoom(): Mechanism {
  return {
    id: 'boom',
    name: 'shoulder boom',
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes: [
      { id: 'S', kind: 'free', position: SHOULDER }, // bound to the shoulder
      { id: 'P', kind: 'free', position: { x: 1, y: 3.2 } },
      { id: 'E', kind: 'free', position: { x: 0, y: 3 } },
    ],
    elements: [
      { id: 'l1', type: 'link', maturity: 'sketch', nodeA: 'S', nodeB: 'P', pointMasses: [] },
      { id: 'l2', type: 'link', maturity: 'sketch', nodeA: 'P', nodeB: 'E', pointMasses: [] },
    ],
    pointMasses: [{ id: 'm', name: 'tip', massKg: TIP_KG, nodeId: 'E' }],
    skeletonBindings: [{ id: 'b', point: 'shoulderR', nodeId: 'S' }],
    anchorBindings: [],
    inputs: [],
    namedStates: [],
  };
}

const L1 = Math.hypot(2 - 1, 3 - 3.2);
const L2 = Math.hypot(1 - 0, 3.2 - 3);

function expectDangleBelow(mech: Mechanism, hold: Vec2): void {
  const result = solve(mech, { channelValues: {}, dragTargets: { S: hold } }, 'equilibrium');
  expect(result.diagnostics.converged).toBe(true);
  const s = result.positions.S!;
  const p = result.positions.P!;
  const e = result.positions.E!;
  // the body holds the bound node exactly where the pose says
  expect(Math.hypot(s.x - hold.x, s.y - hold.y)).toBeLessThanOrEqual(1e-9);
  // the chain hangs straight down from it
  expect(Math.hypot(p.x - hold.x, p.y - (hold.y - L1))).toBeLessThanOrEqual(5e-3);
  expect(Math.hypot(e.x - hold.x, e.y - (hold.y - L1 - L2))).toBeLessThanOrEqual(5e-3);
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

  it('re-dangles below the target when the animation moves the shoulder', () => {
    expectDangleBelow(shoulderBoom(), { x: 2.3, y: 3.15 });
  });

  it('anchor and driven nodes ignore drag targets (kinematic-mode parity)', () => {
    const mech = shoulderBoom();
    mech.nodes = mech.nodes.map((n) => (n.id === 'S' ? { ...n, kind: 'anchor' } : n));
    const result = solve(
      mech,
      { channelValues: {}, dragTargets: { S: { x: 5, y: 5 } } },
      'equilibrium',
    );
    const s = result.positions.S!;
    expect(Math.hypot(s.x - SHOULDER.x, s.y - SHOULDER.y)).toBeLessThanOrEqual(1e-9);
  });

  it('does not flag rope compression at a body-held node (the holder takes the load)', () => {
    // a massed node held by the body, with a taut rope running down to a
    // ground anchor: the static check must not demand the rope push upward
    const mech: Mechanism = {
      id: 'r',
      name: 'held rope',
      viewOrientation: 'side-left',
      gravityOn: true,
      nodes: [
        { id: 'H', kind: 'free', position: { x: 0, y: 1 } },
        { id: 'A', kind: 'anchor', position: { x: 0, y: 0.3 } },
      ],
      elements: [{ id: 'rope', type: 'rope', maturity: 'sketch', path: ['H', 'A'], lengthM: 0.7 }],
      pointMasses: [{ id: 'm', name: 'pack', massKg: 3, nodeId: 'H' }],
      skeletonBindings: [{ id: 'b', point: 'shoulderR', nodeId: 'H' }],
      anchorBindings: [],
      inputs: [],
      namedStates: [],
    };
    const result = solve(
      mech,
      { channelValues: {}, dragTargets: { H: { x: 0, y: 1 } } },
      'equilibrium',
    );
    expect(result.diagnostics.ropesRequiringCompression).toEqual([]);
  });
});
