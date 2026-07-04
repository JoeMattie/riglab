import { z } from 'zod';
import { idSchema, quaternionSchema, vec2Schema, vec3Schema, wearerAnchorSchema } from './common';

// Assembly (3D composition) — §4.3 / §5.4. Kinematic layering, not a global
// 3D solve: each mechanism solves in its plane; instance transforms lift the
// solved positions into 3D and may themselves be driven by a parent
// instance's solved nodes (pan rotates the pitch plane).

export const attachTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('wearerAnchor'), anchor: wearerAnchorSchema }),
  z.object({ kind: z.literal('instanceNode'), instanceId: idSchema, nodeId: idSchema }),
]);

/** How an instance's transform is determined (§5.4): fixed, glued to a
 * wearer anchor frame, or derived from two solved nodes of another instance
 * (origin + axis). */
export const transformDriveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed') }),
  z.object({ kind: z.literal('wearerAnchor'), anchor: wearerAnchorSchema }),
  z.object({
    kind: z.literal('instanceNodes'),
    instanceId: idSchema,
    originNodeId: idSchema,
    axisNodeId: idSchema,
  }),
]);

export const mechanismInstanceSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  mechanismId: idSchema,
  position: vec3Schema,
  quaternion: quaternionSchema,
  /** uniform scale is fixed at 1 in v1 (§4.3); no scale field on purpose */
  mirror: z.boolean(),
  transformDrive: transformDriveSchema,
});

/** Maps a mechanism anchor node to a wearer anchor or another instance's
 * node — rigid weld in v1. */
export const attachmentBindingSchema = z.object({
  id: idSchema,
  instanceId: idSchema,
  anchorNodeId: idSchema,
  target: attachTargetSchema,
});

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

export const assemblySchema = z.object({
  instances: z.array(mechanismInstanceSchema),
  bindings: z.array(attachmentBindingSchema),
  pointMasses: z.array(pointMassSchema),
  foamPlates: z.array(foamPlateSchema),
});

export type AttachTarget = z.infer<typeof attachTargetSchema>;
export type TransformDrive = z.infer<typeof transformDriveSchema>;
export type MechanismInstance = z.infer<typeof mechanismInstanceSchema>;
export type AttachmentBinding = z.infer<typeof attachmentBindingSchema>;
export type PointMass = z.infer<typeof pointMassSchema>;
export type FoamPlate = z.infer<typeof foamPlateSchema>;
export type Assembly = z.infer<typeof assemblySchema>;

export function emptyAssembly(): Assembly {
  return { instances: [], bindings: [], pointMasses: [], foamPlates: [] };
}
