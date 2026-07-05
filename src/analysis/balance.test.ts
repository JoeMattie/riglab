import { describe, expect, it } from 'vitest';
import { balanceReport, GRAVITY } from './balance';

function near(a: number, b: number, tol = 1e-9) {
  expect(Math.abs(a - b)).toBeLessThan(tol);
}

describe('balanceReport — seesaw moment about a chosen axis (§5.4)', () => {
  const axis = { axisPoint: { x: 0, y: 1, z: 0 }, axisDir: { x: 0, y: 0, z: 1 } };

  it('2 kg at 0.5 m vs 1 kg at 1.0 m balances', () => {
    const masses = [
      {
        id: 'f',
        name: 'f',
        massKg: 2,
        world: { x: 0.5, y: 1, z: 0 },
        source: 'pointMass' as const,
      },
      { id: 'b', name: 'b', massKg: 1, world: { x: -1, y: 1, z: 0 }, source: 'pointMass' as const },
    ];
    const r = balanceReport(masses, axis);
    near(r.frontMomentNm, 2 * GRAVITY * 0.5, 1e-6);
    near(r.backMomentNm, 1 * GRAVITY * 1.0, 1e-6);
    expect(r.heavySide).toBe('balanced');
    near(r.imbalanceNm, 0, 1e-6);
  });

  it('vertical offset does not change the moment about a horizontal axis', () => {
    const flat = balanceReport(
      [{ id: 'm', name: 'm', massKg: 2, world: { x: 0.5, y: 1, z: 0 }, source: 'pointMass' }],
      axis,
    );
    const raised = balanceReport(
      [{ id: 'm', name: 'm', massKg: 2, world: { x: 0.5, y: 3.7, z: 0 }, source: 'pointMass' }],
      axis,
    );
    near(flat.frontMomentNm, raised.frontMomentNm);
  });

  it('suggests a counterweight on the light side that zeroes the imbalance', () => {
    const masses = [
      {
        id: 'f',
        name: 'f',
        massKg: 4,
        world: { x: 0.5, y: 1, z: 0 },
        source: 'pointMass' as const,
      },
    ];
    const r = balanceReport(masses, {
      ...axis,
      counterweightPoint: { x: -0.4, y: 1, z: 0 },
    });
    expect(r.heavySide).toBe('front');
    // required: m·g·0.4 = 4·g·0.5 → m = 5 kg
    near(r.suggestedCounterweightKg ?? 0, 5, 1e-6);
  });

  it('offers no suggestion when the counterweight point is on the heavy side', () => {
    const masses = [
      {
        id: 'f',
        name: 'f',
        massKg: 4,
        world: { x: 0.5, y: 1, z: 0 },
        source: 'pointMass' as const,
      },
    ];
    const r = balanceReport(masses, {
      ...axis,
      counterweightPoint: { x: 0.3, y: 1, z: 0 },
    });
    expect(r.suggestedCounterweightKg).toBeUndefined();
  });
});
