// Marquee (drag-box) hit-testing: pure 2D geometry, crossing semantics —
// touching the box selects (the friendlier CAD convention).
//
// Deliberately 2D in the fully-3D app (PLANFILE-3d-conversion.md): a marquee
// is a rectangle in an ortho panel, so callers project the document's Vec3
// positions into that panel's plane coordinates FIRST (panelProject in the
// quad UI) and pass the projected {x, y} record here, along with the rect in
// the same panel coordinates. Span elements (links, cordage) test their
// segments; node-carried elements (pivots, sliders) test their node; a
// torsion cable tests either coupled pivot's node. Positions come from the
// caller so the posed geometry is what gets hit-tested, matching the screen.
import type { Mechanism, Vec2 } from '../schema';

export interface WorldRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Order any two drag corners into min/max form. */
export function normalizedRect(a: Vec2, b: Vec2): WorldRect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

const pointInRect = (p: Vec2, r: WorldRect): boolean =>
  p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

/** Liang–Barsky style clip test: does segment a→b touch the rect? */
export function segmentIntersectsRect(a: Vec2, b: Vec2, r: WorldRect): boolean {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  // clip against each slab: p·t ≤ q
  const clips: Array<[number, number]> = [
    [-dx, a.x - r.minX],
    [dx, r.maxX - a.x],
    [-dy, a.y - r.minY],
    [dy, r.maxY - a.y],
  ];
  for (const [p, q] of clips) {
    if (p === 0) {
      if (q < 0) return false; // parallel and outside the slab
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return t0 <= t1;
}

function polylineIntersectsRect(points: Array<Vec2 | undefined>, r: WorldRect): boolean {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b && segmentIntersectsRect(a, b, r)) return true;
  }
  // a single resolvable point (degenerate polyline) still counts when inside
  if (points.length === 1 && points[0]) return pointInRect(points[0], r);
  return false;
}

/** Element ids whose on-screen geometry touches the world-space rect.
 * Missing positions are skipped (mid-edit states must not throw). */
export function elementIdsInRect(
  mech: Mechanism,
  positions: Record<string, Vec2>,
  rect: WorldRect,
): string[] {
  const at = (nodeId: string): Vec2 | undefined => positions[nodeId];
  const nodeHit = (nodeId: string): boolean => {
    const p = at(nodeId);
    return p !== undefined && pointInRect(p, rect);
  };
  const pivotNodeId = (pivotElementId: string): string | undefined => {
    const el = mech.elements.find((e) => e.id === pivotElementId);
    return el && (el.type === 'pivot' || el.type === 'slider') ? el.nodeId : undefined;
  };

  const out: string[] = [];
  for (const el of mech.elements) {
    let hit = false;
    switch (el.type) {
      case 'link':
      case 'telescope':
      case 'elastic':
        hit = polylineIntersectsRect([at(el.nodeA), at(el.nodeB)], rect);
        break;
      case 'bentLink':
        hit = polylineIntersectsRect(el.nodeIds.map(at), rect);
        break;
      case 'rope':
        hit = polylineIntersectsRect(el.path.map(at), rect);
        break;
      case 'bowden':
        hit =
          polylineIntersectsRect([at(el.a1), at(el.a2)], rect) ||
          polylineIntersectsRect([at(el.b1), at(el.b2)], rect);
        break;
      case 'pivot':
      case 'slider':
        hit = nodeHit(el.nodeId);
        break;
      case 'torsionCable': {
        const a = pivotNodeId(el.pivotA);
        const b = pivotNodeId(el.pivotB);
        hit = (a !== undefined && nodeHit(a)) || (b !== undefined && nodeHit(b));
        break;
      }
    }
    if (hit) out.push(el.id);
  }
  return out;
}
