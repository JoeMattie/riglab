// Phase 1 acceptance (§11) beyond the four-bar: bentLink rigidity under
// drag (vertex distances constant within 1e-4 m), joint limits, welds,
// sliders, telescopes, DOF classification, determinism.
import { describe, expect, it } from 'vitest';
import type { Mechanism, MechanismElement, MechanismNode, Vec2 } from '../../schema';
import { solve } from '..';

function mech(
  nodes: MechanismNode[],
  elements: MechanismElement[],
  overrides: Partial<Mechanism> = {},
): Mechanism {
  return {
    id: 'm',
    name: 'test',
    viewOrientation: 'side-left',
    gravityOn: false,
    nodes,
    elements,
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
    namedStates: [],
    ...overrides,
  };
}

const node = (id: string, x: number, y: number, kind: MechanismNode['kind'] = 'free') => ({
  id,
  kind,
  position: { x, y },
});

const link = (id: string, nodeA: string, nodeB: string): MechanismElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA,
  nodeB,
  pointMasses: [],
});

function dragSequence(
  m: Mechanism,
  nodeId: string,
  targets: Vec2[],
): { positions: Record<string, Vec2>; mech: Mechanism } {
  let cur = m;
  let positions: Record<string, Vec2> = {};
  for (const target of targets) {
    const result = solve(cur, { channelValues: {}, dragTargets: { [nodeId]: target } }, 'kinematic');
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

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

function circleTargets(center: Vec2, radius: number, steps: number): Vec2[] {
  return Array.from({ length: steps }, (_, i) => {
    const a = (i / steps) * 2 * Math.PI;
    return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
  });
}

describe('ACCEPTANCE Phase 1 — bentLink rigidity', () => {
  it('keeps all vertex distances constant within 1e-4 m while dragged', () => {
    // L-shaped bent pipe through 4 vertices, anchored at one end
    const m = mech(
      [
        node('v0', 0, 0, 'anchor'),
        node('v1', 0.4, 0, 'free'),
        node('v2', 0.4, 0.3, 'free'),
        node('v3', 0.7, 0.3, 'free'),
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
    const ids = ['v0', 'v1', 'v2', 'v3'];
    const rest: number[] = [];
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = m.nodes[i]!.position;
        const b = m.nodes[j]!.position;
        rest.push(Math.hypot(a.x - b.x, a.y - b.y));
      }
    }
    // drag the free tip in a wide circle (many targets are unreachable —
    // the body must follow rigidly, never stretch)
    let cur = m;
    let maxDistortion = 0;
    for (const target of circleTargets({ x: 0, y: 0 }, 0.9, 36)) {
      const { positions, mech: next } = dragSequence(cur, 'v3', [target]);
      cur = next;
      let k = 0;
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = positions[ids[i]!]!;
          const b = positions[ids[j]!]!;
          maxDistortion = Math.max(
            maxDistortion,
            Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - rest[k]!),
          );
          k++;
        }
      }
    }
    expect(maxDistortion).toBeLessThanOrEqual(1e-4);
  });
});

describe('ACCEPTANCE Phase 1 — pivot welds and angle limits', () => {
  it('a welded pair keeps its relative angle while dragged', () => {
    const m = mech(
      [node('p', 0, 0, 'anchor'), node('a', 0.5, 0, 'free'), node('b', 0, 0.4, 'free')],
      [
        link('la', 'p', 'a'),
        link('lb', 'p', 'b'),
        {
          id: 'piv',
          type: 'pivot',
          maturity: 'sketch',
          nodeId: 'p',
          memberIds: ['la', 'lb'],
          welds: [['la', 'lb']],
        },
      ],
    );
    const { positions } = dragSequence(m, 'a', circleTargets({ x: 0, y: 0 }, 0.5, 24));
    const a = positions.a!;
    const b = positions.b!;
    const angle = Math.abs(
      Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y), // angle between p→a and p→b
    );
    expect(Math.abs(angle - Math.PI / 2)).toBeLessThanOrEqual(1e-3);
  });

  it('an angle limit clamps the joint when dragged past it', () => {
    // two links pivoted at a shared free node; limit the relative angle
    const m = mech(
      [node('g', 0, 0, 'anchor'), node('p', 0.5, 0, 'free'), node('t', 1.0, 0, 'free')],
      [
        link('base', 'g', 'p'),
        link('arm', 'p', 't'),
        {
          id: 'piv',
          type: 'pivot',
          maturity: 'sketch',
          nodeId: 'p',
          memberIds: ['base', 'arm'],
          welds: [],
          angleLimit: { memberA: 'base', memberB: 'arm', minRad: -Math.PI / 4, maxRad: Math.PI / 4 },
        },
      ],
    );
    // try to fold the arm all the way up (≈ +170°) — it must stop at +45°
    const { positions } = dragSequence(m, 't', [
      { x: 1.0, y: 0.3 },
      { x: 0.8, y: 0.5 },
      { x: 0.4, y: 0.55 },
      { x: 0.1, y: 0.4 },
    ]);
    const p = positions.p!;
    const t = positions.t!;
    const g = positions.g!;
    const u1 = { x: p.x - g.x, y: p.y - g.y }; // base direction at the pivot
    const u2 = { x: t.x - p.x, y: t.y - p.y };
    const rel = Math.atan2(u1.x * u2.y - u1.y * u2.x, u1.x * u2.x + u1.y * u2.y);
    expect(rel).toBeLessThanOrEqual(Math.PI / 4 + 2e-3);
    expect(rel).toBeGreaterThanOrEqual(-Math.PI / 4 - 2e-3);
  });
});

