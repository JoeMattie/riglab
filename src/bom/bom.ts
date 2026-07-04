// BOM computation (§6.2). Pure and framework-free, mirroring the solver's
// purity: inputs are Mechanism[] + MaterialsDb + BomSettings (plain schema
// data), outputs are plain data. No UI, no engine types.
//
// Sign conventions for cut-length allowances (per end, §6.2):
//   fitting                              → −socket depth of the matching fitting
//   nestedSleeve/nestedCoupler/click…    → +overlap (2× this pipe's OD) [inner]
//   heatWrapPivot/heatWrapRigid          → +heatWrapAllowanceFactor × partner OD
//                                          AND a separate short connector part
//   boltThrough/ropeLashing/conduitBox   → 0
// See DECISIONS.md "Phase 3 — materials + BOM math" for the full rationale,
// the telescope member split, and the partial-BOM (unresolved) semantics.
import { developedLengthM, polylineLengthM } from '../geometry/pipe';
import type {
  BomSettings,
  FittingMaterial,
  FittingType,
  JointRealization,
  MaterialsDb,
  Mechanism,
  MechanismElement,
  PipeMaterial,
  PipeSizingSystem,
  Vec2,
} from '../schema';
import { validateTelescopePair } from './nesting';

/** Default length of a heat-wrap connector piece (§1: wraps are fabricated as
 * separate short bent connectors). A fixed, editable-later reasonable default. */
export const HEATWRAP_CONNECTOR_LENGTH_M = 0.1;
/** A link-end nested realization consumes this many pipe ODs of overlap
 * (the schema carries no per-end overlap; telescopes carry overlapM). */
const NESTED_OVERLAP_OD_FACTOR = 2;
/** Cut lengths within this tolerance group into one quantity line (§6.2). */
const CUT_GROUP_TOL_M = 0.0005;
/** Realizations that install a hardware item, mapped to a seed hardware id. */
const REALIZATION_HARDWARE: Partial<Record<JointRealization, string>> = {
  conduitBox: 'hw-conduitbox',
  boltThrough: 'hw-boltset',
  clickDetachable: 'hw-boltset',
};

export type CutPartKind = 'pipe' | 'heatWrapConnector';

export interface CutListPart {
  materialId: string;
  materialName: string;
  sizingSystem: PipeSizingSystem;
  nominalSize: string;
  kind: CutPartKind;
  lengthM: number;
  quantity: number;
}

export interface BendScheduleVertex {
  nodeId: string;
  angleRad: number;
  radiusM: number;
}

export interface BendScheduleEntry {
  elementId: string;
  materialId?: string;
  vertices: BendScheduleVertex[];
}

export interface FittingCount {
  type: FittingType;
  sizingSystem: PipeSizingSystem;
  nominalSize: string;
  quantity: number;
  unitMassKg: number;
  totalMassKg: number;
  /** false ⇒ no matching fitting material in the DB (a warning is also raised) */
  resolved: boolean;
}

export interface TechniqueSummary {
  heatWrapPivot: number;
  heatWrapRigid: number;
  nestedSleeve: number;
  nestedCoupler: number;
  boltThrough: number;
  fitting: number;
  conduitBox: number;
  ropeLashing: number;
  clickDetachable: number;
  /** number of heat-bent vertices across all bentLinks */
  bends: number;
  telescopes: number;
}

export interface Consumables {
  ropeRawM: number;
  /** ropeRawM × bomSettings.ropeWasteFactor */
  ropeTotalM: number;
  elasticTotalM: number;
  bowdenTotalM: number;
  // Foam area is intentionally omitted here — it comes from assembly FoamPlates
  // (Phase 4), which the BOM does not see yet. Noted in DECISIONS.md.
}

export interface WeightBreakdown {
  pipesKg: number;
  fittingsKg: number;
  cordageKg: number;
  pointMassesKg: number;
  hardwareKg: number;
}

export interface WeightRollup {
  grandTotalKg: number;
  breakdown: WeightBreakdown;
  perMechanismKg: Record<string, number>;
  /** keyed by subsystem tag; the empty string '' collects untagged mass */
  perSubsystemTagKg: Record<string, number>;
}

