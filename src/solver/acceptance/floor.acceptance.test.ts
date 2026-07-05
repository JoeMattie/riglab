// Ground plane: world y = 0 is the floor, everywhere and always in 3D (the
// v6 per-view rule collapses to one global plane — a top-panel sketch now
// genuinely lies in a horizontal plane above it). Free nodes can neither be
// dragged nor settle below it, in either solve mode. Anchor/driven nodes are
// exempt: prescribed positions are authoritative.
import { describe, expect, it } from 'vitest';
import { solve } from '..';
import { dist3, link, mech, node } from './analytic';

describe('floor — kinematic', () => {
  const m = mech(
    [node('A', { x: 0, y: 0.5, z: 0.2 }), node('B', { x: 1, y: 0.5, z: 0.2 })],
    [link('L', 'A', 'B')],
  );

  it('a free pipe dragged toward y < 0 stops on the floor with its length intact', () => {
    const result = solve(
      m,
      { channelValues: {}, dragTargets: { B: { x: 1, y: -0.8, z: 0.2 } } },
      'kinematic',
    );
    expect(result.diagnostics.converged).toBe(true);
    expect(result.positions.A!.y).toBeGreaterThanOrEqual(-1e-9);
    expect(result.positions.B!.y).toBeGreaterThanOrEqual(-1e-9);
    expect(dist3(result.positions.A!, result.positions.B!)).toBeCloseTo(1, 6);
  });

  it('a grounded node placed below the floor is left where the user put it', () => {
    const withAnchor = mech(
      [node('G', { x: 0, y: -0.2, z: 0 }, 'anchor'), node('F', { x: 1, y: 0.5, z: 0 })],
      [link('L', 'G', 'F')],
    );
    const result = solve(withAnchor, { channelValues: {} }, 'kinematic');
    expect(result.positions.G).toEqual({ x: 0, y: -0.2, z: 0 });
    expect(result.positions.F!.y).toBeGreaterThanOrEqual(-1e-9);
  });

  it('is deterministic', () => {
    const inputs = { channelValues: {}, dragTargets: { B: { x: 0.7, y: -0.4, z: 0.3 } } };
    const a = solve(m, inputs, 'kinematic');
    const b = solve(m, inputs, 'kinematic');
    expect(a.positions).toEqual(b.positions);
  });
});

describe('floor — equilibrium', () => {
  it('a falling point mass comes to rest ON the floor, converged', () => {
    const m = mech([node('F', { x: 0.3, y: 0.4, z: 0.2 })], [], {
      pointMasses: [{ id: 'pm', name: 'w', massKg: 2, nodeId: 'F' }],
    });
    const result = solve(m, { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    expect(result.positions.F!.y).toBeCloseTo(0, 4);
    expect(result.positions.F!.y).toBeGreaterThanOrEqual(-1e-6);
    // the fall is straight down: x/z untouched
    expect(result.positions.F!.x).toBeCloseTo(0.3, 6);
    expect(result.positions.F!.z).toBeCloseTo(0.2, 6);
  });

  it('a pendulum too long for its headroom rests on the floor at rest length', () => {
    // anchor 0.5 m up, pipe drawn ~0.94 m long — hangs to the floor, not through
    const m = mech(
      [node('G', { x: 0, y: 0.5, z: 0 }, 'anchor'), node('F', { x: 0.8, y: 0.1, z: 0.3 })],
      [link('L', 'G', 'F')],
      { pointMasses: [{ id: 'pm', name: 'w', massKg: 1, nodeId: 'F' }] },
    );
    const rest = dist3({ x: 0, y: 0.5, z: 0 }, { x: 0.8, y: 0.1, z: 0.3 });
    const result = solve(m, { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    expect(result.positions.F!.y).toBeGreaterThanOrEqual(-1e-6);
    expect(result.positions.F!.y).toBeCloseTo(0, 3);
    expect(dist3(result.positions.G!, result.positions.F!)).toBeCloseTo(rest, 3);
  });
});
