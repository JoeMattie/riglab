// Pure scene extraction for the perspective panel (PLANFILE-3d-conversion.md).
// Turns the solved compound mechanism into world-space primitives (mechanism
// elements + the wearer mannequin) the r3f layer draws. Kept pure so the
// geometry is unit-testable without a WebGL context.

import type { MechanismElement, PipeMaterial, Vec3 } from '../../schema';
import type { SkeletonFrame } from '../../wearer/skeleton';
import { GENERIC_PIPE_OD_M, type NodeWorld } from './pipeModel';

export type Segment = [Vec3, Vec3];

export { GENERIC_PIPE_OD_M };
/** Mannequin capsule radius — thick enough to read against the light bg. */
export const MANNEQUIN_RADIUS_M = 0.035;

export interface TubePrim {
  a: Vec3;
  b: Vec3;
  radiusM: number;
  /** engineered = material OD known; sketch = generic-OD stand-in */
  style: 'engineered' | 'sketch';
  /** owning element, for click-to-select in the perspective panel */
  elementId?: string;
}

export interface CablePrim {
  points: Vec3[];
  elementId?: string;
}

export interface MechanismPrimitives {
  tubes: TubePrim[];
  cables: CablePrim[];
}

/** Ordered node ids to stroke for an element, or null for elements that carry
 * no drawn geometry of their own (pivots/sliders live at a node; torsion
 * cables are an abstract angle coupling). Bowden returns both cable runs. */
export function elementPolylines(el: MechanismElement): string[][] {
  switch (el.type) {
    case 'link':
    case 'telescope':
    case 'elastic':
      return [[el.nodeA, el.nodeB]];
    case 'bentLink':
      return [el.nodeIds];
    case 'rope':
      return [el.path];
    case 'bowden':
      return [
        [el.a1, el.a2],
        [el.b1, el.b2],
      ];
    default:
      return [];
  }
}

/** World-space segments for the mechanism, given its solved nodes. Segments
 * whose endpoints are missing (unsolved) are skipped. */
export function mechanismSegments(elements: MechanismElement[], nodeWorld: NodeWorld): Segment[] {
  const out: Segment[] = [];
  for (const el of elements) {
    for (const poly of elementPolylines(el)) {
      for (let i = 1; i < poly.length; i++) {
        const a = nodeWorld[poly[i - 1]!];
        const b = nodeWorld[poly[i]!];
        if (a && b) out.push([a, b]);
      }
    }
  }
  return out;
}

/** Contiguous runs of ≥2 resolved points along an id polyline. A missing
 * (unsolved) node splits the run rather than bridging across it. */
function resolvedRuns(ids: string[], nodeWorld: NodeWorld): Vec3[][] {
  const runs: Vec3[][] = [];
  let run: Vec3[] = [];
  for (const id of ids) {
    const p = nodeWorld[id];
    if (p) {
      run.push(p);
    } else {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

/** World-space render primitives for the compound mechanism: rigid members
 * (link / bentLink / telescope) as tubes — true OD/2 when the element is
 * engineered with a resolvable pipe material, generic OD otherwise — and
 * tension members (rope / elastic / bowden) as cables. Pivots, sliders and
 * torsion couplings carry no drawn geometry here (the pipe model renders
 * joint realizations). */
export function mechanismPrimitives(
  elements: MechanismElement[],
  nodeWorld: NodeWorld,
  pipes: PipeMaterial[],
): MechanismPrimitives {
  const tubes: TubePrim[] = [];
  const cables: CablePrim[] = [];
  const pipe = (id: string | undefined) => pipes.find((p) => p.id === id);

  const tubeRun = (
    elementId: string,
    ids: string[],
    mat: PipeMaterial | undefined,
    engineered: boolean,
  ) => {
    const style = engineered && mat ? 'engineered' : 'sketch';
    const radiusM = (engineered && mat ? mat.outerDiameterM : GENERIC_PIPE_OD_M) / 2;
    for (const run of resolvedRuns(ids, nodeWorld)) {
      for (let i = 1; i < run.length; i++) {
        tubes.push({ a: run[i - 1]!, b: run[i]!, radiusM, style, elementId });
      }
    }
  };

  for (const el of elements) {
    switch (el.type) {
      case 'link':
        tubeRun(el.id, [el.nodeA, el.nodeB], pipe(el.pipeMaterialId), el.maturity === 'engineered');
        break;
      case 'bentLink':
        tubeRun(el.id, el.nodeIds, pipe(el.pipeMaterialId), el.maturity === 'engineered');
        break;
      case 'telescope':
        tubeRun(
          el.id,
          [el.nodeA, el.nodeB],
          pipe(el.outerPipeMaterialId),
          el.maturity === 'engineered',
        );
        break;
      case 'rope':
      case 'elastic':
      case 'bowden':
        for (const poly of elementPolylines(el)) {
          for (const run of resolvedRuns(poly, nodeWorld))
            cables.push({ points: run, elementId: el.id });
        }
        break;
      default:
        break;
    }
  }
  return { tubes, cables };
}

/** Mannequin bones as capsule tubes (§8.3 visibility: the stick figure must
 * read against the light background, so it gets volume, not 1-px lines). */
export function mannequinTubes(frame: SkeletonFrame): TubePrim[] {
  return mannequinBones(frame).map(([a, b]) => ({
    a,
    b,
    radiusM: MANNEQUIN_RADIUS_M,
    style: 'sketch' as const,
  }));
}

/** Wearer mannequin bones in world space (§7 stick figure). */
export function mannequinBones(frame: SkeletonFrame): Segment[] {
  const P = frame.points;
  const chain = (...ids: (keyof typeof P)[]): Segment[] => {
    const segs: Segment[] = [];
    for (let i = 1; i < ids.length; i++) segs.push([P[ids[i - 1]!], P[ids[i]!]]);
    return segs;
  };
  return [
    ...chain('pelvis', 'spineTop', 'head'),
    ...chain('shoulderL', 'shoulderR'),
    ...chain('hipL', 'hipR'),
    ...chain('shoulderL', 'elbowL', 'handL'),
    ...chain('shoulderR', 'elbowR', 'handR'),
    ...chain('hipL', 'kneeL', 'ankleL', 'shoeL'),
    ...chain('hipR', 'kneeR', 'ankleR', 'shoeR'),
  ];
}