describe('ACCEPTANCE Phase 1 — slider and telescope', () => {
  it('a slider node stays on its link axis within travel limits', () => {
    const m = mech(
      [
        node('a', 0, 0, 'anchor'),
        node('b', 1, 0, 'anchor'),
        node('s', 0.5, 0, 'free'),
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
      { x: 0.6, y: 0.4 },
      { x: -0.5, y: 0.1 },
      { x: 1.5, y: -0.2 },
    ]) {
      const result = solve(m, { channelValues: {}, dragTargets: { s: target } }, 'kinematic');
      const s = result.positions.s!;
      expect(Math.abs(s.y)).toBeLessThanOrEqual(1e-4); // on the axis
      expect(s.x).toBeGreaterThanOrEqual(0.2 - 1e-4);
      expect(s.x).toBeLessThanOrEqual(0.8 + 1e-4);
    }
  });

  it('a non-sliding telescope behaves as a rigid bar at its design length', () => {
    const m = mech(
      [node('a', 0, 0, 'anchor'), node('b', 0.5, 0, 'free')],
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
    const result = solve(m, { channelValues: {}, dragTargets: { b: { x: 1.2, y: 0.6 } } }, 'kinematic');
    const b = result.positions.b!;
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(0.5, 4);
  });

  it('a sliding telescope extends only within [min, max]', () => {
    const m = mech(
      [node('a', 0, 0, 'anchor'), node('b', 0.5, 0, 'free')],
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
    const far = solve(m, { channelValues: {}, dragTargets: { b: { x: 2, y: 0 } } }, 'kinematic');
    expect(Math.hypot(far.positions.b!.x, far.positions.b!.y)).toBeCloseTo(0.7, 4);
    const near = solve(m, { channelValues: {}, dragTargets: { b: { x: 0.05, y: 0 } } }, 'kinematic');
    expect(Math.hypot(near.positions.b!.x, near.positions.b!.y)).toBeCloseTo(0.3, 4);
  });
});

describe('ACCEPTANCE Phase 1 — DOF diagnostics', () => {
  it('classifies a four-bar as a 1-DOF mechanism', () => {
    const m = mech(
      [
        node('O2', 0, 0, 'anchor'),
        node('A', 0, 0.2, 'free'),
        node('B', 0.42, 0.45, 'free'),
        node('O4', 0.6, 0, 'anchor'),
      ],
      [link('crank', 'O2', 'A'), link('coupler', 'A', 'B'), link('rocker', 'B', 'O4')],
    );
    const d = solve(m, { channelValues: {} }, 'kinematic').diagnostics;
    expect(d.dof).toBe(1);
    expect(d.classification).toBe('mechanism');
  });

  it('classifies a braced triangle as a structure (0 DOF)', () => {
    const m = mech(
      [node('a', 0, 0, 'anchor'), node('b', 1, 0, 'anchor'), node('c', 0.5, 0.6, 'free')],
      [link('l1', 'a', 'c'), link('l2', 'b', 'c')],
    );
    const d = solve(m, { channelValues: {} }, 'kinematic').diagnostics;
    expect(d.dof).toBe(0);
    expect(d.classification).toBe('structure');
  });

  it('flags an overconstrained lattice and still returns a solution', () => {
    const m = mech(
      [
        node('O2', 0, 0, 'anchor'),
        node('A', 0, 0.2, 'free'),
        node('B', 0.42, 0.45, 'free'),
        node('O4', 0.6, 0, 'anchor'),
      ],
      [
        link('crank', 'O2', 'A'),
        link('coupler', 'A', 'B'),
        link('rocker', 'B', 'O4'),
        link('braceAO4', 'A', 'O4'),
        link('braceBO2', 'B', 'O2'),
      ],
    );
    const result = solve(m, { channelValues: {} }, 'kinematic');
    expect(result.diagnostics.dof).toBeLessThan(0);
    expect(result.diagnostics.classification).toBe('overconstrained');
    expect(Object.keys(result.positions)).toHaveLength(4);
  });

  it('flags conflicting constraints via residual + violated elements', () => {
    // a weld freezes the pair at its drawn 0° relative angle, while an angle
    // limit demands ≥ 30° — unsatisfiable, must be flagged, not hidden
    const conflicted = mech(
      [node('g', 0, 0, 'anchor'), node('p', 0.5, 0, 'free'), node('t', 1, 0, 'free')],
      [
        link('base', 'g', 'p'),
        link('arm', 'p', 't'),
        {
          id: 'piv',
          type: 'pivot',
          maturity: 'sketch',
          nodeId: 'p',
          memberIds: ['base', 'arm'],
          welds: [['base', 'arm']],
          angleLimit: { memberA: 'base', memberB: 'arm', minRad: Math.PI / 6, maxRad: Math.PI / 3 },
        },
      ],
    );
    const result = solve(conflicted, { channelValues: {} }, 'kinematic');
    expect(result.diagnostics.converged).toBe(false);
    expect(result.diagnostics.residual).toBeGreaterThan(0.01);
    expect(result.diagnostics.violated).toContain('piv');
  });
});

describe('ACCEPTANCE Phase 1 — no length ratchet under far drag targets', () => {
  it('feeding solved positions back while dragging to unreachable targets keeps lengths exact', () => {
    // regression: the UI recomputes rest lengths from the previous solution
    // every frame, so any residual drag violation left in the output would
    // compound frame over frame (found via Playwright with coarse pointer
    // steps — solver must end on the constraint manifold, not mid-cycle)
    let m = mech(
      [
        node('O2', 0, 0, 'anchor'),
        node('A', 0, 0.2, 'free'),
        node('B', 0.42, 0.45, 'free'),
        node('O4', 0.6, 0, 'anchor'),
      ],
      [link('crank', 'O2', 'A'), link('coupler', 'A', 'B'), link('rocker', 'B', 'O4')],
    );
    const rests = { crank: 0.2, coupler: dist(m.nodes[1]!.position, m.nodes[2]!.position), rocker: dist(m.nodes[2]!.position, m.nodes[3]!.position) };
    // wild, mostly-unreachable targets, big jumps like a fast pointer
    const targets: Vec2[] = [
      { x: 1.5, y: 1.2 },
      { x: -1.0, y: 0.8 },
      { x: 0.3, y: -1.4 },
      { x: 2.0, y: 0.0 },
      { x: -0.5, y: -0.5 },
      { x: 0.1, y: 1.8 },
    ];
    for (const t of targets) {
      const { positions, mech: next } = dragSequence(m, 'A', [t]);
      m = next;
      const lenCrank = dist(positions.O2!, positions.A!);
      const lenCoupler = dist(positions.A!, positions.B!);
      const lenRocker = dist(positions.B!, positions.O4!);
      expect(Math.abs(lenCrank - rests.crank)).toBeLessThanOrEqual(1e-4);
      expect(Math.abs(lenCoupler - rests.coupler)).toBeLessThanOrEqual(1e-4);
      expect(Math.abs(lenRocker - rests.rocker)).toBeLessThanOrEqual(1e-4);
    }
  });
});

describe('ACCEPTANCE Phase 1 — determinism', () => {
  it('the same drag script yields bit-identical positions', () => {
    const build = () =>
      mech(
        [
          node('O2', 0, 0, 'anchor'),
          node('A', 0, 0.2, 'free'),
          node('B', 0.42, 0.45, 'free'),
          node('O4', 0.6, 0, 'anchor'),
        ],
        [link('crank', 'O2', 'A'), link('coupler', 'A', 'B'), link('rocker', 'B', 'O4')],
      );
    const script = circleTargets({ x: 0, y: 0 }, 0.2, 17);
    const run = () => dragSequence(build(), 'A', script).positions;
    const p1 = run();
    const p2 = run();
    for (const id of Object.keys(p1)) {
      expect(p2[id]!.x).toBe(p1[id]!.x);
      expect(p2[id]!.y).toBe(p1[id]!.y);
    }
  });
});
