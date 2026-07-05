// Control → channel mapping (§4.4). Controls are a grouping-and-manipulation
// layer over the existing global input channels: each axis maps its own range
// onto one channel with an optional invert. Pure functions — the same values
// flow into solve()/composeProject as channel inputs, so an axis drag, a
// control clip, and a manual override all resolve through one path.
import type { Control, ControlAxis, ControlClip } from '../schema';

/** Resolve a project's live control channel values for a solve at the current
 * transport time. Looks up the active control clip by name and composes it with
 * the live controls (held-channel override). Convenience wrapper the 2D solve
 * and the 3D composition both call so controls drive one code path. */
export function projectControlChannels(opts: {
  controls: Control[];
  controlClips: ControlClip[];
  controlClipName?: string | null;
  tS?: number;
  speed?: number;
  heldChannels?: Set<string>;
}): Record<string, number> {
  const clip = opts.controlClipName
    ? (opts.controlClips.find((c) => c.name === opts.controlClipName) ?? null)
    : null;
  return resolveChannelValues({
    clip,
    clipTimeS: opts.tS,
    clipSpeed: opts.speed,
    controls: opts.controls,
    heldChannels: opts.heldChannels,
  });
}

/** Clamp v to [a, b] regardless of order. */
function clamp(v: number, a: number, b: number): number {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return Math.min(hi, Math.max(lo, v));
}

/** The channel value an axis currently commands: linearly remap its position
 * within [min,max] onto [outMin,outMax], inverting first if set. Degenerate
 * (min===max) axes sit at outMin. */
export function axisChannelValue(axis: ControlAxis): number {
  const span = axis.max - axis.min;
  const t = span === 0 ? 0 : clamp((axis.value - axis.min) / span, 0, 1);
  const tt = axis.invert ? 1 - t : t;
  return axis.outMin + tt * (axis.outMax - axis.outMin);
}

/** Resolve every control's axes to a channel-name → value map. Later axes win
 * on a channel collision (unusual). Locked axes still command their channel —
 * the lock freezes it against further widget/clip changes, it does not remove
 * the value (§4.4). */
export function controlChannelValues(controls: Control[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const control of controls) {
    for (const axis of control.axes) {
      out[axis.channelName] = axisChannelValue(axis);
    }
  }
  return out;
}

/** Names of channels frozen by a locked axis (§4.4). */
export function lockedChannels(controls: Control[]): Set<string> {
  const locked = new Set<string>();
  for (const control of controls) {
    for (const axis of control.axes) {
      if (axis.locked) locked.add(axis.channelName);
    }
  }
  return locked;
}

function sampleTrack(timesS: number[], values: number[], t: number): number {
  if (t <= timesS[0]!) return values[0]!;
  for (let i = 1; i < timesS.length; i++) {
    if (t <= timesS[i]!) {
      const t0 = timesS[i - 1]!;
      const t1 = timesS[i]!;
      const f = (t - t0) / (t1 - t0);
      return values[i - 1]! + f * (values[i]! - values[i - 1]!);
    }
  }
  return values[values.length - 1]!;
}

/** Sample a control clip at wall time tS → channel-name → value. Looping clips
 * wrap; non-looping clamp. Same transport semantics as movement clips (§7.2). */
export function sampleControlClip(
  clip: ControlClip,
  tS: number,
  speed = 1,
): Record<string, number> {
  const scaled = tS * speed;
  const t = clip.loop
    ? ((scaled % clip.durationS) + clip.durationS) % clip.durationS
    : Math.min(Math.max(scaled, 0), clip.durationS);
  const out: Record<string, number> = {};
  for (const [channel, track] of Object.entries(clip.tracks)) {
    out[channel] = sampleTrack(track.timesS, track.values, t);
  }
  return out;
}

export interface RecordFrame {
  tS: number;
  values: Record<string, number>;
}

/** Build a control clip from frames captured while scrubbing/recording (§4.4).
 * Frames are sampled channel values over time; this collapses them to one
 * keyframe track per channel over the shared, deduped, ascending time line.
 * Returns null when there is nothing recordable (no channels, or zero span). */
export function buildControlClip(
  name: string,
  frames: RecordFrame[],
  loop = false,
): ControlClip | null {
  if (frames.length === 0) return null;
  // dedupe by time (last write wins), sort ascending
  const byTime = new Map<number, Record<string, number>>();
  for (const f of frames) byTime.set(f.tS, { ...byTime.get(f.tS), ...f.values });
  const times = [...byTime.keys()].sort((a, b) => a - b);
  const durationS = times[times.length - 1]! - times[0]!;
  if (durationS <= 0) return null;
  // rebase to start at 0
  const t0 = times[0]!;
  const timesS = times.map((t) => t - t0);
  const channels = new Set<string>();
  for (const v of byTime.values()) for (const c of Object.keys(v)) channels.add(c);
  if (channels.size === 0) return null;

  const tracks: Record<string, { timesS: number[]; values: number[] }> = {};
  for (const channel of channels) {
    const values: number[] = [];
    let last = 0;
    for (const t of times) {
      const v = byTime.get(t)?.[channel];
      if (v !== undefined) last = v;
      values.push(last);
    }
    // looping clips need equal first/last per track
    if (loop) values[values.length - 1] = values[0]!;
    tracks[channel] = { timesS, values };
  }
  return { name, durationS, loop, tracks };
}

/** Compose channel values for a solve: a playing control clip is the base
 * layer; live controls drive their channels on top. Precedence per §4.4/§7:
 * a channel the clip animates keeps the clip value UNLESS its control is held
 * (manual input beats the track while a widget is held); a channel the clip
 * does not animate always takes the live control value. With no clip, live
 * controls apply everywhere. `heldChannels` = channels under an active drag. */
export function resolveChannelValues(opts: {
  clip?: ControlClip | null;
  clipTimeS?: number;
  clipSpeed?: number;
  controls?: Control[];
  /** channel names whose live control value overrides the clip (held widgets) */
  heldChannels?: Set<string>;
}): Record<string, number> {
  const base = opts.clip ? sampleControlClip(opts.clip, opts.clipTimeS ?? 0, opts.clipSpeed) : {};
  if (!opts.controls || opts.controls.length === 0) return base;
  const live = controlChannelValues(opts.controls);
  const out = { ...base };
  const held = opts.heldChannels;
  for (const [channel, value] of Object.entries(live)) {
    const clipDrivesIt = channel in base;
    // clip-driven channels yield to the clip unless held; others always apply
    if (!clipDrivesIt || !held || held.has(channel)) out[channel] = value;
  }
  return out;
}
