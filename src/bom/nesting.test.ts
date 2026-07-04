import { describe, expect, it } from 'vitest';
import type { PipeMaterial } from '../schema';
import {
  classifyNesting,
  nestingClearanceM,
  nestingMatrix,
  validateTelescopePair,
} from './nesting';

/** minimal pipe: only OD/ID matter for nesting. */
function pipe(id: string, odMm: number, idMm: number): PipeMaterial {
  return {
    id,
    name: id,
    sizingSystem: 'NPS',
    nominalSize: 'x',
    outerDiameterM: odMm / 1000,
    innerDiameterM: idMm / 1000,
    linearDensityKgPerM: 0.3,
    approximate: true,
  };
}

describe('nestingClearanceM', () => {
  it('is ID(outer) − OD(inner)', () => {
    const outer = pipe('o', 30, 25); // ID 25 mm
    const inner = pipe('i', 24, 20); // OD 24 mm
    expect(nestingClearanceM(outer, inner)).toBeCloseTo(0.001, 9); // 1 mm
  });
});

describe('classifyNesting boundary values (§6.1)', () => {
  it('press below zero', () => {
    expect(classifyNesting(-0.001)).toBe('press');
    expect(classifyNesting(-1e-6)).toBe('press');
  });
  it('snug in [0, 0.5 mm]', () => {
    expect(classifyNesting(0)).toBe('snug');
    expect(classifyNesting(0.00025)).toBe('snug');
    expect(classifyNesting(0.0005)).toBe('snug'); // upper boundary inclusive
  });
  it('slip in (0.5, 1.5 mm]', () => {
    expect(classifyNesting(0.00051)).toBe('slip');
    expect(classifyNesting(0.001)).toBe('slip');
    expect(classifyNesting(0.0015)).toBe('slip'); // upper boundary inclusive
  });
  it('sloppy above 1.5 mm', () => {
    expect(classifyNesting(0.00151)).toBe('sloppy');
    expect(classifyNesting(0.01)).toBe('sloppy');
  });
});

describe('nestingMatrix', () => {
  const pipes = [pipe('a', 30, 25), pipe('b', 24, 20), pipe('c', 26, 22)];

  it('produces every ordered pair of distinct pipes', () => {
    const m = nestingMatrix(pipes);
    expect(m.length).toBe(pipes.length * (pipes.length - 1)); // 3×2 = 6
    // no self-pairs
    expect(m.every((p) => p.outerId !== p.innerId)).toBe(true);
    // ordered: both (a,b) and (b,a) present
    expect(m.find((p) => p.outerId === 'a' && p.innerId === 'b')).toBeDefined();
    expect(m.find((p) => p.outerId === 'b' && p.innerId === 'a')).toBeDefined();
  });

  it('classifies each pair from its clearance', () => {
    const m = nestingMatrix(pipes);
    const ab = m.find((p) => p.outerId === 'a' && p.innerId === 'b')!;
    // ID(a)=25, OD(b)=24 → 1 mm → slip
    expect(ab.clearanceM).toBeCloseTo(0.001, 9);
    expect(ab.classification).toBe('slip');
  });

  it('re-flows when an outer pipe ID is edited across a boundary (§11 acceptance)', () => {
    const inner = pipe('i', 22, 18); // OD 22 mm
    const outer = pipe('o', 30, 23); // ID 23 mm → 1 mm clearance → slip
    const before = nestingMatrix([outer, inner]).find(
      (p) => p.outerId === 'o' && p.innerId === 'i',
    )!;
    expect(before.classification).toBe('slip');

    // user calipers the real (looser) ID: 22.3 mm → 0.3 mm clearance → snug
    const edited = { ...outer, innerDiameterM: 22.3 / 1000 };
    const after = nestingMatrix([edited, inner]).find(
      (p) => p.outerId === 'o' && p.innerId === 'i',
    )!;
    expect(after.classification).toBe('snug');
    expect(after.classification).not.toBe(before.classification);
  });
});

describe('validateTelescopePair — telescoping wants slip', () => {
  const inner = pipe('i', 22, 18); // OD 22 mm

  it('accepts a slip fit', () => {
    const outer = pipe('o', 30, 23); // 1 mm → slip
    const v = validateTelescopePair(outer, inner);
    expect(v.classification).toBe('slip');
    expect(v.acceptable).toBe(true);
    expect(v.severity).toBe('ok');
  });

  it('warns on a snug (bearing-tight) fit', () => {
    const outer = pipe('o', 30, 22.3); // 0.3 mm → snug
    const v = validateTelescopePair(outer, inner);
    expect(v.classification).toBe('snug');
    expect(v.acceptable).toBe(false);
    expect(v.severity).toBe('warn');
    expect(v.reason).toBeTruthy();
  });

  it('warns on a press (interference) fit', () => {
    const outer = pipe('o', 30, 21.5); // −0.5 mm → press
    const v = validateTelescopePair(outer, inner);
    expect(v.classification).toBe('press');
    expect(v.acceptable).toBe(false);
    expect(v.severity).toBe('warn');
  });

  it('warns on a sloppy (loose) fit', () => {
    const outer = pipe('o', 30, 25); // 3 mm → sloppy
    const v = validateTelescopePair(outer, inner);
    expect(v.classification).toBe('sloppy');
    expect(v.acceptable).toBe(false);
    expect(v.severity).toBe('warn');
  });
});
