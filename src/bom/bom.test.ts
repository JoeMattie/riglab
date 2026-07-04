import { describe, expect, it } from 'vitest';
import type { JointRealization, MechanismElement } from '../schema';
import { computeBom, HEATWRAP_CONNECTOR_LENGTH_M } from './bom';
import { BOM_SETTINGS, mech, node, testMaterials } from './testHelpers';

const MATS = testMaterials();

function link(
  id: string,
  a: string,
  b: string,
  materialId: string | undefined,
  endA?: JointRealization,
  endB?: JointRealization,
  tag?: string,
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
    ...(tag ? { subsystemTag: tag } : {}),
  };
}

const pipePart = (bom: ReturnType<typeof computeBom>, materialId: string) =>
  bom.cutList.find((p) => p.materialId === materialId && p.kind === 'pipe');

describe('cut-list allowances (§6.2 sign conventions)', () => {
  const nodes = [node('A', 0, 0), node('B', 1, 0)];

  it('bolt-through ends apply no allowance', () => {
    const bom = computeBom(
      [mech([link('L', 'A', 'B', 'PA', 'boltThrough', 'boltThrough')], nodes)],
      MATS,
      BOM_SETTINGS,
    );
    expect(pipePart(bom, 'PA')!.lengthM).toBeCloseTo(1.0, 9);
    expect(bom.cutList.some((p) => p.kind === 'heatWrapConnector')).toBe(false);
  });

  it('a fitting end subtracts the fitting socket depth', () => {
    const bom = computeBom(
      [mech([link('L', 'A', 'B', 'PA', 'fitting', 'boltThrough')], nodes)],
      MATS,
      BOM_SETTINGS,
    );
    expect(pipePart(bom, 'PA')!.lengthM).toBeCloseTo(1.0 - 0.02, 9);
    expect(bom.fittings.find((f) => f.type === 'coupling')!.quantity).toBe(1);
  });

  it('a nested end adds 2× the pipe OD to the inner member', () => {
    const bom = computeBom(
      [mech([link('L', 'A', 'B', 'PA', 'nestedSleeve', 'boltThrough')], nodes)],
      MATS,
      BOM_SETTINGS,
    );
    expect(pipePart(bom, 'PA')!.lengthM).toBeCloseTo(1.0 + 2 * 0.03, 9);
  });

  it('a heat-wrap end adds factor × partner OD and emits a connector part', () => {
    const bom = computeBom(
      [mech([link('L', 'A', 'B', 'PA', 'heatWrapRigid', 'boltThrough')], nodes)],
      MATS,
      BOM_SETTINGS,
    );
    // no partner at A → falls back to own OD 0.03 → 1.5 × 0.03 = 0.045
    expect(pipePart(bom, 'PA')!.lengthM).toBeCloseTo(1.045, 9);
    const conn = bom.cutList.find((p) => p.kind === 'heatWrapConnector')!;
    expect(conn.materialId).toBe('PA');
    expect(conn.lengthM).toBeCloseTo(HEATWRAP_CONNECTOR_LENGTH_M, 9);
    expect(bom.techniqueSummary.heatWrapRigid).toBe(1);
  });

  it('a heat-wrap end uses the PARTNER pipe OD when another pipe shares the node', () => {
    const nodes3 = [node('N0', 0, 0), node('X', 1, 0), node('N2', 2, 0)];
    const a = link('a', 'N0', 'X', 'PA', 'boltThrough', 'heatWrapRigid'); // OD 0.03
    const b = link('b', 'X', 'N2', 'PB', 'boltThrough', 'boltThrough'); // OD 0.05 (partner)
    const bom = computeBom([mech([a, b], nodes3)], MATS, BOM_SETTINGS);
    // a: base 1.0 + 1.5 × partner(0.05) = 1.075
    expect(pipePart(bom, 'PA')!.lengthM).toBeCloseTo(1.075, 9);
  });
});

