import { z } from 'zod';
import { idSchema, wearerAnchorSchema } from './common';

// Controls (§4.4): virtual input devices grouping a manipulation widget over
// the existing global input-channel machinery (§4.2). A control has a type
// (which picks its widget), an optional mount (rides a wearer anchor / instance
// node), and axes; each axis maps its own range onto one input channel.

export const controlTypeSchema = z.enum(['lever', 'yoke', 'twistGrip', 'trigger', 'slider2d']);

/** Where a control mounts (v7): a mechanism node or a wearer anchor; absent =
 * desk-fixed. Same shape as project.ts's attachTargetSchema — defined locally
 * because project.ts imports this module (a shared import would be a cycle). */
export const controlMountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('node'), nodeId: idSchema }),
  z.object({ kind: z.literal('wearerAnchor'), anchor: wearerAnchorSchema }),
]);

/** A named axis with its own range/limits and a linear mapping onto one global
 * input channel (name, output range, invert). `locked` freezes its channel. */
export const controlAxisSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  /** axis input range + current position */
  min: z.number(),
  max: z.number(),
  value: z.number(),
  /** target global input-channel name (§4.2 — channels are global by name) */
  channelName: z.string().min(1),
  /** channel-value range the axis range maps onto */
  outMin: z.number(),
  outMax: z.number(),
  invert: z.boolean(),
  /** per-axis channel lock (set-screw analogue, §4.4) */
  locked: z.boolean(),
});

export const controlSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  type: controlTypeSchema,
  /** rides a wearer anchor or mechanism node through movement clips; absent =
   * desk-fixed (§4.3, v7). */
  mount: controlMountSchema.optional(),
  axes: z.array(controlAxisSchema),
});

/** Keyframe track over one input channel — same shape as a movement-clip track
 * (§7.2): ascending times, linear interpolation. Duplicated here (not imported
 * from the wearer layer) to keep the schema layer dependency-free. */
export const channelTrackSchema = z
  .object({
    timesS: z.array(z.number().nonnegative()).min(2),
    values: z.array(z.number()),
  })
  .refine((t) => t.timesS.length === t.values.length, {
    message: 'timesS and values must have equal length',
  })
  .refine((t) => t.timesS.every((v, i) => i === 0 || v > t.timesS[i - 1]!), {
    message: 'timesS must be strictly ascending',
  });

/** Channel animation (§4.4): named keyframe tracks over input channels, keyed
 * by channel NAME, sharing the movement-clip transport. */
export const controlClipSchema = z
  .object({
    name: z.string().min(1),
    durationS: z.number().positive(),
    loop: z.boolean(),
    tracks: z.record(z.string().min(1), channelTrackSchema),
  })
  .refine(
    (c) =>
      Object.values(c.tracks).every(
        (t) => t.timesS[0] === 0 && t.timesS[t.timesS.length - 1] === c.durationS,
      ),
    { message: 'every track must start at 0 and end at durationS' },
  )
  .refine(
    (c) =>
      !c.loop ||
      Object.values(c.tracks).every((t) => t.values[0] === t.values[t.values.length - 1]),
    { message: 'looping clips must have equal first/last values per track' },
  );

export type ControlType = z.infer<typeof controlTypeSchema>;
export type ControlMount = z.infer<typeof controlMountSchema>;
export type ControlAxis = z.infer<typeof controlAxisSchema>;
export type Control = z.infer<typeof controlSchema>;
export type ChannelTrack = z.infer<typeof channelTrackSchema>;
export type ControlClip = z.infer<typeof controlClipSchema>;