export interface Cost {
  byMaterialId: Record<string, number>;
  /** undefined when nothing in the BOM is priced (cost column hidden, §6.2) */
  totalCost?: number;
}

export type BomWarningKind = 'telescopeNestingIncompatible' | 'missingFitting';

export interface BomWarning {
  kind: BomWarningKind;
  elementId?: string;
  message: string;
}

export interface UnresolvedReport {
  count: number;
  elementIds: string[];
}

export interface Bom {
  cutList: CutListPart[];
  bendSchedule: BendScheduleEntry[];
  fittings: FittingCount[];
  techniqueSummary: TechniqueSummary;
  consumables: Consumables;
  weights: WeightRollup;
  cost: Cost;
  warnings: BomWarning[];
  unresolved: UnresolvedReport;
}

const emptyTechnique = (): TechniqueSummary => ({
  heatWrapPivot: 0,
  heatWrapRigid: 0,
  nestedSleeve: 0,
  nestedCoupler: 0,
  boltThrough: 0,
  fitting: 0,
  conduitBox: 0,
  ropeLashing: 0,
  clickDetachable: 0,
  bends: 0,
  telescopes: 0,
});

/** Fitting type inferred for a 'fitting' realization by its context (§6.2 —
 * the schema records only that a fitting is used, not which one). */
function fittingTypeForPivot(memberCount: number): FittingType {
  if (memberCount <= 2) return 'elbow90';
  if (memberCount === 3) return 'tee';
  return 'cross';
}