describe('cut-list grouping', () => {
  it('groups identical cuts into one quantity line', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0), node('C', 0, 1), node('D', 1, 1)];
    const els = [
      link('L1', 'A', 'B', 'PA', 'boltThrough', 'boltThrough'),
      link('L2', 'C', 'D', 'PA', 'boltThrough', 'boltThrough'),
    ];
    const bom = computeBom([mech(els, nodes)], MATS, BOM_SETTINGS);
    const part = pipePart(bom, 'PA')!;
    expect(part.quantity).toBe(2);
    expect(part.lengthM).toBeCloseTo(1.0, 9);
  });
});

describe('bend schedule', () => {
  it('emits per-vertex angle + radius and counts bends', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0), node('C', 1, 1)];
    const bent: MechanismElement = {
      id: 'bent',
      type: 'bentLink',
      maturity: 'engineered',
      nodeIds: ['A', 'B', 'C'],
      filletRadiiM: [0.05],
      pipeMaterialId: 'PA',
      pointMasses: [],
    };
    const bom = computeBom([mech([bent], nodes)], MATS, BOM_SETTINGS);
    const entry = bom.bendSchedule.find((e) => e.elementId === 'bent')!;
    expect(entry.vertices).toHaveLength(1);
    expect(entry.vertices[0]!.nodeId).toBe('B');
    expect(entry.vertices[0]!.angleRad).toBeCloseTo(Math.PI / 2, 9);
    expect(entry.vertices[0]!.radiusM).toBe(0.05);
    expect(bom.techniqueSummary.bends).toBe(1);
    // developed length = 2 − 0.05·(2·tan45 − π/2)
    const reduction = 0.05 * (2 * Math.tan(Math.PI / 4) - Math.PI / 2);
    expect(pipePart(bom, 'PA')!.lengthM).toBeCloseTo(2 - reduction, 9);
  });
});

describe('telescope members', () => {
  const nodes = [node('A', 0, 0), node('B', 1, 0)];
  const tele = (outer: string, inner: string): MechanismElement => ({
    id: 'tel',
    type: 'telescope',
    maturity: 'engineered',
    nodeA: 'A',
    nodeB: 'B',
    minLengthM: 0.5,
    maxLengthM: 1.5,
    lengthM: 1.0,
    sliding: false,
    outerPipeMaterialId: outer,
    innerPipeMaterialId: inner,
    pointMasses: [],
  });

  it('lists both members with overlap on the inner and no warning for a slip pair', () => {
    const bom = computeBom([mech([tele('TO', 'TI')], nodes)], MATS, BOM_SETTINGS);
    // ov = 2 × TI OD (0.022) = 0.044 → outer 0.5, inner 0.544
    expect(pipePart(bom, 'TO')!.lengthM).toBeCloseTo(0.5, 9);
    expect(pipePart(bom, 'TI')!.lengthM).toBeCloseTo(0.544, 9);
    expect(bom.warnings.filter((w) => w.kind === 'telescopeNestingIncompatible')).toHaveLength(0);
  });

  it('warns when the telescope material pair is nesting-incompatible', () => {
    const bom = computeBom([mech([tele('TX', 'TI')], nodes)], MATS, BOM_SETTINGS);
    const w = bom.warnings.find((x) => x.kind === 'telescopeNestingIncompatible');
    expect(w).toBeDefined();
    expect(w!.elementId).toBe('tel');
  });
});

