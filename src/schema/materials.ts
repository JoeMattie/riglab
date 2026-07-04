import { z } from 'zod';
import { idSchema } from './common';

// Materials database SHAPE (§6.1). Seed VALUES ship in Phase 3; every
// numeric row carries `approximate` so uncertain seed data surfaces an
// "approximate — edit me" badge instead of being silently trusted (§12).
// Each project stores its complete materials DB (seeded on creation), which
// is how "user overrides persist in the project" is realized — no separate
// override-merging layer.

export const pipeSizingSystemSchema = z.enum(['NPS', 'CTS']);

export const pipeMaterialSchema = z.object({
  id: idSchema,
  name: z.string(),
  sizingSystem: pipeSizingSystemSchema,
  nominalSize: z.string(),
  outerDiameterM: z.number().positive(),
  innerDiameterM: z.number().positive(),
  linearDensityKgPerM: z.number().nonnegative(),
  approximate: z.boolean(),
});

export const fittingTypeSchema = z.enum(['elbow90', 'elbow45', 'tee', 'cross', 'coupling', 'cap']);

export const fittingMaterialSchema = z.object({
  id: idSchema,
  type: fittingTypeSchema,
  sizingSystem: pipeSizingSystemSchema,
  nominalSize: z.string(),
  massKg: z.number().nonnegative(),
  socketDepthM: z.number().nonnegative(),
  approximate: z.boolean(),
});

export const cordageMaterialSchema = z.object({
  id: idSchema,
  name: z.string(),
  kind: z.enum(['rope', 'elastic', 'bowdenCable']),
  linearDensityKgPerM: z.number().nonnegative(),
  /** N/m; elastic presets only */
  defaultStiffnessNPerM: z.number().positive().optional(),
  approximate: z.boolean(),
});

export const sheetMaterialSchema = z.object({
  id: idSchema,
  name: z.string(),
  arealDensityKgPerM2: z.number().nonnegative(),
  approximate: z.boolean(),
});

export const hardwareMaterialSchema = z.object({
  id: idSchema,
  name: z.string(),
  massKg: z.number().nonnegative(),
  approximate: z.boolean(),
});

export const materialsDbSchema = z.object({
  pipes: z.array(pipeMaterialSchema),
  fittings: z.array(fittingMaterialSchema),
  cordage: z.array(cordageMaterialSchema),
  sheets: z.array(sheetMaterialSchema),
  hardware: z.array(hardwareMaterialSchema),
  /** linear density assumed for sketch-maturity links so equilibrium mode
   * behaves plausibly before materials are assigned (§4.2) */
  genericPipeLinearDensityKgPerM: z.number().nonnegative(),
  /** editable unit prices; empty/0 = cost column hidden (§6.2) */
  unitPrices: z.record(idSchema, z.number().nonnegative()),
});

export type PipeMaterial = z.infer<typeof pipeMaterialSchema>;
export type FittingMaterial = z.infer<typeof fittingMaterialSchema>;
export type CordageMaterial = z.infer<typeof cordageMaterialSchema>;
export type SheetMaterial = z.infer<typeof sheetMaterialSchema>;
export type HardwareMaterial = z.infer<typeof hardwareMaterialSchema>;
export type MaterialsDb = z.infer<typeof materialsDbSchema>;

export function emptyMaterialsDb(): MaterialsDb {
  return {
    pipes: [],
    fittings: [],
    cordage: [],
    sheets: [],
    hardware: [],
    genericPipeLinearDensityKgPerM: 0.25,
    unitPrices: {},
  };
}
