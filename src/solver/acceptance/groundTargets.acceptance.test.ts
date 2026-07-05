// Wearer-attached grounds (PLANFILE-wearer-attachments-and-floor, slice A):
// `groundTargets` prescribes the position of kind-'anchor' nodes — the
// wearer's pack frame / body carries the ground point through pose and clip
// playback. Rest lengths still derive from document positions, so attached
// structure translates rigidly. Entries for non-anchor nodes are ignored.
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

describe('groundTargets — kinematic', () => {
  const m = mech([node('G', 0, 1, 'anchor'), node('F', 1, 1)], [link('L', 'G', 'F')]);

  it('moves a grounded node to its target; attached structure keeps rest length', () => {
    const result = solve(
      m,
      { channelValues: {}, groundTargets: { G: { x: 0.2, y: 1.3 } } },
      'kinematic',
    );
    expect(result.diagnostics.converged).toBe(true);
    expect(result.positions.G).toEqual({ x: 0.2, y: 1.3 });
    expect(dist(result.positions.G!, result.positions.F!)).toBeCloseTo(1, 6);
  });

  it('ignores a groundTargets entry for a free node', () => {
    const result = solve(
      m,
      { channelValues: {}, groundTargets: { F: { x: 5, y: 5 } } },
      'kinematic',
    );
    expect(result.positions.F).toEqual({ x: 1, y: 1 });
    expect(result.positions.G).toEqual({ x: 0, y: 1 });
  });

  it('composes with a drag on the free node — the ground wins, rest length holds', () => {
    const result = solve(
      m,
      {
        channelValues: {},
        groundTargets: { G: { x: 0.2, y: 1.3 } },
        dragTargets: { F: { x: 3, y: 1.3 } },
      },
      'kinematic',
    );
    expect(result.positions.G).toEqual({ x: 0.2, y: 1.3 });
    expect(dist(result.positions.G!, result.positions.F!)).toBeCloseTo(1, 6);
    // F reached toward the drag along the +x direction from the ground
    expect(result.positions.F!.x).toBeCloseTo(1.2, 6);
  });

  it('is deterministic', () => {
    const inputs = { channelValues: {}, groundTargets: { G: { x: 0.4, y: 0.9 } } };
    const a = solve(m, inputs, 'kinematic');
    const b = solve(m, inputs, 'kinematic');
    expect(a.positions).toEqual(b.positions);
  });
});

describe('groundTargets — equilibrium', () => {
  // gravity on: a link with a point mass dangles from the moving ground
  const m = mech([node('G', 0, 2, 'anchor'), node('F', 0, 1)], [link('L', 'G', 'F')], {
    gravityOn: true,
    pointMasses: [{ id: 'pm', name: 'w', massKg: 1, nodeId: 'F' }],
  });

  it('holds the grounded node at its target; the mass dangles at rest length', () => {
    const result = solve(
      m,
      { channelValues: {}, groundTargets: { G: { x: 0.5, y: 2.2 } } },
      'equilibrium',
    );
    expect(result.diagnostics.converged).toBe(true);
    expect(result.positions.G!.x).toBeCloseTo(0.5, 6);
    expect(result.positions.G!.y).toBeCloseTo(2.2, 6);
    expect(dist(result.positions.G!, result.positions.F!)).toBeCloseTo(1, 3);
    // dangles straight down from the moved ground
    expect(result.positions.F!.x).toBeCloseTo(0.5, 2);
    expect(result.positions.F!.y).toBeCloseTo(1.2, 2);
  });

  it('without a target the ground stays at its document position', () => {
    const result = solve(m, { channelValues: {} }, 'equilibrium');
    expect(result.positions.G).toEqual({ x: 0, y: 2 });
  });
});
