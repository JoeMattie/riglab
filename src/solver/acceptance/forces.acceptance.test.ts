// Phase 2 acceptance (§11 b–e) + the supporting unit cases named in the
// Phase 2 brief. Written before the equilibrium implementation as the
// executable spec (tests-first, CLAUDE.md). Analytic references are computed
// independently of the solver (closed form or an in-test root find).
import { describe, expect, it } from 'vitest';
import type { Mechanism, MechanismElement, MechanismNode } from '../../schema';
import { solve } from '..';

const G = 9.81;

function mech(
  nodes: MechanismNode[],
  elements: MechanismElement[],
  overrides: Partial<Mechanism> = {},
): Mechanism {
  return {
    id: 'm',
    name: 'test',
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes,
    elements,
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
    namedStates: [],
    ...overrides,
  };
}

const node = (
  id: string,
  x: number,
  y: number,
  kind: MechanismNode['kind'] = 'free',
  channelId?: string,
): MechanismNode => ({ id, kind, position: { x, y }, ...(channelId ? { channelId } : {}) });

const link = (id: string, nodeA: string, nodeB: string): MechanismElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA,
  nodeB,
  pointMasses: [],
});

// ─────────────────────────────────────────────────────────────────────────
// §11 (b) — lever balance: 2 kg at 0.5 m vs 1 kg at 1.0 m about a pivot
// settles level, pivot reaction = 3·g N (±2%).
// The balance beam is a rigid body (a bentLink triangle L–O–R). The fulcrum O
// sits a touch above the L–R line so the combined mass hangs just below the
// pin (a stable pendulum whose minimum-PE pose is exactly level), and so the
// pin-jointed particle network is non-degenerate and reacts the transverse
// load. A pivot element at O reports the reaction under its id.
// ─────────────────────────────────────────────────────────────────────────
describe('ACCEPTANCE Phase 2 — lever balance', () => {
  function leverMechanism(): Mechanism {
    return mech(
      [
        node('O', 0, 0.3, 'anchor'), // fulcrum, above the arms → CG hangs below it (stable, level)
        node('L', -0.5, 0), // 2 kg arm end
        node('R', 1.0, 0), // 1 kg arm end
        node('O2', 0, -0.2, 'anchor'), // ground stub for the pivot's 2nd member
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
        {
          id: 'fulcrum',
          type: 'pivot',
          maturity: 'sketch',
          nodeId: 'O',
          memberIds: ['beam', 'ref'],
          welds: [],
        },
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
    // moment-balanced (2·0.5 = 1·1.0) → the beam holds level
    expect(Math.abs(L.y - R.y)).toBeLessThanOrEqual(2e-3);
    const reaction = result.forces.pivotReactions.fulcrum!;
    expect(reaction.y).toBeGreaterThan(0); // support pushes up
    const expected = 3 * G;
    expect(Math.abs(Math.hypot(reaction.x, reaction.y) - expected)).toBeLessThanOrEqual(
      0.02 * expected,
    );
  });

  it('an unbalanced lever tips toward the heavier moment', () => {
    // move the 1 kg mass out to 1.5 m: right moment (1.5) now beats left (1.0)
    const m = leverMechanism();
    m.nodes = m.nodes.map((n) => (n.id === 'R' ? { ...n, position: { x: 1.5, y: 0 } } : n));
    const result = solve(m, { channelValues: {} }, 'equilibrium');
    // right side sinks below the left
    expect(result.positions.R!.y).toBeLessThan(result.positions.L!.y - 0.02);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// §11 (c) — spring-counterbalanced boom settles at the analytically computed
// angle ±1°. Boom pinned at O, point mass at the tip, an elastic from the tip
// up to an overhead anchor holds it up (the §9.2 elastic-counterbalance).
// ─────────────────────────────────────────────────────────────────────────
describe('ACCEPTANCE Phase 2 — spring-counterbalanced boom', () => {
  const M = 2; // kg at tip
  const L = 1; // boom length (O→T drawn along +x)
  const K = 60; // elastic stiffness N/m
  const REST = 0.6; // elastic rest length
  // anchor P directly above O at (0, 1)

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
        node('O', 0, 0, 'anchor'),
        node('T', L, 0), // drawn horizontal; settles up to φ*
        node('P', 0, 1, 'anchor'),
      ],
      [
        link('boom', 'O', 'T'),
        {
          id: 'spring',
          type: 'elastic',
          maturity: 'sketch',
          nodeA: 'T',
          nodeB: 'P',
          restLengthM: REST,
          stiffnessNPerM: K,
          tensionOnly: true,
        },
      ],
      { pointMasses: [{ id: 'tip', name: 'head', massKg: M, nodeId: 'T' }] },
    );
  }

  it('settles at the analytic equilibrium angle within 1°', () => {
    const result = solve(boomMechanism(), { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const T = result.positions.T!;
    const phi = Math.atan2(T.y, T.x);
    const expected = analyticAngle();
    expect(Math.abs(phi - expected)).toBeLessThanOrEqual((1 * Math.PI) / 180);
    // boom length preserved (rigid)
    expect(Math.hypot(T.x, T.y)).toBeCloseTo(L, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// §11 (d) — bowden transfers displacement 1:1. Pulling side A by Δ shortens
// side B by Δ (fixed total cable length), routing-independent. Plan view,
// gravity off.
// ─────────────────────────────────────────────────────────────────────────
describe('ACCEPTANCE Phase 2 — bowden 1:1 displacement transfer', () => {
  function bowdenMechanism(): Mechanism {
    return mech(
      [
        node('a1', 0, 0, 'anchor'),
        node('a2', 0.5, 0, 'driven', 'pull'), // A-side end, driven along the a1→a2 axis
        node('b1', 1, 0, 'anchor'),
        node('b2', 1.5, 0), // B-side output
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
        gravityOn: false,
        inputs: [
          { id: 'pull', name: 'pull', kind: 'displacement', min: -0.3, max: 0.3, value: 0, locked: false },
        ],
      },
    );
  }

  it('driving side A out by Δ pulls side B in by the same Δ', () => {
    const delta = 0.1;
    const result = solve(bowdenMechanism(), { channelValues: { pull: delta } }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const a1 = result.positions.a1!;
    const a2 = result.positions.a2!;
    const b1 = result.positions.b1!;
    const b2 = result.positions.b2!;
    const lenA = Math.hypot(a1.x - a2.x, a1.y - a2.y);
    const lenB = Math.hypot(b1.x - b2.x, b1.y - b2.y);
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
// §11 (e) — torsion cable transfers angle with the configured ratio and
// respects the backlash dead-zone. Two pivots, each between a fixed reference
// member and a moving member; coupling (θB−θB0) = ratio·(θA−θA0). Plan view.
// ─────────────────────────────────────────────────────────────────────────
describe('ACCEPTANCE Phase 2 — torsion cable angle transfer + backlash', () => {
  const RATIO = 2;
  const BACKLASH = 0.05;

  function torsionMechanism(): Mechanism {
    return mech(
      [
        node('FA', -0.5, 0, 'anchor'), // pivotA fixed reference (FA→PA is +x)
        node('PA', 0, 0, 'anchor'), // pivotA node
        node('Ain', 0, 0.3, 'driven', 'twist'), // driven input arm (θA0 = +90°)
        node('FB', 0.5, 0, 'anchor'), // pivotB fixed reference (FB→PB is +x)
        node('PB', 1, 0, 'anchor'), // pivotB node
        node('Bout', 1, 0.3), // output arm (θB0 = +90°)
      ],
      [
        link('mAfix', 'FA', 'PA'),
        link('mAin', 'PA', 'Ain'),
        link('mBfix', 'FB', 'PB'),
        link('mBout', 'PB', 'Bout'),
        {
          id: 'pivA',
          type: 'pivot',
          maturity: 'sketch',
          nodeId: 'PA',
          memberIds: ['mAfix', 'mAin'],
          welds: [],
        },
        {
          id: 'pivB',
          type: 'pivot',
          maturity: 'sketch',
          nodeId: 'PB',
          memberIds: ['mBfix', 'mBout'],
          welds: [],
          // a light return spring loads the output (like a real jaw return),
          // so the backlash free-play resolves deterministically to the
          // trailing edge instead of the unloaded output coasting the band
          torsionSpring: {
            memberA: 'mBfix',
            memberB: 'mBout',
            stiffnessNmPerRad: 3,
            restAngleRad: Math.PI / 2,
          },
        },
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
        gravityOn: false,
        inputs: [
          { id: 'twist', name: 'twist', kind: 'angle', min: -1, max: 1, value: 0, locked: false },
        ],
      },
    );
  }

  // relative angle θB−θB0 (both drawn at +90°): angle of PB→Bout minus +90°
  function thetaBRel(pb: { x: number; y: number }, bout: { x: number; y: number }): number {
    return Math.atan2(bout.y - pb.y, bout.x - pb.x) - Math.PI / 2;
  }

  it('transfers angle at the configured ratio, less the backlash dead-zone', () => {
    const delta = 0.4; // rad of input past the dead-zone
    const result = solve(torsionMechanism(), { channelValues: { twist: delta } }, 'equilibrium');
    expect(result.diagnostics.converged).toBe(true);
    const rel = thetaBRel(result.positions.PB!, result.positions.Bout!);
    // θB−θB0 = ratio·δ − backlash (free play absorbs `backlash` of the drive)
    expect(rel).toBeCloseTo(RATIO * delta - BACKLASH, 2);
    expect(Math.abs(result.forces.elements.tc!)).toBeGreaterThan(0); // transmitted torque
  });

  it('transmits nothing while the input stays inside the backlash dead-zone', () => {
    const delta = 0.02; // ratio·δ = 0.04 < backlash 0.05 → no transmission
    const result = solve(torsionMechanism(), { channelValues: { twist: delta } }, 'equilibrium');
    const rel = thetaBRel(result.positions.PB!, result.positions.Bout!);
    expect(Math.abs(rel)).toBeLessThanOrEqual(1e-2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unit: eyelet-routed rope (Phase 0 spike scenario) — a mass on a rope routed
// through one frictionless eyelet hangs straight below the eyelet; tension =
// m·g and is uniform along the rope.
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 2 unit — eyelet-routed rope', () => {
  it('the mass hangs directly below the eyelet with tension m·g', () => {
    const m = 4;
    const L0 = 1.0;
    const eyeletX = 0.3;
    // segment A→E is fixed (0.3 m); E→M taut segment is 0.7 m straight down
    const mechEyelet = mech(
      [
        node('A', 0, 1, 'anchor'),
        node('E', eyeletX, 1, 'anchor'), // frictionless eyelet (fixed waypoint)
        node('Mn', eyeletX, 0.3), // drawn already near the analytic pose
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
    const segAE = eyeletX; // 0.3
    const segEM = L0 - segAE; // 0.7
    expect(Math.hypot(Mn.x - eyeletX, Mn.y - (1 - segEM))).toBeLessThanOrEqual(2e-3);
    const tension = result.forces.elements.rope!;
    expect(Math.abs(tension - m * G)).toBeLessThanOrEqual(0.02 * m * G);
    expect(result.diagnostics.ropesRequiringCompression).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unit: rope-compression warning — a mass whose only support is a rope
// anchored BELOW it relies on the rope pushing (impossible); flag it.
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 2 unit — rope-compression detection', () => {
  it('flags a rope the design needs to push and does not flag a normal one', () => {
    const pushing = mech(
      [
        node('Q', 0, 0, 'anchor'), // anchor BELOW the mass
        node('Mn', 0, 1), // mass, drawn taut on the rope (len 1.0 = L0)
      ],
      [{ id: 'rope', type: 'rope', maturity: 'sketch', path: ['Q', 'Mn'], lengthM: 1.0 }],
      { pointMasses: [{ id: 'w', name: 'weight', massKg: 3, nodeId: 'Mn' }] },
    );
    const result = solve(pushing, { channelValues: {} }, 'equilibrium');
    expect(result.diagnostics.ropesRequiringCompression).toContain('rope');

    // sanity: a normal overhead-anchored rope is NOT flagged
    const normal = mech(
      [
        node('H', 0, 1, 'anchor'),
        node('Mn', 0, 0.2),
      ],
      [{ id: 'rope', type: 'rope', maturity: 'sketch', path: ['H', 'Mn'], lengthM: 0.8 }],
      { pointMasses: [{ id: 'w', name: 'weight', massKg: 3, nodeId: 'Mn' }] },
    );
    expect(
      solve(normal, { channelValues: {} }, 'equilibrium').diagnostics.ropesRequiringCompression,
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unit: required-input force on a simple driven lever — the holding torque an
// operator's hand must supply equals m·g·L for a horizontal arm.
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 2 unit — required input force on a driven lever', () => {
  function drivenLever(locked = false, value = 0): Mechanism {
    return mech(
      [
        node('O', 0, 0, 'anchor'),
        node('D', 1, 0, 'driven', 'lift'), // arm end, angle-driven about O
      ],
      [link('arm', 'O', 'D')],
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
    // locked at value 0 (horizontal); an override asks for 0.6 rad and must be ignored
    const lockedResult = solve(drivenLever(true, 0), { channelValues: { lift: 0.6 } }, 'equilibrium');
    const D = lockedResult.positions.D!;
    expect(Math.atan2(D.y, D.x)).toBeCloseTo(0, 3); // still horizontal

    // the same channel unlocked DOES follow the override
    const openResult = solve(drivenLever(false, 0), { channelValues: { lift: 0.6 } }, 'equilibrium');
    const D2 = openResult.positions.D!;
    expect(Math.atan2(D2.y, D2.x)).toBeCloseTo(0.6, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unit: link self-weight — a caller-supplied generic-pipe linear density
// gives links mass (half to each endpoint) so a horizontal link sags under
// its own weight; omitting it leaves links massless.
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 2 unit — link self-weight from generic density', () => {
  function twoBarChain(): Mechanism {
    return mech(
      [
        node('A', 0, 0, 'anchor'),
        node('B', 0.5, 0), // free mid node, no point mass
        node('C', 1.0, 0), // free tip, no point mass
      ],
      [link('l1', 'A', 'B'), link('l2', 'B', 'C')],
    );
  }

  it('links are massless without a density (chain holds its drawn pose)', () => {
    const result = solve(twoBarChain(), { channelValues: {} }, 'equilibrium');
    // massless free nodes see no gravity → the horizontal chain stays put
    expect(result.positions.B!.y).toBeCloseTo(0, 6);
    expect(result.positions.C!.y).toBeCloseTo(0, 6);
  });

  it('a supplied linear density makes the chain sag under self-weight', () => {
    const result = solve(
      twoBarChain(),
      { channelValues: {}, linkDensityKgPerM: 0.25 },
      'equilibrium',
    );
    expect(result.diagnostics.converged).toBe(true);
    // the unsupported end droops below the anchor
    expect(result.positions.C!.y).toBeLessThan(-0.01);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Unit: determinism — two fresh equilibrium runs give identical positions.
// ─────────────────────────────────────────────────────────────────────────
describe('Phase 2 unit — equilibrium determinism', () => {
  it('two fresh runs produce identical positions (≤ 1e-12)', () => {
    const build = (): Mechanism =>
      mech(
        [
          node('O', 0, 0, 'anchor'),
          node('T', 1, 0),
          node('P', 0, 1, 'anchor'),
        ],
        [
          link('boom', 'O', 'T'),
          {
            id: 'spring',
            type: 'elastic',
            maturity: 'sketch',
            nodeA: 'T',
            nodeB: 'P',
            restLengthM: 0.6,
            stiffnessNPerM: 60,
            tensionOnly: true,
          },
        ],
        { pointMasses: [{ id: 'tip', name: 'head', massKg: 2, nodeId: 'T' }] },
      );
    const p1 = solve(build(), { channelValues: {} }, 'equilibrium').positions;
    const p2 = solve(build(), { channelValues: {} }, 'equilibrium').positions;
    for (const id of Object.keys(p1)) {
      expect(Math.abs(p1[id]!.x - p2[id]!.x)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(p1[id]!.y - p2[id]!.y)).toBeLessThanOrEqual(1e-12);
    }
  });
});
