import { describe, expect, it } from 'vitest';
import { mech, node, proj, testMaterials } from '../bom/testHelpers';
import type { MechanismElement, Vec3, WearerAnchor } from '../schema';
import { massInventory, polygonAreaM2 } from './masses';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

// Plain wearer-anchor positions — the analysis layer takes a record, not a
// skeleton (no wearer/ or solver/ imports).
const ANCHORS: Partial<Record<WearerAnchor, Vec3>> = {
  spineTop: V(-0.1, 1.45, 0),
  beltBack: V(-0.15, 1.05, 0),
};

function near(a: number, b: number, tol = 1e-9) {
  expect(Math.abs(a - b)).toBeLessThan(tol);
}

describe('massInventory — explicit point masses', () => {
  it('computes total mass and CG of wearer-anchored point masses', () => {
    const project = proj(mech([], []), {
      pointMasses: [
        { id: 'a', name: 'a', massKg: 1, attach: { kind: 'wearerAnchor', anchor: 'spineTop' } },
        { id: 'b', name: 'b', massKg: 3, attach: { kind: 'wearerAnchor', anchor: 'beltBack' } },
      ],
    });
    const inv = massInventory(project, {}, ANCHORS);
    near(inv.totalMassKg, 4);
    // CG = (1·spineTop + 3·beltBack) / 4
    const sp = ANCHORS.spineTop!;
    const bb = ANCHORS.beltBack!;
    near(inv.cg.x, (sp.x + 3 * bb.x) / 4);
    near(inv.cg.y, (sp.y + 3 * bb.y) / 4);
    near(inv.cg.z, (sp.z + 3 * bb.z) / 4);
  });

  it('resolves node attaches through the SOLVED positions', () => {
    const project = proj(mech([], [node('n', 0, 0, 0)]), {
      pointMasses: [{ id: 'x', name: 'x', massKg: 2, attach: { kind: 'node', nodeId: 'n' } }],
    });
    const inv = massInventory(project, { n: V(0.4, 1.2, -0.3) }, {});
    expect(inv.masses).toHaveLength(1);
    expect(inv.masses[0]!.source).toBe('pointMass');
    expect(inv.masses[0]!.world).toEqual(V(0.4, 1.2, -0.3));
    near(inv.totalMassKg, 2);
  });

  it('drops masses whose attach target dangles', () => {
    const project = proj(mech([], []), {
      pointMasses: [
        { id: 'x', name: 'x', massKg: 5, attach: { kind: 'node', nodeId: 'nope' } },
        { id: 'y', name: 'y', massKg: 5, attach: { kind: 'wearerAnchor', anchor: 'handL' } },
      ],
    });
    const inv = massInventory(project, {}, ANCHORS); // no handL in the record
    expect(inv.totalMassKg).toBe(0);
    expect(inv.masses).toHaveLength(0);
    expect(inv.cg).toEqual(V(0, 0, 0));
  });
});

