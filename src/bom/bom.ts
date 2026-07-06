// BOM computation (§6.2). Pure and framework-free, mirroring the solver's
// purity: input is the Project (plain schema data — its single compound
// mechanism, groups, materials DB and BOM settings), outputs are plain data.
// No UI, no engine types. All cut-list math is length-based on the 3D node
// positions and therefore transform-invariant: lifted/migrated geometry
// yields identical totals (PLANFILE-3d-conversion.md).
//
// Sign conventions for cut-length allowances (per end, §6.2):
//   fitting                              → −socket depth of the matching fitting
//   nestedSleeve/nestedCoupler/click…    → +overlap (2× this pipe's OD) [inner]
//   heatWrapPivot/heatWrapRigid          → +heatWrapAllowanceFactor × partner OD
//                                          AND a separate short connector part
//   boltThrough/ropeLashing/conduitBox   → 0
// See DECISIONS.md "Phase 3 — materials + BOM math" for the full rationale,
// the telescope member split, and the partial-BOM (unresolved) semantics.
//
// v7 rollup note: the former per-mechanism weight rollup becomes a per-GROUP
// rollup (groups are named element sets; an element in several groups counts
// in each — they are selection scopes, not a partition). Project-level point
// masses and foam plates are NOT in the BOM (same as the old assembly-level
// masses); the analysis module (src/analysis/) owns total rig mass and CG.
import { bendDihedralsRad, developedLengthM, polylineLengthM } from '../geometry/pipe';
import type {
  FittingMaterial,
  FittingType,
  JointRealization,
  Mechanism,
  MechanismElement,
  PipeMaterial,
  PipeSizingSystem,
  Project,
  Vec3,
} from '../schema';
import { validateTelescopePair } from './nesting';
import {
  DEFAULT_PIPE_STOCK_LENGTH_M,
  type ItemShoppingLine,
  type LengthShoppingLine,
  type PipeShoppingLine,
  packSticks,
  type ShoppingList,
} from './shopping';

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
  /** deflection at the vertex (angle between segments, plane-independent) */
  angleRad: number;
  /** bend-plane rotation relative to the previous bend, signed about the
   * shared segment's travel direction; first bend 0 (see geometry/pipe.ts
   * bendDihedralsRad convention note) — the "twist" column for the builder */
  dihedralRad: number;
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
  // Foam area is intentionally omitted here — foam plates are project-level
  // masses handled by the analysis module, not BOM parts. Noted in DECISIONS.md.
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
  /** keyed by group id; every project group appears (0 when massless).
   * Groups may overlap, so these do not sum to the grand total. */
  perGroupKg: Record<string, number>;
  /** group id → display name, so exports can label the rollup */
  groupNames: Record<string, string>;
  /** keyed by subsystem tag; the empty string '' collects untagged mass */
  perSubsystemTagKg: Record<string, number>;
}

export interface Cost {
  byMaterialId: Record<string, number>;
  /** undefined when nothing in the BOM is priced (cost column hidden, §6.2) */
  totalCost?: number;
}

export type BomWarningKind =
  | 'telescopeNestingIncompatible'
  | 'missingFitting'
  | 'cutLongerThanStock';

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
  /** what to buy, consolidated (PLANFILE-bom-shopping-list.md) */
  shoppingList: ShoppingList;
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

