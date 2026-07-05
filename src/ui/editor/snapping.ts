// Pure snap resolution for the sketch canvas (§8.1): endpoints snap to
// nodes, silhouette skeleton points/anchors, along-pipe points (midpoint
// preferred), and the grid — in that priority order.
import type { Mechanism, SkeletonPoint, Vec2, WearerAnchor } from '../../schema';
import type { Silhouette } from '../../wearer';

/** 0.5" default grid (§8.1), in meters. */
export const GRID_M = 0.0127;

export type Snap =
  | { kind: 'node'; nodeId: string; pos: Vec2 }
  | { kind: 'skeleton'; point: SkeletonPoint; pos: Vec2 }
  | { kind: 'anchor'; anchor: WearerAnchor; pos: Vec2 }
  | { kind: 'onPipe'; elementId: string; t: number; pos: Vec2 }
  | { kind: 'grid'; pos: Vec2 };

export interface SnapContext {
  mechanism: Mechanism;
  /** live positions (pose during playback/drag, else document positions) */
  positions: Record<string, Vec2>;
  silhouette: Silhouette | null;
  /** snap radius in world meters (derived from px tolerance / zoom) */
  tolM: number;
  gridM?: number;
  /** nodes to ignore (e.g. the node being dragged) */
  exclude?: ReadonlySet<string>;
  /** elements whose spans must not attract onPipe snaps — e.g. every pipe
   * incident to a dragged endpoint, whose geometry moves with the pointer
   * (snapping to them would chase a moving target and oscillate) */
  excludeElements?: ReadonlySet<string>;
}

const d = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Konva's dblclick is time-based (fires for any two clicks within its window,
 * regardless of position), so a multi-point drawing tool must only treat a
 * dblclick as "finish" when the double-click's two mousedowns landed on the
 * same spot — i.e. the last two committed points are coincident. Otherwise
 * the dblclick is just a rapid pair of distinct waypoints and drafting
 * continues.
 */
export function isCoincidentFinish(points: readonly Vec2[], tol = 1e-6): boolean {
  const n = points.length;
  return n >= 2 && d(points[n - 1]!, points[n - 2]!) <= tol;
}

/** Drop consecutive duplicate points (the double-click's own mousedowns
 * inject the finish position twice). */
export function dedupConsecutive(points: readonly Vec2[], tol = 1e-6): Vec2[] {
  return points.filter((p, i) => i === 0 || d(p, points[i - 1]!) > tol);
}

export function findSnap(world: Vec2, ctx: SnapContext): Snap {
  const { mechanism, positions, silhouette, tolM } = ctx;
  const gridM = ctx.gridM ?? GRID_M;

  let best: { snap: Snap; dist: number; priority: number } | null = null;
  const consider = (snap: Snap, dist: number, priority: number) => {
    if (dist > tolM) return;
    if (!best || priority < best.priority || (priority === best.priority && dist < best.dist)) {
      best = { snap, dist, priority };
    }
  };

  for (const n of mechanism.nodes) {
    if (ctx.exclude?.has(n.id)) continue;
    const p = positions[n.id] ?? n.position;
    consider({ kind: 'node', nodeId: n.id, pos: p }, d(world, p), 0);
  }

  if (silhouette) {
    for (const [point, p] of Object.entries(silhouette.points)) {
      consider({ kind: 'skeleton', point: point as SkeletonPoint, pos: p }, d(world, p), 1);
    }
    for (const [anchor, p] of Object.entries(silhouette.anchors)) {
      consider({ kind: 'anchor', anchor: anchor as WearerAnchor, pos: p }, d(world, p), 1);
    }
  }

  for (const el of mechanism.elements) {
    if (el.type !== 'link' && el.type !== 'telescope') continue;
    if (ctx.excludeElements?.has(el.id)) continue;
    const a = positions[el.nodeA] ?? mechanism.nodes.find((n) => n.id === el.nodeA)?.position;
    const b = positions[el.nodeB] ?? mechanism.nodes.find((n) => n.id === el.nodeB)?.position;
    if (!a || !b) continue;
    const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (len2 < 1e-12) continue;
    const tRaw = ((world.x - a.x) * (b.x - a.x) + (world.y - a.y) * (b.y - a.y)) / len2;
    // interior only — ends are node snaps
    const t = Math.min(0.95, Math.max(0.05, tRaw));
    const proj = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const mid = { x: a.x + (b.x - a.x) * 0.5, y: a.y + (b.y - a.y) * 0.5 };
    // midpoint gets priority over a generic along-pipe point
    consider({ kind: 'onPipe', elementId: el.id, t: 0.5, pos: mid }, d(world, mid), 2);
    consider({ kind: 'onPipe', elementId: el.id, t, pos: proj }, d(world, proj), 3);
  }

  if (best) return (best as { snap: Snap }).snap;
  return {
    kind: 'grid',
    pos: { x: Math.round(world.x / gridM) * gridM, y: Math.round(world.y / gridM) * gridM },
  };
}
