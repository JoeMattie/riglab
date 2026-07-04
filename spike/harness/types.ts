// Spike-only types. This is NOT the app's solver interface — it exists so the
// three candidate engines can run identical scenarios and be scored identically.

export interface Vec2 {
  x: number;
  y: number;
}

export type NodeKind = 'free' | 'anchor';

export interface ScenarioNode {
  id: string;
  x: number;
  y: number;
  kind: NodeKind;
  /** kg; ignored for anchors */
  mass: number;
}

/** Rigid bar; rest length taken from initial node positions. */
export interface RodSpec {
  id: string;
  a: string;
  b: string;
}

/** Tension-only: total polyline length through `path` may not exceed `length`.
 * Intermediate path nodes act as frictionless eyelets. */
export interface RopeSpec {
  id: string;
  path: string[];
  /** default: initial path length */
  length?: number;
}

/** Displacement coupling (|a1a2| − lenA0) + (|b1b2| − lenB0) ≤ 0, tension-only.
 * len0s taken from initial positions. */
export interface BowdenSpec {
  id: string;
  a1: string;
  a2: string;
  b1: string;
  b2: string;
}

export interface Scenario {
  name: string;
  gravity: Vec2;
  nodes: ScenarioNode[];
  rods: RodSpec[];
  ropes: RopeSpec[];
  bowdens: BowdenSpec[];
}

export interface SpikeAdapter {
  readonly name: string;
  init(scenario: Scenario): Promise<void>;
  step(dt: number): void;
  /** Pull nodeId toward pos each step (kinematic drag). null releases. */
  setDragTarget(nodeId: string, pos: Vec2 | null): void;
  positions(): Record<string, Vec2>;
  /** Force per element id in newtons, tension positive; ropes/bowdens report
   * cable tension, rods axial force (0 is acceptable if the engine can't). */
  forces(): Record<string, number>;
  dispose(): void;
}

export function dist(p: Vec2, q: Vec2): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}