export function computeBom(project: Project): Bom {
  const mech = project.mechanism;
  const materials = project.materials;
  const bomSettings = project.bomSettings;

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

  // element id → ids of the groups containing it (groups may overlap)
  const groupsOfElement = new Map<string, string[]>();
  const perGroupKg: Record<string, number> = {};
  const groupNames: Record<string, string> = {};
  for (const g of project.groups) {
    perGroupKg[g.id] = 0;
    groupNames[g.id] = g.name;
    for (const elId of g.elementIds) {
      const list = groupsOfElement.get(elId) ?? [];
      list.push(g.id);
      groupsOfElement.set(elId, list);
    }
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

  /** Attribute mass to the element's groups (undefined elementId — e.g. a
   * node point mass — belongs to no group), its subsystem tag and category. */
  const addWeight = (
    massKg: number,
    elementId: string | undefined,
    tag: string,
    category: keyof WeightBreakdown,
  ): void => {
    if (massKg === 0) return;
    for (const gid of elementId ? (groupsOfElement.get(elementId) ?? []) : []) {
      perGroupKg[gid] = (perGroupKg[gid] ?? 0) + massKg;
    }
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
    tag: string,
    elementId: string,
  ): void => {
    const key = `${system}|${size}|${type}`;
    const acc = fittingAccum.get(key);
    if (acc) acc.quantity += 1;
    else fittingAccum.set(key, { type, sizingSystem: system, nominalSize: size, quantity: 1 });
    const f = fittingByKey.get(key);
    if (f) {
      addWeight(f.massKg, elementId, tag, 'fittingsKg');
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

  const posOf = new Map(mech.nodes.map((n) => [n.id, n.position]));
  const pointsOf = (ids: string[]): Vec3[] => ids.map((id) => posOf.get(id)!);

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
        countFitting('coupling', pm.sizingSystem, pm.nominalSize, tag, el.id);
        return socket === undefined ? 0 : -socket;
      }
      case 'nestedSleeve':
      case 'nestedCoupler':
      case 'clickDetachable':
        return NESTED_OVERLAP_OD_FACTOR * pm.outerDiameterM;
      case 'heatWrapPivot':
      case 'heatWrapRigid': {
        addCut(pm, 'heatWrapConnector', HEATWRAP_CONNECTOR_LENGTH_M);
        addWeight(HEATWRAP_CONNECTOR_LENGTH_M * pm.linearDensityKgPerM, el.id, tag, 'pipesKg');
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
          addAttachedPointMasses(el, tag, addWeight);
          break;
        }
        const geomLen = polylineLengthM(pointsOf([el.nodeA, el.nodeB]));
        addWeight(geomLen * pm.linearDensityKgPerM, el.id, tag, 'pipesKg');
        const net =
          geomLen +
          applyEnd(el, pm, el.endRealizationA, el.nodeA, tag) +
          applyEnd(el, pm, el.endRealizationB, el.nodeB, tag);
        addCut(pm, 'pipe', Math.max(0, net));
        addAttachedPointMasses(el, tag, addWeight);
        break;
      }
      case 'bentLink': {
        const vertices: BendScheduleVertex[] = [];
        const pts = pointsOf(el.nodeIds);
        const dihedrals = bendDihedralsRad(pts);
        for (let i = 1; i < el.nodeIds.length - 1; i++) {
          vertices.push({
            nodeId: el.nodeIds[i]!,
            angleRad: deflection(pts[i - 1]!, pts[i]!, pts[i + 1]!),
            dihedralRad: dihedrals[i - 1] ?? 0,
            radiusM: el.filletRadiiM[i - 1] ?? 0,
          });
        }
        technique.bends += vertices.length;
        const pm = el.pipeMaterialId ? pipeById.get(el.pipeMaterialId) : undefined;
        bendSchedule.push({ elementId: el.id, materialId: pm?.id, vertices });
        if (!pm) {
          unresolvedIds.push(el.id);
          addAttachedPointMasses(el, tag, addWeight);
          break;
        }
        const devLen = developedLengthM(pts, el.filletRadiiM);
        addWeight(devLen * pm.linearDensityKgPerM, el.id, tag, 'pipesKg');
        const first = el.nodeIds[0]!;
        const last = el.nodeIds[el.nodeIds.length - 1]!;
        const net =
          devLen +
          applyEnd(el, pm, el.endRealizationA, first, tag) +
          applyEnd(el, pm, el.endRealizationB, last, tag);
        addCut(pm, 'pipe', Math.max(0, net));
        addAttachedPointMasses(el, tag, addWeight);
        break;
      }
      case 'telescope': {
        technique.telescopes += 1;
        const om = el.outerPipeMaterialId ? pipeById.get(el.outerPipeMaterialId) : undefined;
        const im = el.innerPipeMaterialId ? pipeById.get(el.innerPipeMaterialId) : undefined;
        if (!om || !im) {
          unresolvedIds.push(el.id);
          addAttachedPointMasses(el, tag, addWeight);
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
        addWeight(outerCut * om.linearDensityKgPerM, el.id, tag, 'pipesKg');
        addWeight(innerCut * im.linearDensityKgPerM, el.id, tag, 'pipesKg');
        addAttachedPointMasses(el, tag, addWeight);
        break;
      }
      case 'pivot': {
        if (el.realization) {
          bumpTechnique(technique, el.realization);
          const hw = REALIZATION_HARDWARE[el.realization];
          if (hw) addHardware(hw, hardwareById, el.id, tag, addWeight, hardwareQtyByMaterial);
          if (el.realization === 'fitting') {
            const pm = pipeMaterialOfMembers(el.memberIds, mech, pipeById);
            if (pm) {
              countFitting(
                fittingTypeForPivot(el.memberIds.length),
                pm.sizingSystem,
                pm.nominalSize,
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
          if (hw) addHardware(hw, hardwareById, el.id, tag, addWeight, hardwareQtyByMaterial);
        }
        break;
      }
      case 'rope': {
        consumables.ropeRawM += el.lengthM;
        addCordage(el.cordageMaterialId, el.lengthM, cordageById, cordageLengthByMaterial, () =>
          addWeight(
            el.lengthM * (cordageById.get(el.cordageMaterialId ?? '')?.linearDensityKgPerM ?? 0),
            el.id,
            tag,
            'cordageKg',
          ),
        );
        break;
      }
      case 'elastic': {
        consumables.elasticTotalM += el.restLengthM;
        addCordage(el.cordageMaterialId, el.restLengthM, cordageById, cordageLengthByMaterial, () =>
          addWeight(
            el.restLengthM *
              (cordageById.get(el.cordageMaterialId ?? '')?.linearDensityKgPerM ?? 0),
            el.id,
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
            el.id,
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

  // node point masses always count (explicit, material-independent); they hang
  // on nodes, not elements, so they belong to no group.
  for (const pm of mech.pointMasses) {
    addWeight(pm.massKg, undefined, '', 'pointMassesKg');
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

  // ── shopping list (PLANFILE-bom-shopping-list.md): what to buy ──────────
  // Pipe cuts of every kind come from the same stock, so wrap connectors
  // pack into the same sticks as the main cuts.
  const cutsByMaterial = new Map<string, { material: PipeMaterial; lengths: number[] }>();
  for (const raw of cutRaw) {
    const acc = cutsByMaterial.get(raw.material.id) ?? { material: raw.material, lengths: [] };
    acc.lengths.push(raw.lengthM);
    cutsByMaterial.set(raw.material.id, acc);
  }
  const shoppingPipes: PipeShoppingLine[] = [...cutsByMaterial.values()]
    .map(({ material, lengths }) => {
      const packed = packSticks(lengths, DEFAULT_PIPE_STOCK_LENGTH_M);
      const totalCutM = lengths.reduce((a, b) => a + b, 0);
      for (const len of packed.oversizeCuts) {
        warnings.push({
          kind: 'cutLongerThanStock',
          message: `${material.name}: a ${len.toFixed(3)} m cut exceeds the ${DEFAULT_PIPE_STOCK_LENGTH_M} m stock length — plan a coupling or longer stock`,
        });
      }
      return {
        materialId: material.id,
        materialName: material.name,
        stockLengthM: DEFAULT_PIPE_STOCK_LENGTH_M,
        sticksToBuy: packed.sticks,
        cutCount: lengths.length,
        totalCutM,
        leftoverM: packed.sticks * DEFAULT_PIPE_STOCK_LENGTH_M - totalCutM,
        oversizeCuts: packed.oversizeCuts,
      };
    })
    .sort((a, b) => a.materialId.localeCompare(b.materialId));
  const shoppingFittings: ItemShoppingLine[] = fittings.map((f) => ({
    id: `${f.sizingSystem}|${f.nominalSize}|${f.type}`,
    label: `${f.nominalSize}" ${f.sizingSystem} ${f.type}`,
    quantity: f.quantity,
  }));
  const shoppingHardware: ItemShoppingLine[] = [...hardwareQtyByMaterial]
    .map(([id, quantity]) => ({
      id,
      label: hardwareById.get(id)?.name ?? id,
      quantity,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const shoppingCordage: LengthShoppingLine[] = [...cordageLengthByMaterial]
    .map(([id, lengthM]) => {
      const mat = cordageById.get(id);
      return {
        id,
        label: mat?.name ?? id,
        lengthM: mat?.kind === 'rope' ? lengthM * bomSettings.ropeWasteFactor : lengthM,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const shoppingList: ShoppingList = {
    pipes: shoppingPipes,
    fittings: shoppingFittings,
    hardware: shoppingHardware,
    cordage: shoppingCordage,
  };

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
    shoppingList,
    weights: { grandTotalKg, breakdown, perGroupKg, groupNames, perSubsystemTagKg },
    cost: { byMaterialId, totalCost },
    warnings,
    unresolved: { count: unresolvedIds.length, elementIds: [...unresolvedIds].sort() },
  };
}

// ── small helpers (module-local) ───────────────────────────────────────────
function deflection(prev: Vec3, vertex: Vec3, next: Vec3): number {
  const inx = vertex.x - prev.x;
  const iny = vertex.y - prev.y;
  const inz = vertex.z - prev.z;
  const outx = next.x - vertex.x;
  const outy = next.y - vertex.y;
  const outz = next.z - vertex.z;
  const li = Math.hypot(inx, iny, inz);
  const lo = Math.hypot(outx, outy, outz);
  if (li < 1e-12 || lo < 1e-12) return 0;
  const cos = (inx * outx + iny * outy + inz * outz) / (li * lo);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

function bumpTechnique(t: TechniqueSummary, r: JointRealization): void {
  t[r] += 1;
}

function addAttachedPointMasses(
  el: MechanismElement,
  tag: string,
  addWeight: (
    m: number,
    elementId: string | undefined,
    tag: string,
    cat: keyof WeightBreakdown,
  ) => void,
): void {
  if (el.type === 'link' || el.type === 'bentLink' || el.type === 'telescope') {
    for (const pm of el.pointMasses) addWeight(pm.massKg, el.id, tag, 'pointMassesKg');
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
  elementId: string,
  tag: string,
  addWeight: (
    m: number,
    elementId: string | undefined,
    tag: string,
    cat: keyof WeightBreakdown,
  ) => void,
  hardwareQtyByMaterial: Map<string, number>,
): void {
  const hw = hardwareById.get(hardwareId);
  if (!hw) return;
  addWeight(hw.massKg, elementId, tag, 'hardwareKg');
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
