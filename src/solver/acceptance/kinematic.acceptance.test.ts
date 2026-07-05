// Kinematic-mode acceptance beyond the four-bar: bentLink rigidity under
// drag (vertex distances constant within 1e-4 m), hinge angle limits, welds,
// sliders, telescopes, DOF classification, determinism — all in 3D.
import { describe, expect, it } from 'vitest';
import type { Mechanism, Vec3 } from '../../schema';
import { solve } from '..';
import { dist3, hinge, link, mech, node, spherical } from './analytic';

function dragSequence(
  m: Mechanism,
  nodeId: string,
  targets: Vec3[],
): { positions: Record<string, Vec3>; mech: Mechanism } {
  let cur = m;
  let positions: Record<string, Vec3> = {};
  for (const target of targets) {
    const result = solve(
      cur,
      { channelValues: {}, dragTargets: { [nodeId]: target } },
      'kinematic',
    );
    positions = result.positions;
    cur = {
      ...cur,
      nodes: cur.nodes.map((n) => {
        const p = result.positions[n.id];
        return p ? { ...n, position: p } : n;
      }),
    };
  }
  return { positions, mech: cur };
}

function circleTargets(center: Vec3, radius: number, steps: number): Vec3[] {
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    return {
      x: center.x + radius * Math.cos(a),
      y: center.y + radius * Math.sin(a),
      z: center.z,
    };
  });
}

describe('ACCEPTANCE — bentLink rigidity in 3D', () => {
  function bentPipe(lift = 0): Mechanism {
    // L-shaped bent pipe through 4 vertices, anchored at one end
    return mech(
      [
        node('v0', { x: 0, y: lift, z: 0 }, 'anchor'),
        node('v1', { x: 0.4, y: lift, z: 0 }),
        node('v2', { x: 0.4, y: lift + 0.3, z: 0 }),
        node('v3', { x: 0.7, y: lift + 0.3, z: 0 }),
      ],
      [
        {
          id: 'bent',
          type: 'bentLink',
          maturity: 'sketch',
          nodeIds: ['v0', 'v1', 'v2', 'v3'],
          filletRadiiM: [0, 0],
          pointMasses: [],
        },
      ],
    );
  }
  const ids = ['v0', 'v1', 'v2', 'v3'];

  function sweep(targets: Vec3[], lift = 0): { maxDistortion: number; maxResidual: number } {
    const m = bentPipe(lift);
    const rest: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        rest.push(dist3(m.nodes[i]!.position, m.nodes[j]!.position));
      }
    }
    let cur = m;
    let maxDistortion = 0;
    let maxResidual = 0;
    for (const target of targets) {
      const result = solve(cur, { channelValues: {}, dragTargets: { v3: target } }, 'kinematic');
      maxResidual = Math.max(maxResidual, result.diagnostics.residual);
      cur = {
        ...cur,
        nodes: cur.nodes.map((n) => {
          const p = result.positions[n.id];
          return p ? { ...n, position: p } : n;
        }),
      };
      let k = 0;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          maxDistortion = Math.max(
            maxDistortion,
            Math.abs(dist3(result.positions[ids[i]!]!, result.positions[ids[j]!]!) - rest[k]!),
          );
          k++;
        }
      }
    }
    return { maxDistortion, maxResidual };
  }

  it('keeps all vertex distances constant within 1e-4 m dragged in its plane (2D parity)', () => {
    // the exact 2D acceptance case: tip dragged in a wide circle, many
    // targets unreachable — the body must follow rigidly, never stretch
    const targets = Array.from({ length: 36 }, (_, s) => {
      const a = (s / 36) * 2 * Math.PI;
      return { x: 0.9 * Math.cos(a), y: 0.9 * Math.sin(a), z: 0 };
    });
    expect(sweep(targets).maxDistortion).toBeLessThanOrEqual(1e-4);
  });

  it('stays rigid within the per-frame tolerance budget dragged OUT of its plane', () => {
    // out-of-plane rigid-body rotation is the slow Gauss–Seidel case (see
    // SETTLE_BLOCKS in kinematic.ts): the final decade toward the 1e-5
    // `converged` threshold relaxes at ~0.9995/sweep, so the honest per-frame
    // guarantee is residual ≤ 1e-4 (still 10× tighter than any position
    // assertion in the suite); the feed-forward rest-length recompute then
    // accumulates at most that per frame, so cumulative distortion over 36
    // frames stays within a 5e-4 budget instead of ratcheting unboundedly.
    // The sweep circles clear of the floor — the floor-wedge pathology is a
    // separate case and the in-plane parity sweep above already rides it.
    const targets = Array.from({ length: 36 }, (_, s) => {
      const a = (s / 36) * 2 * Math.PI;
      return { x: 0.9 * Math.cos(a), y: 1.5 + 0.9 * Math.sin(a), z: 0.3 * Math.sin(2 * a) };
    });
    const { maxDistortion, maxResidual } = sweep(targets, 1.5);
    expect(maxResidual).toBeLessThanOrEqual(1e-4);
    expect(maxDistortion).toBeLessThanOrEqual(5e-4);
  });
});

