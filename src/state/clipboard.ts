// Selection clipboard (PLANFILE-quad-panel-controls C). The clipboard is
// TRANSIENT APP STATE — never in the file format, no schema change. Copy
// snapshots the copyable subset of the selection plus every node it
// references, so paste keeps working after the originals are edited or
// deleted. Paste deep-clones with fresh ids, remapping all internal
// references through the shared clone machinery (cloneElements.ts — the same
// core mirror-duplicate uses).
//
// Policy (planfile C):
// - Pasted DRIVEN nodes keep their channel binding when the channel still
//   exists — channels are global and shared-by-design (a duplicated limb
//   driven by the same walk channel is the expected outcome); if the channel
//   is gone the node demotes to 'free'.
// - Wearer bindings (skeleton/anchor bindings) are NOT copied — same rule as
//   mirror-duplicate; anchored nodes stay 'anchor' kind, grounded at the
//   offset position, and their ground hinge travels with them.
// - Pasted elements join no group and keep their source subsystemTag.
import type { MechanismElement, MechanismNode, Project, Vec3 } from '../schema';
import { cloneElement, copyableSubset, referencedNodeIds } from './cloneElements';

const uid = (): string => crypto.randomUUID();

export interface ClipboardPayload {
  /** the copyable subset of the copied selection, original ids */
  elements: MechanismElement[];
  /** full snapshots of every node the elements reference */
  nodes: MechanismNode[];
}

/** Snapshot the selection for the clipboard: the copyable subset of the
 * selected elements (closure rules in cloneElements.ts) plus every node they
 * reference. Returns null when nothing in the selection is copyable. */
export function copyPayload(doc: Project, elementIds: readonly string[]): ClipboardPayload | null {
  const wanted = new Set(elementIds);
  const elements = copyableSubset(doc.mechanism.elements.filter((e) => wanted.has(e.id)));
  if (elements.length === 0) return null;
  const used = referencedNodeIds(elements);
  return { elements, nodes: doc.mechanism.nodes.filter((n) => used.has(n.id)) };
}

/** Paste a payload into the document: fresh ids for every node, element, and
 * attached point mass; every internal reference remapped; every node offset
 * by `offset` (the caller supplies the active panel's in-plane nudge).
 * Returns the new element ids (payload order) for selection. */
export function pastePayload(
  doc: Project,
  payload: ClipboardPayload,
  offset: Vec3,
): { doc: Project; newElementIds: string[] } {
  if (payload.elements.length === 0) return { doc, newElementIds: [] };
  const elIdMap = new Map(payload.elements.map((e) => [e.id, uid()] as const));
  const nodeIdMap = new Map(payload.nodes.map((n) => [n.id, uid()] as const));
  const mapNode = (id: string): string => nodeIdMap.get(id) ?? id;

  const channelIds = new Set(doc.mechanism.inputs.map((c) => c.id));
  const nodes: MechanismNode[] = payload.nodes.map((n) => {
    const channelOk = n.channelId !== undefined && channelIds.has(n.channelId);
    return {
      id: nodeIdMap.get(n.id)!,
      // a driven node whose channel no longer exists demotes to free
      kind: n.kind === 'driven' && !channelOk ? 'free' : n.kind,
      position: {
        x: n.position.x + offset.x,
        y: n.position.y + offset.y,
        z: n.position.z + offset.z,
      },
      ...(channelOk ? { channelId: n.channelId } : {}),
    };
  });

  const copies = payload.elements.map((e) =>
    cloneElement(e, { elIdMap, mapNode, mapAxis: (axis) => axis }),
  );

  return {
    doc: {
      ...doc,
      mechanism: {
        ...doc.mechanism,
        nodes: [...doc.mechanism.nodes, ...nodes],
        elements: [...doc.mechanism.elements, ...copies],
      },
    },
    newElementIds: payload.elements.map((e) => elIdMap.get(e.id)!),
  };
}
