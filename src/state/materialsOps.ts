// Pure document transforms for the editable materials DB (§6.1). Same
// contract as docOps.ts: all editing flows through these via
// appStore.updateCurrent, one call = one undo entry.
//
// Approximate-flag rule (§12): seed rows carry `approximate: true` ("verify
// against purchased stock"). Editing any NUMERIC field is taken as the user
// entering a measured value, so it clears the flag; renames and other
// non-numeric edits keep it.
import type { BomSettings, MaterialsDb, Project } from '../schema';

export type MaterialCategory = 'pipes' | 'fittings' | 'cordage' | 'sheets' | 'hardware';
type RowOf<C extends MaterialCategory> = MaterialsDb[C][number];

const uid = (): string => crypto.randomUUID();

function withMaterials(doc: Project, fn: (db: MaterialsDb) => MaterialsDb): Project {
  return { ...doc, materials: fn(doc.materials) };
}

export function updateMaterialRow<C extends MaterialCategory>(
  doc: Project,
  category: C,
  rowId: string,
  patch: Partial<RowOf<C>>,
): Project {
  const measured = Object.values(patch).some((v) => typeof v === 'number');
  return withMaterials(doc, (db) => ({
    ...db,
    [category]: db[category].map((row) =>
      row.id === rowId ? { ...row, ...patch, ...(measured ? { approximate: false } : {}) } : row,
    ),
  }));
}

/** Plausible-but-flagged defaults so a fresh row validates and is obviously
 * placeholder ("new …", approximate). */
function defaultRow(category: MaterialCategory, id: string): RowOf<MaterialCategory> {
  switch (category) {
    case 'pipes':
      return {
        id,
        name: 'new pipe',
        sizingSystem: 'NPS',
        nominalSize: '3/4',
        outerDiameterM: 0.0267,
        innerDiameterM: 0.0205,
        linearDensityKgPerM: 0.33,
        approximate: true,
      };
    case 'fittings':
      return {
        id,
        type: 'coupling',
        sizingSystem: 'NPS',
        nominalSize: '3/4',
        massKg: 0.05,
        socketDepthM: 0.02,
        approximate: true,
      };
    case 'cordage':
      return {
        id,
        name: 'new cordage',
        kind: 'rope',
        linearDensityKgPerM: 0.01,
        approximate: true,
      };
    case 'sheets':
      return { id, name: 'new sheet', arealDensityKgPerM2: 1.0, approximate: true };
    case 'hardware':
      return { id, name: 'new hardware', massKg: 0.05, approximate: true };
  }
}

export function addMaterialRow(
  doc: Project,
  category: MaterialCategory,
): { doc: Project; rowId: string } {
  const rowId = uid();
  const row = defaultRow(category, rowId);
  return {
    rowId,
    doc: withMaterials(doc, (db) => ({
      ...db,
      [category]: [...db[category], row],
    })),
  };
}

/** Unconditional delete — the UI disables it while materialReferenceCount
 * is non-zero, so a dangling reference cannot be produced through the panel. */
export function deleteMaterialRow(
  doc: Project,
  category: MaterialCategory,
  rowId: string,
): Project {
  return withMaterials(doc, (db) => ({
    ...db,
    [category]: db[category].filter((row: { id: string }) => row.id !== rowId),
  }));
}

/** How many elements across all mechanisms reference this material id. */
export function materialReferenceCount(doc: Project, materialId: string): number {
  let n = 0;
  for (const m of doc.mechanisms) {
    for (const el of m.elements) {
      switch (el.type) {
        case 'link':
        case 'bentLink':
          if (el.pipeMaterialId === materialId) n++;
          break;
        case 'telescope':
          if (el.outerPipeMaterialId === materialId) n++;
          if (el.innerPipeMaterialId === materialId) n++;
          break;
        case 'rope':
        case 'elastic':
        case 'bowden':
        case 'torsionCable':
          if (el.cordageMaterialId === materialId) n++;
          break;
        default:
          break;
      }
    }
  }
  return n;
}

export function setGenericPipeDensity(doc: Project, kgPerM: number): Project {
  return withMaterials(doc, (db) => ({ ...db, genericPipeLinearDensityKgPerM: kgPerM }));
}

export function updateBomSettings(doc: Project, patch: Partial<BomSettings>): Project {
  return { ...doc, bomSettings: { ...doc.bomSettings, ...patch } };
}
