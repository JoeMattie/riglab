// Materials-DB editing ops (§6.1): row patch/add/delete + the
// approximate-flag clearing rule (editing a NUMBER means the user measured
// it — the "approximate — edit me" badge should go away; renames don't).
import { describe, expect, it } from 'vitest';
import { mech, node, projectWith } from '../design/testFixtures';
import type { LinkElement, Project, RopeElement, TelescopeElement } from '../schema';
import {
  addMaterialRow,
  deleteMaterialRow,
  materialReferenceCount,
  setGenericPipeDensity,
  updateBomSettings,
  updateMaterialRow,
} from './materialsOps';

function project(): Project {
  const link: LinkElement = {
    id: 'L1',
    type: 'link',
    maturity: 'engineered',
    nodeA: 'n1',
    nodeB: 'n2',
    pointMasses: [],
    pipeMaterialId: 'PA',
  };
  const tele: TelescopeElement = {
    id: 'T1',
    type: 'telescope',
    maturity: 'sketch',
    nodeA: 'n1',
    nodeB: 'n2',
    lengthM: 2,
    minLengthM: 1,
    maxLengthM: 3,
    sliding: false,
    pointMasses: [],
    outerPipeMaterialId: 'PA',
  };
  const rope: RopeElement = {
    id: 'R1',
    type: 'rope',
    maturity: 'sketch',
    path: ['n1', 'n2'],
    lengthM: 2,
    cordageMaterialId: 'rope',
  };
  return projectWith(mech([link, tele, rope], [node('n1', 0, 0), node('n2', 3, 4)]));
}

describe('updateMaterialRow', () => {
  it('patches the row and clears approximate on a numeric edit', () => {
    const doc = updateMaterialRow(project(), 'pipes', 'PA', { innerDiameterM: 0.0231 });
    const pa = doc.materials.pipes.find((p) => p.id === 'PA')!;
    expect(pa.innerDiameterM).toBe(0.0231);
    expect(pa.approximate).toBe(false);
  });

  it('keeps approximate on a pure rename', () => {
    const doc = updateMaterialRow(project(), 'pipes', 'PA', { name: 'Measured pipe' });
    const pa = doc.materials.pipes.find((p) => p.id === 'PA')!;
    expect(pa.name).toBe('Measured pipe');
    expect(pa.approximate).toBe(true);
  });

  it('leaves other rows and categories untouched', () => {
    const before = project();
    const doc = updateMaterialRow(before, 'fittings', 'F-tee', { massKg: 0.09 });
    expect(doc.materials.pipes).toEqual(before.materials.pipes);
    expect(doc.materials.fittings.find((f) => f.id === 'F-tee')!.massKg).toBe(0.09);
  });
});

describe('addMaterialRow / deleteMaterialRow', () => {
  it('appends a valid approximate row per category', () => {
    let doc = project();
    for (const category of ['pipes', 'fittings', 'cordage', 'sheets', 'hardware'] as const) {
      const before = doc.materials[category].length;
      const res = addMaterialRow(doc, category);
      doc = res.doc;
      expect(doc.materials[category].length).toBe(before + 1);
      const row = doc.materials[category].find((r) => r.id === res.rowId)!;
      expect(row.approximate).toBe(true);
    }
  });

  it('deletes an unreferenced row', () => {
    const doc = deleteMaterialRow(project(), 'pipes', 'PB');
    expect(doc.materials.pipes.some((p) => p.id === 'PB')).toBe(false);
  });
});

describe('materialReferenceCount', () => {
  it('counts pipe references across links and telescope members, and cordage refs', () => {
    const doc = project();
    expect(materialReferenceCount(doc, 'PA')).toBe(2); // L1 + T1 outer
    expect(materialReferenceCount(doc, 'rope')).toBe(1);
    expect(materialReferenceCount(doc, 'PB')).toBe(0);
  });
});

describe('settings ops', () => {
  it('sets the generic pipe density and patches bomSettings', () => {
    let doc = setGenericPipeDensity(project(), 0.31);
    expect(doc.materials.genericPipeLinearDensityKgPerM).toBe(0.31);
    doc = updateBomSettings(doc, { ropeWasteFactor: 1.35 });
    expect(doc.bomSettings.ropeWasteFactor).toBe(1.35);
    expect(doc.bomSettings.heatWrapAllowanceFactor).toBe(1.5);
  });
});
