// Per-element and per-mechanism resolution computation (§8.2, §8.2a): the
// pure, framework-free source of "what remains unresolved" shared by the info
// panel (this slice) and the docked resolution checklist (next slice).
//
// Item taxonomy (see DECISIONS.md "Phase 3 — design face UI"):
//   missingMaterial               link/bentLink without a pipe material;
//                                 telescope missing outer/inner (one item each)
//   missingRealization            explicit pivot/slider without a realization
//                                 (link END realizations are optional — a butt
//                                 cut is valid — and implicit shared-node
//                                 pivots carry no realization slot, matching
//                                 computeBom)
//   telescopeNestingIncompatible  both members assigned but not a slip fit
//   ropeRequiresCompression       from solve diagnostics, when available
//   overconstrained               diagnostics classification warning
//   unboundChannel                input channel with no driven node bound
//
// Severity: 'todo' = an assignment the user must make (counts toward the
// progress indicator); 'warning' = a computed problem with the current
// assignments/geometry (no slot, but still blocks "buildable" — the checklist
// reaching zero means buildable, §8.2).
import { validateTelescopePair } from '../bom';
import type { MaterialsDb, Maturity, Mechanism, MechanismElement } from '../schema';
import type { SolveDiagnostics } from '../solver';

export type ResolutionKind =
  | 'missingMaterial'
  | 'missingRealization'
  | 'telescopeNestingIncompatible'
  | 'ropeRequiresCompression'
  | 'overconstrained'
  | 'unboundChannel';

export interface ResolutionItem {
  /** stable unique id (kind-scoped), usable as a React key and for
   * click-to-fix routing in the checklist panel */
  id: string;
  kind: ResolutionKind;
  elementId?: string;
  channelId?: string;
  label: string;
  severity: 'todo' | 'warning';
}

export interface ResolutionProgress {
  /** assignment slots satisfied (materials, realizations, channel bindings) */
  resolved: number;
  /** total assignment slots in the mechanism */
  total: number;
}

export interface MechanismResolution {
  items: ResolutionItem[];
  progress: ResolutionProgress;
}

/** Short human name for an element type, for labels. */
export function elementTypeLabel(type: MechanismElement['type']): string {
  switch (type) {
    case 'bentLink':
      return 'bent pipe';
    case 'torsionCable':
      return 'torsion cable';
    default:
      return type;
  }
}

/** Unresolved items for one element. `diagnostics` (when available) supplies
 * the rope-compression flags; everything else is derived from the document. */
export function elementResolutionItems(
  el: MechanismElement,
  _mechanism: Mechanism,
  materials: MaterialsDb,
  diagnostics?: SolveDiagnostics,
): ResolutionItem[] {
  const items: ResolutionItem[] = [];
  const name = elementTypeLabel(el.type);

  switch (el.type) {
    case 'link':
    case 'bentLink': {
      if (!el.pipeMaterialId) {
        items.push({
          id: `material:${el.id}`,
          kind: 'missingMaterial',
          elementId: el.id,
          label: `${name} needs a pipe material`,
          severity: 'todo',
        });
      }
      break;
    }
    case 'telescope': {
      if (!el.outerPipeMaterialId) {
        items.push({
          id: `material-outer:${el.id}`,
          kind: 'missingMaterial',
          elementId: el.id,
          label: 'telescope needs an outer pipe material',
          severity: 'todo',
        });
      }
      if (!el.innerPipeMaterialId) {
        items.push({
          id: `material-inner:${el.id}`,
          kind: 'missingMaterial',
          elementId: el.id,
          label: 'telescope needs an inner pipe material',
          severity: 'todo',
        });
      }
      const outer = materials.pipes.find((p) => p.id === el.outerPipeMaterialId);
      const inner = materials.pipes.find((p) => p.id === el.innerPipeMaterialId);
      if (outer && inner) {
        const fit = validateTelescopePair(outer, inner);
        if (!fit.acceptable) {
          items.push({
            id: `nesting:${el.id}`,
            kind: 'telescopeNestingIncompatible',
            elementId: el.id,
            label: `telescope pair is a ${fit.classification} fit — ${fit.reason ?? 'not a slip fit'}`,
            severity: 'warning',
          });
        }
      }
      break;
    }
    case 'pivot':
    case 'slider': {
      if (!el.realization) {
        items.push({
          id: `realization:${el.id}`,
          kind: 'missingRealization',
          elementId: el.id,
          label: `${name} needs a physical realization`,
          severity: 'todo',
        });
      }
      break;
    }
    case 'rope': {
      if (diagnostics?.ropesRequiringCompression.includes(el.id)) {
        items.push({
          id: `compression:${el.id}`,
          kind: 'ropeRequiresCompression',
          elementId: el.id,
          label: 'rope would need to push — reroute or replace with a rigid member',
          severity: 'warning',
        });
      }
      break;
    }
    default:
      break;
  }
  return items;
}

