// Phase 1 acceptance (§11): binding a hand point to a node and playing
// `walk` animates the node along the projected hand path.
import { describe, expect, it } from 'vitest';
import type { Mechanism } from '../../schema';
import { DEFAULT_WEARER } from '../../schema';
import { bindingTargets, computeSkeleton, getClip, projectPoint, samplePose } from '../../wearer';
import { solve } from '..';

function boundMechanism(): Mechanism {
  return {
    id: 'm',
    name: 'bound',
    viewOrientation: 'side-left',
    gravityOn: false,
    nodes: [
      { id: 'anchor', kind: 'anchor', position: { x: 0.3, y: 1.0 } },
      { id: 'tip', kind: 'free', position: { x: 0.3, y: 0.6 } },
    ],
    elements: [
      {
        id: 'pipe',
        type: 'link',
        maturity: 'sketch',
        nodeA: 'anchor',
        nodeB: 'tip',
        pointMasses: [],
      },
    ],
    pointMasses: [],
    skeletonBindings: [{ id: 'b', point: 'handR', nodeId: 'free' }],
    inputs: [],
    namedStates: [],
  };
}

describe('ACCEPTANCE Phase 1 — skeleton binding drives nodes through walk', () => {
  it('an unconstrained bound node follows the projected hand path exactly', () => {
    const walk = getClip('walk')!;
    const m: Mechanism = {
      ...boundMechanism(),
      nodes: [{ id: 'free', kind: 'free', position: { x: 0, y: 1 } }],
      elements: [],
    };
    for (let i = 0; i < 24; i++) {
      const t = (i / 24) * walk.durationS;
      const pose = samplePose(walk, t);
      const targets = bindingTargets(m, DEFAULT_WEARER, pose);
      const expected = projectPoint('side-left', computeSkeleton(DEFAULT_WEARER, pose).points.handR);
      expect(targets.free).toEqual(expected);
      const result = solve(m, { channelValues: {}, dragTargets: targets }, 'kinematic');
      expect(result.positions.free!.x).toBeCloseTo(expected.x, 9);
      expect(result.positions.free!.y).toBeCloseTo(expected.y, 9);
    }
  });

  it('a bound node on a link follows the hand while the pipe length holds', () => {
    const m = { ...boundMechanism() };
    m.skeletonBindings = [{ id: 'b', point: 'handR', nodeId: 'tip' }];
    const walk = getClip('walk')!;
    let cur = m;
    let moved = 0;
    let prev: { x: number; y: number } | null = null;
    for (let i = 0; i <= 36; i++) {
      const t = (i / 36) * walk.durationS;
      const pose = samplePose(walk, t);
      const targets = bindingTargets(cur, DEFAULT_WEARER, pose);
      const result = solve(cur, { channelValues: {}, dragTargets: targets }, 'kinematic');
      const tip = result.positions.tip!;
      const anchor = result.positions.anchor!;
      // rigid pipe holds its drawn 0.4 m length while chasing the hand
      expect(Math.hypot(tip.x - anchor.x, tip.y - anchor.y)).toBeCloseTo(0.4, 4);
      if (prev) moved += Math.hypot(tip.x - prev.x, tip.y - prev.y);
      prev = tip;
      cur = {
        ...cur,
        nodes: cur.nodes.map((n) => {
          const p = result.positions[n.id];
          return p ? { ...n, position: p } : n;
        }),
      };
    }
    // the arm swing actually animates the node (it travels a real distance)
    expect(moved).toBeGreaterThan(0.3);
  });
});
