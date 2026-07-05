// Parts-minimizing auto-resolver (feature planfile PLANFILE-marquee-autoresolve.md).
// Proposes pipe materials and joint/end realizations for unresolved slots,
// preferring realizations with zero purchased hardware: a nested slip fit
// beats heat-wrap beats bolt-through beats a fitting. Pure and deterministic —
// same document in, same proposal out; the UI previews `changes` and applies
// them through docOps in one undo step.
//
// Ground rules (agreed 2026-07-04, recorded in DECISIONS.md):
//   - fills unassigned slots; `resolveAssigned` opts into changing existing
//     assignments (resizing a member to unlock a slip fit, upgrading a
//     purchased-hardware realization to a nested one)
//   - size palette prefers pipes already used in the project (fewest distinct
//     sizes to buy), falling back to the full materials DB only when a
//     nesting-compatible partner is needed
//   - greedy single pass, no backtracking; a pair chosen for a fit is locked
//     for the rest of the run so later choices cannot break it
//   - no structural/strength reasoning — geometry-of-parts only
import { classifyNesting, nestingClearanceM } from '../bom';
import type {
  JointRealization,
  MechanismElement,
  PipeMaterial,
  PivotElement,
  Project,
  SliderElement,
} from '../schema';

export interface AutoResolveOptions {
  /** restrict proposals to these elements (selection scope); default all */
  elementIds?: string[];
  /** may change existing assignments when that eliminates purchased parts */
  resolveAssigned?: boolean;
}

export type ProposalSlot =
  | 'pipeMaterial'
  | 'outerPipeMaterial'
  | 'innerPipeMaterial'
  | 'realization'
  | 'endRealizationA'
  | 'endRealizationB';

export interface ProposedChange {
  elementId: string;
  slot: ProposalSlot;
  /** current value when replacing an assignment (resolveAssigned paths) */
  before?: string;
  /** pipe material id, or a JointRealization for realization/end slots */
  after: string;
  /** human-readable justification shown in the preview */
  reason: string;
}

export interface AutoResolveProposal {
  changes: ProposedChange[];
}

type PipeLike = Extract<MechanismElement, { type: 'link' | 'bentLink' }>;
type JointLike = PivotElement | SliderElement;

const isPipeLike = (el: MechanismElement): el is PipeLike =>
  el.type === 'link' || el.type === 'bentLink';
const isJointLike = (el: MechanismElement): el is JointLike =>
  el.type === 'pivot' || el.type === 'slider';

/** true when `inner` telescopes cleanly inside `outer` (§6.1 slip band) */
const slips = (outer: PipeMaterial, inner: PipeMaterial): boolean =>
  classifyNesting(nestingClearanceM(outer, inner)) === 'slip';

/** ends carrying a cut-length allowance are worth proposing; zero-allowance
 * ends (boltThrough, conduitBox, ropeLashing) would only be noise */
const END_FAMILY: Partial<Record<JointRealization, JointRealization>> = {
  nestedSleeve: 'nestedSleeve',
  nestedCoupler: 'nestedCoupler',
  clickDetachable: 'clickDetachable',
  heatWrapPivot: 'heatWrapPivot',
  heatWrapRigid: 'heatWrapRigid',
  fitting: 'fitting',
};

const NESTED = new Set<JointRealization>(['nestedSleeve', 'nestedCoupler', 'clickDetachable']);
const HEAT_WRAP = new Set<JointRealization>(['heatWrapPivot', 'heatWrapRigid']);

