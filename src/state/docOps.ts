// Pure document transforms for sketch editing. All editing flows through
// these (via appStore.updateCurrent) so undo/autosave see exactly one code
// path. IDs are generated here; everything else is a pure Project→Project.
//
// v7 (PLANFILE-3d-conversion.md): every op targets the project's single
// compound mechanism (the mechanismId indirection is gone), positions are
// Vec3, and pivots carry a joint (hinge with axis | spherical). Ops that
// create pivots accept an optional `joint`; the UI passes a hinge whose axis
// is the active panel's normal, and the default is the side-panel normal +z —
// identical feel to the old 2D pivots. The assembly layer (instances /
// bindings / place) is deleted; groups + mirror-duplicate replace it.
import type { ProposedChange } from '../design/autoResolve';
import { derivedMaturity } from '../design/resolution';
import { dot, normalize, scale, sub, length as vecLength } from '../geometry/math3';
import type {
  BowdenElement,
  Control,
  ControlAxis,
  ControlClip,
  ElasticElement,
  Group,
  InputChannel,
  JointRealization,
  Mechanism,
  MechanismElement,
  PivotElement,
  PivotJoint,
  Project,
  RopeElement,
  SkeletonPoint,
  SliderElement,
  TorsionCableElement,
  Vec3,
  WearerAnchor,
} from '../schema';

const uid = (): string => crypto.randomUUID();

/** Sketch-default spring rate for a freshly drawn elastic before a material
 * (with its own preset) is assigned in the design face (§4.2). */
export const DEFAULT_ELASTIC_STIFFNESS_N_PER_M = 200;

/** Hinge about +z — the normal of the default (side) sketch panel. Ops that
 * create pivots use this when the caller passes no joint. */
export const DEFAULT_PIVOT_JOINT: PivotJoint = { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } };

function nodePosition(m: Mechanism, nodeId: string): Vec3 {
  const n = m.nodes.find((nd) => nd.id === nodeId);
  if (!n) throw new Error(`no node ${nodeId}`);
  return n.position;
}

function segLength(a: Vec3, b: Vec3): number {
  return vecLength(sub(b, a));
}

function withMechanism(doc: Project, fn: (m: Mechanism) => Mechanism): Project {
  return { ...doc, mechanism: fn(doc.mechanism) };
}

/** How a drawn pipe end lands in the mechanism. Positions are Vec3 document
 * coordinates (the panel projects pointer input onto its work plane first). */
export type EndSpec =
  | { kind: 'existingNode'; nodeId: string; connect: 'pivot' | 'weld' }
  | { kind: 'newNode'; pos: Vec3 }
  /** snapped to a pack-frame/wearer anchor → grounded node attached to (and
   * riding) that anchor */
  | { kind: 'anchorNode'; pos: Vec3; anchor: WearerAnchor }
  /** snapped to a skeleton point → free node driven by clips via binding */
  | { kind: 'boundNode'; pos: Vec3; point: SkeletonPoint }
  /** snapped mid-span on an existing pipe */
  | { kind: 'onPipe'; elementId: string; t: number; connect: 'pivot' | 'weld' | 'slider' };

