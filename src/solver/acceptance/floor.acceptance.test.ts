// Ground plane (PLANFILE-wearer-attachments-and-floor, slice C): world y = 0
// is the floor in every non-`top` view — the mannequin's shoes rest exactly
// on it. Free nodes can neither be dragged nor settle below it, in either
// solve mode. `top` maps the ground plane itself, so no floor applies there.
// Anchor/driven nodes are exempt: prescribed positions are authoritative.
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
    anchorBindings: [],
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

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

describe('floor — kinematic', () => {
  const m = mech([node('A', 0, 0.5), node('B', 1, 0.5)], [link('L', 'A', 'B')]);

  it('a free pipe dragged toward y < 0 stops on the floor with its length intact', () => {
    const result = solve(
      m,
      { channelValues: {}, dragTargets: { B: { x: 1, y: -0.8 } } },
      'kinematic',
    );
    expect(result.diagnostics.converged).toBe(true);
    expect(result.positions.A!.y).toBeGreaterThanOrEqual(-1e-9);
    expect(result.positions.B!.y).toBeGreaterThanOrEqual(-1e-9);
    expect(dist(result.positions.A!, result.positions.B!)).toBeCloseTo(1, 6);
  });

  it('no floor in the top view — the same drag goes negative', () => {
    const top = mech([node('A', 0, 0.5), node('B', 1, 0.5)], [link('L', 'A', 'B')], {
      viewOrientation: 'top',
    });
    const result = solve(
      top,
      { channelValues: {}, dragTargets: { B: { x: 1, y: -0.8 } } },
      'kinematic',
    );
    expect(result.positions.B!.y).toBeLessThan(-0.5);
  });

  it('a grounded node placed below the floor is left where the user put it', () => {
    const withAnchor = mech(
      [node('G', 0, -0.2, 'anchor'), node('F', 1, 0.5)],
      [link('L', 'G', 'F')],
    );
    const result = solve(withAnchor, { channelValues: {} }, 'kinematic');
    expect(result.positions.G).toEqual({ x: 0, y: -0.2 });
    expect(result.positions.F!.y).toBeGreaterThanOrEqual(-1e-9);
  });

  it('is deterministic', () => {
    const inputs = { channelValues: {}, dragTargets: { B: { x: 0.7, y: -0.4 } } };
    const a = solve(m, inputs, 'kinematic');
    const b = solve(m, inputs, 'kinematic');
    expect(a.positions).toEqual(b.positions);
  });
});

describe('floor — equilibrium', () => {
  it('a falling point mass comes to rest ON the floor, converged', () => {
    const m = mech([node('F', 0.3, 0.4)], [], {
      gravityOn: true,
      pointMasses: [{ id: 'pm', name: 'w', massKg: 2, nodeId: 'F' }],
    });
    const result = solve(m, { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    expect(result.positions.F!.y).toBeCloseTo(0, 4);
    expect(result.positions.F!.y).toBeGreaterThanOrEqual(-1e-6);
  });

  it('a pendulum too long for its headroom rests on the floor at rest length', () => {
    // anchor 0.5 m up, pipe drawn 0.894 m long — hangs to the floor, not through
    const m = mech([node('G', 0, 0.5, 'anchor'), node('F', 0.8, 0.1)], [link('L', 'G', 'F')], {
      gravityOn: true,
      pointMasses: [{ id: 'pm', name: 'w', massKg: 1, nodeId: 'F' }],
    });
    const rest = dist({ x: 0, y: 0.5 }, { x: 0.8, y: 0.1 });
    const result = solve(m, { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    expect(result.positions.F!.y).toBeGreaterThanOrEqual(-1e-6);
    expect(result.positions.F!.y).toBeCloseTo(0, 3);
    expect(dist(result.positions.G!, result.positions.F!)).toBeCloseTo(rest, 3);
  });
});
