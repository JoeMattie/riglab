// Shared scaffolding for the bundled §9 example projects, rebuilt as native
// v7 single-compound documents (PLANFILE-3d-conversion.md). Each example file
// exports a *parts* builder — nodes/elements/masses/bindings/channels with an
// optional id prefix so the full-creature document can merge several
// subsystems into one mechanism without id collisions — plus a project
// builder wrapping one mechanism in the standard project shell. Geometry
// helpers keep rope/elastic rest lengths derived from the drawn node
// positions so the JSON artifacts can never drift from the coordinates.
//
// World frame (schema/mechanism.ts): +y up, +x wearer-front, +z wearer-left;
// gravity is global −y. Former planar examples are lifted into their natural
// world plane using the frozen orientation frames (geometry/placement.ts):
// side-left sketches land in the x-y plane (normal +z), plan-view sketches
// land in a horizontal plane (normal −y, local sketch +y → world +z).

import type {
  Control,
  ControlClip,
  FoamPlate,
  Group,
  InputChannel,
  Mechanism,
  MechanismElement,
  MechanismNode,
  NodePointMass,
  PointMass,
  Project,
  SkeletonBinding,
  Vec3,
} from '../schema';
import { DEFAULT_BOM_SETTINGS, DEFAULT_WEARER, SCHEMA_VERSION, seedMaterialsDb } from '../schema';

/** Hinge axis for joints sketched in an elevation (side-left) plane: the
 * plane normal, world +z (orientationFrame('side-left').zAxis). */
export const HINGE_SAGITTAL: Vec3 = { x: 0, y: 0, z: 1 };

/** Hinge axis for joints sketched in a plan (top) plane: the plane normal,
 * world −y (orientationFrame('top').zAxis) — so plan-view angle signs and
 * limits keep their old 2D meaning. */
export const HINGE_PLAN: Vec3 = { x: 0, y: -1, z: 0 };

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Distance between two drawn points, rounded to 0.1 mm so rope/elastic rest
 * lengths in the JSON artifacts stay stable across float formatting. */
export function dist(a: Vec3, b: Vec3): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * 1e4) / 1e4;
}

/** The merge unit for compound documents: everything a subsystem contributes
 * to the single mechanism. Channels are global by name — mergeParts keeps the
 * first definition of a name (they never collide in the bundled data). */
export interface MechParts {
  nodes: MechanismNode[];
  elements: MechanismElement[];
  pointMasses: NodePointMass[];
  skeletonBindings: SkeletonBinding[];
  inputs: InputChannel[];
}

export function mergeParts(...parts: MechParts[]): MechParts {
  const inputs: InputChannel[] = [];
  for (const p of parts) {
    for (const ch of p.inputs) {
      if (!inputs.some((existing) => existing.name === ch.name)) inputs.push(ch);
    }
  }
  return {
    nodes: parts.flatMap((p) => p.nodes),
    elements: parts.flatMap((p) => p.elements),
    pointMasses: parts.flatMap((p) => p.pointMasses),
    skeletonBindings: parts.flatMap((p) => p.skeletonBindings),
    inputs,
  };
}

export function partsMechanism(id: string, name: string, parts: MechParts): Mechanism {
  return {
    id,
    name,
    nodes: parts.nodes,
    elements: parts.elements,
    pointMasses: parts.pointMasses,
    skeletonBindings: parts.skeletonBindings,
    anchorBindings: [],
    inputs: parts.inputs,
    namedStates: [],
  };
}

/** Named selection set covering a subsystem's elements (the successor of the
 * former per-plane mechanisms; drives BOM rollup). */
export function groupOf(id: string, name: string, elements: MechanismElement[]): Group {
  return { id, name, elementIds: elements.map((e) => e.id) };
}

export function exampleProject(
  id: string,
  name: string,
  mechanism: Mechanism,
  groups: Group[],
  extras: {
    pointMasses?: PointMass[];
    foamPlates?: FoamPlate[];
    controls?: Control[];
    controlClips?: ControlClip[];
  } = {},
): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    unitsPreference: 'imperial',
    materials: seedMaterialsDb(),
    mechanism,
    groups,
    pointMasses: extras.pointMasses ?? [],
    foamPlates: extras.foamPlates ?? [],
    controls: extras.controls ?? [],
    controlClips: extras.controlClips ?? [],
    wearer: { ...DEFAULT_WEARER },
    wearerAnchorOverrides: {},
    bomSettings: { ...DEFAULT_BOM_SETTINGS },
  };
}

// Common material ids from the seed DB (§6.1).
export const PIPE_050 = 'pipe-nps-sch40-050';
export const PIPE_075 = 'pipe-nps-sch40-075';
export const PIPE_CLS200_075 = 'pipe-nps-cls200-075';
export const PIPE_CTS_050 = 'pipe-cts-cpvc-050';
export const PIPE_CTS_075 = 'pipe-cts-cpvc-075';
export const CORD = 'cord-paracord550';
export const BUNGEE_6 = 'cord-bungee6';
export const BUNGEE_8 = 'cord-bungee8';
export const BOWDEN_CABLE = 'cord-bowden';
