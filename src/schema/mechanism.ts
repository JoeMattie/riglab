import { z } from 'zod';
import {
  idSchema,
  jointRealizationSchema,
  maturitySchema,
  vec2Schema,
  viewOrientationSchema,
} from './common';

// Mechanism (2D planar linkage) — §4.2. Elements are a discriminated union;
// each carries the maturity state driving progressive refinement.

export const nodeKindSchema = z.enum(['free', 'anchor', 'driven']);

export const mechanismNodeSchema = z.object({
  id: idSchema,
  kind: nodeKindSchema,
  position: vec2Schema,
  /** driven nodes: the input channel that prescribes them */
  channelId: idSchema.optional(),
});

/** Extra point mass at a parametric position along a link (head foam,
 * speaker, …). */
export const attachedPointMassSchema = z.object({
  id: idSchema,
  name: z.string(),
  massKg: z.number().nonnegative(),
  /** 0..1 along the element */
  t: z.number().min(0).max(1),
});

/** Point mass attached directly to a node — for masses that hang on ropes or
 * sit at joints and therefore have no link to carry them. */
export const nodePointMassSchema = z.object({
  id: idSchema,
  name: z.string(),
  massKg: z.number().nonnegative(),
  nodeId: idSchema,
});

const elementBase = {
  id: idSchema,
  maturity: maturitySchema,
  /** user-assignable subsystem tag for BOM rollup (§6.2), e.g. "neck" */
  subsystemTag: z.string().optional(),
};

export const linkElementSchema = z.object({
  ...elementBase,
  type: z.literal('link'),
  nodeA: idSchema,
  nodeB: idSchema,
  pipeMaterialId: idSchema.optional(),
  endRealizationA: jointRealizationSchema.optional(),
  endRealizationB: jointRealizationSchema.optional(),
  pointMasses: z.array(attachedPointMassSchema),
});

/** Single rigid body through 3+ nodes (heat-bent pipe). Splines are fitted
 * to a polyline-with-fillet-radii representation for fabrication; mass and
 * cut length use developed (arc) length (§4.2). */
export const bentLinkElementSchema = z.object({
  ...elementBase,
  type: z.literal('bentLink'),
  nodeIds: z.array(idSchema).min(3),
  /** fillet radius (m) per interior vertex; length = nodeIds.length − 2 */
  filletRadiiM: z.array(z.number().nonnegative()),
  pipeMaterialId: idSchema.optional(),
  endRealizationA: jointRealizationSchema.optional(),
  endRealizationB: jointRealizationSchema.optional(),
  pointMasses: z.array(attachedPointMassSchema),
});

/** Length is a design-time parameter within [min, max]; a runtime prismatic
 * DOF only when `sliding` (§4.2). */
export const telescopeElementSchema = z.object({
  ...elementBase,
  type: z.literal('telescope'),
  nodeA: idSchema,
  nodeB: idSchema,
  minLengthM: z.number().positive(),
  maxLengthM: z.number().positive(),
  lengthM: z.number().positive(),
  sliding: z.boolean(),
  outerPipeMaterialId: idSchema.optional(),
  innerPipeMaterialId: idSchema.optional(),
  /** default 2× inner OD; stored only when the user overrides it */
  overlapM: z.number().positive().optional(),
  pointMasses: z.array(attachedPointMassSchema),
});

/** Pin joint at a shared node. Multi-pivot: 3+ members share the pin; pairs
 * rotate freely unless welded. Optional limits/torsion spring between two
 * designated members model hose joints and fiberglass return rods (§4.2). */
export const pivotElementSchema = z.object({
  ...elementBase,
  type: z.literal('pivot'),
  nodeId: idSchema,
  /** element ids joined at this pin */
  memberIds: z.array(idSchema).min(2),
  /** pairs of member element ids rigidly welded to each other */
  welds: z.array(z.tuple([idSchema, idSchema])),
  /** relative angle = signed deviation from the straight continuation of
   * memberA through the pivot into memberB (0 = straight, like a knee) */
  angleLimit: z
    .object({
      memberA: idSchema,
      memberB: idSchema,
      minRad: z.number(),
      maxRad: z.number(),
    })
    .optional(),
  torsionSpring: z
    .object({
      memberA: idSchema,
      memberB: idSchema,
      stiffnessNmPerRad: z.number().nonnegative(),
      restAngleRad: z.number(),
    })
    .optional(),
  realization: jointRealizationSchema.optional(),
});

