// NEW genuinely-3D acceptance (PLANFILE-3d-conversion.md): behaviours that
// have no 2D counterpart — hinges holding against out-of-plane load,
// spherical joints swinging freely, a spatial four-bar with non-parallel
// hinge axes, torsion transfer between non-parallel axes, and bitwise
// determinism across both modes with hinge machinery in play.
import { describe, expect, it } from 'vitest';
import type { Mechanism, Vec3 } from '../../schema';
import { solve } from '..';
import { dist3, hinge, link, mech, node, spherical } from './analytic';

// ─────────────────────────────────────────────────────────────────────────
// A pendulum hinged to a grounded stub: hinge axis +z ⇒ the arm may only
// rotate in the z = 0 plane. Pushing it sideways (kinematic drag with a big
// z component) must not take it out of that plane.
// ─────────────────────────────────────────────────────────────────────────
function pendulum(joint: 'hinge' | 'spherical'): Mechanism {
  const jointEl =
    joint === 'hinge'
      ? hinge('piv', 'P', ['stub', 'arm'], { x: 0, y: 0, z: 1 })
      : spherical('piv', 'P', ['stub', 'arm']);
  return mech(
    [
      node('P', { x: 0.5, y: 1, z: 0 }, 'anchor'),
      node('G', { x: 0, y: 1, z: 0 }, 'anchor'),
      node('T', { x: 1, y: 1, z: 0 }),
    ],
    [link('stub', 'P', 'G'), link('arm', 'P', 'T'), jointEl],
  );
}

