// Shared deep-clone machinery for duplicating an element SET with fresh ids:
// the single remap core behind mirror-duplicate (docOps.ts) and clipboard
// paste (clipboard.ts, PLANFILE-quad-panel-controls C), so both stay correct
// together. Handles the closure rules (which elements can travel with a
// partial selection) and every internal reference: link/telescope/elastic
// endpoints, bentLink node chains, pivot node/members/welds/angle-limit/
// torsion-spring, slider node + rail, rope paths, bowden endpoints, torsion
// cable pivot pairs, and attached point-mass ids.
import type { MechanismElement, Vec3 } from '../schema';

const uid = (): string => crypto.randomUUID();

/** Which of `selected` can be copied as a set — references must stay inside
 * the selection: a pivot needs ≥2 in-selection members (its member list is
 * later filtered to those), EXCEPT a single-member ground hinge, which
 * travels with its one member (dropping it would turn an anchored copy into
 * a bare spherical anchor — the planarity leak DECISIONS.md documents); a
 * slider needs its rail; a torsion cable needs both pivots, re-checked after
 * pivot filtering. */
export function copyableSubset(selected: readonly MechanismElement[]): MechanismElement[] {
  const selectedIds = new Set(selected.map((e) => e.id));
  const copyable = selected.filter((e) => {
    if (e.type === 'pivot') {
      const kept = e.memberIds.filter((id) => selectedIds.has(id));
      return kept.length >= 2 || (e.memberIds.length === 1 && kept.length === 1);
    }
    if (e.type === 'slider') return selectedIds.has(e.alongElementId);
    if (e.type === 'torsionCable') return selectedIds.has(e.pivotA) && selectedIds.has(e.pivotB);
    return true;
  });
  const copyableIds = new Set(copyable.map((e) => e.id));
  return copyable.filter(
    (e) => e.type !== 'torsionCable' || (copyableIds.has(e.pivotA) && copyableIds.has(e.pivotB)),
  );
}

/** Every node id the element set references. */
export function referencedNodeIds(elements: readonly MechanismElement[]): Set<string> {
  const used = new Set<string>();
  for (const e of elements) {
    switch (e.type) {
      case 'link':
      case 'telescope':
      case 'elastic':
        used.add(e.nodeA).add(e.nodeB);
        break;
      case 'bentLink':
        for (const id of e.nodeIds) used.add(id);
        break;
      case 'pivot':
      case 'slider':
        used.add(e.nodeId);
        break;
      case 'rope':
        for (const id of e.path) used.add(id);
        break;
      case 'bowden':
        for (const id of [e.a1, e.a2, e.b1, e.b2]) used.add(id);
        break;
      case 'torsionCable':
        break;
    }
  }
  return used;
}

export interface CloneMaps {
  /** old element id → fresh id, for every element being cloned */
  elIdMap: Map<string, string>;
  /** old node id → fresh id */
  mapNode(id: string): string;
  /** hinge-axis transform (mirror reflects + negates; paste is identity) */
  mapAxis(axis: Vec3): Vec3;
}

/** Deep-clone one element of a `copyableSubset`, remapping every internal
 * reference through the maps. Pivot member lists are filtered to the cloned
 * set; welds / angle limits / torsion springs are dropped when a referenced
 * member did not travel. */
export function cloneElement(
  e: MechanismElement,
  { elIdMap, mapNode, mapAxis }: CloneMaps,
): MechanismElement {
  const freshMasses = <T extends { id: string }>(masses: T[]): T[] =>
    masses.map((pm) => ({ ...pm, id: uid() }));
  const memberPairMap = (pair: [string, string]): [string, string] => [
    elIdMap.get(pair[0])!,
    elIdMap.get(pair[1])!,
  ];
  const id = elIdMap.get(e.id)!;
  switch (e.type) {
    case 'link':
      return {
        ...e,
        id,
        nodeA: mapNode(e.nodeA),
        nodeB: mapNode(e.nodeB),
        pointMasses: freshMasses(e.pointMasses),
      };
    case 'telescope':
      return {
        ...e,
        id,
        nodeA: mapNode(e.nodeA),
        nodeB: mapNode(e.nodeB),
        pointMasses: freshMasses(e.pointMasses),
      };
    case 'elastic':
      return { ...e, id, nodeA: mapNode(e.nodeA), nodeB: mapNode(e.nodeB) };
    case 'bentLink':
      return {
        ...e,
        id,
        nodeIds: e.nodeIds.map(mapNode),
        pointMasses: freshMasses(e.pointMasses),
      };
    case 'pivot': {
      const members = e.memberIds.filter((mid) => elIdMap.has(mid));
      const keptSet = new Set(members);
      const bothKept = (a: string, b: string) => keptSet.has(a) && keptSet.has(b);
      return {
        ...e,
        id,
        nodeId: mapNode(e.nodeId),
        joint: e.joint.kind === 'hinge' ? { kind: 'hinge', axis: mapAxis(e.joint.axis) } : e.joint,
        memberIds: members.map((mid) => elIdMap.get(mid)!),
        welds: e.welds.filter(([a, b]) => bothKept(a, b)).map(memberPairMap),
        angleLimit:
          e.angleLimit && bothKept(e.angleLimit.memberA, e.angleLimit.memberB)
            ? {
                ...e.angleLimit,
                memberA: elIdMap.get(e.angleLimit.memberA)!,
                memberB: elIdMap.get(e.angleLimit.memberB)!,
              }
            : undefined,
        torsionSpring:
          e.torsionSpring && bothKept(e.torsionSpring.memberA, e.torsionSpring.memberB)
            ? {
                ...e.torsionSpring,
                memberA: elIdMap.get(e.torsionSpring.memberA)!,
                memberB: elIdMap.get(e.torsionSpring.memberB)!,
              }
            : undefined,
      };
    }
    case 'slider':
      return {
        ...e,
        id,
        nodeId: mapNode(e.nodeId),
        alongElementId: elIdMap.get(e.alongElementId)!,
      };
    case 'rope':
      return { ...e, id, path: e.path.map(mapNode) };
    case 'bowden':
      return {
        ...e,
        id,
        a1: mapNode(e.a1),
        a2: mapNode(e.a2),
        b1: mapNode(e.b1),
        b2: mapNode(e.b2),
      };
    case 'torsionCable':
      return { ...e, id, pivotA: elIdMap.get(e.pivotA)!, pivotB: elIdMap.get(e.pivotB)! };
  }
}
