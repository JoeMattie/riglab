import { z } from 'zod';
import { assemblySchema, emptyAssembly } from './assembly';
import { idSchema, unitsPreferenceSchema, vec3Schema, wearerAnchorSchema } from './common';
import { emptyMaterialsDb, materialsDbSchema } from './materials';
import { mechanismSchema } from './mechanism';

export const SCHEMA_VERSION = 2;

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

/** The project document — the single source of truth for the file format.
 * Every schema change bumps SCHEMA_VERSION and adds a migration (§3).
 * v2: mechanisms gained skeletonBindings; project gained wearer params. */
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
});

export type Project = z.infer<typeof projectSchema>;

export function createEmptyProject(id: string, name: string): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    unitsPreference: 'imperial',
    materials: emptyMaterialsDb(),
    mechanisms: [],
    assembly: emptyAssembly(),
    wearer: { ...DEFAULT_WEARER },
    wearerAnchorOverrides: {},
  };
}
