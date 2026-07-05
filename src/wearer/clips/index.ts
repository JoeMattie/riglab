import armSwingJson from './arm-swing.json';
import crouchJson from './crouch.json';
import danceJson from './dance.json';
import { type MovementClip, movementClipSchema } from './format';
import idleSwayJson from './idle-sway.json';
import leanJson from './lean.json';
import sitStandJson from './sit-stand.json';
import walkJson from './walk.json';

export * from './format';

/** Bundled clips, validated at module load — a malformed clip file fails
 * tests, not users. Full §7.2 library. */
export const CLIPS: MovementClip[] = [
  walkJson,
  armSwingJson,
  leanJson,
  danceJson,
  sitStandJson,
  crouchJson,
  idleSwayJson,
].map((c) => movementClipSchema.parse(c));

export function getClip(name: string): MovementClip | undefined {
  return CLIPS.find((c) => c.name === name);
}