export function computeBom(
  mechanisms: Mechanism[],
  materials: MaterialsDb,
  bomSettings: BomSettings,
): Bom {
  const pipeById = new Map(materials.pipes.map((p) => [p.id, p]));
  const hardwareById = new Map(materials.hardware.map((h) => [h.id, h]));
  const cordageById = new Map(materials.cordage.map((c) => [c.id, c]));
  const fittingByKey = new Map<string, FittingMaterial>();
  const fittingSocketBySize = new Map<string, number>();
  for (const f of materials.fittings) {
    fittingByKey.set(`${f.sizingSystem}|${f.nominalSize}|${f.type}`, f);
    const sizeKey = `${f.sizingSystem}|${f.nominalSize}`;
    if (!fittingSocketBySize.has(sizeKey)) fittingSocketBySize.set(sizeKey, f.socketDepthM);
  }

  // ── accumulators ─────────────────────────────────────────────────────
  const cutRaw: Array<{ material: PipeMaterial; kind: CutPartKind; lengthM: number }> = [];
  const bendSchedule: BendScheduleEntry[] = [];
  const technique = emptyTechnique();
  const fittingAccum = new Map<
    string,
    { type: FittingType; sizingSystem: PipeSizingSystem; nominalSize: string; quantity: number }
  >();
  const consumables: Consumables = {
    ropeRawM: 0,
    ropeTotalM: 0,
    elasticTotalM: 0,
    bowdenTotalM: 0,
  };
  const perMechanismKg: Record<string, number> = {};
  const perSubsystemTagKg: Record<string, number> = {};
  const breakdown: WeightBreakdown = {
    pipesKg: 0,
    fittingsKg: 0,
    cordageKg: 0,
    pointMassesKg: 0,
    hardwareKg: 0,
  };
  const pipeLengthByMaterial = new Map<string, number>();
  const cordageLengthByMaterial = new Map<string, number>();
  const fittingQtyByMaterial = new Map<string, number>();
  const hardwareQtyByMaterial = new Map<string, number>();
  const warnings: BomWarning[] = [];
  const missingFittingKeys = new Set<string>();
  const unresolvedIds: string[] = [];

  const addWeight = (
    massKg: number,
    mechId: string,
    tag: string,
    category: keyof WeightBreakdown,
  ): void => {
    if (massKg === 0) return;
    perMechanismKg[mechId] = (perMechanismKg[mechId] ?? 0) + massKg;
    perSubsystemTagKg[tag] = (perSubsystemTagKg[tag] ?? 0) + massKg;
    breakdown[category] += massKg;
  };

  const addCut = (material: PipeMaterial, kind: CutPartKind, lengthM: number): void => {
    cutRaw.push({ material, kind, lengthM });
    if (kind === 'pipe' || kind === 'heatWrapConnector') {
      pipeLengthByMaterial.set(material.id, (pipeLengthByMaterial.get(material.id) ?? 0) + lengthM);
    }
  };

  const countFitting = (
    type: FittingType,
    system: PipeSizingSystem,
    size: string,
    mechId: string,
    tag: string,
    elementId: string,
  ): void => {
    const key = `${system}|${size}|${type}`;
    const acc = fittingAccum.get(key);
    if (acc) acc.quantity += 1;
    else fittingAccum.set(key, { type, sizingSystem: system, nominalSize: size, quantity: 1 });
    const f = fittingByKey.get(key);
    if (f) {
      addWeight(f.massKg, mechId, tag, 'fittingsKg');
      fittingQtyByMaterial.set(f.id, (fittingQtyByMaterial.get(f.id) ?? 0) + 1);
    } else if (!missingFittingKeys.has(key)) {
      missingFittingKeys.add(key);
      warnings.push({
        kind: 'missingFitting',
        elementId,
        message: `no ${system} ${size}" ${type} fitting in the materials DB`,
      });
    }
  };

  for (const mech of mechanisms) {
    const posOf = new Map(mech.nodes.map((n) => [n.id, n.position]));
    const pointsOf = (ids: string[]): Vec2[] => ids.map((id) => posOf.get(id)!);

    // node → structural elements with a resolved pipe OD present at that node
    const odAtNode = new Map<string, Array<{ elementId: string; odM: number }>>();
    const noteOd = (nodeId: string, elementId: string, odM: number): void => {
      const list = odAtNode.get(nodeId) ?? [];
      list.push({ elementId, odM });
      odAtNode.set(nodeId, list);
    };
    for (const el of mech.elements) {
      if (el.type === 'link') {
        const pm = el.pipeMaterialId ? pipeById.get(el.pipeMaterialId) : undefined;
        if (pm) {
          noteOd(el.nodeA, el.id, pm.outerDiameterM);
          noteOd(el.nodeB, el.id, pm.outerDiameterM);
        }
      } else if (el.type === 'bentLink') {
        const pm = el.pipeMaterialId ? pipeById.get(el.pipeMaterialId) : undefined;
        if (pm) {
          noteOd(el.nodeIds[0]!, el.id, pm.outerDiameterM);
          noteOd(el.nodeIds[el.nodeIds.length - 1]!, el.id, pm.outerDiameterM);
        }
      } else if (el.type === 'telescope') {
        const om = el.outerPipeMaterialId ? pipeById.get(el.outerPipeMaterialId) : undefined;
        if (om) {
          noteOd(el.nodeA, el.id, om.outerDiameterM);
          noteOd(el.nodeB, el.id, om.outerDiameterM);
        }
      }
    }
    const partnerOdM = (nodeId: string, selfElId: string, ownOdM: number): number => {
      const list = (odAtNode.get(nodeId) ?? [])
        .filter((e) => e.elementId !== selfElId)
        .sort((a, b) => a.elementId.localeCompare(b.elementId));
      return list[0]?.odM ?? ownOdM;
    };

    // process a link/bentLink end: apply the realization allowance to `net`,
    // emit connector parts, count fittings; returns the signed length delta.
    const applyEnd = (
      el: MechanismElement & { subsystemTag?: string },
      pm: PipeMaterial,
      realization: JointRealization | undefined,
      nodeId: string,
      tag: string,
    ): number => {
      if (realization) bumpTechnique(technique, realization);
      switch (realization) {
        case 'fitting': {
          const socket = fittingSocketBySize.get(`${pm.sizingSystem}|${pm.nominalSize}`);
          countFitting('coupling', pm.sizingSystem, pm.nominalSize, mech.id, tag, el.id);
          return socket === undefined ? 0 : -socket;
        }
        case 'nestedSleeve':
        case 'nestedCoupler':
        case 'clickDetachable':
          return NESTED_OVERLAP_OD_FACTOR * pm.outerDiameterM;
        case 'heatWrapPivot':
        case 'heatWrapRigid': {
          addCut(pm, 'heatWrapConnector', HEATWRAP_CONNECTOR_LENGTH_M);
          addWeight(HEATWRAP_CONNECTOR_LENGTH_M * pm.linearDensityKgPerM, mech.id, tag, 'pipesKg');
          return bomSettings.heatWrapAllowanceFactor * partnerOdM(nodeId, el.id, pm.outerDiameterM);
        }
        default:
          return 0;
      }
    };

    for (const el of mech.elements) {
      const tag = el.subsystemTag ?? '';
      switch (el.type) {
        case 'link': {
          const pm = el.pipeMaterialId ? pipeById.get(el.pipeMaterialId) : undefined;
          if (!pm) {
            unresolvedIds.push(el.id);
            addAttachedPointMasses(el, mech.id, tag, addWeight);
            break;
          }
          const geomLen = polylineLengthM(pointsOf([el.nodeA, el.nodeB]));
          addWeight(geomLen * pm.linearDensityKgPerM, mech.id, tag, 'pipesKg');
          const net =
            geomLen +
            applyEnd(el, pm, el.endRealizationA, el.nodeA, tag) +
            applyEnd(el, pm, el.endRealizationB, el.nodeB, tag);
          addCut(pm, 'pipe', Math.max(0, net));
          addAttachedPointMasses(el, mech.id, tag, addWeight);
          break;
        }
        case 'bentLink': {
          const vertices: BendScheduleVertex[] = [];
          const pts = pointsOf(el.nodeIds);
          for (let i = 1; i < el.nodeIds.length - 1; i++) {
            vertices.push({
              nodeId: el.nodeIds[i]!,
              angleRad: deflection(pts[i - 1]!, pts[i]!, pts[i + 1]!),
              radiusM: el.filletRadiiM[i - 1] ?? 0,
            });
          }
          technique.bends += vertices.length;
          const pm = el.pipeMaterialId ? pipeById.get(el.pipeMaterialId) : undefined;
          bendSchedule.push({ elementId: el.id, materialId: pm?.id, vertices });
          if (!pm) {
            unresolvedIds.push(el.id);
            addAttachedPointMasses(el, mech.id, tag, addWeight);
            break;
          }
          const devLen = developedLengthM(pts, el.filletRadiiM);
          addWeight(devLen * pm.linearDensityKgPerM, mech.id, tag, 'pipesKg');
          const first = el.nodeIds[0]!;
          const last = el.nodeIds[el.nodeIds.length - 1]!;
          const net =
            devLen +
            applyEnd(el, pm, el.endRealizationA, first, tag) +
            applyEnd(el, pm, el.endRealizationB, last, tag);
          addCut(pm, 'pipe', Math.max(0, net));
          addAttachedPointMasses(el, mech.id, tag, addWeight);
          break;
        }
        case 'telescope': {
          technique.telescopes += 1;
          const om = el.outerPipeMaterialId ? pipeById.get(el.outerPipeMaterialId) : undefined;
          const im = el.innerPipeMaterialId ? pipeById.get(el.innerPipeMaterialId) : undefined;
          if (!om || !im) {
            unresolvedIds.push(el.id);
            addAttachedPointMasses(el, mech.id, tag, addWeight);
            break;
          }
          const fit = validateTelescopePair(om, im);
          if (!fit.acceptable) {
            warnings.push({
              kind: 'telescopeNestingIncompatible',
              elementId: el.id,
              message: `telescope ${el.id}: ${fit.classification} fit — ${fit.reason ?? 'not a slip fit'}`,
            });
          }
          const ov = el.overlapM ?? NESTED_OVERLAP_OD_FACTOR * im.outerDiameterM;
          const outerCut = el.lengthM / 2;
          const innerCut = el.lengthM / 2 + ov; // overlap on the inner member
          addCut(om, 'pipe', outerCut);
          addCut(im, 'pipe', innerCut);
          addWeight(outerCut * om.linearDensityKgPerM, mech.id, tag, 'pipesKg');
          addWeight(innerCut * im.linearDensityKgPerM, mech.id, tag, 'pipesKg');
          addAttachedPointMasses(el, mech.id, tag, addWeight);
          break;
        }
        case 'pivot': {
          if (el.realization) {
            bumpTechnique(technique, el.realization);
            const hw = REALIZATION_HARDWARE[el.realization];
            if (hw) addHardware(hw, hardwareById, mech.id, tag, addWeight, hardwareQtyByMaterial);
            if (el.realization === 'fitting') {
              const pm = pipeMaterialOfMembers(el.memberIds, mech, pipeById);
              if (pm) {
                countFitting(
                  fittingTypeForPivot(el.memberIds.length),
                  pm.sizingSystem,
                  pm.nominalSize,
                  mech.id,
                  tag,
                  el.id,
                );
              }
            }
          }
          break;
        }
        case 'slider': {
          if (el.realization) {
            bumpTechnique(technique, el.realization);
            const hw = REALIZATION_HARDWARE[el.realization];
            if (hw) addHardware(hw, hardwareById, mech.id, tag, addWeight, hardwareQtyByMaterial);
          }
          break;
        }
        case 'rope': {
          consumables.ropeRawM += el.lengthM;
          addCordage(el.cordageMaterialId, el.lengthM, cordageById, cordageLengthByMaterial, () =>
            addWeight(
              el.lengthM * (cordageById.get(el.cordageMaterialId ?? '')?.linearDensityKgPerM ?? 0),
              mech.id,
              tag,
              'cordageKg',
            ),
          );
          break;
        }
        case 'elastic': {
          consumables.elasticTotalM += el.restLengthM;
          addCordage(
            el.cordageMaterialId,
            el.restLengthM,
            cordageById,
            cordageLengthByMaterial,
            () =>
              addWeight(
                el.restLengthM *
                  (cordageById.get(el.cordageMaterialId ?? '')?.linearDensityKgPerM ?? 0),
                mech.id,
                tag,
                'cordageKg',
              ),
          );
          break;
        }
        case 'bowden': {
          const len = el.restLengthAM + el.restLengthBM;
          consumables.bowdenTotalM += len;
          addCordage(el.cordageMaterialId, len, cordageById, cordageLengthByMaterial, () =>
            addWeight(
              len * (cordageById.get(el.cordageMaterialId ?? '')?.linearDensityKgPerM ?? 0),
              mech.id,
              tag,
              'cordageKg',
            ),
          );
          break;
        }
        case 'torsionCable':
          // routing-independent angle coupling: no cut/consumable/mass in v1
          break;
      }
    }

    // node point masses always count (explicit, material-independent)
    for (const pm of mech.pointMasses) {
      addWeight(pm.massKg, mech.id, '', 'pointMassesKg');
    }
  }

  consumables.ropeTotalM = consumables.ropeRawM * bomSettings.ropeWasteFactor;

  // ── cut-list grouping (same material + kind + length within 0.5 mm) ─────
  const grouped = new Map<string, CutListPart>();
  for (const raw of cutRaw) {
    const bucket = Math.round(raw.lengthM / CUT_GROUP_TOL_M);
    const key = `${raw.material.id}|${raw.kind}|${bucket}`;
    const existing = grouped.get(key);
    if (existing) existing.quantity += 1;
    else {
      grouped.set(key, {
        materialId: raw.material.id,
        materialName: raw.material.name,
        sizingSystem: raw.material.sizingSystem,
        nominalSize: raw.material.nominalSize,
        kind: raw.kind,
        lengthM: raw.lengthM,
        quantity: 1,
      });
    }
  }
  const cutList = [...grouped.values()].sort(
    (a, b) =>
      a.materialId.localeCompare(b.materialId) ||
      a.kind.localeCompare(b.kind) ||
      a.lengthM - b.lengthM,
  );

  // ── fittings report ────────────────────────────────────────────────────
  const fittings: FittingCount[] = [...fittingAccum.values()]
    .map((f) => {
      const mat = fittingByKey.get(`${f.sizingSystem}|${f.nominalSize}|${f.type}`);
      const unitMassKg = mat?.massKg ?? 0;
      return {
        ...f,
        unitMassKg,
        totalMassKg: unitMassKg * f.quantity,
        resolved: mat !== undefined,
      };
    })
    .sort(
      (a, b) =>
        a.sizingSystem.localeCompare(b.sizingSystem) ||
        a.nominalSize.localeCompare(b.nominalSize) ||
        a.type.localeCompare(b.type),
    );

  // ── cost (§6.2): only materials with a unit price contribute ────────────
  const byMaterialId: Record<string, number> = {};
  let anyPriced = false;
  const addCost = (materialId: string, quantity: number): void => {
    const price = materials.unitPrices[materialId];
    if (price === undefined) return;
    anyPriced = true;
    byMaterialId[materialId] = (byMaterialId[materialId] ?? 0) + price * quantity;
  };
  for (const [id, len] of pipeLengthByMaterial) addCost(id, len);
  for (const [id, len] of cordageLengthByMaterial) addCost(id, len);
  for (const [id, qty] of fittingQtyByMaterial) addCost(id, qty);
  for (const [id, qty] of hardwareQtyByMaterial) addCost(id, qty);
  const totalCost = anyPriced ? Object.values(byMaterialId).reduce((a, b) => a + b, 0) : undefined;

  const grandTotalKg =
    breakdown.pipesKg +
    breakdown.fittingsKg +
    breakdown.cordageKg +
    breakdown.pointMassesKg +
    breakdown.hardwareKg;

  return {
    cutList,
    bendSchedule,
    fittings,
    techniqueSummary: technique,
    consumables,
    weights: { grandTotalKg, breakdown, perMechanismKg, perSubsystemTagKg },
    cost: { byMaterialId, totalCost },
    warnings,
    unresolved: { count: unresolvedIds.length, elementIds: [...unresolvedIds].sort() },
  };
}

