import { describe, expect, it } from 'vitest';
import { materialsDbSchema } from './materials';
import { createEmptyProject } from './project';
import { seedMaterialsDb } from './seedMaterials';

const IN_TO_M = 0.0254;

describe('seedMaterialsDb', () => {
  const db = seedMaterialsDb();

  it('is a valid materials DB', () => {
    expect(materialsDbSchema.parse(db)).toEqual(db);
  });

  it('marks every seeded row as approximate (§12)', () => {
    for (const row of [...db.pipes, ...db.fittings, ...db.cordage, ...db.sheets, ...db.hardware]) {
      expect(row.approximate).toBe(true);
    }
  });

  it('ships PVC Sch 40 NPS pipe in five nominal sizes', () => {
    const sch40 = db.pipes.filter((p) => p.sizingSystem === 'NPS' && p.name.includes('Sch 40'));
    expect(sch40.map((p) => p.nominalSize).sort()).toEqual(['1', '1-1/2', '1-1/4', '1/2', '3/4']);
  });

  it('ships PVC thin-wall alternates for 3/4" and 1"', () => {
    const thin = db.pipes.filter((p) => p.name.includes('Class 200'));
    expect(thin.map((p) => p.nominalSize).sort()).toEqual(['1', '3/4']);
    // thin-wall is lighter than Sch 40 at the same nominal size
    const sch40_075 = db.pipes.find((p) => p.id === 'pipe-nps-sch40-075')!;
    const thin075 = db.pipes.find((p) => p.id === 'pipe-nps-cls200-075')!;
    expect(thin075.linearDensityKgPerM).toBeLessThan(sch40_075.linearDensityKgPerM);
    // ...and has a larger bore (thinner wall) for the same OD
    expect(thin075.innerDiameterM).toBeGreaterThan(sch40_075.innerDiameterM);
    expect(thin075.outerDiameterM).toBeCloseTo(sch40_075.outerDiameterM, 6);
  });

  it('ships CPVC CTS pipe in three nominal sizes', () => {
    const cts = db.pipes.filter((p) => p.sizingSystem === 'CTS');
    expect(cts.map((p) => p.nominalSize).sort()).toEqual(['1', '1/2', '3/4']);
  });

  it('converts published inch dimensions to SI metres', () => {
    const p = db.pipes.find((x) => x.id === 'pipe-nps-sch40-075')!;
    expect(p.outerDiameterM).toBeCloseTo(1.05 * IN_TO_M, 9); // 0.02667 m
    expect(p.innerDiameterM).toBeCloseTo(0.824 * IN_TO_M, 9);
    expect(p.linearDensityKgPerM).toBeGreaterThan(0);
  });

  it('ships every fitting type for every NPS size, with socket depth + mass', () => {
    const types = ['elbow90', 'elbow45', 'tee', 'cross', 'coupling', 'cap'];
    const nps = db.fittings.filter((f) => f.sizingSystem === 'NPS');
    const sizes = [...new Set(nps.map((f) => f.nominalSize))];
    expect(sizes.length).toBe(5); // all five NPS sizes
    for (const size of sizes) {
      const forSize = nps.filter((f) => f.nominalSize === size);
      expect(forSize.map((f) => f.type).sort()).toEqual([...types].sort());
      for (const f of forSize) {
        expect(f.socketDepthM).toBeGreaterThan(0);
        expect(f.massKg).toBeGreaterThan(0);
      }
    }
  });

  it('ships CTS fittings too, per sizing system (§6.1: NPS ≠ CTS)', () => {
    const cts = db.fittings.filter((f) => f.sizingSystem === 'CTS');
    expect(new Set(cts.map((f) => f.nominalSize))).toEqual(new Set(['1/2', '3/4', '1']));
  });

  it('ships cordage: paracord, nylon rope, bungee presets, and a bowden cable', () => {
    const kinds = db.cordage.map((c) => c.kind);
    expect(kinds).toContain('rope');
    expect(kinds).toContain('elastic');
    expect(kinds).toContain('bowdenCable');
    const bungee = db.cordage.filter((c) => c.kind === 'elastic');
    expect(bungee.length).toBeGreaterThanOrEqual(1);
    for (const b of bungee) expect(b.defaultStiffnessNPerM).toBeGreaterThan(0);
  });

  it('ships EVA foam sheet and hardware point masses', () => {
    expect(db.sheets.length).toBeGreaterThanOrEqual(1);
    for (const s of db.sheets) expect(s.arealDensityKgPerM2).toBeGreaterThan(0);
    const hwIds = db.hardware.map((h) => h.id);
    expect(hwIds).toEqual(
      expect.arrayContaining(['hw-boltset', 'hw-conduitbox', 'hw-hosesleeve', 'hw-fiberglassrod']),
    );
  });

  it('keeps a plausible generic-pipe density and an empty price list', () => {
    expect(db.genericPipeLinearDensityKgPerM).toBe(0.25);
    expect(db.unitPrices).toEqual({});
  });

  it('provides a real slip-fit telescoping pair (CPVC CTS 3/4" inside PVC Class 200 3/4")', () => {
    const outer = db.pipes.find((p) => p.id === 'pipe-nps-cls200-075')!;
    const inner = db.pipes.find((p) => p.id === 'pipe-cts-cpvc-075')!;
    const clearanceM = outer.innerDiameterM - inner.outerDiameterM;
    expect(clearanceM * 1000).toBeGreaterThan(0.5); // slip band lower bound (mm)
    expect(clearanceM * 1000).toBeLessThanOrEqual(1.5); // slip band upper bound (mm)
  });
});

describe('createEmptyProject materials seeding (§6.1)', () => {
  it('seeds the full materials DB on creation rather than shipping empty', () => {
    const p = createEmptyProject('p', 'p');
    expect(p.materials.pipes.length).toBeGreaterThan(0);
    expect(p.materials.fittings.length).toBeGreaterThan(0);
    expect(p.materials).toEqual(seedMaterialsDb());
  });
});
