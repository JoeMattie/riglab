import { z } from 'zod';
import {
  idSchema,
  unitsPreferenceSchema,
  vec2Schema,
  vec3Schema,
  wearerAnchorSchema,
} from './common';
import { controlClipSchema, controlSchema } from './controls';
import { materialsDbSchema } from './materials';
import { type Mechanism, mechanismSchema } from './mechanism';
import { seedMaterialsDb } from './seedMaterials';

export const SCHEMA_VERSION = 7;

/** Parametric mannequin dimensions (§7); segment lengths derive from height
 * via standard anthropometry in src/wearer/. */
export const wearerParamsSchema = z.object({
  heightM: z.number().positive(),
  shoulderWidthM: z.number().positive(),
  hipWidthM: z.number().positive(),
});

export type WearerParams = z.infer<typeof wearerParamsSchema>;

export const DEFAULT_WEARER: WearerParams = {
  heightM: 1.75,
  shoulderWidthM: 0.46,
  hipWidthM: 0.36,
};

/** Project-wide BOM tuning factors (§6.2), both editable. Defaults match the
 * planfile: heat-wrap end allowance is 1.5× the partner pipe's OD, and rope
 * consumables carry a 1.2× waste factor. */
export const bomSettingsSchema = z.object({
  /** heat-wrap end allowance = heatWrapAllowanceFactor × partner pipe OD (§6.2) */
  heatWrapAllowanceFactor: z.number(),
  /** rope consumable multiplier applied to total rope path length (§6.2) */
  ropeWasteFactor: z.number(),
});

export type BomSettings = z.infer<typeof bomSettingsSchema>;

export const DEFAULT_BOM_SETTINGS: BomSettings = {
  heatWrapAllowanceFactor: 1.5,
  ropeWasteFactor: 1.2,
};

/** Where a project-level mass hangs (PLANFILE-3d-conversion.md): a mechanism
 * node or a wearer anchor. The former assembly-instance indirection is gone. */
export const attachTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), nodeId: idSchema }),
  z.object({ kind: z.literal('wearerAnchor'), anchor: wearerAnchorSchema }),
]);

export const pointMassSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  massKg: z.number().nonnegative(),
  attach: attachTargetSchema,
});

export const foamPlateSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  /** simple polygon in plate-local coordinates; area derived. Plain area
   * override for plates the user doesn't bother drawing. */
  polygon: z.array(vec2Schema).optional(),
  areaM2: z.number().nonnegative().optional(),
  sheetMaterialId: idSchema.optional(),
  attach: attachTargetSchema,
});

/** Named selection set over the compound mechanism — the successor of the
 * former per-plane "mechanisms" (PLANFILE-3d-conversion.md). Drives BOM
 * rollup alongside subsystemTag and scopes checklist notes. `note` carries
 * migration warnings (e.g. a formerly transform-driven plane that needs
 * re-jointing). */
export const groupSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  elementIds: z.array(idSchema),
  note: z.string().optional(),
});

export type AttachTarget = z.infer<typeof attachTargetSchema>;
export type PointMass = z.infer<typeof pointMassSchema>;
export type FoamPlate = z.infer<typeof foamPlateSchema>;
export type Group = z.infer<typeof groupSchema>;

/** The project document — the single source of truth for the file format.
 * Every schema change bumps SCHEMA_VERSION and adds a migration (§3).
 * v2: mechanisms gained skeletonBindings; project gained wearer params.
 * v3: project gained bomSettings; materials DB seeded on creation (§6.1).
 * v4: link/telescope gained optional lengthLocked (interface overhaul).
 * v5: project gained controls + controlClips (§4.4).
 * v6: mechanisms gained anchorBindings (wearer attachments).
 * v7: fully-3D single compound mechanism (PLANFILE-3d-conversion.md) —
 *     vec3 positions, hinge/spherical pivot joints, groups; assembly layer
 *     (instances/bindings) removed; point masses & foam plates moved to
 *     project level. */
export const projectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: idSchema,
  name: z.string().min(1),
  unitsPreference: unitsPreferenceSchema,
  materials: materialsDbSchema,
  /** the single compound mechanism (PLANFILE-3d-conversion.md) */
  mechanism: mechanismSchema,
  /** named selection sets over the mechanism's elements */
  groups: z.array(groupSchema),
  pointMasses: z.array(pointMassSchema),
  foamPlates: z.array(foamPlateSchema),
  /** virtual input devices over the channel machinery (§4.4) */
  controls: z.array(controlSchema),
  /** channel-animation clips (§4.4), composable with movement clips */
  controlClips: z.array(controlClipSchema),
  wearer: wearerParamsSchema,
  /** overrides of the parametric mannequin's anchor positions (§4.1) */
  wearerAnchorOverrides: z.partialRecord(wearerAnchorSchema, vec3Schema),
  /** BOM tuning factors (§6.2) */
  bomSettings: bomSettingsSchema,
});

export type Project = z.infer<typeof projectSchema>;

export function createEmptyMechanism(id: string, name: string): Mechanism {
  return {
    id,
    name,
    nodes: [],
    elements: [],
    pointMasses: [],
    skeletonBindings: [],
    anchorBindings: [],
    inputs: [],
    namedStates: [],
  };
}

export function createEmptyProject(id: string, name: string): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    unitsPreference: 'imperial',
    // Each project owns its complete materials DB, seeded on creation (§6.1).
    materials: seedMaterialsDb(),
    mechanism: createEmptyMechanism(`${id}-mechanism`, name),
    groups: [],
    pointMasses: [],
    foamPlates: [],
    controls: [],
    controlClips: [],
    wearer: { ...DEFAULT_WEARER },
    wearerAnchorOverrides: {},
    bomSettings: { ...DEFAULT_BOM_SETTINGS },
  };
}
