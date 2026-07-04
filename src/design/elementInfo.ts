// Pure derived-information helpers for the info panel (§8.2a): geometry,
// computed mass, connections, and channel bindings. Framework-free so the
// panel's logic unit-tests without a DOM.
import { deflectionAngleRad, developedLengthM, polylineLengthM } from '../geometry/pipe';
import type { MaterialsDb, Mechanism, MechanismElement, Vec2 } from '../schema';

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

function positions(mech: Mechanism, nodeIds: string[]): Vec2[] {
  const byId = new Map(mech.nodes.map((n) => [n.id, n.position]));
  return nodeIds.map((id) => byId.get(id)).filter((p): p is Vec2 => p !== undefined);
}

export interface ElementGeometry {
  /** node-to-node (link/telescope), path (rope/elastic), or polyline length */
  lengthM?: number;
  /** developed (arc) length for bentLink (§4.2) */
  developedLengthM?: number;
  /** interior vertex deflection angles for bentLink, radians */
  vertexAnglesRad?: number[];
  /** endpoint (or path) coordinates in mechanism space */
  points: Vec2[];
}

/** Geometry block for the info panel. Uses document positions. */
export function elementGeometry(el: MechanismElement, mech: Mechanism): ElementGeometry {
  const pts = positions(mech, elementNodeIds(el, mech));
  switch (el.type) {
    case 'link':
    case 'telescope':
    case 'elastic':
    case 'rope':
      return { lengthM: polylineLengthM(pts), points: pts };
    case 'bentLink': {
      const angles: number[] = [];
      for (let i = 1; i < pts.length - 1; i++) {
        angles.push(deflectionAngleRad(pts[i - 1]!, pts[i]!, pts[i + 1]!));
      }
      return {
        lengthM: polylineLengthM(pts),
        developedLengthM: developedLengthM(pts, el.filletRadiiM),
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
      return polylineLengthM(positions(mech, [el.nodeA, el.nodeB])) * pm.linearDensityKgPerM;
    }
    case 'bentLink': {
      const pm = pipe(el.pipeMaterialId);
      if (!pm) return undefined;
      return (
        developedLengthM(positions(mech, el.nodeIds), el.filletRadiiM) * pm.linearDensityKgPerM
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
