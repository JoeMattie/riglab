// 2D-parity acceptance for equilibrium + force extraction (PLANFILE-3d-
// conversion.md): every planar analytic case re-expressed in 3D and matching
// the same analytic result. Statics cases live in a vertical plane rotated
// about world y (gravity stays −y, so the physics is untouched while every
// solver path runs in 3D); gravity-free coupling cases (bowden, torsion) tilt
// by a fully general quaternion. Analytic references are computed
// independently of the solver.
import { describe, expect, it } from 'vitest';
import type { Mechanism, Vec3 } from '../../schema';
import { solve } from '..';
import {
  dist3,
  hinge,
  link,
  mech,
  node,
  place,
  rotAxisOfFrame,
  TILT,
  unplace,
  YAW,
} from './analytic';

const G = 9.81;

// ─────────────────────────────────────────────────────────────────────────
// Lever balance: 2 kg at 0.5 m vs 1 kg at 1.0 m about a pivot settles level,
// pivot reaction = 3·g N (±2%). The balance beam is a rigid body (bentLink
// L–O–R) hinged to a fully-anchored ground stub, with the hinge axis normal
// to the rotated vertical plane — the beam tips only in that plane.
// ─────────────────────────────────────────────────────────────────────────
describe('ACCEPTANCE 3D parity — lever balance in a rotated vertical plane', () => {
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  const at = place(YAW, origin);
  const axis = rotAxisOfFrame(YAW);

  function leverMechanism(): Mechanism {
    return mech(
      [
        // raised well above the floor so the arms can tip freely
        node('O', at(0, 2.3), 'anchor'), // fulcrum, above the arms → CG hangs below it (stable, level)
        node('L', at(-0.5, 2)), // 2 kg arm end
        node('R', at(1.0, 2)), // 1 kg arm end
        node('O2', at(0, 1.8), 'anchor'), // ground stub for the pivot's 2nd member
      ],
      [
        {
          id: 'beam',
          type: 'bentLink',
          maturity: 'sketch',
          nodeIds: ['L', 'O', 'R'],
          filletRadiiM: [0],
          pointMasses: [],
        },
        link('ref', 'O', 'O2'),
        hinge('fulcrum', 'O', ['beam', 'ref'], axis),
      ],
      {
        pointMasses: [
          { id: 'pmL', name: 'heavy', massKg: 2, nodeId: 'L' },
          { id: 'pmR', name: 'light', massKg: 1, nodeId: 'R' },
        ],
      },
    );
  }

  it('a balanced lever stays level and the pivot reaction is 3·g up (±2%)', () => {
    const result = solve(leverMechanism(), { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const L = result.positions.L!;
    const R = result.positions.R!;
    // moment-balanced (2·0.5 = 1·1.0) → the beam holds level (world y)
    expect(Math.abs(L.y - R.y)).toBeLessThanOrEqual(2e-3);
    const reaction = result.forces.pivotReactions.fulcrum!;
    expect(reaction.y).toBeGreaterThan(0); // support pushes up
    const expected = 3 * G;
    expect(Math.abs(Math.hypot(reaction.x, reaction.y, reaction.z) - expected)).toBeLessThanOrEqual(
      0.02 * expected,
    );
  });

  it('an unbalanced lever tips toward the heavier moment, staying in its plane', () => {
    // move the 1 kg mass out to 1.5 m: right moment (1.5) now beats left (1.0)
    const m = leverMechanism();
    m.nodes = m.nodes.map((n) => (n.id === 'R' ? { ...n, position: at(1.5, 2) } : n));
    const result = solve(m, { channelValues: {} }, 'equilibrium');
    // right side sinks below the left
    expect(result.positions.R!.y).toBeLessThan(result.positions.L!.y - 0.02);
    // hinged to the grounded stub: no out-of-plane drift (local z ≈ 0)
    const toLocal = unplace(YAW, origin);
    expect(Math.abs(toLocal(result.positions.R!).z)).toBeLessThanOrEqual(2e-3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Spring-counterbalanced boom settles at the analytically computed angle ±1°.
// Boom pinned at O (spherical anchor — forces keep it in its vertical plane),
// point mass at the tip, an elastic from the tip up to an overhead anchor.
// ─────────────────────────────────────────────────────────────────────────
describe('ACCEPTANCE 3D parity — spring-counterbalanced boom in a rotated plane', () => {
  const M = 2; // kg at tip
  const L = 1; // boom length (O→T drawn along local +x)
  const K = 60; // elastic stiffness N/m
  const REST = 0.6; // elastic rest length
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  const at = place(YAW, origin);

  // Torque balance about O at boom angle φ (T = (cosφ, sinφ)·L):
  //   −M g L cosφ + Te·cosφ/len = 0,  Te = K(len−REST), len = √(2−2 sinφ)
  // ⇒ K(1 − REST/len) = M g  ⇒  len = REST / (1 − M g / K),  sinφ = 1 − len²/2
  function analyticAngle(): number {
    const len = REST / (1 - (M * G) / K);
    const s = 1 - (len * len) / 2;
    return Math.asin(s);
  }

  function boomMechanism(): Mechanism {
    return mech(
      [
        node('O', at(0, 0), 'anchor'),
        node('T', at(L, 0)), // drawn horizontal; settles up to φ*
        node('P', at(0, 1), 'anchor'),
      ],
      [
        link('boom', 'O', 'T'),
        {
          id: 'spring',
          type: 'elastic',
          maturity: 'sketch',
          nodeA: 'T',
          nodeB: 'P',
          slackLengthM: REST,
          stiffnessNPerM: K,
        },
      ],
      { pointMasses: [{ id: 'tip', name: 'head', massKg: M, nodeId: 'T' }] },
    );
  }

  it('settles at the analytic equilibrium angle within 1°', () => {
    const result = solve(boomMechanism(), { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const tLocal = unplace(YAW, origin)(result.positions.T!);
    const phi = Math.atan2(tLocal.y, tLocal.x);
    const expected = analyticAngle();
    expect(Math.abs(phi - expected)).toBeLessThanOrEqual((1 * Math.PI) / 180);
    // boom length preserved (rigid), pose stays in the rotated plane
    expect(Math.hypot(tLocal.x, tLocal.y, tLocal.z)).toBeCloseTo(L, 3);
    expect(Math.abs(tLocal.z)).toBeLessThanOrEqual(2e-3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Bowden transfers displacement 1:1 — fully tilted (no gravity coupling: the
// output node is massless, so global gravity is inert here).
// ─────────────────────────────────────────────────────────────────────────
describe('ACCEPTANCE 3D parity — bowden 1:1 displacement transfer, tilted', () => {
  const origin: Vec3 = { x: 0, y: 2, z: 0 };
  const at = place(TILT, origin);

  function bowdenMechanism(): Mechanism {
    return mech(
      [
        node('a1', at(0, 0), 'anchor'),
        node('a2', at(0.5, 0), 'driven', 'pull'), // A-side end, driven along the a1→a2 axis
        node('b1', at(1, 0), 'anchor'),
        node('b2', at(1.5, 0)), // B-side output
      ],
      [
        {
          id: 'cable',
          type: 'bowden',
          maturity: 'sketch',
          a1: 'a1',
          a2: 'a2',
          b1: 'b1',
          b2: 'b2',
          restLengthAM: 0.5,
          restLengthBM: 0.5,
        },
      ],
      {
        inputs: [
          {
            id: 'pull',
            name: 'pull',
            kind: 'displacement',
            min: -0.3,
            max: 0.3,
            value: 0,
            locked: false,
          },
        ],
      },
    );
  }

  it('driving side A out by Δ pulls side B in by the same Δ', () => {
    const delta = 0.1;
    const result = solve(bowdenMechanism(), { channelValues: { pull: delta } }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const lenA = dist3(result.positions.a1!, result.positions.a2!);
    const lenB = dist3(result.positions.b1!, result.positions.b2!);
    expect(lenA).toBeCloseTo(0.5 + delta, 3); // A lengthened by Δ
    expect(lenB).toBeCloseTo(0.5 - delta, 3); // B shortened by Δ (1:1)
    // cable tension is reported (finite, non-negative); its magnitude is
    // load-dependent and ~0 here because the B-side output is unresisted
    const tension = result.forces.elements.cable!;
    expect(Number.isFinite(tension)).toBe(true);
    expect(tension).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Torsion cable transfers angle with the configured ratio and respects the
// backlash dead-zone — fully tilted, hinge axes normal to the tilted plane.
// ─────────────────────────────────────────────────────────────────────────
describe('ACCEPTANCE 3D parity — torsion cable ratio + backlash, tilted', () => {
  const RATIO = 2;
  const BACKLASH = 0.05;
  const origin: Vec3 = { x: 0, y: 2, z: 0 };
  const at = place(TILT, origin);
  const axis = rotAxisOfFrame(TILT);

  function torsionMechanism(): Mechanism {
    return mech(
      [
        node('FA', at(-0.5, 0), 'anchor'), // pivotA fixed reference (FA→PA is local +x)
        node('PA', at(0, 0), 'anchor'), // pivotA node
        node('Ain', at(0, 0.3), 'driven', 'twist'), // driven input arm (θA0 = +90°)
        node('FB', at(0.5, 0), 'anchor'), // pivotB fixed reference (FB→PB is local +x)
        node('PB', at(1, 0), 'anchor'), // pivotB node
        node('Bout', at(1, 0.3)), // output arm (θB0 = +90°)
      ],
      [
        link('mAfix', 'FA', 'PA'),
        link('mAin', 'PA', 'Ain'),
        link('mBfix', 'FB', 'PB'),
        link('mBout', 'PB', 'Bout'),
        hinge('pivA', 'PA', ['mAfix', 'mAin'], axis),
        hinge('pivB', 'PB', ['mBfix', 'mBout'], axis, {
          // a light return spring loads the output (like a real jaw return),
          // so the backlash free-play resolves deterministically to the
          // trailing edge instead of the unloaded output coasting the band
          torsionSpring: {
            memberA: 'mBfix',
            memberB: 'mBout',
            stiffnessNmPerRad: 3,
            restAngleRad: Math.PI / 2,
          },
        }),
        {
          id: 'tc',
          type: 'torsionCable',
          maturity: 'sketch',
          pivotA: 'pivA',
          pivotB: 'pivB',
          ratio: RATIO,
          backlashRad: BACKLASH,
        },
      ],
      {
        inputs: [
          { id: 'twist', name: 'twist', kind: 'angle', min: -1, max: 1, value: 0, locked: false },
        ],
      },
    );
  }

  // relative angle θB−θB0 (both drawn at +90° in the local plane)
  function thetaBRel(pb: Vec3, bout: Vec3): number {
    const toLocal = unplace(TILT, origin);
    const p = toLocal(pb);
    const b = toLocal(bout);
    return Math.atan2(b.y - p.y, b.x - p.x) - Math.PI / 2;
  }

  it('transfers angle at the configured ratio, less the backlash dead-zone', () => {
    const delta = 0.4; // rad of input past the dead-zone
    const result = solve(torsionMechanism(), { channelValues: { twist: delta } }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const rel = thetaBRel(result.positions.PB!, result.positions.Bout!);
    // θB−θB0 = ratio·δ − backlash (free play absorbs `backlash` of the drive)
    expect(rel).toBeCloseTo(RATIO * delta - BACKLASH, 2);
    expect(Math.abs(result.forces.elements.tc!)).toBeGreaterThan(0); // transmitted torque
    // the output arm never leaves its hinge plane
    expect(Math.abs(unplace(TILT, origin)(result.positions.Bout!).z)).toBeLessThanOrEqual(2e-3);
  });

  it('transmits nothing while the input stays inside the backlash dead-zone', () => {
    const delta = 0.02; // ratio·δ = 0.04 < backlash 0.05 → no transmission
    const result = solve(torsionMechanism(), { channelValues: { twist: delta } }, 'equilibrium');
    const rel = thetaBRel(result.positions.PB!, result.positions.Bout!);
    expect(Math.abs(rel)).toBeLessThanOrEqual(1e-2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Eyelet-routed rope — a mass on a rope routed through one frictionless
// eyelet hangs straight below the eyelet; tension = m·g and is uniform.
// Rotated vertical plane.
// ─────────────────────────────────────────────────────────────────────────
describe('3D parity — eyelet-routed rope', () => {
  it('the mass hangs directly below the eyelet with tension m·g', () => {
    const at = place(YAW, { x: 0, y: 0, z: 0 });
    const m = 4;
    const L0 = 1.0;
    const eyelet = at(0.3, 1);
    const mechEyelet = mech(
      [
        node('A', at(0, 1), 'anchor'),
        node('E', eyelet, 'anchor'), // frictionless eyelet (fixed waypoint)
        node('Mn', at(0.3, 0.3)), // drawn already near the analytic pose
      ],
      [
        {
          id: 'rope',
          type: 'rope',
          maturity: 'sketch',
          path: ['A', 'E', 'Mn'],
          lengthM: L0,
        },
      ],
      { pointMasses: [{ id: 'w', name: 'weight', massKg: m, nodeId: 'Mn' }] },
    );
    const result = solve(mechEyelet, { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const Mn = result.positions.Mn!;
    const segAE = 0.3; // local eyelet offset
    const segEM = L0 - segAE; // 0.7, straight down in world y
    const expected: Vec3 = { x: eyelet.x, y: eyelet.y - segEM, z: eyelet.z };
    expect(dist3(Mn, expected)).toBeLessThanOrEqual(2e-3);
    const tension = result.forces.elements.rope!;
    expect(Math.abs(tension - m * G)).toBeLessThanOrEqual(0.02 * m * G);
    expect(result.diagnostics.ropesRequiringCompression).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Rope-compression warning — a mass whose only support is a rope anchored
// BELOW it relies on the rope pushing (impossible); flag it.
// ─────────────────────────────────────────────────────────────────────────
describe('3D parity — rope-compression detection', () => {
  it('flags a rope the design needs to push and does not flag a normal one', () => {
    const pushing = mech(
      [
        node('Q', { x: 0, y: 0, z: 0.2 }, 'anchor'), // anchor BELOW the mass
        node('Mn', { x: 0, y: 1, z: 0.2 }), // mass, drawn taut on the rope (len 1.0 = L0)
      ],
      [{ id: 'rope', type: 'rope', maturity: 'sketch', path: ['Q', 'Mn'], lengthM: 1.0 }],
      { pointMasses: [{ id: 'w', name: 'weight', massKg: 3, nodeId: 'Mn' }] },
    );
    const result = solve(pushing, { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.ropesRequiringCompression).toContain('rope');

    // sanity: a normal overhead-anchored rope is NOT flagged
    const normal = mech(
      [node('H', { x: 0, y: 1, z: 0.2 }, 'anchor'), node('Mn', { x: 0, y: 0.2, z: 0.2 })],
      [{ id: 'rope', type: 'rope', maturity: 'sketch', path: ['H', 'Mn'], lengthM: 0.8 }],
      { pointMasses: [{ id: 'w', name: 'weight', massKg: 3, nodeId: 'Mn' }] },
    );
    expect(
      solve(normal, { channelValues: {} }, 'equilibrium').diagnostics.ropesRequiringCompression,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Required-input force on a driven lever — the holding torque an operator's
// hand must supply equals m·g·L for a horizontal arm. The arm is hinged to a
// fully-anchored stub, axis normal to the rotated vertical plane, so the
// angle channel rotates about that axis.
// ─────────────────────────────────────────────────────────────────────────
describe('3D parity — required input force on a driven lever', () => {
  const origin: Vec3 = { x: 0, y: 0, z: 0 };
  const at = place(YAW, origin);
  const axis = rotAxisOfFrame(YAW);

  function drivenLever(locked = false, value = 0): Mechanism {
    return mech(
      [
        node('O', at(0, 0), 'anchor'),
        node('D', at(1, 0), 'driven', 'lift'), // arm end, angle-driven about O
        node('Ob', at(-0.5, 0), 'anchor'), // ground stub for the hinge
      ],
      [link('arm', 'O', 'D'), link('stub', 'O', 'Ob'), hinge('piv', 'O', ['arm', 'stub'], axis)],
      {
        pointMasses: [{ id: 'w', name: 'load', massKg: 3, nodeId: 'D' }],
        inputs: [{ id: 'lift', name: 'lift', kind: 'angle', min: -1.5, max: 1.5, value, locked }],
      },
    );
  }

  it('reports the holding torque m·g·L for a horizontal driven arm', () => {
    const result = solve(drivenLever(), { channelValues: { lift: 0 } }, 'equilibrium');
    const required = result.forces.requiredInputs.lift!;
    const expected = 3 * G * 1.0; // m·g·L
    expect(Math.abs(required - expected)).toBeLessThanOrEqual(0.02 * expected);
  });

  it('a locked channel stays frozen at its stored value despite a channel override', () => {
    const toLocal = unplace(YAW, origin);
    // locked at value 0 (horizontal); an override asks for 0.6 rad and must be ignored
    const lockedResult = solve(
      drivenLever(true, 0),
      { channelValues: { lift: 0.6 } },
      'equilibrium',
    );
    const D = toLocal(lockedResult.positions.D!);
    expect(Math.atan2(D.y, D.x)).toBeCloseTo(0, 3); // still horizontal

    // the same channel unlocked DOES follow the override, rotating about the
    // hinge axis (the pose stays in the rotated plane)
    const openResult = solve(
      drivenLever(false, 0),
      { channelValues: { lift: 0.6 } },
      'equilibrium',
    );
    const D2 = toLocal(openResult.positions.D!);
    expect(Math.atan2(D2.y, D2.x)).toBeCloseTo(0.6, 2);
    expect(Math.abs(D2.z)).toBeLessThanOrEqual(1e-6);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Link self-weight — a caller-supplied generic-pipe linear density gives
// links mass (half to each endpoint) so a horizontal link sags under its own
// weight; omitting it leaves links massless.
// ─────────────────────────────────────────────────────────────────────────
describe('3D parity — link self-weight from generic density', () => {
  function twoBarChain(): Mechanism {
    return mech(
      [
        // raised above the floor so the tip can droop
        node('A', { x: 0, y: 2, z: 0.3 }, 'anchor'),
        node('B', { x: 0.5, y: 2, z: 0.3 }), // free mid node, no point mass
        node('C', { x: 1.0, y: 2, z: 0.3 }), // free tip, no point mass
      ],
      [link('l1', 'A', 'B'), link('l2', 'B', 'C')],
    );
  }

  it('links are massless without a density (chain holds its drawn pose)', () => {
    const result = solve(twoBarChain(), { channelValues: {} }, 'equilibrium');
    // massless free nodes see no gravity → the horizontal chain stays put
    expect(result.positions.B!.y).toBeCloseTo(2, 6);
    expect(result.positions.C!.y).toBeCloseTo(2, 6);
  });

  it('a supplied linear density makes the chain sag under self-weight', () => {
    const result = solve(
      twoBarChain(),
      { channelValues: {}, linkDensityKgPerM: 0.25 },
      'equilibrium',
    );
    expect(result.diagnostics.converged).toBe(true);
    // the unsupported end droops below the anchor
    expect(result.positions.C!.y).toBeLessThan(2 - 0.01);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Determinism — two fresh equilibrium runs give identical positions.
// ─────────────────────────────────────────────────────────────────────────
describe('3D parity — equilibrium determinism', () => {
  it('two fresh runs produce identical positions (≤ 1e-12)', () => {
    const at = place(YAW, { x: 0, y: 0, z: 0 });
    const build = (): Mechanism =>
      mech(
        [node('O', at(0, 0), 'anchor'), node('T', at(1, 0)), node('P', at(0, 1), 'anchor')],
        [
          link('boom', 'O', 'T'),
          {
            id: 'spring',
            type: 'elastic',
            maturity: 'sketch',
            nodeA: 'T',
            nodeB: 'P',
            slackLengthM: 0.6,
            stiffnessNPerM: 60,
          },
        ],
        { pointMasses: [{ id: 'tip', name: 'head', massKg: 2, nodeId: 'T' }] },
      );
    const p1 = solve(build(), { channelValues: {} }, 'equilibrium').positions;
    const p2 = solve(build(), { channelValues: {} }, 'equilibrium').positions;
    for (const id of Object.keys(p1)) {
      expect(Math.abs(p1[id]!.x - p2[id]!.x)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(p1[id]!.y - p2[id]!.y)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(p1[id]!.z - p2[id]!.z)).toBeLessThanOrEqual(1e-12);
    }
  });
});