export function autoResolve(
  doc: Project,
  mechId: string,
  opts: AutoResolveOptions,
): AutoResolveProposal {
  const mech = doc.mechanisms.find((m) => m.id === mechId);
  if (!mech) return { changes: [] };
  const resolveAssigned = opts.resolveAssigned ?? false;
  const inScope = (elementId: string): boolean =>
    opts.elementIds === undefined || opts.elementIds.includes(elementId);

  const pipes = doc.materials.pipes;
  const pipeById = new Map(pipes.map((p) => [p.id, p]));

  // ── size palette: in-use sizes by use count (desc), then DB order ────────
  const useCount = new Map<string, number>();
  for (const m of doc.mechanisms) {
    for (const el of m.elements) {
      const ids =
        el.type === 'link' || el.type === 'bentLink'
          ? [el.pipeMaterialId]
          : el.type === 'telescope'
            ? [el.outerPipeMaterialId, el.innerPipeMaterialId]
            : [];
      for (const id of ids) if (id) useCount.set(id, (useCount.get(id) ?? 0) + 1);
    }
  }
  const dbIndex = new Map(pipes.map((p, i) => [p.id, i]));
  const palette = pipes
    .filter((p) => useCount.has(p.id))
    .sort(
      (a, b) =>
        useCount.get(b.id)! - useCount.get(a.id)! || dbIndex.get(a.id)! - dbIndex.get(b.id)!,
    );
  /** palette first, then the rest of the DB — the search order everywhere */
  const orderedStock = [...palette, ...pipes.filter((p) => !useCount.has(p.id))];

  const slipPartnerCount = (p: PipeMaterial): number =>
    pipes.filter((q) => q.id !== p.id && (slips(p, q) || slips(q, p))).length;
  const defaultFill: PipeMaterial | undefined =
    palette[0] ??
    [...pipes].sort(
      (a, b) =>
        slipPartnerCount(b) - slipPartnerCount(a) || dbIndex.get(a.id)! - dbIndex.get(b.id)!,
    )[0];
  const defaultFillReason = palette[0]
    ? 'most-used pipe size in this project'
    : 'stock size with the most slip-fit partners';

  // ── proposal state ────────────────────────────────────────────────────────
  const changes = new Map<string, ProposedChange>();
  const put = (c: ProposedChange) => changes.set(`${c.elementId}|${c.slot}`, c);
  const get = (elementId: string, slot: ProposalSlot) => changes.get(`${elementId}|${slot}`);
  /** members already committed to a chosen fit this run — never resized again */
  const fitLocked = new Set<string>();

  /** effective (proposed-over-current) pipe material of a pipe-like member;
   * telescopes contribute their outer — that is the pipe present at the ends */
  const effMaterialId = (el: MechanismElement): string | undefined => {
    if (isPipeLike(el)) return get(el.id, 'pipeMaterial')?.after ?? el.pipeMaterialId;
    if (el.type === 'telescope')
      return get(el.id, 'outerPipeMaterial')?.after ?? el.outerPipeMaterialId;
    return undefined;
  };
  const effMaterial = (el: MechanismElement): PipeMaterial | undefined => {
    const id = effMaterialId(el);
    return id ? pipeById.get(id) : undefined;
  };

  // ── pass A: fill unassigned pipe materials ────────────────────────────────
  for (const el of mech.elements) {
    if (!inScope(el.id) || !defaultFill) continue;
    if (isPipeLike(el) && !el.pipeMaterialId) {
      put({
        elementId: el.id,
        slot: 'pipeMaterial',
        after: defaultFill.id,
        reason: defaultFillReason,
      });
    }
    if (el.type === 'telescope' && !el.outerPipeMaterialId) {
      put({
        elementId: el.id,
        slot: 'outerPipeMaterial',
        after: defaultFill.id,
        reason: defaultFillReason,
      });
    }
  }

  // ── pass B: telescopes want a slip-fit partner ────────────────────────────
  for (const el of mech.elements) {
    if (el.type !== 'telescope' || !inScope(el.id)) continue;
    const outerId = get(el.id, 'outerPipeMaterial')?.after ?? el.outerPipeMaterialId;
    const outer = outerId ? pipeById.get(outerId) : undefined;
    if (!outer) continue;
    if (!el.innerPipeMaterialId) {
      const inner = orderedStock.find((p) => p.id !== outer.id && slips(outer, p));
      if (inner) {
        put({
          elementId: el.id,
          slot: 'innerPipeMaterial',
          after: inner.id,
          reason: `slip fit inside ${outer.name} — telescopes freely`,
        });
        fitLocked.add(el.id);
      }
      // no slip partner: propose nothing rather than a bad fit
    } else {
      fitLocked.add(el.id); // both assigned — respect the pair
    }
  }

  // ── pass C: joints prefer nesting over hardware ──────────────────────────
  for (const el of mech.elements) {
    if (!isJointLike(el) || !inScope(el.id)) continue;

    if (el.type === 'slider') {
      if (!el.realization) {
        put({
          elementId: el.id,
          slot: 'realization',
          after: 'conduitBox',
          reason: 'pass-through slider — conduit box',
        });
      }
      continue;
    }

    const unrealized = !el.realization;
    const upgradeable =
      resolveAssigned && (el.realization === 'fitting' || el.realization === 'boltThrough');
    if (!unrealized && !upgradeable) continue;

    const members = el.memberIds
      .map((id) => mech.elements.find((e) => e.id === id))
      .filter((m): m is MechanismElement => m !== undefined);
    const welded = el.welds.length > 0;

    // nesting is only a 2-member, unwelded proposition
    let nested = false;
    if (members.length === 2 && !welded) {
      const [mA, mB] = members as [MechanismElement, MechanismElement];
      const pA = effMaterial(mA);
      const pB = effMaterial(mB);
      const realizeNested = (why: string) =>
        put({
          elementId: el.id,
          slot: 'realization',
          before: el.realization,
          after: 'nestedSleeve',
          reason: why,
        });

      if (pA && pB && (slips(pA, pB) || slips(pB, pA))) {
        const [outer, inner] = slips(pA, pB) ? [pA, pB] : [pB, pA];
        realizeNested(`${inner.name} slips inside ${outer.name} — rotates with zero hardware`);
        fitLocked.add(mA.id).add(mB.id);
        nested = true;
      } else if (pA || pB) {
        // try resizing ONE member to unlock a slip fit. Eligible: a material
        // this run proposed itself, or (with resolveAssigned) an assigned one;
        // never a member already committed to another fit, never out of scope.
        const eligibility = (m: MechanismElement): 'auto' | 'assigned' | null => {
          if (fitLocked.has(m.id) || !inScope(m.id) || !isPipeLike(m)) return null;
          if (get(m.id, 'pipeMaterial')) return 'auto';
          if (m.pipeMaterialId && resolveAssigned) return 'assigned';
          return null;
        };
        // prefer resizing an auto-filled member; among equals, the one whose
        // size the project uses least (tie → the later member, keeping the
        // first-drawn pipe stable)
        const rank = (m: MechanismElement, i: number): number[] | null => {
          const e = eligibility(m);
          if (!e) return null;
          const matId = effMaterialId(m);
          return [e === 'auto' ? 0 : 1, matId ? (useCount.get(matId) ?? 0) : 0, -i];
        };
        const candidates = members
          .map((m, i) => ({ m, r: rank(m, i) }))
          .filter((x): x is { m: MechanismElement; r: number[] } => x.r !== null)
          .sort((a, b) => {
            for (let i = 0; i < a.r.length; i++) if (a.r[i]! !== b.r[i]!) return a.r[i]! - b.r[i]!;
            return 0;
          });
        for (const { m } of candidates) {
          const other = members.find((x) => x.id !== m.id)!;
          const fixed = effMaterial(other);
          if (!fixed) continue;
          const partner = orderedStock.find(
            (p) => p.id !== fixed.id && (slips(fixed, p) || slips(p, fixed)),
          );
          if (!partner) continue;
          put({
            elementId: m.id,
            slot: 'pipeMaterial',
            before: (m as PipeLike).pipeMaterialId,
            after: partner.id,
            reason: `resized to slip-fit ${fixed.name} at the joint — no hardware needed`,
          });
          const [outer, inner] = slips(fixed, partner) ? [fixed, partner] : [partner, fixed];
          realizeNested(`${inner.name} slips inside ${outer.name} — rotates with zero hardware`);
          fitLocked.add(m.id).add(other.id);
          nested = true;
          break;
        }
      }
    }

    if (!nested && unrealized) {
      put(
        welded
          ? {
              elementId: el.id,
              slot: 'realization',
              after: 'heatWrapRigid',
              reason: 'welded junction — heat-wrapped rigid attachment, no purchased parts',
            }
          : {
              elementId: el.id,
              slot: 'realization',
              after: 'heatWrapPivot',
              reason: 'no slip-fit pair available — heat-wrapped pivot, no purchased parts',
            },
      );
    }
    // upgradeable joints with no nesting reachable keep their hardware —
    // swapping a bolt for heat-wrap labor is the user's call, not ours
  }

  // ── pass D: end realizations follow the joint so allowances come out right
  const endSlotAt = (
    el: PipeLike,
    nodeId: string,
  ): 'endRealizationA' | 'endRealizationB' | null => {
    const [a, b] =
      el.type === 'link'
        ? [el.nodeA, el.nodeB]
        : [el.nodeIds[0], el.nodeIds[el.nodeIds.length - 1]];
    if (a === nodeId) return 'endRealizationA';
    if (b === nodeId) return 'endRealizationB';
    return null;
  };
  const currentEnd = (el: PipeLike, slot: 'endRealizationA' | 'endRealizationB') =>
    slot === 'endRealizationA' ? el.endRealizationA : el.endRealizationB;

  for (const el of mech.elements) {
    if (el.type !== 'pivot' && el.type !== 'slider') continue;
    const proposed = get(el.id, 'realization')?.after as JointRealization | undefined;
    const realization = proposed ?? el.realization;
    if (!realization || !END_FAMILY[realization]) continue;
    const previous = proposed ? el.realization : undefined;

    const terminating = mech.elements
      .filter(isPipeLike)
      .map((m) => ({ m, slot: endSlotAt(m, el.nodeId) }))
      .filter(
        (
          x,
        ): x is {
          m: PipeLike;
          slot: 'endRealizationA' | 'endRealizationB';
        } => x.slot !== null && (el.type === 'slider' || el.memberIds.includes(x.m.id)),
      );
    /** an end is writable when unset, or when it just mirrored the joint's
     * previous realization and that realization is being replaced this run */
    const writable = (m: PipeLike, slot: 'endRealizationA' | 'endRealizationB') => {
      const cur = currentEnd(m, slot);
      return inScope(m.id) && (cur === undefined || (previous !== undefined && cur === previous));
    };
    const propose = (m: PipeLike, slot: 'endRealizationA' | 'endRealizationB', reason: string) =>
      put({
        elementId: m.id,
        slot,
        before: currentEnd(m, slot),
        after: realization,
        reason,
      });

    if (NESTED.has(realization) && el.type === 'pivot' && terminating.length <= 2) {
      // the inner member carries the overlap allowance (§6.2)
      const withMat = terminating
        .map((t) => ({ ...t, p: effMaterial(t.m) }))
        .filter((t): t is typeof t & { p: PipeMaterial } => t.p !== undefined);
      if (withMat.length === 2) {
        const [a, b] = withMat as [(typeof withMat)[0], (typeof withMat)[0]];
        const inner = slips(a.p, b.p) ? b : slips(b.p, a.p) ? a : null;
        if (inner && writable(inner.m, inner.slot)) {
          propose(inner.m, inner.slot, 'inner member takes the nesting overlap allowance');
        }
      }
    } else if (HEAT_WRAP.has(realization)) {
      // exactly one member carries the wrap (its connector piece + allowance);
      // the lighter (smaller-OD) pipe wraps around its partner
      const already = terminating.some((t) => currentEnd(t.m, t.slot) === realization);
      if (!already) {
        const pick = [...terminating].sort(
          (a, b) =>
            (effMaterial(a.m)?.outerDiameterM ?? Infinity) -
            (effMaterial(b.m)?.outerDiameterM ?? Infinity),
        )[0];
        if (pick && writable(pick.m, pick.slot)) {
          propose(pick.m, pick.slot, 'wrap connector + heat-wrap allowance at this end');
        }
      }
    } else if (realization === 'fitting') {
      for (const t of terminating) {
        if (writable(t.m, t.slot)) propose(t.m, t.slot, 'socket make-in at the fitting');
      }
    }
  }

  return { changes: [...changes.values()] };
}
