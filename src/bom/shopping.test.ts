// Acceptance tests for the consolidated shopping list
// (PLANFILE-bom-shopping-list.md): stick packing plus the fittings /
// hardware / cordage purchase lines.
import { describe, expect, it } from 'vitest';
import type { JointRealization, MechanismElement } from '../schema';
import { computeBom, HEATWRAP_CONNECTOR_LENGTH_M } from './bom';
import { DEFAULT_PIPE_STOCK_LENGTH_M, packSticks } from './shopping';
import { mech, node, proj } from './testHelpers';

const FT = 0.3048;

function link(
  id: string,
  a: string,
  b: string,
  materialId: string | undefined,
  endA?: JointRealization,
  endB?: JointRealization,
): MechanismElement {
  return {
    id,
    type: 'link',
    maturity: 'engineered',
    nodeA: a,
    nodeB: b,
    pipeMaterialId: materialId,
    endRealizationA: endA,
    endRealizationB: endB,
    pointMasses: [],
  };
}

describe('packSticks (first-fit decreasing)', () => {
  it('packs nothing into zero sticks', () => {
    expect(packSticks([], DEFAULT_PIPE_STOCK_LENGTH_M)).toEqual({ sticks: 0, oversizeCuts: [] });
  });

  it('a cut of exactly one stock length fits in one stick', () => {
    const r = packSticks([DEFAULT_PIPE_STOCK_LENGTH_M], DEFAULT_PIPE_STOCK_LENGTH_M);
    expect(r.sticks).toBe(1);
    expect(r.oversizeCuts).toEqual([]);
  });

  it("cuts summing to 9' fit in one 10' stick (the headline example)", () => {
    expect(packSticks([4 * FT, 3 * FT, 2 * FT], 10 * FT).sticks).toBe(1);
  });

  it("does NOT under-buy like ceil(total/stock): three 6' cuts need three 10' sticks", () => {
    // total 18' → naive ceiling would say 2 sticks, but no stick fits two 6' cuts
    expect(packSticks([6 * FT, 6 * FT, 6 * FT], 10 * FT).sticks).toBe(3);
  });

  it('pairs cuts into a shared stick when they fit', () => {
    expect(packSticks([5 * FT, 5 * FT, 5 * FT], 10 * FT).sticks).toBe(2);
  });

  it('an oversize cut counts ceil(len/stock) sticks and is reported', () => {
    const r = packSticks([13 * FT], 10 * FT);
    expect(r.sticks).toBe(2);
    expect(r.oversizeCuts).toEqual([13 * FT]);
  });

  it('a cut of exactly two stock lengths counts two sticks, not three', () => {
    expect(packSticks([20 * FT], 10 * FT).sticks).toBe(2);
  });
});