/** Number of assignment slots an element contributes to the progress count. */
function slotCount(el: MechanismElement): number {
  switch (el.type) {
    case 'link':
    case 'bentLink':
      return 1; // pipe material
    case 'telescope':
      return 2; // outer + inner materials
    case 'pivot':
    case 'slider':
      return 1; // realization
    default:
      return 0; // cordage assignment is optional refinement, not a slot (§8.2)
  }
}

/** All unresolved items for a mechanism plus the "K of N resolved" progress.
 * Pass the latest solve diagnostics when available to include the
 * rope-compression and constraint-classification warnings. */
export function mechanismResolution(
  mechanism: Mechanism,
  materials: MaterialsDb,
  diagnostics?: SolveDiagnostics,
): MechanismResolution {
  const items: ResolutionItem[] = [];
  let total = 0;
  let openTodos = 0;

  for (const el of mechanism.elements) {
    const elItems = elementResolutionItems(el, mechanism, materials, diagnostics);
    items.push(...elItems);
    total += slotCount(el);
    openTodos += elItems.filter((i) => i.severity === 'todo').length;
  }

  // input channels with no driven node bound to them (§8.2)
  const boundChannelIds = new Set(
    mechanism.nodes.filter((n) => n.kind === 'driven' && n.channelId).map((n) => n.channelId),
  );
  for (const ch of mechanism.inputs) {
    total += 1;
    if (!boundChannelIds.has(ch.id)) {
      openTodos += 1;
      items.push({
        id: `channel:${ch.id}`,
        kind: 'unboundChannel',
        channelId: ch.id,
        label: `input channel "${ch.name}" drives nothing — bind it to a driven node`,
        severity: 'todo',
      });
    }
  }

  if (diagnostics?.classification === 'overconstrained') {
    items.push({
      id: 'overconstrained',
      kind: 'overconstrained',
      label: `mechanism is overconstrained (DOF ${diagnostics.dof}) — remove a constraint or free a node`,
      severity: 'warning',
    });
  }

  return { items, progress: { resolved: total - openTodos, total } };
}

/** Maturity derived from assignments (§4.2): links/bentLinks are engineered
 * once a pipe material is assigned; telescopes need both members; pivots and
 * sliders need a realization; cordage elements need a cordage material.
 * Symmetric — unassigning drops the element back to sketch. Applied by the
 * assignment docOps, so maturity always agrees with the data. */
export function derivedMaturity(el: MechanismElement): Maturity {
  switch (el.type) {
    case 'link':
    case 'bentLink':
      return el.pipeMaterialId ? 'engineered' : 'sketch';
    case 'telescope':
      return el.outerPipeMaterialId && el.innerPipeMaterialId ? 'engineered' : 'sketch';
    case 'pivot':
    case 'slider':
      return el.realization ? 'engineered' : 'sketch';
    case 'rope':
    case 'elastic':
    case 'bowden':
    case 'torsionCable':
      return el.cordageMaterialId ? 'engineered' : 'sketch';
  }
}
