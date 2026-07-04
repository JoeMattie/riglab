// Movement clip format (§7.2): clips are DATA — JSON keyframe tracks over
// named pose channels, validated here. The format is documented in
// docs/movement-clips.md so new clips can be added without code changes.
import { z } from 'zod';

/** Pose channels a track may target. Angles in radians; pelvisRise in
 * meters. Matches JointPose in src/wearer/skeleton.ts. */
export const clipChannelSchema = z.enum([
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
  'shoulderL',
  'shoulderR',
  'elbowL',
  'elbowR',
  'lean',
  'pelvisRise',
]);

export const clipTrackSchema = z
  .object({
    /** keyframe times in seconds, ascending, first at 0, last at durationS */
    timesS: z.array(z.number().nonnegative()).min(2),
    /** keyframe values (rad, or m for pelvisRise); linear interpolation */
    values: z.array(z.number()),
  })
  .refine((t) => t.timesS.length === t.values.length, {
    message: 'timesS and values must have equal length',
  })
  .refine((t) => t.timesS.every((v, i) => i === 0 || v > t.timesS[i - 1]!), {
    message: 'timesS must be strictly ascending',
  });

export const movementClipSchema = z
  .object({
    name: z.string().min(1),
    durationS: z.number().positive(),
    loop: z.boolean(),
    tracks: z.partialRecord(clipChannelSchema, clipTrackSchema),
  })
  .refine(
    (c) =>
      Object.values(c.tracks).every(
        (t) =>
          t !== undefined && t.timesS[0] === 0 && t.timesS[t.timesS.length - 1] === c.durationS,
      ),
    { message: 'every track must start at 0 and end at durationS' },
  )
  .refine(
    (c) =>
      !c.loop ||
      Object.values(c.tracks).every(
        (t) => t !== undefined && t.values[0] === t.values[t.values.length - 1],
      ),
    { message: 'looping clips must have equal first/last values per track' },
  );

export type ClipChannel = z.infer<typeof clipChannelSchema>;
export type ClipTrack = z.infer<typeof clipTrackSchema>;
export type MovementClip = z.infer<typeof movementClipSchema>;