// ── small helpers (module-local) ───────────────────────────────────────────
function deflection(prev: Vec2, vertex: Vec2, next: Vec2): number {
  const inx = vertex.x - prev.x;
  const iny = vertex.y - prev.y;
  const outx = next.x - vertex.x;
  const outy = next.y - vertex.y;
  const li = Math.hypot(inx, iny);
  const lo = Math.hypot(outx, outy);
  if (li < 1e-12 || lo < 1e-12) return 0;
  const cos = (inx * outx + iny * outy) / (li * lo);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

function bumpTechnique(t: TechniqueSummary, r: JointRealization): void {
  t[r] += 1;
}

function addAttachedPointMasses(
  el: MechanismElement,
  mechId: string,
  tag: string,
  addWeight: (m: number, mech: string, tag: string, cat: keyof WeightBreakdown) => void,
): void {
  if (el.type === 'link' || el.type === 'bentLink' || el.type === 'telescope') {
    for (const pm of el.pointMasses) addWeight(pm.massKg, mechId, tag, 'pointMassesKg');
  }
}

function pipeMaterialOfMembers(
  memberIds: string[],
  mech: Mechanism,
  pipeById: Map<string, PipeMaterial>,
): PipeMaterial | undefined {
  for (const id of [...memberIds].sort((a, b) => a.localeCompare(b))) {
    const el = mech.elements.find((e) => e.id === id);
    if (!el) continue;
    if (el.type === 'link' || el.type === 'bentLink') {
      const pm = el.pipeMaterialId ? pipeById.get(el.pipeMaterialId) : undefined;
      if (pm) return pm;
    } else if (el.type === 'telescope') {
      const pm = el.outerPipeMaterialId ? pipeById.get(el.outerPipeMaterialId) : undefined;
      if (pm) return pm;
    }
  }
  return undefined;
}

function addHardware(
  hardwareId: string,
  hardwareById: Map<string, { massKg: number }>,
  mechId: string,
  tag: string,
  addWeight: (m: number, mech: string, tag: string, cat: keyof WeightBreakdown) => void,
  hardwareQtyByMaterial: Map<string, number>,
): void {
  const hw = hardwareById.get(hardwareId);
  if (!hw) return;
  addWeight(hw.massKg, mechId, tag, 'hardwareKg');
  hardwareQtyByMaterial.set(hardwareId, (hardwareQtyByMaterial.get(hardwareId) ?? 0) + 1);
}

function addCordage(
  cordageId: string | undefined,
  lengthM: number,
  cordageById: Map<string, { linearDensityKgPerM: number }>,
  cordageLengthByMaterial: Map<string, number>,
  addMass: () => void,
): void {
  if (!cordageId || !cordageById.has(cordageId)) return;
  cordageLengthByMaterial.set(cordageId, (cordageLengthByMaterial.get(cordageId) ?? 0) + lengthM);
  addMass();
}
