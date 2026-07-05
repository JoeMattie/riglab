// Unit-conversion helpers (§3 units): SI internally, conversion at the UI
// boundary only. Exact factors: 1 in = 0.0254 m, 1 lb = 0.45359237 kg.
import { describe, expect, it } from 'vitest';
import {
  formatLength,
  formatMass,
  KG_PER_LB,
  lengthFromDisplay,
  lengthToDisplay,
  lengthUnit,
  M_PER_IN,
} from './units';

describe('conversion factors', () => {
  it('uses the exact international definitions', () => {
    expect(M_PER_IN).toBe(0.0254);
    expect(KG_PER_LB).toBe(0.45359237);
  });
});

describe('lengthToDisplay / lengthFromDisplay', () => {
  it('round-trips a length through imperial display units', () => {
    const m = 0.9144; // exactly 36 in
    expect(lengthToDisplay(m, 'imperial')).toBeCloseTo(36, 12);
    expect(lengthFromDisplay(36, 'imperial')).toBeCloseTo(m, 12);
  });

  it('is the identity for metric', () => {
    expect(lengthToDisplay(1.25, 'metric')).toBe(1.25);
    expect(lengthFromDisplay(1.25, 'metric')).toBe(1.25);
  });
});

describe('formatLength', () => {
  it('formats metric metres like the existing panel style', () => {
    expect(formatLength(0.5, 'metric')).toBe('0.5 m');
    expect(formatLength(1.23456789, 'metric')).toBe('1.2346 m');
  });

  it('formats imperial as inches', () => {
    expect(formatLength(0.0254, 'imperial')).toBe('1 in');
    expect(formatLength(0.5, 'imperial')).toBe('19.69 in');
  });
});

describe('formatMass', () => {
  it('formats metric kilograms', () => {
    expect(formatMass(1.5, 'metric')).toBe('1.5 kg');
    expect(formatMass(0.1234567, 'metric')).toBe('0.123 kg');
  });

  it('formats imperial pounds', () => {
    expect(formatMass(0.45359237, 'imperial')).toBe('1 lb');
    expect(formatMass(1.5, 'imperial')).toBe('3.31 lb');
  });
});

describe('lengthUnit', () => {
  it('names the display unit', () => {
    expect(lengthUnit('imperial')).toBe('in');
    expect(lengthUnit('metric')).toBe('m');
  });
});
