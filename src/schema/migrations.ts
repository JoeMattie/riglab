import { type Project, projectSchema, SCHEMA_VERSION } from './project';

/** Migration from version N to N+1. Operates on plain JSON — never import
 * app code here; old documents must migrate forever. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

type Json = Record<string, unknown>;

/** keyed by the version the migration upgrades FROM; every SCHEMA_VERSION
 * bump adds an entry (enforced by tests). */
export const migrations: Record<number, Migration> = {
  // v1 → v2: mechanisms gained skeletonBindings (empty for old docs);
  // project gained wearer mannequin params (defaults).
  1: (doc) => ({
    ...doc,
    mechanisms: Array.isArray(doc.mechanisms)
      ? (doc.mechanisms as Array<Record<string, unknown>>).map((m) => ({
          ...m,
          skeletonBindings: [],
        }))
      : doc.mechanisms,
    wearer: { heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 },
  }),
  // v2 → v3: project gained bomSettings (§6.2); old docs get the defaults.
  2: (doc) => ({
    ...doc,
    bomSettings: { heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 },
  }),
  // v3 → v4: link/telescope gained OPTIONAL lengthLocked (absent = unlocked),
  // so v3 documents are already valid v4 documents — stamp only.
  3: (doc) => doc,
  // v4 → v5: project gained controls + controlClips (§4.4); old docs get empty
  // arrays.
  4: (doc) => ({ ...doc, controls: [], controlClips: [] }),
  // v5 → v6: mechanisms gained anchorBindings (wearer-anchor attachments for
  // grounded nodes; PLANFILE-wearer-attachments-and-floor slice A). Add-if-
  // missing so a doc that somehow carries the field keeps it.
  5: (doc) => ({
    ...doc,
    mechanisms: Array.isArray(doc.mechanisms)
      ? (doc.mechanisms as Array<Record<string, unknown>>).map((m) => ({
          ...m,
          anchorBindings: m.anchorBindings ?? [],
        }))
      : doc.mechanisms,
  }),
  // v6 → v7: fully-3D single compound mechanism (PLANFILE-3d-conversion.md).
  // Per-plane mechanisms × assembly instances are lifted into world space and
  // concatenated; the assembly layer (instances/bindings) dissolves into
  // groups, anchor bindings, and project-level masses.
  6: migrateV6ToV7,
  // v7 → v8: pivots gained OPTIONAL axisLocked (absent = free hinge axis, the
  // prior behavior), so v7 documents are already valid v8 documents — stamp.
  7: (doc) => doc,
  // v8 → v9: elastics become a rubber-band model — restLengthM/pretensionN/
  // tensionOnly collapse to slackLengthM (the zero-force length = the old
  // effective rest) plus a maxLengthM stretch cap (new; a roomy default that
  // preserves the old uncapped feel). The mechanism is the single top-level
  // `mechanism` since v7.
  8: (doc) => migrateV8Elastics(doc),
};

/** v8 → v9 elastic reshape (see the migration table). Pure JSON. */
function migrateV8Elastics(doc: Json): Json {
  const mech = doc.mechanism as Json | undefined;
  if (!mech || !Array.isArray(mech.elements)) return doc;
  const elements = (mech.elements as Json[]).map((el) => {
    if (el.type !== 'elastic') return el;
    const rest = typeof el.restLengthM === 'number' ? el.restLengthM : 0.1;
    const k =
      typeof el.stiffnessNPerM === 'number' && el.stiffnessNPerM > 0 ? el.stiffnessNPerM : 1;
    const pre = typeof el.pretensionN === 'number' ? el.pretensionN : 0;
    const slack = Math.max(1e-3, rest - pre / k);
    const { restLengthM: _r, pretensionN: _p, tensionOnly: _t, ...keep } = el;
    return { ...keep, slackLengthM: slack, maxLengthM: Math.max(slack, rest) * 3 };
  });
  return { ...doc, mechanism: { ...mech, elements } };
}

// ---------------------------------------------------------------------------
// v6 → v7 support. Everything in this section is FROZEN MIGRATION DATA/MATH:
// copied from src/geometry/math3.ts, src/geometry/placement.ts,
// src/assembly/compose.ts and src/wearer/skeleton.ts as they stood at the v7
// bump. It must never track later changes to those modules (which may not
// even exist anymore) — old documents must migrate identically forever.
// ---------------------------------------------------------------------------

