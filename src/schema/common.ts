import { z } from 'zod';

// All stored quantities are SI: meters, kilograms, newtons, radians (§3).
// Unit conversion happens at the UI boundary only.

export const idSchema = z.string().min(1);

export const vec2Schema = z.object({ x: z.number(), y: z.number() });
export const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() });
export const quaternionSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  w: z.number(),
});

export const unitsPreferenceSchema = z.enum(['imperial', 'metric']);

export const viewOrientationSchema = z.enum([
  'side-left',
  'side-right',
  'front',
  'back',
  'top',
  'free',
]);

/** Progressive-refinement backbone (§4.2): sketch elements are fully
 * solvable/playable with defaults; engineered elements have materials and
 * joint realizations assigned. */
export const maturitySchema = z.enum(['sketch', 'engineered']);

/** Physical realization of a joint/junction (§6.2). */
export const jointRealizationSchema = z.enum([
  'heatWrapPivot',
  'heatWrapRigid',
  'nestedSleeve',
  'nestedCoupler',
  'boltThrough',
  'fitting',
  'conduitBox',
  'ropeLashing',
  'clickDetachable',
]);

/** Named wearer anchors exposed by the mannequin (§4.3). */
export const wearerAnchorSchema = z.enum([
  'shoulderL',
  'shoulderR',
  'spineTop',
  'beltL',
  'beltR',
  'beltBack',
  'hipRectFrontL',
  'hipRectFrontR',
  'hipRectBackL',
  'hipRectBackR',
  'thighL',
  'thighR',
  'calfL',
  'calfR',
  'shoeL',
  'shoeR',
  'handL',
  'handR',
]);

/** Poseable skeleton points exposed for 2D snapping and node bindings (§7).
 * Distinct from wearer *anchors* (§4.3): anchors are structural attachment
 * frames; skeleton points move with clips. */
export const skeletonPointSchema = z.enum([
  'head',
  'spineTop',
  'pelvis',
  'shoulderL',
  'shoulderR',
  'elbowL',
  'elbowR',
  'handL',
  'handR',
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
  'ankleL',
  'ankleR',
  'shoeL',
  'shoeR',
]);

export type SkeletonPoint = z.infer<typeof skeletonPointSchema>;

export type Vec2 = z.infer<typeof vec2Schema>;
export type Vec3 = z.infer<typeof vec3Schema>;
export type Quaternion = z.infer<typeof quaternionSchema>;
export type UnitsPreference = z.infer<typeof unitsPreferenceSchema>;
export type ViewOrientation = z.infer<typeof viewOrientationSchema>;
export type Maturity = z.infer<typeof maturitySchema>;
export type JointRealization = z.infer<typeof jointRealizationSchema>;
export type WearerAnchor = z.infer<typeof wearerAnchorSchema>;
