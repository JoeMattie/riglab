// Wearer-attached grounds: `groundTargets` prescribes the position of
// kind-'anchor' nodes — the wearer's pack frame / body carries the ground
// point through pose and clip playback, now as true 3D points (the per-view
// projection indirection is gone). Rest lengths still derive from document
// positions, so attached structure translates rigidly. Entries for non-anchor
// nodes are ignored.
import { describe, expect, it } from 'vitest';
import { solve } from '..';
import { dist3, link, mech, node } from './analytic';

describe('groundTargets — kinematic', () => {
  const m = mech(
    [node('G', { x: 0, y: 1, z: 0 }, 'anchor'), node('F', { x: 1, y: 1, z: 0 })],
    [link('L', 'G', 'F')],
  );

  it('moves a grounded node to its 3D target; attached structure keeps rest length', () => {
    const result = solve(
      m,
      { channelValues: {}, groundTargets: { G: { x: 0.2, y: 1.3, z: 0.4 } } },
      'kinematic',
    );
    expect(result.diagnostics.converged).toBe(true);
    expect(result.positions.G).toEqual({ x: 0.2, y: 1.3, z: 0.4 });
    expect(dist3(result.positions.G!, result.positions.F!)).toBeCloseTo(1, 6);
  });

  it('ignores a groundTargets entry for a free node', () => {
    const result = solve(
      m,
      { channelValues: {}, groundTargets: { F: { x: 5, y: 5, z: 5 } } },
      'kinematic',
    );
    expect(result.positions.F).toEqual({ x: 1, y: 1, z: 0 });
    expect(result.positions.G).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('composes with a drag on the free node — the ground wins, rest length holds', () => {
    const result = solve(
      m,
      {
        channelValues: {},
        groundTargets: { G: { x: 0.2, y: 1.3, z: 0.1 } },
        dragTargets: { F: { x: 3, y: 1.3, z: 0.1 } },
      },
      'kinematic',
    );
    expect(result.positions.G).toEqual({ x: 0.2, y: 1.3, z: 0.1 });
    expect(dist3(result.positions.G!, result.positions.F!)).toBeCloseTo(1, 6);
    // F reached toward the drag along the +x direction from the ground
    expect(result.positions.F!.x).toBeCloseTo(1.2, 6);
    expect(result.positions.F!.y).toBeCloseTo(1.3, 6);
    expect(result.positions.F!.z).toBeCloseTo(0.1, 6);
  });

  it('is deterministic', () => {
    const inputs = { channelValues: {}, groundTargets: { G: { x: 0.4, y: 0.9, z: -0.2 } } };
    const a = solve(m, inputs, 'kinematic');
    const b = solve(m, inputs, 'kinematic');
    expect(a.positions).toEqual(b.positions);
  });
});

describe('groundTargets — equilibrium', () => {
  // a link with a point mass dangles from the moving ground
  const m = mech(
    [node('G', { x: 0, y: 2, z: 0 }, 'anchor'), node('F', { x: 0, y: 1, z: 0 })],
    [link('L', 'G', 'F')],
    { pointMasses: [{ id: 'pm', name: 'w', massKg: 1, nodeId: 'F' }] },
  );

  it('holds the grounded node at its 3D target; the mass dangles at rest length', () => {
    const result = solve(
      m,
      { channelValues: {}, groundTargets: { G: { x: 0.5, y: 2.2, z: -0.3 } } },
      'equilibrium',
    );
    expect(result.diagnostics.converged).toBe(true);
    expect(result.positions.G!.x).toBeCloseTo(0.5, 6);
    expect(result.positions.G!.y).toBeCloseTo(2.2, 6);
    expect(result.positions.G!.z).toBeCloseTo(-0.3, 6);
    expect(dist3(result.positions.G!, result.positions.F!)).toBeCloseTo(1, 3);
    // dangles straight down from the moved ground
    expect(result.positions.F!.x).toBeCloseTo(0.5, 2);
    expect(result.positions.F!.y).toBeCloseTo(1.2, 2);
    expect(result.positions.F!.z).toBeCloseTo(-0.3, 2);
  });

  it('without a target the ground stays at its document position', () => {
    const result = solve(m, { channelValues: {} }, 'equilibrium');
    expect(result.positions.G).toEqual({ x: 0, y: 2, z: 0 });
  });
});