describe('computeBom shopping list', () => {
  it("suggests one 10' stick when a material's cuts total 9 feet", () => {
    const nodes = [
      node('a0', 0, 0),
      node('a1', 4 * FT, 0),
      node('b0', 0, 1),
      node('b1', 5 * FT, 1),
    ];
    const els = [
      link('L1', 'a0', 'a1', 'PA', 'boltThrough', 'boltThrough'),
      link('L2', 'b0', 'b1', 'PA', 'boltThrough', 'boltThrough'),
    ];
    const bom = computeBom(proj(mech(els, nodes)));
    const line = bom.shoppingList.pipes.find((p) => p.materialId === 'PA')!;
    expect(line.sticksToBuy).toBe(1);
    expect(line.stockLengthM).toBeCloseTo(10 * FT, 9);
    expect(line.cutCount).toBe(2);
    expect(line.totalCutM).toBeCloseTo(9 * FT, 9);
    expect(line.leftoverM).toBeCloseTo(1 * FT, 9);
    expect(line.oversizeCuts).toEqual([]);
  });

  it('separates stick counts per pipe material', () => {
    const nodes = [node('a0', 0, 0), node('a1', 1, 0), node('b0', 0, 1), node('b1', 1, 1)];
    const els = [
      link('L1', 'a0', 'a1', 'PA', 'boltThrough', 'boltThrough'),
      link('L2', 'b0', 'b1', 'PB', 'boltThrough', 'boltThrough'),
    ];
    const bom = computeBom(proj(mech(els, nodes)));
    expect(bom.shoppingList.pipes.map((p) => [p.materialId, p.sticksToBuy])).toEqual([
      ['PA', 1],
      ['PB', 1],
    ]);
  });

  it('packs heat-wrap connector pieces into the same sticks as the main cuts', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0)];
    const els = [link('L', 'A', 'B', 'PA', 'heatWrapRigid', 'boltThrough')];
    const bom = computeBom(proj(mech(els, nodes)));
    const line = bom.shoppingList.pipes.find((p) => p.materialId === 'PA')!;
    // main cut 1.045 m + 0.1 m connector share one stick
    expect(line.cutCount).toBe(2);
    expect(line.totalCutM).toBeCloseTo(1.045 + HEATWRAP_CONNECTOR_LENGTH_M, 9);
    expect(line.sticksToBuy).toBe(1);
  });

  it('warns when a single cut exceeds the stock length and buys enough sticks', () => {
    const nodes = [node('A', 0, 0), node('B', 4, 0)]; // 4 m cut > 3.048 m stock
    const bom = computeBom(proj(mech([link('L', 'A', 'B', 'PA')], nodes)));
    const line = bom.shoppingList.pipes.find((p) => p.materialId === 'PA')!;
    expect(line.sticksToBuy).toBe(2);
    expect(line.oversizeCuts).toHaveLength(1);
    expect(bom.warnings.some((w) => w.kind === 'cutLongerThanStock')).toBe(true);
  });

  it('lists fitting purchases with quantities', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0)];
    const els = [link('L', 'A', 'B', 'PA', 'fitting', 'fitting')];
    const bom = computeBom(proj(mech(els, nodes)));
    expect(bom.shoppingList.fittings).toEqual([
      { id: 'NPS|3/4|coupling', label: '3/4" NPS coupling', quantity: 2 },
    ]);
  });

  it('lists installed hardware with quantities', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0), node('C', 2, 0)];
    const els: MechanismElement[] = [
      link('L1', 'A', 'B', 'PA'),
      link('L2', 'B', 'C', 'PA'),
      {
        id: 'piv',
        type: 'pivot',
        maturity: 'engineered',
        nodeId: 'B',
        joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
        memberIds: ['L1', 'L2'],
        welds: [],
        realization: 'boltThrough',
      },
    ];
    const bom = computeBom(proj(mech(els, nodes)));
    expect(bom.shoppingList.hardware).toEqual([
      { id: 'hw-boltset', label: 'bolt set', quantity: 1 },
    ]);
  });

  it('lists cordage lengths, applying the waste factor to rope only', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0)];
    const els: MechanismElement[] = [
      {
        id: 'r',
        type: 'rope',
        maturity: 'sketch',
        path: ['A', 'B'],
        lengthM: 2,
        cordageMaterialId: 'rope',
      },
      {
        id: 'e',
        type: 'elastic',
        maturity: 'sketch',
        nodeA: 'A',
        nodeB: 'B',
        restLengthM: 3,
        stiffnessNPerM: 300,
        tensionOnly: true,
        cordageMaterialId: 'bungee',
      },
    ];
    const bom = computeBom(proj(mech(els, nodes)));
    expect(bom.shoppingList.cordage).toEqual([
      { id: 'bungee', label: 'bungee', lengthM: 3 },
      { id: 'rope', label: 'rope', lengthM: 2 * 1.2 },
    ]);
  });

  it('is empty for an empty mechanism', () => {
    const bom = computeBom(proj(mech([], [])));
    expect(bom.shoppingList).toEqual({ pipes: [], fittings: [], hardware: [], cordage: [] });
  });
});