describe('fittings + missing-fitting warning', () => {
  it('infers pivot fitting type by member count and resolves mass', () => {
    const nodes = [node('P', 0, 0), node('A', 1, 0), node('B', -1, 0), node('C', 0, 1)];
    const els: MechanismElement[] = [
      link('la', 'P', 'A', 'PA', 'boltThrough', 'boltThrough'),
      link('lb', 'P', 'B', 'PA', 'boltThrough', 'boltThrough'),
      link('lc', 'P', 'C', 'PA', 'boltThrough', 'boltThrough'),
      {
        id: 'piv',
        type: 'pivot',
        maturity: 'engineered',
        nodeId: 'P',
        memberIds: ['la', 'lb', 'lc'],
        welds: [],
        realization: 'fitting',
      },
    ];
    const bom = computeBom([mech(els, nodes)], MATS, BOM_SETTINGS);
    const tee = bom.fittings.find((f) => f.type === 'tee')!; // 3 members → tee
    expect(tee.quantity).toBe(1);
    expect(tee.resolved).toBe(true);
    expect(tee.totalMassKg).toBeCloseTo(0.07, 9);
    // the fitting mass also lands in the weight rollup's fittings category
    expect(bom.weights.breakdown.fittingsKg).toBeCloseTo(0.07, 9);
  });

  it('warns and reports unresolved when the size/system has no fitting', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0)];
    // PB is NPS 1" — no 1" fittings in the test DB
    const bom = computeBom(
      [mech([link('L', 'A', 'B', 'PB', 'fitting', 'boltThrough')], nodes)],
      MATS,
      BOM_SETTINGS,
    );
    expect(bom.warnings.some((w) => w.kind === 'missingFitting')).toBe(true);
    const f = bom.fittings.find((x) => x.nominalSize === '1')!;
    expect(f.resolved).toBe(false);
    expect(f.totalMassKg).toBe(0);
    // socket depth unavailable → no allowance applied
    expect(pipePart(bom, 'PB')!.lengthM).toBeCloseTo(1.0, 9);
  });
});

describe('consumables', () => {
  it('sums rope × waste factor, elastic and bowden lengths', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0)];
    const els: MechanismElement[] = [
      {
        id: 'r',
        type: 'rope',
        maturity: 'sketch',
        path: ['A', 'B'],
        lengthM: 2.0,
        cordageMaterialId: 'rope',
      },
      {
        id: 'e',
        type: 'elastic',
        maturity: 'sketch',
        nodeA: 'A',
        nodeB: 'B',
        restLengthM: 0.5,
        stiffnessNPerM: 300,
        tensionOnly: true,
        cordageMaterialId: 'bungee',
      },
      {
        id: 'bw',
        type: 'bowden',
        maturity: 'sketch',
        a1: 'A',
        a2: 'B',
        b1: 'A',
        b2: 'B',
        restLengthAM: 0.3,
        restLengthBM: 0.4,
        cordageMaterialId: 'bowden',
      },
    ];
    const bom = computeBom([mech(els, nodes)], MATS, BOM_SETTINGS);
    expect(bom.consumables.ropeRawM).toBeCloseTo(2.0, 9);
    expect(bom.consumables.ropeTotalM).toBeCloseTo(2.4, 9); // × 1.2
    expect(bom.consumables.elasticTotalM).toBeCloseTo(0.5, 9);
    expect(bom.consumables.bowdenTotalM).toBeCloseTo(0.7, 9);
  });
});

describe('technique summary', () => {
  it('counts realizations, bends, telescopes', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0), node('C', 2, 0)];
    const els: MechanismElement[] = [
      link('l1', 'A', 'B', 'PA', 'heatWrapPivot', 'boltThrough'),
      link('l2', 'B', 'C', 'PA', 'ropeLashing', 'conduitBox'),
    ];
    const bom = computeBom([mech(els, nodes)], MATS, BOM_SETTINGS);
    expect(bom.techniqueSummary.heatWrapPivot).toBe(1);
    expect(bom.techniqueSummary.boltThrough).toBe(1);
    expect(bom.techniqueSummary.ropeLashing).toBe(1);
    expect(bom.techniqueSummary.conduitBox).toBe(1);
  });
});

