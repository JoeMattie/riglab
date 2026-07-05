// Pure derived-information helpers for the info panel (§8.2a): geometry,
// computed mass, connections, and channel bindings. Framework-free so the
// panel's logic unit-tests without a DOM.
//
// v7 (PLANFILE-3d-conversion.md): positions are Vec3, so lengths/angles are
// computed in 3D here. The Vec2 helpers in src/geometry/pipe.ts (shared with
// the BOM bend schedule) are being generalized in parallel; once they are
// Vec3, these local versions can fold back into that single source of truth.
import { dot, length, sub } from '../geometry/math3';
import type { MaterialsDb, Mechanism, MechanismElement, Vec3 } from '../schema';

const distM = (a: Vec3, b: Vec3): number => length(sub(b, a));

/** Sharp polyline (chord) length through the points, in 3D. */
export function polylineLength3M(points: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distM(points[i - 1]!, points[i]!);
  return total;
}

/** Deflection (turn) angle at an interior vertex in 3D: 0 = straight through,
 * π = full reversal. */
export function deflectionAngle3Rad(prev: Vec3, vertex: Vec3, next: Vec3): number {
  const din = sub(vertex, prev);
  const dout = sub(next, vertex);
  const li = length(din);
  const lo = length(dout);
  if (li < 1e-12 || lo < 1e-12) return 0;
  const cos = dot(din, dout) / (li * lo);
  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

/** Developed (centre-line) length of a heat-bent pipe through 3D points, with
 * an optional fillet radius per interior vertex. A fillet of radius r at a
 * vertex of deflection φ replaces 2·r·tan(φ/2) of sharp polyline with an r·φ
 * arc: developed = Σ segments − Σ_vertices r·(2·tan(φ/2) − φ). Clamped ≥ 0. */
export function developedLength3M(points: Vec3[], filletRadiiM: number[]): number {
  let total = polylineLength3M(points);
  for (let i = 1; i < points.length - 1; i++) {
    const r = filletRadiiM[i - 1] ?? 0;
    if (r <= 0) continue;
    const phi = deflectionAngle3Rad(points[i - 1]!, points[i]!, points[i + 1]!);
    total -= r * (2 * Math.tan(phi / 2) - phi);
  }
  return Math.max(0, total);
}

/** The nodes an element touches, in schema order. */
export function elementNodeIds(el: MechanismElement, mech: Mechanism): string[] {
  switch (el.type) {
    case 'link':
    case 'telescope':
    case 'elastic':
      return [el.nodeA, el.nodeB];
    case 'bentLink':
      return [...el.nodeIds];
    case 'pivot':
    case 'slider':
      return [el.nodeId];
    case 'rope':
      return [...el.path];
    case 'bowden':
      return [el.a1, el.a2, el.b1, el.b2];
    case 'torsionCable': {
      const ids: string[] = [];
      for (const pid of [el.pivotA, el.pivotB]) {
        const p = mech.elements.find((e) => e.id === pid);
        if (p?.type === 'pivot') ids.push(p.nodeId);
      }
      return ids;
    }
  }
}

function positions(mech: Mechanism, nodeIds: string[]): Vec3[] {
  const byId = new Map(mech.nodes.map((n) => [n.id, n.position]));
  return nodeIds.map((id) => byId.get(id)).filter((p): p is Vec3 => p !== undefined);
}

export interface ElementGeometry {
  /** node-to-node (link/telescope), path (rope/elastic), or polyline length */
  lengthM?: number;
  /** developed (arc) length for bentLink (§4.2) */
  developedLengthM?: number;
  /** interior vertex deflection angles for bentLink, radians */
  vertexAnglesRad?: number[];
  /** endpoint (or path) coordinates in document (world) space */
  points: Vec3[];
}

/** Geometry block for the info panel. Uses document positions. */
export function elementGeometry(el: MechanismElement, mech: Mechanism): ElementGeometry {
  const pts = positions(mech, elementNodeIds(el, mech));
  switch (el.type) {
    case 'link':
    case 'telescope':
    case 'elastic':
    case 'rope':
      return { lengthM: polylineLength3M(pts), points: pts };
    case 'bentLink': {
      const angles: number[] = [];
      for (let i = 1; i < pts.length - 1; i++) {
        angles.push(deflectionAngle3Rad(pts[i - 1]!, pts[i]!, pts[i + 1]!));
      }
      return {
        lengthM: polylineLength3M(pts),
        developedLengthM: developedLength3M(pts, el.filletRadiiM),
        vertexAnglesRad: angles,
        points: pts,
      };
    }
    default:
      return { points: pts };
  }
}

/** Computed mass (§8.2a design scope): length × linear density. Telescope
 * overlap counts both members (§4.2), matching the BOM's member split.
 * Undefined while the required material assignment is missing. */
export function elementMassKg(
  el: MechanismElement,
  mech: Mechanism,
  materials: MaterialsDb,
): number | undefined {
  const pipe = (id?: string) => materials.pipes.find((p) => p.id === id);
  const cord = (id?: string) => materials.cordage.find((c) => c.id === id);
  switch (el.type) {
    case 'link': {
      const pm = pipe(el.pipeMaterialId);
      if (!pm) return undefined;
      return polylineLength3M(positions(mech, [el.nodeA, el.nodeB])) * pm.linearDensityKgPerM;
    }
    case 'bentLink': {
      const pm = pipe(el.pipeMaterialId);
      if (!pm) return undefined;
      return (
        developedLength3M(positions(mech, el.nodeIds), el.filletRadiiM) * pm.linearDensityKgPerM
      );
    }
    case 'telescope': {
      const om = pipe(el.outerPipeMaterialId);
      const im = pipe(el.innerPipeMaterialId);
      if (!om || !im) return undefined;
      const ov = el.overlapM ?? 2 * im.outerDiameterM;
      return (
        (el.lengthM / 2) * om.linearDensityKgPerM + (el.lengthM / 2 + ov) * im.linearDensityKgPerM
      );
    }
    case 'rope': {
      const cm = cord(el.cordageMaterialId);
      return cm ? el.lengthM * cm.linearDensityKgPerM : undefined;
    }
    case 'elastic': {
      const cm = cord(el.cordageMaterialId);
      return cm ? el.restLengthM * cm.linearDensityKgPerM : undefined;
    }
    case 'bowden': {
      const cm = cord(el.cordageMaterialId);
      return cm ? (el.restLengthAM + el.restLengthBM) * cm.linearDensityKgPerM : undefined;
    }
    default:
      return undefined;
  }
}

export interface Connection {
  elementId: string;
  type: MechanismElement['type'];
  /** the shared node through which the two elements touch */
  nodeId: string;
}

/** Elements sharing at least one node with `el` — the "what it connects to"
 * block; each entry is clickable to navigate the selection (§8.2a). */
export function connectedElements(el: MechanismElement, mech: Mechanism): Connection[] {
  const own = new Set(elementNodeIds(el, mech));
  const out: Connection[] = [];
  for (const other of mech.elements) {
    if (other.id === el.id) continue;
    const shared = elementNodeIds(other, mech).find((id) => own.has(id));
    if (shared) out.push({ elementId: other.id, type: other.type, nodeId: shared });
  }
  return out;
}

/** Input channels bound (via driven nodes) to any of the element's nodes. */
export function boundChannelNames(el: MechanismElement, mech: Mechanism): string[] {
  const own = new Set(elementNodeIds(el, mech));
  const channelIds = new Set(
    mech.nodes
      .filter((n) => own.has(n.id) && n.kind === 'driven' && n.channelId)
      .map((n) => n.channelId),
  );
  return mech.inputs.filter((c) => channelIds.has(c.id)).map((c) => c.name);
}
