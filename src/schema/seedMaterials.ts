// Seed materials database (§6.1). EVERY row carries `approximate: true` —
// internal "not yet measured by the user" bookkeeping, cleared when a numeric
// field is edited (no UI badge; removed by decision, see DECISIONS.md). Pipe
// dimensions are actual published standard values (ASTM D1785 Sch 40, D2241
// SDR-21, D2846 CTS; weights from the same published tables / Cresline
// CNWPVC-21 catalog), though extruded stock still varies within tolerance,
// so calipered overrides remain worthwhile. Inch / lb-ft figures are
// converted to SI here — SI (metres, kg/m) is the only stored form (§3).
// Human-readable names are creature-agnostic and hardware-store-recognizable
// (§6.1). Pipe stock is deliberately limited to US-inch PVC and CPVC.
//
// createEmptyProject() seeds this on creation, which is how "user overrides
// persist in the project" is realized: each project owns its complete DB.
import type {
  CordageMaterial,
  FittingMaterial,
  FittingType,
  HardwareMaterial,
  MaterialsDb,
  PipeMaterial,
  PipeSizingSystem,
  SheetMaterial,
} from './materials';

const IN_TO_M = 0.0254;
const LBFT_TO_KGM = 1.4881639; // lb/ft → kg/m

function pipe(
  id: string,
  name: string,
  sizingSystem: PipeSizingSystem,
  nominalSize: string,
  odIn: number,
  idIn: number,
  lbPerFt: number,
): PipeMaterial {
  return {
    id,
    name,
    sizingSystem,
    nominalSize,
    outerDiameterM: odIn * IN_TO_M,
    innerDiameterM: idIn * IN_TO_M,
    linearDensityKgPerM: lbPerFt * LBFT_TO_KGM,
    approximate: true,
  };
}

// ── pipe stock ─────────────────────────────────────────────────────────────
// PVC Schedule 40 (ASTM D1785), NPS (iron-pipe) sizing: OD is standardized
// per size; ID = OD − 2·min-wall. OD/ID/lb-ft from the published D1785 table.
const NPS_SCH40: PipeMaterial[] = [
  pipe('pipe-nps-sch40-050', 'PVC Sch 40 1/2" (NPS)', 'NPS', '1/2', 0.84, 0.622, 0.16),
  pipe('pipe-nps-sch40-075', 'PVC Sch 40 3/4" (NPS)', 'NPS', '3/4', 1.05, 0.824, 0.21),
  pipe('pipe-nps-sch40-100', 'PVC Sch 40 1" (NPS)', 'NPS', '1', 1.315, 1.049, 0.32),
  pipe('pipe-nps-sch40-125', 'PVC Sch 40 1-1/4" (NPS)', 'NPS', '1-1/4', 1.66, 1.38, 0.43),
  pipe('pipe-nps-sch40-150', 'PVC Sch 40 1-1/2" (NPS)', 'NPS', '1-1/2', 1.9, 1.61, 0.51),
];

// PVC Class 200 (SDR 21, ASTM D2241), thin-wall lighter alternates — same NPS
// OD, thinner wall (larger bore), lighter per foot. Dimensions from the D2241
// SDR-21 column; lb/ft from the Cresline CNWPVC-21 catalog (12.11 and 16.17
// lb per 100 ft).
const NPS_CLASS200: PipeMaterial[] = [
  pipe('pipe-nps-cls200-075', 'PVC Class 200 3/4" (NPS)', 'NPS', '3/4', 1.05, 0.93, 0.121),
  pipe('pipe-nps-cls200-100', 'PVC Class 200 1" (NPS)', 'NPS', '1', 1.315, 1.189, 0.162),
];

// CPVC, CTS (copper-tube) sizing, SDR-11 (ASTM D2846) — a different schedule
// than NPS, which is what makes some PVC↔CPVC nesting combinations possible
// in the US (§6.1). ID = OD − 2·min-wall; lb/ft from the published D2846
// table.
const CTS_CPVC: PipeMaterial[] = [
  pipe('pipe-cts-cpvc-050', 'CPVC CTS 1/2"', 'CTS', '1/2', 0.625, 0.489, 0.085),
  pipe('pipe-cts-cpvc-075', 'CPVC CTS 3/4"', 'CTS', '3/4', 0.875, 0.715, 0.14),
  pipe('pipe-cts-cpvc-100', 'CPVC CTS 1"', 'CTS', '1', 1.125, 0.921, 0.218),
];

// ── fittings ─────────────────────────────────────────────────────────────
// Fittings are keyed structurally by type/size/sizing-system (no free-text
// name in the schema). unit mass (kg) at the 3/4" reference size; scaled below.
const FITTING_TYPES: FittingType[] = ['elbow90', 'elbow45', 'tee', 'cross', 'coupling', 'cap'];
const FITTING_BASE_MASS: Record<FittingType, number> = {
  elbow90: 0.05,
  elbow45: 0.045,
  tee: 0.062,
  cross: 0.095,
  coupling: 0.028,
  cap: 0.018,
};

