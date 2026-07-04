// Pure document transforms for sketch editing. All editing flows through
// these (via appStore.updateCurrent) so undo/autosave see exactly one code
// path. IDs are generated here; everything else is a pure Project→Project.
import type {
  Mechanism,
  MechanismElement,
  PivotElement,
  Project,
  SkeletonPoint,
  Vec2,
  ViewOrientation,
} from '../schema';

const uid = (): string => crypto.randomUUID();

function withMechanism(doc: Project, mechId: string, fn: (m: Mechanism) => Mechanism): Project {
  return {
    ...doc,
    mechanisms: doc.mechanisms.map((m) => (m.id === mechId ? fn(m) : m)),
  };
}

export function addMechanism(
  doc: Project,
  viewOrientation: ViewOrientation,
): { doc: Project; mechanismId: string } {
  const id = uid();
  const mechanism: Mechanism = {
    id,
    name: `Mechanism ${doc.mechanisms.length + 1}`,
    viewOrientation,
    // §4.2: gravity defaults on for elevation views, off for plan view
    gravityOn: viewOrientation !== 'top',
    nodes: [],
    elements: [],
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
    namedStates: [],
  };
  return { doc: { ...doc, mechanisms: [...doc.mechanisms, mechanism] }, mechanismId: id };
}

export function renameMechanism(doc: Project, mechId: string, name: string): Project {
  return withMechanism(doc, mechId, (m) => ({ ...m, name }));
}

export function deleteMechanism(doc: Project, mechId: string): Project {
  return { ...doc, mechanisms: doc.mechanisms.filter((m) => m.id !== mechId) };
}

/** How a drawn pipe end lands in the mechanism. */
export type EndSpec =
  | { kind: 'existingNode'; nodeId: string; connect: 'pivot' | 'weld' }
  | { kind: 'newNode'; pos: Vec2 }
  /** snapped to a pack-frame/wearer anchor → grounded node */
  | { kind: 'anchorNode'; pos: Vec2 }
  /** snapped to a skeleton point → free node driven by clips via binding */
  | { kind: 'boundNode'; pos: Vec2; point: SkeletonPoint }
  /** snapped mid-span on an existing pipe */
  | { kind: 'onPipe'; elementId: string; t: number; connect: 'pivot' | 'weld' | 'slider' };

interface ResolveResult {
  mechanism: Mechanism;
  nodeId: string;
  /** element to weld the incoming pipe to (weld connect choice) */
  weldTo?: string;
}

function elementsAtNode(m: Mechanism, nodeId: string): string[] {
  const out: string[] = [];
  for (const el of m.elements) {
    if (el.type === 'link' || el.type === 'telescope') {
      if (el.nodeA === nodeId || el.nodeB === nodeId) out.push(el.id);
    } else if (el.type === 'bentLink') {
      if (el.nodeIds.includes(nodeId)) out.push(el.id);
    }
  }
  return out;
}

