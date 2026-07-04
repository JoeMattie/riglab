# Movement clip format

Movement clips animate the wearer mannequin (planfile §7.2). They are pure
data — JSON files validated against `movementClipSchema`
(`src/wearer/clips/format.ts`) — so new clips can be added without code
changes: drop a `.json` file in `src/wearer/clips/` and register it in
`src/wearer/clips/index.ts`.

## Shape

```json
{
  "name": "walk",
  "durationS": 1.2,
  "loop": true,
  "tracks": {
    "hipR": { "timesS": [0, 0.3, 0.6, 0.9, 1.2], "values": [0.5, 0, -0.5, 0, 0.5] }
  }
}
```

- `durationS` — one cycle, in seconds.
- `loop` — looping clips wrap time; non-looping clips clamp at the ends.
- `tracks` — one entry per pose channel. Omitted channels stay at the rest
  pose.

## Tracks

Each track is a keyframe list, linearly interpolated:

- `timesS`: strictly ascending, first key at `0`, last key exactly at
  `durationS`.
- `values`: same length as `timesS`. For a looping clip the first and last
  value of every track must be equal (seamless wrap).

## Channels

All angles are radians in the sagittal plane; `pelvisRise` is meters.

| channel | meaning |
|---|---|
| `hipL`, `hipR` | hip flexion from straight-down, forward positive |
| `kneeL`, `kneeR` | knee flexion, ≥ 0 bends the shank backward |
| `shoulderL`, `shoulderR` | shoulder flexion from straight-down, forward positive |
| `elbowL`, `elbowR` | elbow flexion, ≥ 0 bends the forearm forward |
| `lean` | torso lean about the hips, forward positive |
| `pelvisRise` | vertical pelvis offset (walk bob) |

## Playback

`samplePose(clip, tS, { speed, amplitude })` (`src/wearer/playback.ts`):
`speed` multiplies time; `amplitude` scales every track value (0 = rest
pose). The per-clip amplitude/speed sliders in the transport map directly to
these options.
