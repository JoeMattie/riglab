import { describe, expect, it } from 'vitest';
import { type Control, type ControlAxis, type ControlClip, projectSchema } from '../schema';
import { fixtureProject } from '../schema/fixtures';
import {
  axisChannelValue,
  controlChannelValues,
  lockedChannels,
  resolveChannelValues,
  sampleControlClip,
} from './mapping';

const axis = (over: Partial<ControlAxis>): ControlAxis => ({
  id: 'a',
  name: 'x',
  min: -1,
  max: 1,
  value: 0,
  channelName: 'ch',
  outMin: 0,
  outMax: 90,
  invert: false,
  locked: false,
  ...over,
});

// §11 Phase 4.5 unit: axis value → mapped channel value → solve() input,
// including invert and range mapping.
describe('axisChannelValue — range mapping + invert', () => {
  it('maps the axis midpoint to the output midpoint', () => {
    expect(axisChannelValue(axis({ value: 0 }))).toBeCloseTo(45, 9);
  });

  it('maps the endpoints to the output range', () => {
    expect(axisChannelValue(axis({ value: -1 }))).toBeCloseTo(0, 9);
    expect(axisChannelValue(axis({ value: 1 }))).toBeCloseTo(90, 9);
  });

  it('inverts the mapping when invert is set', () => {
    expect(axisChannelValue(axis({ value: -1, invert: true }))).toBeCloseTo(90, 9);
    expect(axisChannelValue(axis({ value: 1, invert: true }))).toBeCloseTo(0, 9);
  });

  it('clamps values outside the axis range', () => {
    expect(axisChannelValue(axis({ value: 5 }))).toBeCloseTo(90, 9);
    expect(axisChannelValue(axis({ value: -5 }))).toBeCloseTo(0, 9);
  });

  it('handles a degenerate (min===max) axis', () => {
    expect(axisChannelValue(axis({ min: 2, max: 2, value: 2 }))).toBeCloseTo(0, 9);
  });
});

describe('controlChannelValues — a yoke drives three channels', () => {
  const yoke: Control = {
    id: 'yoke',
    name: 'Head yoke',
    type: 'yoke',
    axes: [
      axis({ id: 'tilt', channelName: 'pitch', value: 1, outMin: 0, outMax: 1 }),
      axis({ id: 'twist', channelName: 'pan', value: -1, outMin: -30, outMax: 30 }),
      axis({ id: 'trigger', channelName: 'jaw', value: 0, outMin: 0, outMax: 1, min: 0, max: 1 }),
    ],
  };

  it('resolves each axis to its channel value (invert + range applied)', () => {
    const vals = controlChannelValues([yoke]);
    expect(vals.pitch).toBeCloseTo(1, 9);
    expect(vals.pan).toBeCloseTo(-30, 9);
    expect(vals.jaw).toBeCloseTo(0, 9);
  });

  it('reports axis-locked channels (§4.4 per-axis lock)', () => {
    const locked = lockedChannels([
      {
        ...yoke,
        axes: yoke.axes.map((a) => (a.channelName === 'jaw' ? { ...a, locked: true } : a)),
      },
    ]);
    expect([...locked]).toEqual(['jaw']);
  });
});

describe('sampleControlClip — channel keyframe animation', () => {
  const clip: ControlClip = {
    name: 'head sweep',
    durationS: 2,
    loop: true,
    tracks: { pan: { timesS: [0, 1, 2], values: [0, 30, 0] } },
  };

  it('linearly interpolates a track', () => {
    expect(sampleControlClip(clip, 0).pan).toBeCloseTo(0, 9);
    expect(sampleControlClip(clip, 0.5).pan).toBeCloseTo(15, 9);
    expect(sampleControlClip(clip, 1).pan).toBeCloseTo(30, 9);
  });

  it('wraps a looping clip', () => {
    expect(sampleControlClip(clip, 2.5).pan).toBeCloseTo(15, 9);
  });
});

describe('resolveChannelValues — clip + live controls compose (§4.4/§7)', () => {
  const clip: ControlClip = {
    name: 'sweep',
    durationS: 2,
    loop: true,
    tracks: { pan: { timesS: [0, 1, 2], values: [0, 30, 0] } },
  };
  const control: Control = {
    id: 'c',
    name: 'yoke',
    type: 'yoke',
    axes: [axis({ channelName: 'pan', value: 1, outMin: -30, outMax: 30 })],
  };

  it('a control clip drives channels', () => {
    const vals = resolveChannelValues({ clip, clipTimeS: 1 });
    expect(vals.pan).toBeCloseTo(30, 9);
  });

  it('a held control overrides the clip (manual input wins while held)', () => {
    const vals = resolveChannelValues({
      clip,
      clipTimeS: 0.5, // clip alone would give pan=15
      controls: [control],
      heldChannels: new Set(['pan']),
    });
    expect(vals.pan).toBeCloseTo(30, 9); // control value wins
  });

  it('an unheld control leaves the clip value in place', () => {
    const vals = resolveChannelValues({
      clip,
      clipTimeS: 0.5,
      controls: [control],
      heldChannels: new Set(), // nothing held
    });
    expect(vals.pan).toBeCloseTo(15, 9); // clip value stands
  });
});

// §11 Phase 4.5: control-clip round-trips through JSON export/import.
describe('controls round-trip through the project schema', () => {
  it('preserves a populated control + control clip across JSON', () => {
    const project = {
      ...fixtureProject(),
      controls: [
        {
          id: 'yoke',
          name: 'Head yoke',
          type: 'yoke' as const,
          mount: { kind: 'wearerAnchor' as const, anchor: 'handR' as const },
          axes: [axis({ id: 'tilt', channelName: 'pitch' })],
        },
      ],
      controlClips: [
        {
          name: 'head sweep',
          durationS: 2,
          loop: true,
          tracks: { pitch: { timesS: [0, 1, 2], values: [0, 1, 0] } },
        },
      ],
    };
    const back = projectSchema.parse(JSON.parse(JSON.stringify(project)));
    expect(back).toEqual(project);
  });
});