describe('massInventory — distributed pipe masses', () => {
  const linkEl = (id: string, a: string, b: string, matId?: string): MechanismElement => ({
    id,
    type: 'link',
    maturity: 'engineered',
    nodeA: a,
    nodeB: b,
    pipeMaterialId: matId,
    pointMasses: [],
    subsystemTag: 'spine',
  });

  it('puts density × solved length at each link midpoint', () => {
    const project = proj(mech([linkEl('L', 'A', 'B', 'PA')], [node('A', 0, 0), node('B', 1, 0)]));
    // solved positions differ from the stored sketch — the solve wins
    const inv = massInventory(project, { A: V(0, 0, 0), B: V(0, 2, 0) }, {});
    expect(inv.masses).toHaveLength(1);
    const m = inv.masses[0]!;
    expect(m.source).toBe('link');
    expect(m.name).toBe('spine');
    near(m.massKg, 2 * 0.5); // 2 m × 0.5 kg/m (pipe PA)
    expect(m.world).toEqual(V(0, 1, 0));
    near(inv.cg.y, 1);
  });

  it('splits a bentLink into per-segment midpoint masses', () => {
    const bent: MechanismElement = {
      id: 'bent',
      type: 'bentLink',
      maturity: 'engineered',
      nodeIds: ['A', 'B', 'C'],
      filletRadiiM: [0],
      pipeMaterialId: 'PA',
      pointMasses: [],
    };
    const project = proj(mech([bent], [node('A', 0, 0), node('B', 1, 0), node('C', 1, 1)]));
    const inv = massInventory(project, { A: V(0, 0, 0), B: V(1, 0, 0), C: V(1, 1, 0) }, {});
    expect(inv.masses).toHaveLength(2);
    near(inv.masses[0]!.massKg, 0.5);
    near(inv.masses[1]!.massKg, 0.5);
    near(inv.cg.x, 0.75);
    near(inv.cg.y, 0.25);
  });

  it('weighs a telescope by its effective density (BOM member split)', () => {
    const tel: MechanismElement = {
      id: 'tel',
      type: 'telescope',
      maturity: 'engineered',
      nodeA: 'A',
      nodeB: 'B',
      minLengthM: 0.5,
      maxLengthM: 1.5,
      lengthM: 1.0,
      sliding: false,
      outerPipeMaterialId: 'TO',
      innerPipeMaterialId: 'TI',
      pointMasses: [],
    };
    const project = proj(mech([tel], [node('A', 0, 0), node('B', 1, 0)]));
    const inv = massInventory(project, { A: V(0, 0, 0), B: V(1, 0, 0) }, {});
    // outer 0.5 m × 0.5 + inner (0.5 + 2×0.022) m × 0.3 = 0.25 + 0.1632
    near(inv.totalMassKg, 0.4132, 1e-9);
  });

  it('includePipeMass:false weighs only explicit masses', () => {
    const project = proj(mech([linkEl('L', 'A', 'B', 'PA')], [node('A', 0, 0), node('B', 1, 0)]), {
      pointMasses: [{ id: 'p', name: 'p', massKg: 1, attach: { kind: 'node', nodeId: 'A' } }],
    });
    const positions = { A: V(0, 0, 0), B: V(0, 2, 0) };
    near(massInventory(project, positions, {}).totalMassKg, 2);
    near(massInventory(project, positions, {}, { includePipeMass: false }).totalMassKg, 1);
  });

  it('skips material-less (sketch) elements', () => {
    const project = proj(mech([linkEl('L', 'A', 'B')], [node('A', 0, 0), node('B', 1, 0)]));
    const inv = massInventory(project, { A: V(0, 0, 0), B: V(0, 2, 0) }, {});
    expect(inv.masses).toHaveLength(0);
  });
});

describe('massInventory — foam plates', () => {
  const foamMaterials = () => ({
    ...testMaterials(),
    sheets: [{ id: 'foam', name: 'EVA foam', arealDensityKgPerM2: 2, approximate: true }],
  });

  it('weighs polygon area × sheet density at the attach point', () => {
    const project = proj(mech([], [node('n', 0, 0)]), {
      materials: foamMaterials(),
      foamPlates: [
        {
          id: 'fp',
          name: 'head plate',
          polygon: [V2(0, 0), V2(1, 0), V2(1, 1), V2(0, 1)], // 1 m²
          sheetMaterialId: 'foam',
          attach: { kind: 'node', nodeId: 'n' },
        },
      ],
    });
    const inv = massInventory(project, { n: V(0, 2, 0) }, {});
    expect(inv.masses).toHaveLength(1);
    expect(inv.masses[0]!.source).toBe('foamPlate');
    near(inv.masses[0]!.massKg, 2); // 1 m² × 2 kg/m²
    expect(inv.masses[0]!.world).toEqual(V(0, 2, 0));
  });

  it('prefers the plain areaM2 override over the polygon', () => {
    const project = proj(mech([], []), {
      materials: foamMaterials(),
      foamPlates: [
        {
          id: 'fp',
          name: 'plate',
          polygon: [V2(0, 0), V2(1, 0), V2(1, 1), V2(0, 1)],
          areaM2: 0.5,
          sheetMaterialId: 'foam',
          attach: { kind: 'wearerAnchor', anchor: 'spineTop' },
        },
      ],
    });
    near(massInventory(project, {}, ANCHORS).totalMassKg, 1); // 0.5 m² × 2
  });

  it('contributes nothing without a sheet material', () => {
    const project = proj(mech([], []), {
      foamPlates: [
        {
          id: 'fp',
          name: 'plate',
          areaM2: 1,
          attach: { kind: 'wearerAnchor', anchor: 'spineTop' },
        },
      ],
    });
    expect(massInventory(project, {}, ANCHORS).masses).toHaveLength(0);
  });
});

describe('polygonAreaM2', () => {
  it('computes shoelace area regardless of winding', () => {
    const sq = [V2(0, 0), V2(2, 0), V2(2, 1), V2(0, 1)];
    near(polygonAreaM2(sq), 2);
    near(polygonAreaM2([...sq].reverse()), 2);
  });
});

function V2(x: number, y: number) {
  return { x, y };
}
