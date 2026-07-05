# PLANFILE — walk clip default + global spacebar toggle

Feature branch: `worktree-walk-default-spacebar`. Scope addition requested by Joe
(2026-07-04): "Make walk pose the default selected and make spacebar toggle it
from everywhere."

## Goal

1. The transport's clip selector defaults to the bundled `walk` movement clip
   instead of the rest pose, so a fresh session shows the walk pose and the
   play button is immediately usable.
2. Spacebar toggles walk playback from everywhere in the editor (2D sketch,
   quad workspace, 3D assembly, popovers open or closed) — not only after a
   clip has been picked by hand.

## Design

- `DEFAULT_CLIP_NAME = 'walk'` exported from `src/state/editorStore.ts`; the
  initial `playback.clipName` uses it. A test pins the name to a bundled clip
  so renaming the clip file cannot silently break the default.
- The existing window-level space handler in `EditorShell` already fires in
  every mode (it is a `window` keydown listener mounted for the whole editor).
  Two gaps close:
  - **Rest pose fallback**: with no clip selected, space previously flipped
    `playing` on a null clip — visibly nothing. Now it selects the default
    clip and starts it.
  - **Key-repeat guard**: holding space is the canvas pan modifier; without a
    guard, OS key-repeat machine-gunned the play/pause toggle. `e.repeat`
    events are ignored, so hold-to-pan toggles at most once.
- Typing guard unchanged: space inside inputs/textareas/selects still types a
  space.

## Acceptance (Vitest, `src/ui/transportKeys.test.tsx`)

- Initial store state selects `walk`, and `walk` resolves via `getClip`.
- Space keydown on `window` with `EditorShell` mounted toggles
  `playback.playing` on and off.
- Space with the rest pose selected switches to the default clip and plays.
- `repeat` keydowns do not toggle.
- Space with focus in a text input does not toggle.

## Out of scope

Persisting the clip choice per project; changing what the clip menu offers;
any solver/BOM behavior.
