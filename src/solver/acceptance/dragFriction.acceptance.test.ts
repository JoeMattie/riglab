// Drag friction (Joe's request — "friction on the joints"): a fast drag past
// a branch boundary should NOT teleport a member to the far solution (the
// "foot flips at the ankle" complaint). Easing each drag target from the
// node's current position toward the pointer keeps a single solve near the
// current branch; because the caller ratchets the pose every frame, the node
// still reaches the pointer over frames — it just drags there continuously
// instead of snapping.
import { describe, expect, it } from 'vitest';
import type { Mechanism, Vec3 } from '../../schema';
import { solve } from '..';
import { link, mech, node } from './analytic';

/** One bar: anchor G at origin, free end E out along +x at length 1. Dragging
 * E hard to −x would flip it through the anchor to the far side. */
function bar(ePos: Vec3): Mechanism {
  return mech(
    [node('G', { x: 0, y: 0, z: 0 }, 'anchor'), node('E', ePos)],
    [link('bar', 'G', 'E')],
  );
}

const FLIP_TARGET = { E: { x: -1, y: 0.3, z: 0 } };

describe('ACCEPTANCE — drag friction resists a branch flip', () => {
  it('crisp (default): a hard pull to −x flips E across the anchor', () => {
    const r = solve(
      bar({ x: 1, y: 0, z: 0 }),
      { channelValues: {}, dragTargets: FLIP_TARGET },
      'kinematic',
    );
    expect(r.diagnostics.converged).toBe(true);
    expect(r.positions.E!.x).toBeLessThan(-0.5); // landed on the far branch
  });

  it('with friction: the same one-frame pull keeps E on the near branch', () => {
    const r = solve(
      bar({ x: 1, y: 0, z: 0 }),
      { channelValues: {}, dragTargets: FLIP_TARGET, dragFriction: 0.8 },
      'kinematic',
    );
    expect(r.diagnostics.converged).toBe(true);
    expect(r.positions.E!.x).toBeGreaterThan(0.5); // stayed near, no teleport
  });

  it('friction is lag, not a cap: E still reaches the target over many frames', () => {
    // simulate the per-frame ratchet: each frame solves toward the fixed
    // target with friction, then writes the solved pose back as the new pose
    let ePos: Vec3 = { x: 1, y: 0, z: 0 };
    for (let frame = 0; frame < 60; frame++) {
      const r = solve(
        bar(ePos),
        { channelValues: {}, dragTargets: FLIP_TARGET, dragFriction: 0.8 },
        'kinematic',
      );
      ePos = r.positions.E!;
    }
    // arrived on the far side — but got there by dragging around, not flipping
    expect(ePos.x).toBeLessThan(-0.5);
    // still on the unit sphere (bar length preserved throughout)
    expect(Math.hypot(ePos.x, ePos.y, ePos.z)).toBeCloseTo(1, 3);
  });
});
