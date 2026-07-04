import type { MovementClip } from './clips/format';
import { REST_POSE, type JointPose } from './skeleton';

export interface PlaybackOptions {
  /** time multiplier (1 = authored speed) */
  speed?: number;
  /** scales every track value (0 = rest pose, 1 = authored) */
  amplitude?: number;
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

/** Sample a clip at wall time tS. Looping clips wrap; non-looping clamp. */
export function samplePose(
  clip: MovementClip,
  tS: number,
  { speed = 1, amplitude = 1 }: PlaybackOptions = {},
): JointPose {
  const scaled = tS * speed;
  const t = clip.loop
    ? ((scaled % clip.durationS) + clip.durationS) % clip.durationS
    : Math.min(Math.max(scaled, 0), clip.durationS);
  const pose: JointPose = { ...REST_POSE };
  for (const [channel, track] of Object.entries(clip.tracks)) {
    if (!track) continue;
    // + 0 normalizes the −0 that amplitude 0 would otherwise produce
    pose[channel as keyof JointPose] = amplitude * sampleTrack(track.timesS, track.values, t) + 0;
  }
  return pose;
}
