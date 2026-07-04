import armSwingJson from './arm-swing.json';
import leanJson from './lean.json';
import walkJson from './walk.json';
import { movementClipSchema, type MovementClip } from './format';

export * from './format';

/** Bundled clips, validated at module load — a malformed clip file fails
 * tests, not users. */
export const CLIPS: MovementClip[] = [walkJson, armSwingJson, leanJson].map((c) =>
  movementClipSchema.parse(c),
);

export function getClip(name: string): MovementClip | undefined {
  return CLIPS.find((c) => c.name === name);
}