interface FittingSize {
  nominalSize: string;
  socketDepthM: number; // socket make-in depth for cut-length allowance (§6.2)
  massScale: number; // relative to the 3/4" reference
}

const NPS_FITTING_SIZES: FittingSize[] = [
  { nominalSize: '1/2', socketDepthM: 0.0175, massScale: 0.6 },
  { nominalSize: '3/4', socketDepthM: 0.0183, massScale: 1.0 },
  { nominalSize: '1', socketDepthM: 0.0223, massScale: 1.7 },
  { nominalSize: '1-1/4', socketDepthM: 0.0238, massScale: 2.6 },
  { nominalSize: '1-1/2', socketDepthM: 0.0246, massScale: 3.4 },
];

const CTS_FITTING_SIZES: FittingSize[] = [
  { nominalSize: '1/2', socketDepthM: 0.014, massScale: 0.4 },
  { nominalSize: '3/4', socketDepthM: 0.017, massScale: 0.7 },
  { nominalSize: '1', socketDepthM: 0.02, massScale: 1.2 },
];

function fittingsFor(
  sizingSystem: PipeSizingSystem,
  idPrefix: string,
  sizes: FittingSize[],
): FittingMaterial[] {
  const out: FittingMaterial[] = [];
  for (const size of sizes) {
    const sizeToken = size.nominalSize.replace(/[^a-z0-9]/gi, '_');
    for (const type of FITTING_TYPES) {
      out.push({
        id: `fitting-${idPrefix}-${type}-${sizeToken}`,
        type,
        sizingSystem,
        nominalSize: size.nominalSize,
        massKg: FITTING_BASE_MASS[type] * size.massScale,
        socketDepthM: size.socketDepthM,
        approximate: true,
      });
    }
  }
  return out;
}

// ── cordage ─────────────────────────────────────────────────────────────
const CORDAGE: CordageMaterial[] = [
  {
    id: 'cord-paracord550',
    name: 'Paracord 550',
    kind: 'rope',
    linearDensityKgPerM: 0.0088,
    approximate: true,
  },
  {
    id: 'cord-nylon4mm',
    name: '4 mm nylon rope',
    kind: 'rope',
    linearDensityKgPerM: 0.011,
    approximate: true,
  },
  {
    id: 'cord-bungee6',
    name: '6 mm bungee / elastic',
    kind: 'elastic',
    linearDensityKgPerM: 0.02,
    defaultStiffnessNPerM: 300,
    approximate: true,
  },
  {
    id: 'cord-bungee8',
    name: '8 mm bungee / elastic',
    kind: 'elastic',
    linearDensityKgPerM: 0.034,
    defaultStiffnessNPerM: 520,
    approximate: true,
  },
  {
    id: 'cord-bowden',
    name: 'Bowden cable + housing',
    kind: 'bowdenCable',
    linearDensityKgPerM: 0.052,
    approximate: true,
  },
];

// ── sheet + hardware ─────────────────────────────────────────────────────
const SHEETS: SheetMaterial[] = [
  {
    id: 'sheet-eva10',
    name: 'EVA foam floor tile 10 mm',
    arealDensityKgPerM2: 0.9,
    approximate: true,
  },
  {
    id: 'sheet-eva12',
    name: 'EVA foam floor tile 12 mm',
    arealDensityKgPerM2: 1.1,
    approximate: true,
  },
];

// Hardware is a generic point mass (name + mass). Per-metre items (fiberglass
// rod) are represented as a 1 m reference entry — the schema carries only a
// lump mass, so BOM multiplies by installed count, not length (§6.1).
const HARDWARE: HardwareMaterial[] = [
  { id: 'hw-boltset', name: 'Bolt + nut set (M6)', massKg: 0.02, approximate: true },
  { id: 'hw-conduitbox', name: 'Electrical conduit box', massKg: 0.12, approximate: true },
  { id: 'hw-hosesleeve', name: 'Garden-hose joint sleeve', massKg: 0.05, approximate: true },
  { id: 'hw-fiberglassrod', name: 'Fiberglass rod 1/4" (per m)', massKg: 0.055, approximate: true },
];

/** The seeded materials database — approximate US stock values, every row
 * flagged `approximate` (§6.1, §12). */
export function seedMaterialsDb(): MaterialsDb {
  return {
    pipes: [...NPS_SCH40, ...NPS_CLASS200, ...CTS_CPVC],
    fittings: [
      ...fittingsFor('NPS', 'nps', NPS_FITTING_SIZES),
      ...fittingsFor('CTS', 'cts', CTS_FITTING_SIZES),
    ],
    cordage: CORDAGE,
    sheets: SHEETS,
    hardware: HARDWARE,
    genericPipeLinearDensityKgPerM: 0.25,
    unitPrices: {},
  };
}