interface ResolveResult {
  mechanism: Mechanism;
  nodeId: string;
  /** element to weld the incoming pipe to (weld connect choice) */
  weldTo?: string;
  /** node the incoming pipe should pin-joint at (pivot connect choice) —
   * in 3D a bare shared node is spherical, so an explicit hinge pivot is
   * materialized (decision 2, PLANFILE-3d-conversion.md) */
  pivotAt?: string;
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

function positionOnLink(m: Mechanism, elementId: string, t: number): Vec3 {
  const el = m.elements.find((e) => e.id === elementId);
  if (!el || (el.type !== 'link' && el.type !== 'telescope')) {
    throw new Error(`cannot locate along element ${elementId}`);
  }
  const a = m.nodes.find((n) => n.id === el.nodeA)!.position;
  const b = m.nodes.find((n) => n.id === el.nodeB)!.position;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
}

/** Split a straight link at parameter t into two segments WELDED at the new
 * node — physically it is still one rigid pipe; the weld keeps it from
 * folding. Returns the new node so callers can attach to it. */
export function splitLink(
  m: Mechanism,
  elementId: string,
  t: number,
  joint: PivotJoint = DEFAULT_PIVOT_JOINT,
): { mechanism: Mechanism; nodeId: string } {
  const el = m.elements.find((e) => e.id === elementId);
  if (el?.type !== 'link') throw new Error(`cannot split element ${elementId}`);
  const pos = positionOnLink(m, elementId, t);
  const nodeId = uid();
  const segA: MechanismElement = { ...el, id: uid(), nodeB: nodeId };
  const segB: MechanismElement = { ...el, id: uid(), nodeA: nodeId, pointMasses: [] };
  const weld: PivotElement = {
    id: uid(),
    type: 'pivot',
    maturity: 'sketch',
    nodeId,
    joint,
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

function resolveEnd(m: Mechanism, spec: EndSpec, joint: PivotJoint): ResolveResult {
  switch (spec.kind) {
    case 'existingNode': {
      if (spec.connect === 'weld') {
        return { mechanism: m, nodeId: spec.nodeId, weldTo: elementsAtNode(m, spec.nodeId)[0] };
      }
      return { mechanism: m, nodeId: spec.nodeId, pivotAt: spec.nodeId };
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
          anchorBindings: [...m.anchorBindings, { id: uid(), anchor: spec.anchor, nodeId }],
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
          skeletonBindings: [...m.skeletonBindings, { id: uid(), point: spec.point, nodeId }],
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
      const { mechanism, nodeId } = splitLink(m, spec.elementId, spec.t, joint);
      if (spec.connect === 'weld') {
        return { mechanism, nodeId, weldTo: elementsAtNode(mechanism, nodeId)[0] };
      }
      return { mechanism, nodeId, pivotAt: nodeId };
    }
  }
}

function addWeld(
  m: Mechanism,
  nodeId: string,
  elA: string,
  elB: string,
  joint: PivotJoint,
): Mechanism {
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
    joint,
    memberIds: [elA, elB],
    welds: [[elA, elB]],
  };
  return { ...m, elements: [...m.elements, pivot] };
}

/** Pin the element into the joint at `nodeId`: joins an existing pivot's
 * member list, or materializes a fresh (unwelded) pivot with the given joint
 * when the node now has ≥2 members. In 3D a bare shared node behaves as a
 * spherical joint, so the sketch default must be an explicit hinge. */
function addToPivot(m: Mechanism, nodeId: string, elementId: string, joint: PivotJoint): Mechanism {
  const existing = m.elements.find(
    (e): e is PivotElement => e.type === 'pivot' && e.nodeId === nodeId,
  );
  if (existing) {
    if (existing.memberIds.includes(elementId)) return m;
    return {
      ...m,
      elements: m.elements.map((e) =>
        e.id === existing.id ? { ...existing, memberIds: [...existing.memberIds, elementId] } : e,
      ),
    };
  }
  const members = elementsAtNode(m, nodeId);
  if (members.length < 2) return m;
  const pivot: PivotElement = {
    id: uid(),
    type: 'pivot',
    maturity: 'sketch',
    nodeId,
    joint,
    memberIds: members,
    welds: [],
  };
  return { ...m, elements: [...m.elements, pivot] };
}

/** Draw a straight pipe (2 ends) or a bent pipe (3+ vertices; interior
 * vertices become new free nodes). `joint` is the pivot created at a
 * pivot-connect end (hinge axis = the sketch panel's normal). Returns the
 * created element id. */
export function addPipe(
  doc: Project,
  vertices: Vec3[],
  startSpec: EndSpec,
  endSpec: EndSpec,
  joint: PivotJoint = DEFAULT_PIVOT_JOINT,
): { doc: Project; elementId: string } {
  const elementId = uid();
  const newDoc = withMechanism(doc, (m0) => {
    const start = resolveEnd(m0, startSpec, joint);
    const end = resolveEnd(start.mechanism, endSpec, joint);
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
    if (start.weldTo) m = addWeld(m, start.nodeId, elementId, start.weldTo, joint);
    else if (start.pivotAt) m = addToPivot(m, start.pivotAt, elementId, joint);
    if (end.weldTo) m = addWeld(m, end.nodeId, elementId, end.weldTo, joint);
    else if (end.pivotAt) m = addToPivot(m, end.pivotAt, elementId, joint);
    return m;
  });
  return { doc: newDoc, elementId };
}

/** Resolve a chain of pipe-end specs into node ids on the mechanism, threading
 * the mutated mechanism through each resolution. Force elements (rope/elastic/
 * bowden) attach to nodes but never weld or pin the incoming cord to existing
 * pipes, so `weldTo`/`pivotAt` are intentionally ignored. */
function resolveChain(m: Mechanism, specs: EndSpec[]): { mechanism: Mechanism; nodeIds: string[] } {
  let mech = m;
  const nodeIds: string[] = [];
  for (const spec of specs) {
    const r = resolveEnd(mech, spec, DEFAULT_PIVOT_JOINT);
    mech = r.mechanism;
    nodeIds.push(r.nodeId);
  }
  return { mechanism: mech, nodeIds };
}

/** Draw a rope: a tension-only cord through 2+ path points. Interior points
 * landing on a pipe become frictionless eyelets fixed to that pipe (§4.2).
 * Rest length L₀ defaults to the drawn path length (taut at creation). */
export function addRope(doc: Project, path: EndSpec[]): { doc: Project; elementId: string } {
  const elementId = uid();
  const newDoc = withMechanism(doc, (m0) => {
    const { mechanism, nodeIds } = resolveChain(m0, path);
    // collapse a path point that resolved onto the previous node (e.g. a
    // double-click that re-snapped the last vertex)
    const pathIds = nodeIds.filter((id, i) => i === 0 || id !== nodeIds[i - 1]);
    if (pathIds.length < 2) return m0;
    const pts = pathIds.map((id) => nodePosition(mechanism, id));
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += segLength(pts[i - 1]!, pts[i]!);
    const rope: RopeElement = {
      id: elementId,
      type: 'rope',
      maturity: 'sketch',
      path: pathIds,
      lengthM: Math.max(len, 1e-3),
    };
    return { ...mechanism, elements: [...mechanism.elements, rope] };
  });
  return { doc: newDoc, elementId };
}

/** Draw an elastic (linear spring) between two points. Rest length defaults to
 * the drawn length so a fresh elastic sits at zero force. */
export function addElastic(
  doc: Project,
  startSpec: EndSpec,
  endSpec: EndSpec,
): { doc: Project; elementId: string } {
  const elementId = uid();
  const newDoc = withMechanism(doc, (m0) => {
    const { mechanism, nodeIds } = resolveChain(m0, [startSpec, endSpec]);
    const [a, b] = nodeIds as [string, string];
    if (a === b) return m0;
    const rest = Math.max(segLength(nodePosition(mechanism, a), nodePosition(mechanism, b)), 1e-3);
    const elastic: ElasticElement = {
      id: elementId,
      type: 'elastic',
      maturity: 'sketch',
      nodeA: a,
      nodeB: b,
      restLengthM: rest,
      stiffnessNPerM: DEFAULT_ELASTIC_STIFFNESS_N_PER_M,
      tensionOnly: true,
    };
    return { ...mechanism, elements: [...mechanism.elements, elastic] };
  });
  return { doc: newDoc, elementId };
}

/** Draw a bowden: a displacement coupling between two drawn segments A(a1→a2)
 * and B(b1→b2), routing-independent (brake-cable jaw drive, §4.2). */
export function addBowden(
  doc: Project,
  aStart: EndSpec,
  aEnd: EndSpec,
  bStart: EndSpec,
  bEnd: EndSpec,
): { doc: Project; elementId: string } {
  const elementId = uid();
  const newDoc = withMechanism(doc, (m0) => {
    const { mechanism, nodeIds } = resolveChain(m0, [aStart, aEnd, bStart, bEnd]);
    const [a1, a2, b1, b2] = nodeIds as [string, string, string, string];
    if (a1 === a2 || b1 === b2) return m0;
    const bowden: BowdenElement = {
      id: elementId,
      type: 'bowden',
      maturity: 'sketch',
      a1,
      a2,
      b1,
      b2,
      restLengthAM: Math.max(
        segLength(nodePosition(mechanism, a1), nodePosition(mechanism, a2)),
        1e-3,
      ),
      restLengthBM: Math.max(
        segLength(nodePosition(mechanism, b1), nodePosition(mechanism, b2)),
        1e-3,
      ),
    };
    return { ...mechanism, elements: [...mechanism.elements, bowden] };
  });
  return { doc: newDoc, elementId };
}

/** Couple two existing pivots with a torsion cable (θ_B − θ_B₀ = ratio·(θ_A −
 * θ_A₀), §4.2). No-op if either id is not a pivot in the mechanism. */
export function addTorsionCable(
  doc: Project,
  pivotAId: string,
  pivotBId: string,
): { doc: Project; elementId: string } {
  const elementId = uid();
  const newDoc = withMechanism(doc, (m) => {
    const isPivot = (id: string) => m.elements.some((e) => e.id === id && e.type === 'pivot');
    if (pivotAId === pivotBId || !isPivot(pivotAId) || !isPivot(pivotBId)) return m;
    const cable: TorsionCableElement = {
      id: elementId,
      type: 'torsionCable',
      maturity: 'sketch',
      pivotA: pivotAId,
      pivotB: pivotBId,
      ratio: 1,
      backlashRad: 0,
    };
    return { ...m, elements: [...m.elements, cable] };
  });
  return { doc: newDoc, elementId };
}

/** Add a generic input channel. Channel→geometry binding (driven nodes) is
 * authored later; this exists so the slider + lock-toggle UI is usable. */
export function addInputChannel(doc: Project): { doc: Project; channelId: string } {
  const channelId = uid();
  const newDoc = withMechanism(doc, (m) => {
    const channel: InputChannel = {
      id: channelId,
      name: `input ${m.inputs.length + 1}`,
      kind: 'displacement',
      min: 0,
      max: 1,
      value: 0,
      locked: false,
    };
    return { ...m, inputs: [...m.inputs, channel] };
  });
  return { doc: newDoc, channelId };
}

export function setInputChannel(
  doc: Project,
  channelId: string,
  patch: Partial<Pick<InputChannel, 'name' | 'value' | 'locked' | 'min' | 'max'>>,
): Project {
  return withMechanism(doc, (m) => ({
    ...m,
    inputs: m.inputs.map((c) => {
      if (c.id !== channelId) return c;
      const next = { ...c, ...patch };
      // keep value within the channel range whenever either bound changes
      next.value = Math.min(next.max, Math.max(next.min, next.value));
      return next;
    }),
  }));
}

export function removeInputChannel(doc: Project, channelId: string): Project {
  return withMechanism(doc, (m) => ({
    ...m,
    inputs: m.inputs.filter((c) => c.id !== channelId),
  }));
}

export function moveNodes(doc: Project, positions: Record<string, Vec3>): Project {
  return withMechanism(doc, (m) => ({
    ...m,
    nodes: m.nodes.map((n) => {
      const p = positions[n.id];
      return p ? { ...n, position: p } : n;
    }),
  }));
}

export function setNodeKind(doc: Project, nodeId: string, kind: 'free' | 'anchor'): Project {
  return withMechanism(doc, (m) => ({
    ...m,
    nodes: m.nodes.map((n) => (n.id === nodeId ? { ...n, kind } : n)),
  }));
}

/** Delete an element plus dependents (pivots/sliders that reference it), any
 * nodes left orphaned, and every project-level reference (group membership,
 * point masses / foam plates hanging on a removed node). */
export function deleteElement(doc: Project, elementId: string): Project {
  const m = doc.mechanism;
  const remaining = m.elements.filter((e) => {
    if (e.id === elementId) return false;
    if (e.type === 'pivot') return !e.memberIds.includes(elementId);
    if (e.type === 'slider') return e.alongElementId !== elementId;
    // a torsion cable couples two pivots; drop it if either pivot is gone
    if (e.type === 'torsionCable') return e.pivotA !== elementId && e.pivotB !== elementId;
    return true;
  });
  const keptElementIds = new Set(remaining.map((e) => e.id));
  // torsion cables whose pivot was removed as a dependent go too
  const survivors = remaining.filter(
    (e) =>
      e.type !== 'torsionCable' || (keptElementIds.has(e.pivotA) && keptElementIds.has(e.pivotB)),
  );
  const survivorIds = new Set(survivors.map((e) => e.id));

  const used = new Set<string>();
  for (const el of survivors) {
    if (el.type === 'link' || el.type === 'telescope' || el.type === 'elastic') {
      used.add(el.nodeA);
      used.add(el.nodeB);
    } else if (el.type === 'bentLink') {
      for (const id of el.nodeIds) used.add(id);
    } else if (el.type === 'pivot' || el.type === 'slider') used.add(el.nodeId);
    else if (el.type === 'rope') {
      for (const id of el.path) used.add(id);
    } else if (el.type === 'bowden') {
      for (const id of [el.a1, el.a2, el.b1, el.b2]) used.add(id);
    }
  }
  return {
    ...doc,
    mechanism: {
      ...m,
      elements: survivors,
      nodes: m.nodes.filter((n) => used.has(n.id)),
      skeletonBindings: m.skeletonBindings.filter((b) => used.has(b.nodeId)),
      anchorBindings: m.anchorBindings.filter((b) => used.has(b.nodeId)),
      pointMasses: m.pointMasses.filter((p) => used.has(p.nodeId)),
    },
    groups: doc.groups.map((g) => ({
      ...g,
      elementIds: g.elementIds.filter((id) => survivorIds.has(id)),
    })),
    pointMasses: doc.pointMasses.filter(
      (pm) => pm.attach.kind !== 'node' || used.has(pm.attach.nodeId),
    ),
    foamPlates: doc.foamPlates.filter(
      (fp) => fp.attach.kind !== 'node' || used.has(fp.attach.nodeId),
    ),
  };
}

/** Duplicate a pipe element (link/bentLink/telescope) with fresh nodes offset
 * slightly so the copy is visible and independently draggable (§5 keyboard
 * shortcut). Returns the new element id, or null for element types whose copy
 * isn't well-defined on its own (joints, ropes — they reference other parts). */
export function duplicateElement(
  doc: Project,
  elementId: string,
): { doc: Project; newElementId: string | null } {
  const mech = doc.mechanism;
  const el = mech.elements.find((e) => e.id === elementId);
  if (!el || (el.type !== 'link' && el.type !== 'bentLink' && el.type !== 'telescope')) {
    return { doc, newElementId: null };
  }
  const off = (p: Vec3): Vec3 => ({ x: p.x + 0.1, y: p.y - 0.1, z: p.z });
  const nodeCopies = new Map<string, string>();
  const oldIds = el.type === 'bentLink' ? el.nodeIds : [el.nodeA, el.nodeB];
  for (const id of oldIds) if (!nodeCopies.has(id)) nodeCopies.set(id, uid());
  const newNodes = oldIds.map((id) => {
    const src = mech.nodes.find((n) => n.id === id)!;
    // duplicated nodes are free (the copy floats, not grounded/driven)
    return { id: nodeCopies.get(id)!, kind: 'free' as const, position: off(src.position) };
  });
  const newElementId = uid();
  const copy: MechanismElement =
    el.type === 'bentLink'
      ? { ...el, id: newElementId, nodeIds: el.nodeIds.map((id) => nodeCopies.get(id)!) }
      : {
          ...el,
          id: newElementId,
          nodeA: nodeCopies.get(el.nodeA)!,
          nodeB: nodeCopies.get(el.nodeB)!,
        };
  return {
    doc: withMechanism(doc, (m) => ({
      ...m,
      nodes: [...m.nodes, ...newNodes],
      elements: [...m.elements, copy],
    })),
    newElementId,
  };
}

export function addSkeletonBinding(doc: Project, point: SkeletonPoint, nodeId: string): Project {
  return withMechanism(doc, (m) => ({
    ...m,
    skeletonBindings: [
      ...m.skeletonBindings.filter((b) => b.nodeId !== nodeId),
      { id: uid(), point, nodeId },
    ],
  }));
}

export function removeSkeletonBinding(doc: Project, nodeId: string): Project {
  return withMechanism(doc, (m) => ({
    ...m,
    skeletonBindings: m.skeletonBindings.filter((b) => b.nodeId !== nodeId),
  }));
}

/** Tear a node off whatever wearer connection it has (drag past the tear-off
 * deadzone, PLANFILE-wearer-attachments-and-floor slice B): drops any
 * skeleton binding or anchor attachment, and un-grounds a grounded node so
 * the drag can move it freely. Driven nodes keep their channel. */
export function releaseNodeConnection(doc: Project, nodeId: string): Project {
  return withMechanism(doc, (m) => ({
    ...m,
    nodes: m.nodes.map((n) =>
      n.id === nodeId && n.kind === 'anchor' ? { ...n, kind: 'free' as const } : n,
    ),
    skeletonBindings: m.skeletonBindings.filter((b) => b.nodeId !== nodeId),
    anchorBindings: m.anchorBindings.filter((b) => b.nodeId !== nodeId),
  }));
}

/** Dropping a node on a pack-frame/wearer anchor grounds it there AND
 * attaches it — the ground point rides the wearer anchor through pose/clip
 * playback (PLANFILE-wearer-attachments-and-floor slice A). The drag-gesture
 * counterpart of drawing's `anchorNode` end spec. A grounded node cannot
 * also be skeleton-driven, so any skeleton binding is removed. Bindings now
 * target true 3D wearer points (no per-view projection). */
export function groundNodeAtAnchor(
  doc: Project,
  nodeId: string,
  anchor: WearerAnchor,
  pos: Vec3,
): Project {
  return withMechanism(doc, (m) => ({
    ...m,
    nodes: m.nodes.map((n) => (n.id === nodeId ? { ...n, kind: 'anchor', position: pos } : n)),
    skeletonBindings: m.skeletonBindings.filter((b) => b.nodeId !== nodeId),
    anchorBindings: [
      ...m.anchorBindings.filter((b) => b.nodeId !== nodeId),
      { id: uid(), anchor, nodeId },
    ],
  }));
}

// ── design-face assignment ops (§8.2, §8.2a) ────────────────────────────────
// Every assignment re-derives the element's maturity (derivedMaturity in
// src/design/resolution.ts) so maturity always agrees with the data —
// assigning flips to 'engineered', unassigning drops back to 'sketch'.

/** Re-derive maturity after an assignment change. */
const withMaturity = <T extends MechanismElement>(el: T): T => ({
  ...el,
  maturity: derivedMaturity(el),
});

function mapElements(doc: Project, fn: (el: MechanismElement) => MechanismElement): Project {
  return withMechanism(doc, (m) => ({ ...m, elements: m.elements.map(fn) }));
}

/** Assign (or clear, with undefined) a pipe material on every link/bentLink in
 * `elementIds` — the single- and bulk-assignment surface (§8.2). Other element
 * types in the list are ignored, so a mixed selection is safe. */
export function assignPipeMaterial(
  doc: Project,
  elementIds: string[],
  pipeMaterialId: string | undefined,
): Project {
  const ids = new Set(elementIds);
  return mapElements(doc, (el) =>
    ids.has(el.id) && (el.type === 'link' || el.type === 'bentLink')
      ? withMaturity({ ...el, pipeMaterialId })
      : el,
  );
}

/** Assign (or clear) one member of a telescope's outer/inner material pair. */
export function assignTelescopeMaterial(
  doc: Project,
  elementId: string,
  member: 'outer' | 'inner',
  pipeMaterialId: string | undefined,
): Project {
  return mapElements(doc, (el) =>
    el.id === elementId && el.type === 'telescope'
      ? withMaturity(
          member === 'outer'
            ? { ...el, outerPipeMaterialId: pipeMaterialId }
            : { ...el, innerPipeMaterialId: pipeMaterialId },
        )
      : el,
  );
}

/** Assign (or clear) a cordage material on every rope/elastic/bowden/torsion
 * cable in `elementIds`. Assigning a cordage that carries a stiffness preset
 * to an elastic adopts the preset (§4.2 "material with its own preset"). */
export function assignCordageMaterial(
  doc: Project,
  elementIds: string[],
  cordageMaterialId: string | undefined,
): Project {
  const ids = new Set(elementIds);
  const preset = cordageMaterialId
    ? doc.materials.cordage.find((c) => c.id === cordageMaterialId)?.defaultStiffnessNPerM
    : undefined;
  return mapElements(doc, (el) => {
    if (!ids.has(el.id)) return el;
    if (el.type === 'elastic') {
      return withMaturity({
        ...el,
        cordageMaterialId,
        stiffnessNPerM: preset ?? el.stiffnessNPerM,
      });
    }
    if (el.type === 'rope' || el.type === 'bowden' || el.type === 'torsionCable') {
      return withMaturity({ ...el, cordageMaterialId });
    }
    return el;
  });
}

/** Assign (or clear) the physical realization of every pivot/slider in
 * `elementIds` — the bulk-realization surface (§8.2). */
export function assignRealization(
  doc: Project,
  elementIds: string[],
  realization: JointRealization | undefined,
): Project {
  const ids = new Set(elementIds);
  return mapElements(doc, (el) =>
    ids.has(el.id) && (el.type === 'pivot' || el.type === 'slider')
      ? withMaturity({ ...el, realization })
      : el,
  );
}

/** Assign (or clear) the physical realization of the joint at a node — the
 * design-face joint popover. Unlike `assignRealization`, which needs an
 * explicit element id, this finds-or-materializes the pivot element so an
 * implicit free pin (a node with ≥2 members but no pivot element) can be
 * realized directly. Clearing the realization on a bare materialized pin (no
 * welds, limits, or spring) removes the element again, restoring the implicit
 * sketch state. No-op on nodes that are not a pivot-like joint. */
export function assignNodeRealization(
  doc: Project,
  nodeId: string,
  realization: JointRealization | undefined,
  joint: PivotJoint = DEFAULT_PIVOT_JOINT,
): Project {
  return withMechanism(doc, (m) => {
    const existing = m.elements.find(
      (e): e is PivotElement | SliderElement =>
        (e.type === 'pivot' || e.type === 'slider') && e.nodeId === nodeId,
    );
    if (existing) {
      // a bare pin we materialized only to carry a realization loses its
      // element when unrealized, so no redundant free-pin pivot lingers
      const bare =
        existing.type === 'pivot' &&
        existing.welds.length === 0 &&
        !existing.angleLimit &&
        !existing.torsionSpring;
      if (realization === undefined && bare) {
        return { ...m, elements: m.elements.filter((e) => e.id !== existing.id) };
      }
      return {
        ...m,
        elements: m.elements.map((e) =>
          e.id === existing.id ? withMaturity({ ...e, realization }) : e,
        ),
      };
    }
    // no explicit joint element: materialize a free-pin pivot to carry the
    // realization (clearing an already-implicit pin is a no-op)
    if (realization === undefined) return m;
    const members = elementsAtNode(m, nodeId);
    if (members.length < 2) return m;
    const pivot: PivotElement = {
      id: uid(),
      type: 'pivot',
      maturity: 'engineered',
      nodeId,
      joint,
      memberIds: members,
      welds: [],
      realization,
    };
    return { ...m, elements: [...m.elements, pivot] };
  });
}

/** Assign (or clear) a link/bentLink END realization (cut allowance at that
 * end, §6.2). Ends are optional refinements — a butt cut is valid — so they do
 * not participate in the maturity rule. */
export function assignEndRealization(
  doc: Project,
  elementId: string,
  end: 'A' | 'B',
  realization: JointRealization | undefined,
): Project {
  return mapElements(doc, (el) =>
    el.id === elementId && (el.type === 'link' || el.type === 'bentLink')
      ? end === 'A'
        ? { ...el, endRealizationA: realization }
        : { ...el, endRealizationB: realization }
      : el,
  );
}

/** Apply an accepted auto-resolve proposal (PLANFILE-marquee-autoresolve.md)
 * by folding every change through the existing assignment ops, so maturity
 * derivation stays in one place. Callers run this inside a single
 * updateCurrent — one undo step for the whole proposal. */
export function applyAutoResolve(doc: Project, changes: readonly ProposedChange[]): Project {
  let d = doc;
  for (const c of changes) {
    switch (c.slot) {
      case 'pipeMaterial':
        d = assignPipeMaterial(d, [c.elementId], c.after);
        break;
      case 'outerPipeMaterial':
        d = assignTelescopeMaterial(d, c.elementId, 'outer', c.after);
        break;
      case 'innerPipeMaterial':
        d = assignTelescopeMaterial(d, c.elementId, 'inner', c.after);
        break;
      case 'realization':
        d = assignRealization(d, [c.elementId], c.after as JointRealization);
        break;
      case 'endRealizationA':
        d = assignEndRealization(d, c.elementId, 'A', c.after as JointRealization);
        break;
      case 'endRealizationB':
        d = assignEndRealization(d, c.elementId, 'B', c.after as JointRealization);
        break;
    }
  }
  return d;
}

/** Inline dimension edit (§8.2, §11): set a link/telescope length by keeping
 * endpoint A fixed and moving B along the current A→B direction (degenerate
 * zero-length links extend along +x). Only node B moves — connected geometry
 * reconciles on the next kinematic solve. Telescopes clamp to [min, max] and
 * update their length parameter as well. Non-positive lengths are ignored. */
export function setLinkLength(doc: Project, elementId: string, lengthM: number): Project {
  if (!(lengthM > 0)) return doc;
  return withMechanism(doc, (m) => {
    const el = m.elements.find((e) => e.id === elementId);
    if (!el || (el.type !== 'link' && el.type !== 'telescope')) return m;
    const target =
      el.type === 'telescope' ? Math.min(el.maxLengthM, Math.max(el.minLengthM, lengthM)) : lengthM;
    const a = nodePosition(m, el.nodeA);
    const b = nodePosition(m, el.nodeB);
    const len = segLength(a, b);
    const dir: Vec3 = len > 1e-9 ? normalize(sub(b, a)) : { x: 1, y: 0, z: 0 };
    const newB: Vec3 = {
      x: a.x + dir.x * target,
      y: a.y + dir.y * target,
      z: a.z + dir.z * target,
    };
    return {
      ...m,
      nodes: m.nodes.map((n) => (n.id === el.nodeB ? { ...n, position: newB } : n)),
      elements:
        el.type === 'telescope'
          ? m.elements.map((e) => (e.id === el.id ? { ...el, lengthM: target } : e))
          : m.elements,
    };
  });
}

// ── interface-overhaul ops (dimension chips + joint popover) ────────────────

/** Pin/unpin a link/telescope length (the dimension-chip lock). Locked
 * lengths refuse direct geometry edits (endpoint drag / scrub / typed value);
 * the kinematic solver already holds every pipe length rigid while posing. */
export function setLengthLocked(doc: Project, elementId: string, locked: boolean): Project {
  return mapElements(doc, (el) =>
    el.id === elementId && (el.type === 'link' || el.type === 'telescope')
      ? { ...el, lengthLocked: locked || undefined }
      : el,
  );
}

/** Re-realize the joint at a node (joint popover):
 * - 'pivot' — members rotate about the joint: any pivot element at the node
 *   loses its welds; with no element yet, an explicit pivot is materialized
 *   (in 3D a bare shared node is spherical, so hinge-by-default needs the
 *   element). A `joint` argument re-aims an existing hinge / switches to
 *   spherical.
 * - 'weld' — all members rigid: a pivot element is created (or updated) with
 *   every member pair welded.
 * - 'anchor' — the node is grounded (double-click parity).
 * No-op when a joint kind needs ≥2 members and the node has fewer. */
export function setNodeJoint(
  doc: Project,
  nodeId: string,
  kind: 'pivot' | 'weld' | 'anchor',
  joint?: PivotJoint,
): Project {
  return withMechanism(doc, (m) => {
    const node = m.nodes.find((n) => n.id === nodeId);
    if (!node) return m;
    if (kind === 'anchor') {
      return { ...m, nodes: m.nodes.map((n) => (n.id === nodeId ? { ...n, kind: 'anchor' } : n)) };
    }
    const members = elementsAtNode(m, nodeId);
    const existing = m.elements.find(
      (e): e is PivotElement => e.type === 'pivot' && e.nodeId === nodeId,
    );
    let elements = m.elements;
    if (kind === 'pivot') {
      if (existing) {
        elements = elements.map((e) =>
          e.id === existing.id ? { ...existing, welds: [], joint: joint ?? existing.joint } : e,
        );
      } else {
        if (members.length < 2) return m;
        elements = [
          ...elements,
          {
            id: uid(),
            type: 'pivot',
            maturity: 'sketch',
            nodeId,
            joint: joint ?? DEFAULT_PIVOT_JOINT,
            memberIds: members,
            welds: [],
          } satisfies PivotElement,
        ];
      }
    } else {
      if (members.length < 2) return m;
      const first = members[0]!;
      const welds = members.slice(1).map((id) => [first, id] as [string, string]);
      elements = existing
        ? elements.map((e) =>
            e.id === existing.id ? { ...existing, memberIds: members, welds } : e,
          )
        : [
            ...elements,
            {
              id: uid(),
              type: 'pivot',
              maturity: 'sketch',
              nodeId,
              joint: joint ?? DEFAULT_PIVOT_JOINT,
              memberIds: members,
              welds,
            } satisfies PivotElement,
          ];
    }
    return {
      ...m,
      nodes: m.nodes.map((n) =>
        n.id === nodeId && n.kind === 'anchor' ? { ...n, kind: 'free' } : n,
      ),
      elements,
    };
  });
}

/** Set the joint of the pivot at a node (joint-popover hinge-axis edit /
 * spherical toggle). Finds-or-materializes the pivot element, preserving
 * welds/limits/realization when one already exists. */
export function setNodePivotJoint(doc: Project, nodeId: string, joint: PivotJoint): Project {
  return withMechanism(doc, (m) => {
    const existing = m.elements.find(
      (e): e is PivotElement => e.type === 'pivot' && e.nodeId === nodeId,
    );
    if (existing) {
      return {
        ...m,
        elements: m.elements.map((e) => (e.id === existing.id ? { ...existing, joint } : e)),
      };
    }
    const members = elementsAtNode(m, nodeId);
    if (members.length < 2) return m;
    const pivot: PivotElement = {
      id: uid(),
      type: 'pivot',
      maturity: 'sketch',
      nodeId,
      joint,
      memberIds: members,
      welds: [],
    };
    return { ...m, elements: [...m.elements, pivot] };
  });
}

/** Disconnect a junction: every incident element beyond the first gets its
 * own copy of the node (same position), and joint elements (pivot/slider) at
 * the node are removed. Skeleton bindings stay on the original node. */
export function detachNode(doc: Project, nodeId: string): Project {
  return withMechanism(doc, (m) => {
    const node = m.nodes.find((n) => n.id === nodeId);
    if (!node) return m;
    const newNodes: Mechanism['nodes'] = [];
    let first = true;
    const replaceRef = (): string => {
      if (first) {
        first = false;
        return nodeId;
      }
      const id = uid();
      newNodes.push({ ...node, id });
      return id;
    };
    const elements = m.elements
      .filter((e) => !((e.type === 'pivot' || e.type === 'slider') && e.nodeId === nodeId))
      .map((e): MechanismElement => {
        switch (e.type) {
          case 'link':
          case 'telescope':
          case 'elastic':
            if (e.nodeA !== nodeId && e.nodeB !== nodeId) return e;
            return {
              ...e,
              nodeA: e.nodeA === nodeId ? replaceRef() : e.nodeA,
              nodeB: e.nodeB === nodeId ? replaceRef() : e.nodeB,
            };
          case 'bentLink':
            if (!e.nodeIds.includes(nodeId)) return e;
            return { ...e, nodeIds: e.nodeIds.map((id) => (id === nodeId ? replaceRef() : id)) };
          case 'rope':
            if (!e.path.includes(nodeId)) return e;
            return { ...e, path: e.path.map((id) => (id === nodeId ? replaceRef() : id)) };
          case 'bowden': {
            if (![e.a1, e.a2, e.b1, e.b2].includes(nodeId)) return e;
            const r = (id: string) => (id === nodeId ? replaceRef() : id);
            return { ...e, a1: r(e.a1), a2: r(e.a2), b1: r(e.b1), b2: r(e.b2) };
          }
          default:
            return e;
        }
      });
    return { ...m, elements, nodes: [...m.nodes, ...newNodes] };
  });
}

/** Swap a link/telescope's A and B ends (selection-card "Reverse"). Length
 * edits and end realizations are A-anchored, so reversing chooses which end
 * stays put. */
export function reverseLink(doc: Project, elementId: string): Project {
  return mapElements(doc, (el) => {
    if (el.id !== elementId) return el;
    if (el.type === 'link') {
      return {
        ...el,
        nodeA: el.nodeB,
        nodeB: el.nodeA,
        endRealizationA: el.endRealizationB,
        endRealizationB: el.endRealizationA,
      };
    }
    if (el.type === 'telescope') return { ...el, nodeA: el.nodeB, nodeB: el.nodeA };
    if (el.type === 'bentLink') {
      return {
        ...el,
        nodeIds: [...el.nodeIds].reverse(),
        filletRadiiM: [...el.filletRadiiM].reverse(),
        endRealizationA: el.endRealizationB,
        endRealizationB: el.endRealizationA,
      };
    }
    return el;
  });
}

/** Split a straight link at its midpoint (selection-card "Split"); the two
 * halves stay welded at the new node, matching the drawn-onto-pipe behavior. */
export function splitLinkAtMidpoint(
  doc: Project,
  elementId: string,
  joint: PivotJoint = DEFAULT_PIVOT_JOINT,
): Project {
  return withMechanism(doc, (m) => {
    const el = m.elements.find((e) => e.id === elementId);
    if (el?.type !== 'link') return m;
    return splitLink(m, elementId, 0.5, joint).mechanism;
  });
}

/** Patch behavior parameters of one element (rope L₀, elastic k/rest/
 * pretension, telescope range/sliding, bowden rests, torsion ratio/backlash,
 * pivot joint/limits/spring — §8.2a). The expected `type` guards against
 * stale selections patching a different element kind. */
export function patchElement<K extends MechanismElement['type']>(
  doc: Project,
  elementId: string,
  type: K,
  patch: Partial<Extract<MechanismElement, { type: K }>>,
): Project {
  return mapElements(doc, (el) =>
    el.id === elementId && el.type === type
      ? withMaturity({ ...el, ...patch } as MechanismElement)
      : el,
  );
}

// ── Groups (PLANFILE-3d-conversion.md) ──────────────────────────────────────
// Named selection sets over the compound mechanism — the successors of the
// per-plane "mechanisms". They drive BOM rollup and scope checklist notes.

function withGroup(doc: Project, groupId: string, fn: (g: Group) => Group): Project {
  return { ...doc, groups: doc.groups.map((g) => (g.id === groupId ? fn(g) : g)) };
}

export function createGroup(
  doc: Project,
  name: string,
  elementIds: string[] = [],
): { doc: Project; groupId: string } {
  const groupId = uid();
  const group: Group = { id: groupId, name, elementIds: [...new Set(elementIds)] };
  return { doc: { ...doc, groups: [...doc.groups, group] }, groupId };
}

export function renameGroup(doc: Project, groupId: string, name: string): Project {
  return withGroup(doc, groupId, (g) => ({ ...g, name }));
}

/** Replace a group's membership wholesale (deduped, order kept). */
export function setGroupElements(doc: Project, groupId: string, elementIds: string[]): Project {
  return withGroup(doc, groupId, (g) => ({ ...g, elementIds: [...new Set(elementIds)] }));
}

/** Add elements to a group (union, existing order kept). */
export function addToGroup(doc: Project, groupId: string, elementIds: string[]): Project {
  return withGroup(doc, groupId, (g) => ({
    ...g,
    elementIds: [...new Set([...g.elementIds, ...elementIds])],
  }));
}

/** Delete a group. Its elements survive — a group is a named selection, not a
 * container. */
export function deleteGroup(doc: Project, groupId: string): Project {
  return { ...doc, groups: doc.groups.filter((g) => g.id !== groupId) };
}

/** Dismiss a group's note (e.g. the migration's "re-joint needed" warning). */
export function clearGroupNote(doc: Project, groupId: string): Project {
  return withGroup(doc, groupId, ({ note: _note, ...g }) => g);
}

// ── Mirror-duplicate (PLANFILE-3d-conversion.md decision 1) ─────────────────

/** A mirror plane through `origin` with unit-ish `normal` (normalized here). */
export interface MirrorPlane {
  origin: Vec3;
  normal: Vec3;
}

/** The wearer's sagittal plane z = 0 — the default mirror for limbs. */
export const SAGITTAL_PLANE: MirrorPlane = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
};

/** Duplicate the selected elements reflected across `plane` (default the
 * sagittal z = 0): real duplicated geometry with fresh node/element ids, no
 * live link. Hinge axes are reflected then NEGATED so signed-angle
 * conventions (limits, torsion rest angles) survive the reflection — the
 * same rule the v6→v7 migration uses for mirrored instances. Dependent
 * elements whose references fall outside the selection are dropped (a pivot
 * keeps only in-selection members and needs ≥2; sliders need their rail;
 * torsion cables need both pivots). Wearer bindings are NOT copied — the
 * mirrored side is re-bound explicitly (left/right anchors don't reflect
 * mechanically). Creates a group "<source group or 'mirror'> (mirrored)"
 * over the copies. */
export function mirrorDuplicate(
  doc: Project,
  elementIds: string[],
  plane: MirrorPlane = SAGITTAL_PLANE,
): { doc: Project; newElementIds: string[]; groupId: string | null } {
  const m = doc.mechanism;
  const n = normalize(plane.normal);
  const wanted = new Set(elementIds);
  const selected = m.elements.filter((e) => wanted.has(e.id));
  if (selected.length === 0) return { doc, newElementIds: [], groupId: null };

  // decide which elements can be copied (references must stay inside the set)
  const selectedIds = new Set(selected.map((e) => e.id));
  const copyable = selected.filter((e) => {
    if (e.type === 'pivot') return e.memberIds.filter((id) => selectedIds.has(id)).length >= 2;
    if (e.type === 'slider') return selectedIds.has(e.alongElementId);
    if (e.type === 'torsionCable') return selectedIds.has(e.pivotA) && selectedIds.has(e.pivotB);
    return true;
  });
  // pivots that survive, for torsion-cable re-checking
  const copyableIds = new Set(copyable.map((e) => e.id));
  const finalElements = copyable.filter(
    (e) => e.type !== 'torsionCable' || (copyableIds.has(e.pivotA) && copyableIds.has(e.pivotB)),
  );
  if (finalElements.length === 0) return { doc, newElementIds: [], groupId: null };

  const reflectPoint = (p: Vec3): Vec3 => sub(p, scale(n, 2 * dot(sub(p, plane.origin), n)));
  const reflectDir = (v: Vec3): Vec3 => sub(v, scale(n, 2 * dot(v, n)));
  /** reflected then negated — the migration's mirrored-hinge rule */
  const mirrorAxis = (axis: Vec3): Vec3 => scale(reflectDir(axis), -1);

  // fresh ids
  const elIdMap = new Map(finalElements.map((e) => [e.id, uid()] as const));
  const nodeIdMap = new Map<string, string>();
  const mapNode = (id: string): string => {
    let mapped = nodeIdMap.get(id);
    if (!mapped) {
      mapped = uid();
      nodeIdMap.set(id, mapped);
    }
    return mapped;
  };
  const usedNodeIds = new Set<string>();
  for (const e of finalElements) {
    switch (e.type) {
      case 'link':
      case 'telescope':
      case 'elastic':
        usedNodeIds.add(e.nodeA).add(e.nodeB);
        break;
      case 'bentLink':
        for (const id of e.nodeIds) usedNodeIds.add(id);
        break;
      case 'pivot':
      case 'slider':
        usedNodeIds.add(e.nodeId);
        break;
      case 'rope':
        for (const id of e.path) usedNodeIds.add(id);
        break;
      case 'bowden':
        for (const id of [e.a1, e.a2, e.b1, e.b2]) usedNodeIds.add(id);
        break;
      case 'torsionCable':
        break;
    }
  }

  const newNodes: Mechanism['nodes'] = [];
  for (const nodeId of usedNodeIds) {
    const src = m.nodes.find((nd) => nd.id === nodeId);
    if (!src) continue;
    newNodes.push({ ...src, id: mapNode(nodeId), position: reflectPoint(src.position) });
  }

  const freshMasses = <T extends { id: string }>(masses: T[]): T[] =>
    masses.map((pm) => ({ ...pm, id: uid() }));

  const memberPairMap = (pair: [string, string]): [string, string] => [
    elIdMap.get(pair[0])!,
    elIdMap.get(pair[1])!,
  ];

  const copyElement = (e: MechanismElement): MechanismElement => {
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
          joint:
            e.joint.kind === 'hinge' ? { kind: 'hinge', axis: mirrorAxis(e.joint.axis) } : e.joint,
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
  };
  const copies = finalElements.map(copyElement);

  const newElementIds = finalElements.map((e) => elIdMap.get(e.id)!);
  const sourceGroup = doc.groups.find((g) => elementIds.every((id) => g.elementIds.includes(id)));
  const groupName = `${sourceGroup?.name ?? 'mirror'} (mirrored)`;
  const groupId = uid();
  return {
    doc: {
      ...doc,
      mechanism: { ...m, nodes: [...m.nodes, ...newNodes], elements: [...m.elements, ...copies] },
      groups: [...doc.groups, { id: groupId, name: groupName, elementIds: newElementIds }],
    },
    newElementIds,
    groupId,
  };
}

// ── Project-level masses (formerly assembly-level) ──────────────────────────

/** Set a project point mass's mass (kg) — drives the live CG/balance readout
 * in the analysis sidebar. */
export function setPointMassKg(doc: Project, pointMassId: string, massKg: number): Project {
  return {
    ...doc,
    pointMasses: doc.pointMasses.map((m) =>
      m.id === pointMassId ? { ...m, massKg: Math.max(0, massKg) } : m,
    ),
  };
}

// ── Controls + control clips (§4.4) ────────────────────────────────────────

/** Create a control of the given type with one default axis mapped to the
 * first available channel name (or a placeholder). Returns the new id. */
export function addControl(
  doc: Project,
  type: Control['type'],
  channelName: string,
): { doc: Project; controlId: string } {
  const controlId = uid();
  const control: Control = {
    id: controlId,
    name: `${type[0]!.toUpperCase()}${type.slice(1)} ${doc.controls.length + 1}`,
    type,
    axes: [
      {
        id: uid(),
        name: 'axis 1',
        min: -1,
        max: 1,
        value: 0,
        channelName,
        outMin: 0,
        outMax: 1,
        invert: false,
        locked: false,
      },
    ],
  };
  return { doc: { ...doc, controls: [...doc.controls, control] }, controlId };
}

export function removeControl(doc: Project, controlId: string): Project {
  return { ...doc, controls: doc.controls.filter((c) => c.id !== controlId) };
}

function withControl(doc: Project, controlId: string, fn: (c: Control) => Control): Project {
  return { ...doc, controls: doc.controls.map((c) => (c.id === controlId ? fn(c) : c)) };
}

export function renameControl(doc: Project, controlId: string, name: string): Project {
  return withControl(doc, controlId, (c) => ({ ...c, name }));
}

export function setControlMount(doc: Project, controlId: string, mount: Control['mount']): Project {
  return withControl(doc, controlId, (c) => ({ ...c, mount }));
}

export function addControlAxis(doc: Project, controlId: string, channelName: string): Project {
  return withControl(doc, controlId, (c) => ({
    ...c,
    axes: [
      ...c.axes,
      {
        id: uid(),
        name: `axis ${c.axes.length + 1}`,
        min: -1,
        max: 1,
        value: 0,
        channelName,
        outMin: 0,
        outMax: 1,
        invert: false,
        locked: false,
      },
    ],
  }));
}

export function removeControlAxis(doc: Project, controlId: string, axisId: string): Project {
  return withControl(doc, controlId, (c) => ({
    ...c,
    axes: c.axes.filter((a) => a.id !== axisId),
  }));
}

export function patchControlAxis(
  doc: Project,
  controlId: string,
  axisId: string,
  patch: Partial<ControlAxis>,
): Project {
  return withControl(doc, controlId, (c) => ({
    ...c,
    axes: c.axes.map((a) => (a.id === axisId ? { ...a, ...patch } : a)),
  }));
}

/** Add (or replace by name) a control clip. */
export function upsertControlClip(doc: Project, clip: ControlClip): Project {
  const exists = doc.controlClips.some((c) => c.name === clip.name);
  return {
    ...doc,
    controlClips: exists
      ? doc.controlClips.map((c) => (c.name === clip.name ? clip : c))
      : [...doc.controlClips, clip],
  };
}

export function deleteControlClip(doc: Project, name: string): Project {
  return { ...doc, controlClips: doc.controlClips.filter((c) => c.name !== name) };
}