function positionOnLink(m: Mechanism, elementId: string, t: number): Vec2 {
  const el = m.elements.find((e) => e.id === elementId);
  if (!el || (el.type !== 'link' && el.type !== 'telescope')) {
    throw new Error(`cannot locate along element ${elementId}`);
  }
  const a = m.nodes.find((n) => n.id === el.nodeA)!.position;
  const b = m.nodes.find((n) => n.id === el.nodeB)!.position;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Split a straight link at parameter t into two segments WELDED at the new
 * node — physically it is still one rigid pipe; the weld keeps it from
 * folding. Returns the new node so callers can attach to it. */
export function splitLink(
  m: Mechanism,
  elementId: string,
  t: number,
): { mechanism: Mechanism; nodeId: string } {
  const el = m.elements.find((e) => e.id === elementId);
  if (!el || el.type !== 'link') throw new Error(`cannot split element ${elementId}`);
  const pos = positionOnLink(m, elementId, t);
  const nodeId = uid();
  const segA: MechanismElement = { ...el, id: uid(), nodeB: nodeId };
  const segB: MechanismElement = { ...el, id: uid(), nodeA: nodeId, pointMasses: [] };
  const weld: PivotElement = {
    id: uid(),
    type: 'pivot',
    maturity: 'sketch',
    nodeId,
    memberIds: [segA.id, segB.id],
    welds: [[segA.id, segB.id]],
  };
  const mechanism: Mechanism = {
    ...m,
    nodes: [...m.nodes, { id: nodeId, kind: 'free', position: pos }],
    elements: [...m.elements.filter((e) => e.id !== elementId), segA, segB, weld],
  };
  return { mechanism, nodeId };
}

function resolveEnd(m: Mechanism, spec: EndSpec): ResolveResult {
  switch (spec.kind) {
    case 'existingNode': {
      const weldTo =
        spec.connect === 'weld' ? elementsAtNode(m, spec.nodeId)[0] : undefined;
      return { mechanism: m, nodeId: spec.nodeId, weldTo };
    }
    case 'newNode': {
      const nodeId = uid();
      return {
        mechanism: { ...m, nodes: [...m.nodes, { id: nodeId, kind: 'free', position: spec.pos }] },
        nodeId,
      };
    }
    case 'anchorNode': {
      const nodeId = uid();
      return {
        mechanism: {
          ...m,
          nodes: [...m.nodes, { id: nodeId, kind: 'anchor', position: spec.pos }],
        },
        nodeId,
      };
    }
    case 'boundNode': {
      const nodeId = uid();
      return {
        mechanism: {
          ...m,
          nodes: [...m.nodes, { id: nodeId, kind: 'free', position: spec.pos }],
          skeletonBindings: [
            ...m.skeletonBindings,
            { id: uid(), point: spec.point, nodeId },
          ],
        },
        nodeId,
      };
    }
    case 'onPipe': {
      if (spec.connect === 'slider') {
        const nodeId = uid();
        const pos = positionOnLink(m, spec.elementId, spec.t);
        return {
          mechanism: {
            ...m,
            nodes: [...m.nodes, { id: nodeId, kind: 'free', position: pos }],
            elements: [
              ...m.elements,
              {
                id: uid(),
                type: 'slider',
                maturity: 'sketch',
                nodeId,
                alongElementId: spec.elementId,
                travelMin: 0,
                travelMax: 1,
              },
            ],
          },
          nodeId,
        };
      }
      const { mechanism, nodeId } = splitLink(m, spec.elementId, spec.t);
      const weldTo =
        spec.connect === 'weld' ? elementsAtNode(mechanism, nodeId)[0] : undefined;
      return { mechanism, nodeId, weldTo };
    }
  }
}

function addWeld(m: Mechanism, nodeId: string, elA: string, elB: string): Mechanism {
  const existing = m.elements.find(
    (e): e is PivotElement => e.type === 'pivot' && e.nodeId === nodeId,
  );
  if (existing) {
    return {
      ...m,
      elements: m.elements.map((e) =>
        e.id === existing.id
          ? {
              ...existing,
              memberIds: [...new Set([...existing.memberIds, elA, elB])],
              welds: [...existing.welds, [elA, elB] as [string, string]],
            }
          : e,
      ),
    };
  }
  const pivot: PivotElement = {
    id: uid(),
    type: 'pivot',
    maturity: 'sketch',
    nodeId,
    memberIds: [elA, elB],
    welds: [[elA, elB]],
  };
  return { ...m, elements: [...m.elements, pivot] };
}

/** Draw a straight pipe (2 ends) or a bent pipe (3+ vertices; interior
 * vertices become new free nodes). Returns the created element id. */
export function addPipe(
  doc: Project,
  mechId: string,
  vertices: Vec2[],
  startSpec: EndSpec,
  endSpec: EndSpec,
): { doc: Project; elementId: string } {
  const elementId = uid();
  const newDoc = withMechanism(doc, mechId, (m0) => {
    const start = resolveEnd(m0, startSpec);
    const end = resolveEnd(start.mechanism, endSpec);
    let m = end.mechanism;

    let element: MechanismElement;
    if (vertices.length <= 2) {
      element = {
        id: elementId,
        type: 'link',
        maturity: 'sketch',
        nodeA: start.nodeId,
        nodeB: end.nodeId,
        pointMasses: [],
      };
    } else {
      const interiorIds = vertices.slice(1, -1).map((pos) => {
        const nid = uid();
        m = { ...m, nodes: [...m.nodes, { id: nid, kind: 'free', position: pos }] };
        return nid;
      });
      element = {
        id: elementId,
        type: 'bentLink',
        maturity: 'sketch',
        nodeIds: [start.nodeId, ...interiorIds, end.nodeId],
        filletRadiiM: interiorIds.map(() => 0),
        pointMasses: [],
      };
    }
    m = { ...m, elements: [...m.elements, element] };
    if (start.weldTo) m = addWeld(m, start.nodeId, elementId, start.weldTo);
    if (end.weldTo) m = addWeld(m, end.nodeId, elementId, end.weldTo);
    return m;
  });
  return { doc: newDoc, elementId };
}

export function moveNodes(doc: Project, mechId: string, positions: Record<string, Vec2>): Project {
  return withMechanism(doc, mechId, (m) => ({
    ...m,
    nodes: m.nodes.map((n) => {
      const p = positions[n.id];
      return p ? { ...n, position: p } : n;
    }),
  }));
}

export function setNodeKind(
  doc: Project,
  mechId: string,
  nodeId: string,
  kind: 'free' | 'anchor',
): Project {
  return withMechanism(doc, mechId, (m) => ({
    ...m,
    nodes: m.nodes.map((n) => (n.id === nodeId ? { ...n, kind } : n)),
  }));
}

/** Delete an element plus dependents (pivots/sliders that reference it) and
 * any nodes left orphaned. */
export function deleteElement(doc: Project, mechId: string, elementId: string): Project {
  return withMechanism(doc, mechId, (m) => {
    const remaining = m.elements.filter((e) => {
      if (e.id === elementId) return false;
      if (e.type === 'pivot') {
        return !e.memberIds.includes(elementId);
      }
      if (e.type === 'slider') return e.alongElementId !== elementId;
      return true;
    });
    const used = new Set<string>();
    for (const el of remaining) {
      if (el.type === 'link' || el.type === 'telescope' || el.type === 'elastic') {
        used.add(el.nodeA);
        used.add(el.nodeB);
      } else if (el.type === 'bentLink') el.nodeIds.forEach((id) => used.add(id));
      else if (el.type === 'pivot' || el.type === 'slider') used.add(el.nodeId);
      else if (el.type === 'rope') el.path.forEach((id) => used.add(id));
      else if (el.type === 'bowden') [el.a1, el.a2, el.b1, el.b2].forEach((id) => used.add(id));
    }
    return {
      ...m,
      elements: remaining,
      nodes: m.nodes.filter((n) => used.has(n.id)),
      skeletonBindings: m.skeletonBindings.filter((b) => used.has(b.nodeId)),
      pointMasses: m.pointMasses.filter((p) => used.has(p.nodeId)),
    };
  });
}

export function addSkeletonBinding(
  doc: Project,
  mechId: string,
  point: SkeletonPoint,
  nodeId: string,
): Project {
  return withMechanism(doc, mechId, (m) => ({
    ...m,
    skeletonBindings: [
      ...m.skeletonBindings.filter((b) => b.nodeId !== nodeId),
      { id: uid(), point, nodeId },
    ],
  }));
}

export function removeSkeletonBinding(doc: Project, mechId: string, nodeId: string): Project {
  return withMechanism(doc, mechId, (m) => ({
    ...m,
    skeletonBindings: m.skeletonBindings.filter((b) => b.nodeId !== nodeId),
  }));
}
