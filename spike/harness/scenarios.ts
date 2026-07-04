import type { Scenario, Vec2 } from './types';
import { FOUR_BAR, fourBarInitial } from './analytic';

export const G = 9.81;
const DOWN: Vec2 = { x: 0, y: -G };
const OFF: Vec2 = { x: 0, y: 0 };

/** (a) Four-bar drag-to-pose. Kinematic (gravity off). Drag node A around the
 * crank circle; B must track the analytic coupler-rocker solution. */
export function fourBarScenario(): Scenario {
  const { A, B } = fourBarInitial(FOUR_BAR);
  return {
    name: 'four-bar',
    gravity: OFF,
    nodes: [
      { id: 'O2', x: 0, y: 0, kind: 'anchor', mass: 0 },
      { id: 'A', x: A.x, y: A.y, kind: 'free', mass: 1 },
      { id: 'B', x: B.x, y: B.y, kind: 'free', mass: 1 },
      { id: 'O4', x: FOUR_BAR.d, y: 0, kind: 'anchor', mass: 0 },
    ],
    rods: [
      { id: 'crank', a: 'O2', b: 'A' },
      { id: 'coupler', a: 'A', b: 'B' },
      { id: 'rocker', a: 'B', b: 'O4' },
    ],
    ropes: [],
    bowdens: [],
  };
}

/** (b1) 5 kg mass hanging from an anchor on a 0.8 m tension-only rope.
 * Starts above the taut position so the rope has to catch it. */
export const HANGING_MASS_KG = 5;
export const HANGING_ROPE_LEN = 0.8;
export const HANGING_EXPECTED_POS: Vec2 = { x: 0, y: 0.2 };
export const HANGING_EXPECTED_TENSION = HANGING_MASS_KG * G;

export function hangingTautScenario(): Scenario {
  return {
    name: 'hanging-taut',
    gravity: DOWN,
    nodes: [
      { id: 'H', x: 0, y: 1, kind: 'anchor', mass: 0 },
      { id: 'M', x: 0, y: 0.3, kind: 'free', mass: HANGING_MASS_KG },
    ],
    rods: [],
    ropes: [{ id: 'rope', path: ['H', 'M'], length: HANGING_ROPE_LEN }],
    bowdens: [],
  };
}

/** (b2) Slack case: the mass hangs from a rigid rod pendulum, so the 0.8 m
 * rope (needing only 0.5 m) must go slack and report ~zero tension. */
export const SLACK_EXPECTED_POS: Vec2 = { x: 0, y: 0.5 };

export function hangingSlackScenario(): Scenario {
  return {
    name: 'hanging-slack',
    gravity: DOWN,
    nodes: [
      { id: 'G', x: 0, y: 1.5, kind: 'anchor', mass: 0 },
      { id: 'H', x: 0, y: 1, kind: 'anchor', mass: 0 },
      { id: 'M', x: 0, y: 0.5, kind: 'free', mass: HANGING_MASS_KG },
    ],
    rods: [{ id: 'rod', a: 'G', b: 'M' }],
    ropes: [{ id: 'rope', path: ['H', 'M'], length: HANGING_ROPE_LEN }],
    bowdens: [],
  };
}

/** (c) Rope through one eyelet: a single rope anchored at (−1,1) and (1,1)
 * routed through a frictionless eyelet on a 3 kg mass. The mass settles on
 * the centerline at depth sqrt(1.5² − 1²) below the anchors; both segments
 * carry the same tension T = m·g·1.5 / (2·sqrt(1.25)). */
export const PULLEY_MASS_KG = 3;
export const PULLEY_ROPE_LEN = 3;
export const PULLEY_EXPECTED_POS: Vec2 = { x: 0, y: 1 - Math.sqrt(1.25) };
export const PULLEY_EXPECTED_TENSION =
  (PULLEY_MASS_KG * G * (PULLEY_ROPE_LEN / 2)) / (2 * Math.sqrt(1.25));

export function pulleyScenario(): Scenario {
  return {
    name: 'rope-eyelet',
    gravity: DOWN,
    nodes: [
      { id: 'A1', x: -1, y: 1, kind: 'anchor', mass: 0 },
      { id: 'A2', x: 1, y: 1, kind: 'anchor', mass: 0 },
      { id: 'M', x: 0, y: 0.2, kind: 'free', mass: PULLEY_MASS_KG },
    ],
    rods: [],
    ropes: [{ id: 'rope', path: ['A1', 'M', 'A2'], length: PULLEY_ROPE_LEN }],
    bowdens: [],
  };
}

/** (d) Bowden coupling: dragging A2 changes the A-pair gap; the B-pair gap
 * must change by exactly the opposite amount while the hanging 1 kg mass on
 * B2 keeps the cable taut. Tension = m·g while taut. */
export const BOWDEN_MASS_KG = 1;
export const BOWDEN_EXPECTED_TENSION = BOWDEN_MASS_KG * G;
export const BOWDEN_A1: Vec2 = { x: 0, y: 0.5 };
export const BOWDEN_A2_START: Vec2 = { x: 0.3, y: 0.5 };
export const BOWDEN_B1: Vec2 = { x: 2, y: 0.5 };
export const BOWDEN_B2_START: Vec2 = { x: 2, y: 0.1 };

export function bowdenScenario(): Scenario {
  return {
    name: 'bowden',
    gravity: DOWN,
    nodes: [
      { id: 'A1', ...BOWDEN_A1, kind: 'anchor', mass: 0 },
      { id: 'A2', ...BOWDEN_A2_START, kind: 'free', mass: 0.1 },
      { id: 'B1', ...BOWDEN_B1, kind: 'anchor', mass: 0 },
      { id: 'B2', ...BOWDEN_B2_START, kind: 'free', mass: BOWDEN_MASS_KG },
    ],
    rods: [],
    ropes: [],
    bowdens: [{ id: 'cable', a1: 'A1', a2: 'A2', b1: 'B1', b2: 'B2' }],
  };
}

/** Perf probe: 100-node ladder truss (2 rails × 50 columns, 0.1 m spacing),
 * anchored at the left end, dragged by the top-right node. Kinematic. */
export function trussScenario(cols = 50): Scenario {
  const nodes: Scenario['nodes'] = [];
  const rods: Scenario['rods'] = [];
  for (let i = 0; i < cols; i++) {
    const anchor = i === 0;
    nodes.push({ id: `b${i}`, x: i * 0.1, y: 0, kind: anchor ? 'anchor' : 'free', mass: 1 });
    nodes.push({ id: `t${i}`, x: i * 0.1, y: 0.1, kind: anchor ? 'anchor' : 'free', mass: 1 });
    rods.push({ id: `rung${i}`, a: `b${i}`, b: `t${i}` });
    if (i > 0) {
      rods.push({ id: `railB${i}`, a: `b${i - 1}`, b: `b${i}` });
      rods.push({ id: `railT${i}`, a: `t${i - 1}`, b: `t${i}` });
      rods.push({ id: `diag${i}`, a: `b${i - 1}`, b: `t${i}` });
    }
  }
  return { name: `truss-${cols * 2}`, gravity: OFF, nodes, rods, ropes: [], bowdens: [] };
}