/** Point-on-line constraint with travel limits (conduit-box pass-through). */
export const sliderElementSchema = z.object({
  ...elementBase,
  type: z.literal('slider'),
  nodeId: idSchema,
  /** the link whose axis constrains the node */
  alongElementId: idSchema,
  /** travel limits as parametric positions along the link */
  travelMin: z.number().min(0).max(1),
  travelMax: z.number().min(0).max(1),
  realization: jointRealizationSchema.optional(),
});

/** Tension-only; intermediate path nodes are frictionless eyelets (§4.2). */
export const ropeElementSchema = z.object({
  ...elementBase,
  type: z.literal('rope'),
  path: z.array(idSchema).min(2),
  lengthM: z.number().positive(),
  cordageMaterialId: idSchema.optional(),
});

export const elasticElementSchema = z.object({
  ...elementBase,
  type: z.literal('elastic'),
  nodeA: idSchema,
  nodeB: idSchema,
  restLengthM: z.number().positive(),
  stiffnessNPerM: z.number().positive(),
  /** bungee/rubber can't push (default true at creation) */
  tensionOnly: z.boolean(),
  pretensionN: z.number().nonnegative().optional(),
  cordageMaterialId: idSchema.optional(),
});

/** Displacement coupling (lenA − lenA₀) + (lenB − lenB₀) = 0, tension-only,
 * routing-independent (brake-cable jaw drive). */
export const bowdenElementSchema = z.object({
  ...elementBase,
  type: z.literal('bowden'),
  a1: idSchema,
  a2: idSchema,
  b1: idSchema,
  b2: idSchema,
  restLengthAM: z.number().positive(),
  restLengthBM: z.number().positive(),
  cordageMaterialId: idSchema.optional(),
});

/** Angle coupling between two pivots: (θB − θB₀) = ratio·(θA − θA₀). */
export const torsionCableElementSchema = z.object({
  ...elementBase,
  type: z.literal('torsionCable'),
  pivotA: idSchema,
  pivotB: idSchema,
  ratio: z.number(),
  backlashRad: z.number().nonnegative(),
  cordageMaterialId: idSchema.optional(),
});

export const mechanismElementSchema = z.discriminatedUnion('type', [
  linkElementSchema,
  bentLinkElementSchema,
  telescopeElementSchema,
  pivotElementSchema,
  sliderElementSchema,
  ropeElementSchema,
  elasticElementSchema,
  bowdenElementSchema,
  torsionCableElementSchema,
]);

/** Named scalar channel bound to driven nodes/joints; shown as a slider.
 * `locked` freezes it at its value (set-screw analogue, §4.2). Channel names
 * are global: several mechanisms may bind the same name. */
export const inputChannelSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  kind: z.enum(['angle', 'displacement']),
  min: z.number(),
  max: z.number(),
  value: z.number(),
  locked: z.boolean(),
});

export const namedStateSchema = z.object({
  name: z.string().min(1),
  positions: z.record(idSchema, vec2Schema),
  channelValues: z.record(idSchema, z.number()),
});

export const mechanismSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  viewOrientation: viewOrientationSchema,
  /** default from view orientation: off for `top`, on for elevations (§4.2) */
  gravityOn: z.boolean(),
  nodes: z.array(mechanismNodeSchema),
  elements: z.array(mechanismElementSchema),
  pointMasses: z.array(nodePointMassSchema),
  inputs: z.array(inputChannelSchema),
  namedStates: z.array(namedStateSchema),
});

export type MechanismNode = z.infer<typeof mechanismNodeSchema>;
export type MechanismElement = z.infer<typeof mechanismElementSchema>;
export type LinkElement = z.infer<typeof linkElementSchema>;
export type BentLinkElement = z.infer<typeof bentLinkElementSchema>;
export type TelescopeElement = z.infer<typeof telescopeElementSchema>;
export type PivotElement = z.infer<typeof pivotElementSchema>;
export type SliderElement = z.infer<typeof sliderElementSchema>;
export type RopeElement = z.infer<typeof ropeElementSchema>;
export type ElasticElement = z.infer<typeof elasticElementSchema>;
export type BowdenElement = z.infer<typeof bowdenElementSchema>;
export type TorsionCableElement = z.infer<typeof torsionCableElementSchema>;
export type NodePointMass = z.infer<typeof nodePointMassSchema>;
export type InputChannel = z.infer<typeof inputChannelSchema>;
export type NamedState = z.infer<typeof namedStateSchema>;
export type Mechanism = z.infer<typeof mechanismSchema>;