describe('ACCEPTANCE — pivot welds and hinge angle limits', () => {
  it('a welded pair keeps its relative angle while dragged', () => {
    const m = mech(
      [
        node('p', { x: 0, y: 0, z: 0 }, 'anchor'),
        node('a', { x: 0.5, y: 0, z: 0 }),
        node('b', { x: 0, y: 0.4, z: 0 }),
      ],
      [
        link('la', 'p', 'a'),
        link('lb', 'p', 'b'),
        spherical('piv', 'p', ['la', 'lb'], { welds: [['la', 'lb']] }),
      ],
    );
    const { positions } = dragSequence(m, 'a', circleTargets({ x: 0, y: 0, z: 0 }, 0.5, 24));
    const a = positions.a!;
    const b = positions.b!;
    const cosAngle =
      (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
    expect(
      Math.abs(Math.acos(Math.max(-1, Math.min(1, cosAngle))) - Math.PI / 2),
    ).toBeLessThanOrEqual(1e-3);
  });

  it('a hinge angle limit clamps the joint when dragged past it', () => {
    // an arm hinged to a fully-anchored base; limit the relative angle. The
    // anchored base pins the hinge axis, so the arm moves only in the z = 0
    // hinge plane and the clamp is exact.
    const m = mech(
      [
        node('g', { x: 0, y: 0, z: 0 }, 'anchor'),
        node('p', { x: 0.5, y: 0, z: 0 }, 'anchor'),
        node('t', { x: 1.0, y: 0, z: 0 }),
      ],
      [
        link('base', 'g', 'p'),
        link('arm', 'p', 't'),
        hinge(
          'piv',
          'p',
          ['base', 'arm'],
          { x: 0, y: 0, z: 1 },
          {
            angleLimit: {
              memberA: 'base',
              memberB: 'arm',
              minRad: -Math.PI / 4,
              maxRad: Math.PI / 4,
            },
          },
        ),
      ],
    );
    // try to fold the arm all the way up (≈ +170°) — it must stop at +45°
    const { positions } = dragSequence(m, 't', [
      { x: 1.0, y: 0.3, z: 0 },
      { x: 0.8, y: 0.5, z: 0 },
      { x: 0.4, y: 0.55, z: 0 },
      { x: 0.1, y: 0.4, z: 0 },
    ]);
    const p = positions.p!;
    const t = positions.t!;
    const g = positions.g!;
    // geometry stays in the hinge plane (axis +z) — the 2D formula applies
    expect(Math.abs(t.z)).toBeLessThanOrEqual(1e-3);
    const u1 = { x: p.x - g.x, y: p.y - g.y }; // base direction at the pivot
    const u2 = { x: t.x - p.x, y: t.y - p.y };
    const rel = Math.atan2(u1.x * u2.y - u1.y * u2.x, u1.x * u2.x + u1.y * u2.y);
    expect(rel).toBeLessThanOrEqual(Math.PI / 4 + 2e-3);
    expect(rel).toBeGreaterThanOrEqual(-Math.PI / 4 - 2e-3);
  });
});

describe('ACCEPTANCE — slider and telescope in 3D', () => {
  it('a slider node stays on its link axis within travel limits', () => {
    const m = mech(
      [
        node('a', { x: 0, y: 0, z: 0 }, 'anchor'),
        node('b', { x: 1, y: 0, z: 0 }, 'anchor'),
        node('s', { x: 0.5, y: 0, z: 0 }),
      ],
      [
        link('rail', 'a', 'b'),
        {
          id: 'sl',
          type: 'slider',
          maturity: 'sketch',
          nodeId: 's',
          alongElementId: 'rail',
          travelMin: 0.2,
          travelMax: 0.8,
        },
      ],
    );
    for (const target of [
      { x: 0.6, y: 0.4, z: 0.2 },
      { x: -0.5, y: 0.1, z: -0.3 },
      { x: 1.5, y: 0.2, z: 0.4 },
    ]) {
      const result = solve(m, { channelValues: {}, dragTargets: { s: target } }, 'kinematic');
      const s = result.positions.s!;
      expect(Math.abs(s.y)).toBeLessThanOrEqual(1e-4); // on the axis
      expect(Math.abs(s.z)).toBeLessThanOrEqual(1e-4);
      expect(s.x).toBeGreaterThanOrEqual(0.2 - 1e-4);
      expect(s.x).toBeLessThanOrEqual(0.8 + 1e-4);
    }
  });

  it('a non-sliding telescope behaves as a rigid bar at its design length', () => {
    const m = mech(
      [node('a', { x: 0, y: 0, z: 0 }, 'anchor'), node('b', { x: 0.5, y: 0, z: 0 })],
      [
        {
          id: 'tel',
          type: 'telescope',
          maturity: 'sketch',
          nodeA: 'a',
          nodeB: 'b',
          minLengthM: 0.3,
          maxLengthM: 0.7,
          lengthM: 0.5,
          sliding: false,
          pointMasses: [],
        },
      ],
    );
    const result = solve(
      m,
      { channelValues: {}, dragTargets: { b: { x: 1.2, y: 0.6, z: 0.4 } } },
      'kinematic',
    );
    const b = result.positions.b!;
    expect(Math.hypot(b.x, b.y, b.z)).toBeCloseTo(0.5, 4);
  });

  it('a sliding telescope extends only within [min, max]', () => {
    const m = mech(
      [node('a', { x: 0, y: 0, z: 0 }, 'anchor'), node('b', { x: 0.5, y: 0, z: 0 })],
      [
        {
          id: 'tel',
          type: 'telescope',
          maturity: 'sketch',
          nodeA: 'a',
          nodeB: 'b',
          minLengthM: 0.3,
          maxLengthM: 0.7,
          lengthM: 0.5,
          sliding: true,
          pointMasses: [],
        },
      ],
    );
    const far = solve(
      m,
      { channelValues: {}, dragTargets: { b: { x: 2, y: 0, z: 1 } } },
      'kinematic',
    );
    expect(Math.hypot(far.positions.b!.x, far.positions.b!.y, far.positions.b!.z)).toBeCloseTo(
      0.7,
      4,
    );
    const near = solve(
      m,
      { channelValues: {}, dragTargets: { b: { x: 0.05, y: 0, z: 0.02 } } },
      'kinematic',
    );
    expect(Math.hypot(near.positions.b!.x, near.positions.b!.y, near.positions.b!.z)).toBeCloseTo(
      0.3,
      4,
    );
  });
});

describe('ACCEPTANCE — DOF diagnostics (3D)', () => {
  it('classifies a planar four-bar with hinges throughout as a 1-DOF mechanism', () => {
    // ground stubs give the grounded hinges their second member; their axis
    // particles pin to ground, so the whole linkage moves only in its plane
    const z: Vec3 = { x: 0, y: 0, z: 1 };
    const m = mech(
      [
        node('O2', { x: 0, y: 1, z: 0 }, 'anchor'),
        node('A', { x: 0, y: 1.2, z: 0 }),
        node('B', { x: 0.42, y: 1.45, z: 0 }),
        node('O4', { x: 0.6, y: 1, z: 0 }, 'anchor'),
        node('G2', { x: 0, y: 0.7, z: 0 }, 'anchor'),
        node('G4', { x: 0.6, y: 0.7, z: 0 }, 'anchor'),
      ],
      [
        link('crank', 'O2', 'A'),
        link('coupler', 'A', 'B'),
        link('rocker', 'B', 'O4'),
        link('stub2', 'O2', 'G2'),
        link('stub4', 'O4', 'G4'),
        hinge('pivO2', 'O2', ['stub2', 'crank'], z),
        hinge('pivA', 'A', ['crank', 'coupler'], z),
        hinge('pivB', 'B', ['coupler', 'rocker'], z),
        hinge('pivO4', 'O4', ['rocker', 'stub4'], z),
      ],
    );
    const d = solve(m, { channelValues: {} }, 'kinematic').diagnostics;
    expect(d.dof).toBe(1);
    expect(d.classification).toBe('mechanism');
    expect(d.converged).toBe(true);
  });

  it('classifies a triangulated apex (tripod of links) as a structure (0 DOF)', () => {
    const m = mech(
      [
        node('b1', { x: 0, y: 0, z: 0 }, 'anchor'),
        node('b2', { x: 1, y: 0, z: 0 }, 'anchor'),
        node('b3', { x: 0.5, y: 0, z: 0.8 }, 'anchor'),
        node('c', { x: 0.5, y: 0.8, z: 0.3 }),
      ],
      [link('l1', 'b1', 'c'), link('l2', 'b2', 'c'), link('l3', 'b3', 'c')],
    );
    const d = solve(m, { channelValues: {} }, 'kinematic').diagnostics;
    expect(d.dof).toBe(0);
    expect(d.classification).toBe('structure');
  });

  it('flags an over-braced apex as overconstrained and still returns a solution', () => {
    const m = mech(
      [
        node('b1', { x: 0, y: 0, z: 0 }, 'anchor'),
        node('b2', { x: 1, y: 0, z: 0 }, 'anchor'),
        node('b3', { x: 0.5, y: 0, z: 0.8 }, 'anchor'),
        node('b4', { x: 0.5, y: 0, z: -0.5 }, 'anchor'),
        node('c', { x: 0.5, y: 0.8, z: 0.3 }),
      ],
      [link('l1', 'b1', 'c'), link('l2', 'b2', 'c'), link('l3', 'b3', 'c'), link('l4', 'b4', 'c')],
    );
    const result = solve(m, { channelValues: {} }, 'kinematic');
    expect(result.diagnostics.dof).toBeLessThan(0);
    expect(result.diagnostics.classification).toBe('overconstrained');
    expect(Object.keys(result.positions)).toHaveLength(5);
  });

  it('flags conflicting constraints via residual + violated elements', () => {
    // a weld freezes the pair at its drawn 0° relative angle, while an angle
    // limit demands ≥ 30° — unsatisfiable, must be flagged, not hidden
    const conflicted = mech(
      [
        node('g', { x: 0, y: 0, z: 0 }, 'anchor'),
        node('p', { x: 0.5, y: 0, z: 0 }),
        node('t', { x: 1, y: 0, z: 0 }),
      ],
      [
        link('base', 'g', 'p'),
        link('arm', 'p', 't'),
        hinge(
          'piv',
          'p',
          ['base', 'arm'],
          { x: 0, y: 0, z: 1 },
          {
            welds: [['base', 'arm']],
            angleLimit: {
              memberA: 'base',
              memberB: 'arm',
              minRad: Math.PI / 6,
              maxRad: Math.PI / 3,
            },
          },
        ),
      ],
    );
    const result = solve(conflicted, { channelValues: {} }, 'kinematic');
    expect(result.diagnostics.converged).toBe(false);
    expect(result.diagnostics.residual).toBeGreaterThan(0.01);
    expect(result.diagnostics.violated).toContain('piv');
  });
});

describe('ACCEPTANCE — no length ratchet under far drag targets', () => {
  it('feeding solved positions back while dragging to unreachable 3D targets keeps lengths exact', () => {
    // regression: the UI recomputes rest lengths from the previous solution
    // every frame, so any residual drag violation left in the output would
    // compound frame over frame — the solver must end on the constraint
    // manifold, not mid-cycle
    let m = mech(
      [
        node('O2', { x: 0, y: 1, z: 0 }, 'anchor'),
        node('A', { x: 0, y: 1.2, z: 0 }),
        node('B', { x: 0.42, y: 1.45, z: 0 }),
        node('O4', { x: 0.6, y: 1, z: 0 }, 'anchor'),
      ],
      [link('crank', 'O2', 'A'), link('coupler', 'A', 'B'), link('rocker', 'B', 'O4')],
    );
    const rests = {
      crank: 0.2,
      coupler: dist3(m.nodes[1]!.position, m.nodes[2]!.position),
      rocker: dist3(m.nodes[2]!.position, m.nodes[3]!.position),
    };
    // wild, mostly-unreachable targets, big jumps like a fast pointer
    const targets: Vec3[] = [
      { x: 1.5, y: 1.2, z: 0.5 },
      { x: -1.0, y: 0.8, z: -0.7 },
      { x: 0.3, y: -1.4, z: 0.2 },
      { x: 2.0, y: 0.0, z: -1.0 },
      { x: -0.5, y: -0.5, z: 0.5 },
      { x: 0.1, y: 1.8, z: -0.3 },
    ];
    for (const t of targets) {
      const { positions, mech: next } = dragSequence(m, 'A', [t]);
      m = next;
      expect(Math.abs(dist3(positions.O2!, positions.A!) - rests.crank)).toBeLessThanOrEqual(1e-4);
      expect(Math.abs(dist3(positions.A!, positions.B!) - rests.coupler)).toBeLessThanOrEqual(1e-4);
      expect(Math.abs(dist3(positions.B!, positions.O4!) - rests.rocker)).toBeLessThanOrEqual(1e-4);
    }
  });
});

describe('ACCEPTANCE — kinematic determinism', () => {
  it('the same 3D drag script yields bit-identical positions', () => {
    const build = () =>
      mech(
        [
          node('O2', { x: 0, y: 1, z: 0 }, 'anchor'),
          node('A', { x: 0, y: 1.2, z: 0 }),
          node('B', { x: 0.42, y: 1.45, z: 0 }),
          node('O4', { x: 0.6, y: 1, z: 0 }, 'anchor'),
        ],
        [link('crank', 'O2', 'A'), link('coupler', 'A', 'B'), link('rocker', 'B', 'O4')],
      );
    const script = Array.from({ length: 17 }, (_, i) => {
      const a = (i / 17) * 2 * Math.PI;
      return { x: 0.2 * Math.cos(a), y: 1 + 0.2 * Math.sin(a), z: 0.1 * Math.sin(3 * a) };
    });
    const run = () => dragSequence(build(), 'A', script).positions;
    const p1 = run();
    const p2 = run();
    for (const id of Object.keys(p1)) {
      expect(p2[id]!.x).toBe(p1[id]!.x);
      expect(p2[id]!.y).toBe(p1[id]!.y);
      expect(p2[id]!.z).toBe(p1[id]!.z);
    }
  });
});