describe('ACCEPTANCE 3D — hinge holds under out-of-plane load', () => {
  it('a hinged pendulum dragged sideways stays in its hinge plane', () => {
    const result = solve(
      pendulum('hinge'),
      { channelValues: {}, dragTargets: { T: { x: 0.8, y: 1.3, z: 0.5 } } },
      'kinematic',
    );
    expect(result.diagnostics.converged).toBe(true);
    const t = result.positions.T!;
    expect(Math.abs(t.z)).toBeLessThanOrEqual(1e-3); // never leaves the plane
    expect(dist3(t, result.positions.P!)).toBeCloseTo(0.5, 4); // arm length holds
    // and it did swing toward the in-plane part of the wish
    expect(t.y).toBeGreaterThan(1.1);
  });

  it('a spherical pivot swings freely out of plane', () => {
    // same rig, ball joint: the arm follows the out-of-plane wish exactly
    // (the target is reachable on the 0.5 m sphere around P)
    const target: Vec3 = { x: 0.5 + 0.3, y: 1, z: 0.4 }; // |target − P| = 0.5
    const result = solve(
      pendulum('spherical'),
      { channelValues: {}, dragTargets: { T: target } },
      'kinematic',
    );
    expect(result.diagnostics.converged).toBe(true);
    const t = result.positions.T!;
    expect(dist3(t, target)).toBeLessThanOrEqual(1e-3);
    expect(t.z).toBeGreaterThan(0.35); // genuinely out of the drawn plane
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Spatial four-bar: crank hinged about +z at O2, rocker hinged about +x at
// O4 (non-parallel axes), spherical coupler joints. 1 DOF; dragging the
// crank around its circle keeps everything converged, the crank in its z-
// plane, the rocker on its x-plane circle, and all lengths rigid.
// ─────────────────────────────────────────────────────────────────────────
function spatialFourBar(): Mechanism {
  return mech(
    [
      node('O2', { x: 0, y: 1, z: 0 }, 'anchor'),
      node('G2', { x: 0, y: 0.7, z: 0 }, 'anchor'),
      node('A', { x: 0.2, y: 1, z: 0 }),
      node('O4', { x: 0.6, y: 1, z: 0 }, 'anchor'),
      node('G4', { x: 0.6, y: 0.7, z: 0 }, 'anchor'),
      node('B', { x: 0.6, y: 1.3, z: 0.15 }),
    ],
    [
      link('crank', 'O2', 'A'),
      link('coupler', 'A', 'B'),
      link('rocker', 'B', 'O4'),
      link('stub2', 'O2', 'G2'),
      link('stub4', 'O4', 'G4'),
      hinge('pivO2', 'O2', ['stub2', 'crank'], { x: 0, y: 0, z: 1 }),
      hinge('pivO4', 'O4', ['stub4', 'rocker'], { x: 1, y: 0, z: 0 }),
    ],
  );
}

describe('ACCEPTANCE 3D — spatial four-bar with non-parallel hinge axes', () => {
  it('is a 1-DOF mechanism', () => {
    const d = solve(spatialFourBar(), { channelValues: {} }, 'kinematic').diagnostics;
    expect(d.dof).toBe(1);
    expect(d.classification).toBe('mechanism');
  });

  it('stays solvable and converged while the crank sweeps ±45°', () => {
    let m = spatialFourBar();
    const rests = {
      crank: 0.2,
      coupler: dist3({ x: 0.2, y: 1, z: 0 }, { x: 0.6, y: 1.3, z: 0.15 }),
      rocker: dist3({ x: 0.6, y: 1.3, z: 0.15 }, { x: 0.6, y: 1, z: 0 }),
    };
    const steps = 24;
    for (let i = 0; i <= steps; i++) {
      // sweep 0 → +45° → −45° → 0 in small increments (the loop stops
      // assembling near ±57° with this geometry — stay inside its range)
      const sweep = Math.sin((i / steps) * 2 * Math.PI) * (Math.PI / 4);
      const target: Vec3 = {
        x: 0.2 * Math.cos(sweep),
        y: 1 + 0.2 * Math.sin(sweep),
        z: 0,
      };
      const result = solve(m, { channelValues: {}, dragTargets: { A: target } }, 'kinematic');
      expect(result.diagnostics.converged).toBe(true);
      const A = result.positions.A!;
      const B = result.positions.B!;
      // crank rides its +z hinge plane; rocker rides its +x hinge plane
      expect(Math.abs(A.z)).toBeLessThanOrEqual(1e-3);
      expect(Math.abs(B.x - 0.6)).toBeLessThanOrEqual(1e-3);
      // all bars rigid
      expect(dist3(result.positions.O2!, A)).toBeCloseTo(rests.crank, 3);
      expect(dist3(A, B)).toBeCloseTo(rests.coupler, 3);
      expect(dist3(B, result.positions.O4!)).toBeCloseTo(rests.rocker, 3);
      m = {
        ...m,
        nodes: m.nodes.map((n) => {
          const p = result.positions[n.id];
          return p ? { ...n, position: p } : n;
        }),
      };
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Torsion transfer between NON-PARALLEL hinge axes: input pivot about +z,
// output pivot about +y, ratio 1, no backlash. Driving the input by δ must
// rotate the output arm by δ about ITS OWN axis.
// ─────────────────────────────────────────────────────────────────────────
describe('ACCEPTANCE 3D — torsion transfer between non-parallel axes', () => {
  function crossAxisTorsion(): Mechanism {
    return mech(
      [
        node('FA', { x: -0.5, y: 1, z: 0 }, 'anchor'),
        node('PA', { x: 0, y: 1, z: 0 }, 'anchor'),
        node('Ain', { x: 0, y: 1.3, z: 0 }, 'driven', 'twist'),
        node('FB', { x: 0.5, y: 1, z: 0 }, 'anchor'),
        node('PB', { x: 1, y: 1, z: 0 }, 'anchor'),
        node('Bout', { x: 1, y: 1, z: 0.3 }), // output arm along +z, rotates about +y
      ],
      [
        link('mAfix', 'FA', 'PA'),
        link('mAin', 'PA', 'Ain'),
        link('mBfix', 'FB', 'PB'),
        link('mBout', 'PB', 'Bout'),
        hinge('pivA', 'PA', ['mAfix', 'mAin'], { x: 0, y: 0, z: 1 }),
        hinge('pivB', 'PB', ['mBfix', 'mBout'], { x: 0, y: 1, z: 0 }),
        {
          id: 'tc',
          type: 'torsionCable',
          maturity: 'sketch',
          pivotA: 'pivA',
          pivotB: 'pivB',
          ratio: 1,
          backlashRad: 0,
        },
      ],
      {
        inputs: [
          { id: 'twist', name: 'twist', kind: 'angle', min: -1, max: 1, value: 0, locked: false },
        ],
      },
    );
  }

  it('rotating the input about +z rotates the output about +y by the same angle', () => {
    const delta = 0.3;
    const result = solve(crossAxisTorsion(), { channelValues: { twist: delta } }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const pb = result.positions.PB!;
    const bout = result.positions.Bout!;
    // output rotation about +y from the drawn +z arm: φ = atan2(Δx, Δz)
    const phi = Math.atan2(bout.x - pb.x, bout.z - pb.z);
    expect(phi).toBeCloseTo(delta, 2);
    // arm stays rigid and on its hinge plane (y = const for axis +y)
    expect(dist3(pb, bout)).toBeCloseTo(0.3, 3);
    expect(Math.abs(bout.y - pb.y)).toBeLessThanOrEqual(2e-3);
  });

  it('is inert at zero input', () => {
    const result = solve(crossAxisTorsion(), { channelValues: { twist: 0 } }, 'equilibrium');
    const bout = result.positions.Bout!;
    expect(dist3(bout, { x: 1, y: 1, z: 0.3 })).toBeLessThanOrEqual(1e-3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Determinism with hinge machinery in play: two identical solves must be
// bitwise-equal in BOTH modes (virtual axis particles included in the solve,
// excluded from the output).
// ─────────────────────────────────────────────────────────────────────────
describe('ACCEPTANCE 3D — determinism with hinges', () => {
  const build = (): Mechanism =>
    mech(
      [
        node('P', { x: 0.5, y: 1, z: 0 }, 'anchor'),
        node('G', { x: 0, y: 1, z: 0 }, 'anchor'),
        node('T', { x: 1, y: 1, z: 0 }),
      ],
      [
        link('stub', 'P', 'G'),
        link('arm', 'P', 'T'),
        hinge('piv', 'P', ['stub', 'arm'], { x: 0, y: 0, z: 1 }),
      ],
      { pointMasses: [{ id: 'w', name: 'tip', massKg: 1, nodeId: 'T' }] },
    );

  it('kinematic: bitwise-identical positions, no virtual particles in the output', () => {
    const inputs = { channelValues: {}, dragTargets: { T: { x: 0.7, y: 1.4, z: 0.3 } } };
    const a = solve(build(), inputs, 'kinematic');
    const b = solve(build(), inputs, 'kinematic');
    expect(Object.keys(a.positions).sort()).toEqual(['G', 'P', 'T']);
    for (const id of Object.keys(a.positions)) {
      expect(b.positions[id]!.x).toBe(a.positions[id]!.x);
      expect(b.positions[id]!.y).toBe(a.positions[id]!.y);
      expect(b.positions[id]!.z).toBe(a.positions[id]!.z);
    }
  });

  it('equilibrium: bitwise-identical positions, no virtual particles in the output', () => {
    const a = solve(build(), { channelValues: {} }, 'equilibrium');
    const b = solve(build(), { channelValues: {} }, 'equilibrium');
    expect(Object.keys(a.positions).sort()).toEqual(['G', 'P', 'T']);
    for (const id of Object.keys(a.positions)) {
      expect(b.positions[id]!.x).toBe(a.positions[id]!.x);
      expect(b.positions[id]!.y).toBe(a.positions[id]!.y);
      expect(b.positions[id]!.z).toBe(a.positions[id]!.z);
    }
  });

  it('equilibrium: a hinged pendulum under gravity settles in its hinge plane', () => {
    const result = solve(build(), { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const t = result.positions.T!;
    // hangs straight below the pivot, in the z = 0 hinge plane
    expect(Math.abs(t.z)).toBeLessThanOrEqual(1e-3);
    expect(dist3(t, { x: 0.5, y: 0.5, z: 0 })).toBeLessThanOrEqual(5e-3);
  });
});
