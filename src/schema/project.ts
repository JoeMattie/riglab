import { z } from 'zod';
import { assemblySchema, emptyAssembly } from './assembly';
import { idSchema, unitsPreferenceSchema, vec3Schema, wearerAnchorSchema } from './common';
import { emptyMaterialsDb, materialsDbSchema } from './materials';
import { mechanismSchema } from './mechanism';

export const SCHEMA_VERSION = 1;

/** The project document — the single source of truth for the file format.
 * Every schema change bumps SCHEMA_VERSION and adds a migration (§3). */
export const projectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: idSchema,
  name: z.string().min(1),
  unitsPreference: unitsPreferenceSchema,
  materials: materialsDbSchema,
  mechanisms: z.array(mechanismSchema),
  assembly: assemblySchema,
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
    wearerAnchorOverrides: {},
  };
}
