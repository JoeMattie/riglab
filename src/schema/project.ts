import { z } from 'zod';
import { assemblySchema, emptyAssembly } from './assembly';
import { idSchema, unitsPreferenceSchema, vec3Schema, wearerAnchorSchema } from './common';
import { materialsDbSchema } from './materials';
import { mechanismSchema } from './mechanism';
import { seedMaterialsDb } from './seedMaterials';

export const SCHEMA_VERSION = 3;

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

/** The project document — the single source of truth for the file format.
 * Every schema change bumps SCHEMA_VERSION and adds a migration (§3).
 * v2: mechanisms gained skeletonBindings; project gained wearer params.
 * v3: project gained bomSettings; materials DB seeded on creation (§6.1). */
export const projectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: idSchema,
  name: z.string().min(1),
  unitsPreference: unitsPreferenceSchema,
  materials: materialsDbSchema,
  mechanisms: z.array(mechanismSchema),
  assembly: assemblySchema,
  wearer: wearerParamsSchema,
  /** overrides of the parametric mannequin's anchor positions (§4.1) */
  wearerAnchorOverrides: z.partialRecord(wearerAnchorSchema, vec3Schema),
  /** BOM tuning factors (§6.2) */
  bomSettings: bomSettingsSchema,
});

export type Project = z.infer<typeof projectSchema>;

export function createEmptyProject(id: string, name: string): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    unitsPreference: 'imperial',
    // Each project owns its complete materials DB, seeded on creation (§6.1).
    materials: seedMaterialsDb(),
    mechanisms: [],
    assembly: emptyAssembly(),
    wearer: { ...DEFAULT_WEARER },
    wearerAnchorOverrides: {},
    bomSettings: { ...DEFAULT_BOM_SETTINGS },
  };
}