interface Vec3M {
  x: number;
  y: number;
  z: number;
}
interface QuatM {
  x: number;
  y: number;
  z: number;
  w: number;
}

const M_IDENTITY_Q: QuatM = { x: 0, y: 0, z: 0, w: 1 };
const mV = (x: number, y: number, z: number): Vec3M => ({ x, y, z });

function mAdd(a: Vec3M, b: Vec3M): Vec3M {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function mSub(a: Vec3M, b: Vec3M): Vec3M {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function mScale(a: Vec3M, s: number): Vec3M {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function mDot(a: Vec3M, b: Vec3M): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function mCross(a: Vec3M, b: Vec3M): Vec3M {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function mNormalize(a: Vec3M): Vec3M {
  const l = Math.sqrt(mDot(a, a));
  return l < 1e-12 ? { x: 0, y: 0, z: 0 } : mScale(a, 1 / l);
}

/** Rotate vector v by unit quaternion q: v' = v + 2·q.w·(q×v) + 2·q×(q×v). */
function mRotate(q: QuatM, v: Vec3M): Vec3M {
  const qv: Vec3M = { x: q.x, y: q.y, z: q.z };
  const t = mScale(mCross(qv, v), 2);
  return mAdd(mAdd(v, mScale(t, q.w)), mCross(qv, t));
}

/** Hamilton product a·b (apply b first, then a). */
function mMulQ(a: QuatM, b: QuatM): QuatM {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Quaternion from an orthonormal basis given as its column axes. */
function mQuatFromBasis(x: Vec3M, y: Vec3M, z: Vec3M): QuatM {
  const m00 = x.x;
  const m10 = x.y;
  const m20 = x.z;
  const m01 = y.x;
  const m11 = y.y;
  const m21 = y.z;
  const m02 = z.x;
  const m12 = z.y;
  const m22 = z.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return { w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s };
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
}

/** Frozen copy of the v6 default-placement tables (src/geometry/placement.ts
 * FRAMES/ORIGINS): where an uninstanced mechanism's plane sat, by its
 * viewOrientation. World frame: +y up, wearer front +x, wearer-left +z. */
const V6_FRAMES: Record<string, { x: Vec3M; y: Vec3M; z: Vec3M }> = {
  'side-left': { x: mV(1, 0, 0), y: mV(0, 1, 0), z: mV(0, 0, 1) },
  'side-right': { x: mV(-1, 0, 0), y: mV(0, 1, 0), z: mV(0, 0, -1) },
  front: { x: mV(0, 0, -1), y: mV(0, 1, 0), z: mV(1, 0, 0) },
  back: { x: mV(0, 0, 1), y: mV(0, 1, 0), z: mV(-1, 0, 0) },
  top: { x: mV(1, 0, 0), y: mV(0, 0, 1), z: mV(0, -1, 0) },
  free: { x: mV(0, 0, -1), y: mV(0, 1, 0), z: mV(1, 0, 0) },
};

const V6_ORIGINS: Record<string, Vec3M> = {
  'side-left': mV(0, 0, 0.25),
  'side-right': mV(0, 0, -0.25),
  front: mV(0.25, 0, 0),
  back: mV(-0.25, 0, 0),
  top: mV(0, 1.45, 0),
  free: mV(0.25, 0, 0),
};

function v6DefaultPlacement(viewOrientation: unknown): { origin: Vec3M; rot: QuatM } {
  const key =
    typeof viewOrientation === 'string' && viewOrientation in V6_FRAMES ? viewOrientation : 'free';
  const f = V6_FRAMES[key]!;
  return { origin: V6_ORIGINS[key]!, rot: mQuatFromBasis(f.x, f.y, f.z) };
}

/** Frozen rest-pose wearer anchor positions: src/wearer/skeleton.ts
 * computeSkeleton() evaluated at REST_POSE (all joint angles 0), with the
 * Drillis & Contini anthropometry fractions inlined. Used to resolve
 * 'wearerAnchor' transform drives. Formulas frozen forever. */
function v6RestAnchors(wearer: Json): Record<string, Vec3M> {
  const H = typeof wearer.heightM === 'number' ? wearer.heightM : 1.75;
  const shoulderW = typeof wearer.shoulderWidthM === 'number' ? wearer.shoulderWidthM : 0.46;
  const hipW = typeof wearer.hipWidthM === 'number' ? wearer.hipWidthM : 0.36;
  const hipY = 0.53 * H;
  const shoulderY = 0.818 * H;
  const handY = shoulderY - 0.186 * H - 0.146 * H;
  const kneeY = hipY - 0.245 * H;
  const ankleY = kneeY - 0.246 * H;
  const shoulderZ = shoulderW / 2;
  const hipZ = hipW / 2;
  const beltZ = hipZ + 0.02;
  const rectZ = hipZ + 0.03;
  return {
    shoulderL: mV(0, shoulderY, shoulderZ),
    shoulderR: mV(0, shoulderY, -shoulderZ),
    spineTop: mV(0, shoulderY, 0),
    beltL: mV(0, hipY, beltZ),
    beltR: mV(0, hipY, -beltZ),
    beltBack: mV(-0.1, hipY, 0),
    hipRectFrontL: mV(0.12, hipY, rectZ),
    hipRectFrontR: mV(0.12, hipY, -rectZ),
    hipRectBackL: mV(-0.14, hipY, rectZ),
    hipRectBackR: mV(-0.14, hipY, -rectZ),
    thighL: mV(0, (hipY + kneeY) / 2, hipZ),
    thighR: mV(0, (hipY + kneeY) / 2, -hipZ),
    calfL: mV(0, (kneeY + ankleY) / 2, hipZ),
    calfR: mV(0, (kneeY + ankleY) / 2, -hipZ),
    shoeL: mV(0.1, ankleY - 0.039 * H, hipZ),
    shoeR: mV(0.1, ankleY - 0.039 * H, -hipZ),
    handL: mV(0, handY, shoulderZ),
    handR: mV(0, handY, -shoulderZ),
  };
}

const NOTE_STATIC_BAKE =
  "re-joint needed: this plane was driven by another mechanism's nodes (static bake)";
const NOTE_UNRESOLVED = 're-joint needed: transform drive could not be resolved';

// Loose structural views of the v6 document (plain JSON, never app types).
interface V6Vec2 {
  x: number;
  y: number;
}
interface V6Node {
  [k: string]: unknown;
  id: string;
  position: V6Vec2;
  channelId?: string;
}
interface V6Channel {
  [k: string]: unknown;
  id: string;
  name: string;
}
interface V6NamedState {
  [k: string]: unknown;
  name: string;
  positions?: Record<string, V6Vec2>;
  channelValues?: Record<string, number>;
}
interface V6Mechanism {
  [k: string]: unknown;
  id: string;
  name: string;
  viewOrientation?: string;
  nodes?: V6Node[];
  elements?: Json[];
  pointMasses?: Json[];
  skeletonBindings?: Json[];
  anchorBindings?: Json[];
  inputs?: V6Channel[];
  namedStates?: V6NamedState[];
}
interface V6Drive {
  [k: string]: unknown;
  kind: string;
  anchor?: string;
  instanceId?: string;
  originNodeId?: string;
  axisNodeId?: string;
}
interface V6Instance {
  [k: string]: unknown;
  id: string;
  name: string;
  mechanismId: string;
  position: Vec3M;
  quaternion: QuatM;
  mirror?: boolean;
  transformDrive?: V6Drive;
}
interface V6Target {
  [k: string]: unknown;
  kind: string;
  anchor?: string;
  instanceId?: string;
  nodeId?: string;
}
interface V6Binding {
  [k: string]: unknown;
  id: string;
  instanceId: string;
  anchorNodeId: string;
  target: V6Target;
}
interface V6Attached {
  [k: string]: unknown;
  id: string;
  attach: V6Target;
}
interface V6Assembly {
  instances?: V6Instance[];
  bindings?: V6Binding[];
  pointMasses?: V6Attached[];
  foamPlates?: V6Attached[];
}

interface V6Frame {
  origin: Vec3M;
  rot: QuatM;
}

/** liftNode from src/assembly/compose.ts, frozen: mirror flips local x
 * before rotation, and the 2D plane embeds at local z = 0. */
function liftPointV6(p: V6Vec2, frame: V6Frame, mirror: boolean): Vec3M {
  return mAdd(frame.origin, mRotate(frame.rot, mV(mirror ? -p.x : p.x, p.y, 0)));
}

/** Suffix ids and add the hinge joint while lifting one element. `eid` maps
 * element ids, `nid` maps node ids (suffix + weld-by-unification rewrite). */
function liftElementV6(
  el: Json,
  eid: (id: string) => string,
  nid: (id: string) => string,
  hingeAxis: Vec3M,
): Json {
  const out: Json = { ...el, id: eid(el.id as string) };
  if (Array.isArray(el.pointMasses)) {
    out.pointMasses = (el.pointMasses as Json[]).map((pm) => ({
      ...pm,
      id: eid(pm.id as string),
    }));
  }
  switch (el.type) {
    case 'link':
    case 'telescope':
    case 'elastic':
      out.nodeA = nid(el.nodeA as string);
      out.nodeB = nid(el.nodeB as string);
      break;
    case 'bentLink':
      out.nodeIds = (el.nodeIds as string[]).map(nid);
      break;
    case 'pivot': {
      out.nodeId = nid(el.nodeId as string);
      out.memberIds = (el.memberIds as string[]).map(eid);
      out.welds = (el.welds as Array<[string, string]>).map(([a, b]) => [eid(a), eid(b)]);
      const limit = el.angleLimit as Json | undefined;
      if (limit) {
        out.angleLimit = {
          ...limit,
          memberA: eid(limit.memberA as string),
          memberB: eid(limit.memberB as string),
        };
      }
      const spring = el.torsionSpring as Json | undefined;
      if (spring) {
        out.torsionSpring = {
          ...spring,
          memberA: eid(spring.memberA as string),
          memberB: eid(spring.memberB as string),
        };
      }
      // v6 pivots were pins in the sketch plane: the hinge axis is the lifted
      // plane normal (mirrored copies flip it so signed angle limits keep
      // their meaning under reflection).
      out.joint = { kind: 'hinge', axis: { ...hingeAxis } };
      break;
    }
    case 'slider':
      out.nodeId = nid(el.nodeId as string);
      out.alongElementId = eid(el.alongElementId as string);
      break;
    case 'rope':
      out.path = (el.path as string[]).map(nid);
      break;
    case 'bowden':
      out.a1 = nid(el.a1 as string);
      out.a2 = nid(el.a2 as string);
      out.b1 = nid(el.b1 as string);
      out.b2 = nid(el.b2 as string);
      break;
    case 'torsionCable':
      out.pivotA = eid(el.pivotA as string);
      out.pivotB = eid(el.pivotB as string);
      break;
    default:
      break;
  }
  return out;
}

/** One lifted copy of a v6 mechanism: a real assembly instance, or a
 * synthetic instance at the viewOrientation's default placement when the
 * mechanism was never placed. */
interface V6Copy {
  mechanism: V6Mechanism;
  instanceId?: string;
  groupId: string;
  groupName: string;
  frame: V6Frame;
  mirror: boolean;
  /** '' or `@<instanceId>` (only when the mechanism has >1 instance) */
  suffix: string;
  /** '' or ` — <instance name>` for named-state disambiguation */
  stateSuffix: string;
  note?: string;
}

function migrateV6ToV7(doc: Json): Json {
  const mechanisms = (Array.isArray(doc.mechanisms) ? doc.mechanisms : []) as V6Mechanism[];
  const assembly = (
    typeof doc.assembly === 'object' && doc.assembly !== null ? doc.assembly : {}
  ) as V6Assembly;
  const bindings = Array.isArray(assembly.bindings) ? assembly.bindings : [];
  const anchors = v6RestAnchors((doc.wearer ?? {}) as Json);
  const mechById = new Map(mechanisms.map((m) => [m.id, m]));
  const instances = (Array.isArray(assembly.instances) ? assembly.instances : []).filter((i) =>
    mechById.has(i.mechanismId),
  );
  const instById = new Map(instances.map((i) => [i.id, i]));

  // -- resolve instance frames (compose.ts driveFrame semantics, frozen).
  // 'instanceNodes' parents use the DRAWN (document) node positions — the
  // static bake at the design pose. Iterate to a fixed point; cyclic or
  // dangling drives fall back to 'fixed' with a group note.
  const frames = new Map<string, V6Frame>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const inst of instances) {
      if (frames.has(inst.id)) continue;
      const drive = inst.transformDrive ?? { kind: 'fixed' };
      let base: V6Frame | null = null;
      if (drive.kind === 'wearerAnchor') {
        const a = drive.anchor === undefined ? undefined : anchors[drive.anchor];
        if (a) base = { origin: a, rot: M_IDENTITY_Q };
      } else if (drive.kind === 'instanceNodes') {
        const parent = drive.instanceId === undefined ? undefined : instById.get(drive.instanceId);
        const parentFrame = parent ? frames.get(parent.id) : undefined;
        if (parent && parentFrame) {
          const parentNodes = mechById.get(parent.mechanismId)?.nodes ?? [];
          const oNode = parentNodes.find((n) => n.id === drive.originNodeId);
          const aNode = parentNodes.find((n) => n.id === drive.axisNodeId);
          if (oNode && aNode) {
            const o = liftPointV6(oNode.position, parentFrame, parent.mirror === true);
            const a = liftPointV6(aNode.position, parentFrame, parent.mirror === true);
            const xAxis = mNormalize(mSub(a, o));
            if (mDot(xAxis, xAxis) > 0.5) {
              // local +x → origin→axis heading; +y kept toward world up.
              let zAxis = mCross(xAxis, mV(0, 1, 0));
              if (mDot(zAxis, zAxis) < 1e-9) zAxis = mV(0, 0, 1);
              zAxis = mNormalize(zAxis);
              const yAxis = mCross(zAxis, xAxis);
              base = { origin: o, rot: mQuatFromBasis(xAxis, yAxis, zAxis) };
            }
          }
        }
      } else {
        base = { origin: mV(0, 0, 0), rot: M_IDENTITY_Q };
      }
      if (!base) continue;
      frames.set(inst.id, {
        origin: mAdd(base.origin, mRotate(base.rot, inst.position)),
        rot: mMulQ(base.rot, inst.quaternion),
      });
      progressed = true;
    }
  }
  const instanceNotes = new Map<string, string>();
  for (const inst of instances) {
    if (!frames.has(inst.id)) {
      instanceNotes.set(inst.id, NOTE_UNRESOLVED);
      frames.set(inst.id, { origin: inst.position, rot: inst.quaternion });
    } else if (inst.transformDrive?.kind === 'instanceNodes') {
      instanceNotes.set(inst.id, NOTE_STATIC_BAKE);
    }
  }

  // -- one copy per mechanism × instance, in mechanism order then instance
  // order (deterministic concatenation).
  const copies: V6Copy[] = [];
  for (const mech of mechanisms) {
    const own = instances.filter((i) => i.mechanismId === mech.id);
    if (own.length === 0) {
      const placement = v6DefaultPlacement(mech.viewOrientation);
      copies.push({
        mechanism: mech,
        groupId: mech.id,
        groupName: mech.name,
        frame: { origin: placement.origin, rot: placement.rot },
        mirror: false,
        suffix: '',
        stateSuffix: '',
      });
      continue;
    }
    const multi = own.length > 1;
    for (const inst of own) {
      copies.push({
        mechanism: mech,
        instanceId: inst.id,
        groupId: inst.id,
        groupName: inst.name,
        frame: frames.get(inst.id)!,
        mirror: inst.mirror === true,
        suffix: multi ? `@${inst.id}` : '',
        stateSuffix: multi ? ` — ${inst.name}` : '',
        note: instanceNotes.get(inst.id),
      });
    }
  }
  const copyByInstance = new Map(
    copies.filter((c) => c.instanceId !== undefined).map((c) => [c.instanceId!, c]),
  );

  // -- channels: one flat list deduped by NAME (first definition wins), each
  // mechanism contributing its inputs once. channelMaps remaps a mechanism's
  // local channel ids to the surviving global ids.
  const channels: V6Channel[] = [];
  const survivorByName = new Map<string, string>();
  const usedChannelIds = new Set<string>();
  const channelMaps = new Map<string, Map<string, string>>();
  for (const mech of mechanisms) {
    const map = new Map<string, string>();
    for (const ch of mech.inputs ?? []) {
      const survivor = survivorByName.get(ch.name);
      if (survivor !== undefined) {
        map.set(ch.id, survivor);
        continue;
      }
      const gid = usedChannelIds.has(ch.id) ? `${ch.id}@${mech.id}` : ch.id;
      usedChannelIds.add(gid);
      survivorByName.set(ch.name, gid);
      channels.push({ ...ch, id: gid });
      map.set(ch.id, gid);
    }
    channelMaps.set(mech.id, map);
  }

  // -- attachment bindings: wearer-anchor targets become anchorBindings;
  // instance-node targets unify the anchor node into the target node (weld by
  // unification — the anchor node is dropped and every reference rewritten).
  const rename = new Map<string, string>();
  const boundAnchorBindings: Json[] = [];
  for (const b of bindings) {
    const src = copyByInstance.get(b.instanceId);
    if (!src) continue;
    const srcId = `${b.anchorNodeId}${src.suffix}`;
    if (b.target.kind === 'wearerAnchor' && b.target.anchor !== undefined) {
      boundAnchorBindings.push({ id: b.id, anchor: b.target.anchor, nodeId: srcId });
    } else if (b.target.kind === 'instanceNode' && b.target.nodeId !== undefined) {
      const dst =
        b.target.instanceId === undefined ? undefined : copyByInstance.get(b.target.instanceId);
      if (!dst) continue;
      rename.set(srcId, `${b.target.nodeId}${dst.suffix}`);
    }
  }
  const resolveNode = (id: string): string => {
    let cur = id;
    const seen = new Set<string>([cur]);
    for (;;) {
      const next = rename.get(cur);
      if (next === undefined || seen.has(next)) return cur;
      seen.add(next);
      cur = next;
    }
  };

  // -- lift each copy's geometry into the compound mechanism.
  const nodesOut: Json[] = [];
  const elementsOut: Json[] = [];
  const massesOut: Json[] = [];
  const skeletonOut: Json[] = [];
  const anchorOut: Json[] = [];
  const statesOut: Json[] = [];
  const groupsOut: Json[] = [];
  for (const copy of copies) {
    const mech = copy.mechanism;
    const chMap = channelMaps.get(mech.id) ?? new Map<string, string>();
    const eid = (id: string): string => `${id}${copy.suffix}`;
    const nid = (id: string): string => resolveNode(`${id}${copy.suffix}`);
    const lift = (p: V6Vec2): Vec3M => liftPointV6(p, copy.frame, copy.mirror);
    const hingeAxis = mNormalize(mRotate(copy.frame.rot, mV(0, 0, copy.mirror ? -1 : 1)));

    for (const node of mech.nodes ?? []) {
      const lifted = eid(node.id);
      if (rename.has(lifted)) continue; // unified into its binding target
      const out: Json = { ...node, id: lifted, position: lift(node.position) };
      if (typeof node.channelId === 'string') {
        out.channelId = chMap.get(node.channelId) ?? node.channelId;
      }
      nodesOut.push(out);
    }

    const elementIds: string[] = [];
    for (const el of mech.elements ?? []) {
      const lifted = liftElementV6(el, eid, nid, hingeAxis);
      elementIds.push(lifted.id as string);
      elementsOut.push(lifted);
    }

    for (const pm of mech.pointMasses ?? []) {
      massesOut.push({ ...pm, id: eid(pm.id as string), nodeId: nid(pm.nodeId as string) });
    }
    for (const sb of mech.skeletonBindings ?? []) {
      skeletonOut.push({ ...sb, id: eid(sb.id as string), nodeId: nid(sb.nodeId as string) });
    }
    for (const ab of mech.anchorBindings ?? []) {
      anchorOut.push({ ...ab, id: eid(ab.id as string), nodeId: nid(ab.nodeId as string) });
    }

    for (const st of mech.namedStates ?? []) {
      const positions: Json = {};
      for (const [nodeId, pos] of Object.entries(st.positions ?? {})) {
        const key = nid(nodeId);
        if (!(key in positions)) positions[key] = lift(pos);
      }
      const channelValues: Json = {};
      for (const [chId, value] of Object.entries(st.channelValues ?? {})) {
        const key = chMap.get(chId) ?? chId;
        if (!(key in channelValues)) channelValues[key] = value;
      }
      statesOut.push({ ...st, name: `${st.name}${copy.stateSuffix}`, positions, channelValues });
    }

    groupsOut.push({
      id: copy.groupId,
      name: copy.groupName,
      elementIds,
      ...(copy.note === undefined ? {} : { note: copy.note }),
    });
  }

  // -- assembly point masses / foam plates move to project level with the
  // new attach-target shape; instance-node attaches resolve to lifted node
  // ids. Items pointing at a missing instance are dropped (dangling in v6).
  const convertAttach = (t: V6Target): Json | null => {
    if (t.kind === 'wearerAnchor' && t.anchor !== undefined) {
      return { kind: 'wearerAnchor', anchor: t.anchor };
    }
    if (t.kind === 'instanceNode' && t.instanceId !== undefined && t.nodeId !== undefined) {
      const copy = copyByInstance.get(t.instanceId);
      if (!copy) return null;
      return { kind: 'node', nodeId: resolveNode(`${t.nodeId}${copy.suffix}`) };
    }
    return null;
  };
  const pointMassesOut: Json[] = [];
  for (const pm of assembly.pointMasses ?? []) {
    const attach = convertAttach(pm.attach);
    if (attach) pointMassesOut.push({ ...pm, attach });
  }
  const foamPlatesOut: Json[] = [];
  for (const fp of assembly.foamPlates ?? []) {
    const attach = convertAttach(fp.attach);
    if (attach) foamPlatesOut.push({ ...fp, attach });
  }

  // -- control mounts (§4.4) used the v6 assembly attach-target shape;
  // instance-node mounts resolve to lifted node ids. A mount whose instance
  // is gone is dropped: the control becomes desk-fixed instead of dangling.
  const controlsOut = (Array.isArray(doc.controls) ? (doc.controls as Json[]) : []).map((c) => {
    const mount = c.mount as V6Target | undefined;
    if (!mount) return c;
    const converted = convertAttach(mount);
    const { mount: _mount, ...restOfControl } = c;
    return converted ? { ...restOfControl, mount: converted } : restOfControl;
  });

  const { mechanisms: _mechanisms, assembly: _assembly, ...rest } = doc;
  const projectId = typeof doc.id === 'string' ? doc.id : 'project';
  const projectName = typeof doc.name === 'string' && doc.name.length > 0 ? doc.name : 'Project';
  return {
    ...rest,
    mechanism: {
      id: `${projectId}-mechanism`,
      name: projectName,
      nodes: nodesOut,
      elements: elementsOut,
      pointMasses: massesOut,
      skeletonBindings: skeletonOut,
      anchorBindings: [
        ...anchorOut,
        ...boundAnchorBindings.map((b) => ({ ...b, nodeId: resolveNode(b.nodeId as string) })),
      ],
      inputs: channels,
      namedStates: statesOut,
    },
    groups: groupsOut,
    pointMasses: pointMassesOut,
    foamPlates: foamPlatesOut,
    controls: controlsOut,
  };
}

export class MigrationError extends Error {}

/** Run the migration chain from `from` (exclusive of `to`). Exported so the
 * chaining/stamping/missing-step behavior stays testable while the real
 * registry is still empty (version 1 is the first release). */
export function applyMigrations(
  doc: Record<string, unknown>,
  from: number,
  to: number,
  registry: Record<number, Migration>,
): Record<string, unknown> {
  let out = doc;
  for (let v = from; v < to; v++) {
    const step = registry[v];
    if (!step) throw new MigrationError(`no migration from schemaVersion ${v}`);
    out = { ...step(out), schemaVersion: v + 1 };
  }
  return out;
}

/** Upgrade an arbitrary parsed JSON document to the current schema and
 * validate it. Accepts documents written by any released schema version. */
export function migrateToLatest(
  raw: unknown,
  registry: Record<number, Migration> = migrations,
): Project {
  if (typeof raw !== 'object' || raw === null) {
    throw new MigrationError('project file is not an object');
  }
  let doc = raw as Record<string, unknown>;
  const version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MigrationError(`invalid schemaVersion: ${String(version)}`);
  }
  if (version > SCHEMA_VERSION) {
    throw new MigrationError(
      `project was written by a newer app (schemaVersion ${version} > ${SCHEMA_VERSION})`,
    );
  }
  doc = applyMigrations(doc, version, SCHEMA_VERSION, registry);
  const parsed = projectSchema.safeParse(doc);
  if (!parsed.success) {
    throw new MigrationError(`project failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}