describe('weight rollup', () => {
  const nodes = [node('A', 0, 0), node('B', 2, 0)];

  it('rolls up pipes + point masses per mechanism, per tag, and grand total', () => {
    const els = [link('L', 'A', 'B', 'PA', 'boltThrough', 'boltThrough', 'spine')];
    const m = mech(els, nodes, {
      pointMasses: [{ id: 'pm', name: 'head', massKg: 0.5, nodeId: 'B' }],
    });
    const bom = computeBom([m], MATS, BOM_SETTINGS);
    expect(bom.weights.breakdown.pipesKg).toBeCloseTo(1.0, 9); // 2 m × 0.5 kg/m
    expect(bom.weights.breakdown.pointMassesKg).toBeCloseTo(0.5, 9);
    expect(bom.weights.grandTotalKg).toBeCloseTo(1.5, 9);
    expect(bom.weights.perMechanismKg.m1).toBeCloseTo(1.5, 9);
    expect(bom.weights.perSubsystemTagKg.spine).toBeCloseTo(1.0, 9);
    expect(bom.weights.perSubsystemTagKg['']).toBeCloseTo(0.5, 9); // untagged node mass
  });

  it('changing a pipe size changes the weight by the analytic delta', () => {
    const before = computeBom(
      [mech([link('L', 'A', 'B', 'PA', 'boltThrough', 'boltThrough')], nodes)],
      MATS,
      BOM_SETTINGS,
    );
    const after = computeBom(
      [mech([link('L', 'A', 'B', 'PB', 'boltThrough', 'boltThrough')], nodes)],
      MATS,
      BOM_SETTINGS,
    );
    // 2 m × (0.8 − 0.5) = 0.6 kg
    expect(after.weights.grandTotalKg - before.weights.grandTotalKg).toBeCloseTo(0.6, 9);
  });
});

describe('partial BOM (unresolved elements)', () => {
  it('excludes material-less links from the cut list but counts their point masses', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0)];
    const bare: MechanismElement = {
      id: 'bare',
      type: 'link',
      maturity: 'sketch',
      nodeA: 'A',
      nodeB: 'B',
      pointMasses: [{ id: 'pm', name: 'blob', massKg: 0.3, t: 0.5 }],
    };
    const bom = computeBom([mech([bare], nodes)], MATS, BOM_SETTINGS);
    expect(bom.unresolved.count).toBe(1);
    expect(bom.unresolved.elementIds).toEqual(['bare']);
    expect(bom.cutList).toHaveLength(0);
    expect(bom.weights.breakdown.pointMassesKg).toBeCloseTo(0.3, 9);
  });
});

describe('cost', () => {
  it('is undefined when nothing is priced; sums priced materials otherwise', () => {
    const nodes = [node('A', 0, 0), node('B', 2, 0)];
    const els = [link('L', 'A', 'B', 'PA', 'boltThrough', 'boltThrough')];
    const bomUnpriced = computeBom([mech(els, nodes)], MATS, BOM_SETTINGS);
    expect(bomUnpriced.cost.totalCost).toBeUndefined();

    const priced = { ...MATS, unitPrices: { PA: 3 } }; // $3 per metre
    const bom = computeBom([mech(els, nodes)], priced, BOM_SETTINGS);
    expect(bom.cost.byMaterialId.PA).toBeCloseTo(6, 9); // 2 m × $3
    expect(bom.cost.totalCost).toBeCloseTo(6, 9);
  });
});

describe('multiple mechanisms', () => {
  it('rolls up per mechanism id', () => {
    const nA = [node('A', 0, 0), node('B', 2, 0)];
    const m1 = mech([link('L', 'A', 'B', 'PA', 'boltThrough', 'boltThrough')], nA, { id: 'm1' });
    const m2 = mech([link('L', 'A', 'B', 'PB', 'boltThrough', 'boltThrough')], nA, { id: 'm2' });
    const bom = computeBom([m1, m2], MATS, BOM_SETTINGS);
    expect(bom.weights.perMechanismKg.m1).toBeCloseTo(1.0, 9);
    expect(bom.weights.perMechanismKg.m2).toBeCloseTo(1.6, 9);
  });
});
