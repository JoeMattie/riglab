// The panel sketch canvas (PLANFILE-3d-conversion.md): every quad ortho
// panel hosts this full editing surface over the whole compound mechanism,
// projected into the panel's plane. The document is Vec3; this component
// projects for drawing/snapping and lifts pointer input back through the
// panel frame at the panel's active work-plane depth (snapping to existing
// geometry adopts that geometry's depth so connections land exactly).
import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { groupDragNodeIds, translatedTargets } from '../../design/groupDrag';
import { elementIdsInRect, normalizedRect } from '../../design/marquee';
import { pivotArcPoints } from '../../design/pivotArc';
import type { Mechanism, PivotElement, PivotJoint, SliderElement, Vec2, Vec3 } from '../../schema';
import { solve } from '../../solver';
import { useAppStore } from '../../state/appStore';
import type { EndSpec } from '../../state/docOps';
import {
  addBowden,
  addElastic,
  addPipe,
  addRope,
  addSkeletonBinding,
  addTorsionCable,
  attachNodes,
  attachNodeToLink,
  canAttachNodes,
  canAttachNodeToLink,
  deleteElement,
  groundNodeAtAnchor,
  moveNodes,
  releaseNodeConnection,
  setNodeKind,
} from '../../state/docOps';
import { type OrthoPanelId, useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import {
  anchorTargets,
  bindingTargets,
  computeSkeleton,
  getClip,
  headRadiusM,
  projectSilhouette,
  REST_POSE,
  type SkeletonFrame,
  samplePose,
} from '../../wearer';
import {
  isoFrame,
  PANEL_FRAME,
  panelDepthOf,
  panelToWorld,
  projectPositions,
  projectToPanel,
} from '../quad/panelProject';
import { selectionCardHost } from '../quad/quadLayout';
import { M_PER_IN } from '../units';
import { DimensionChips, type EndpointDragReadout } from './DimensionChips';
import { carriesForceLabel, forceLabelAnchor, formatForce, pickRenderPositions } from './forces';
import { pinchStep, wheelZoomFactor } from './gesture';
import { JointPopover } from './JointPopover';
import { SelectionCard } from './SelectionCard';
import {
  dedupConsecutive,
  findBentLinkHit,
  findSnap,
  GRID_M,
  isCoincidentFinish,
  type Snap,
} from './snapping';
import { scenePalette } from './theme';
import {
  initialView,
  panBy,
  panTo,
  toScreen,
  toWorld,
  type ViewTransform,
  zoomAt,
} from './viewTransform';

const SNAP_TOL_PX = 14;
/** Drag distance (screen px) past which a wearer-connected node tears off
 * its snap point — comfortably beyond the snap tolerance so a small jiggle
 * cannot disconnect anything (PLANFILE-wearer-attachments-and-floor, B). */
const TEAR_OFF_PX = SNAP_TOL_PX * 2;

/** Screen-space triangle-wave points hinting a coil, between two endpoints. */
function zigzag(a: Vec2, b: Vec2, segments = 9, ampPx = 5): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const pts: number[] = [a.x, a.y];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const side = i % 2 === 1 ? 1 : -1;
    pts.push(a.x + dx * t + nx * ampPx * side, a.y + dy * t + ny * ampPx * side);
  }
  pts.push(b.x, b.y);
  return pts;
}

/** Ramer–Douglas–Peucker polyline simplification for the freehand tool. */
function rdp(points: Vec2[], epsilon: number): Vec2[] {
  if (points.length < 3) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDist = 0;
  let index = 0;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const len = Math.hypot(dx, dy) || 1e-12;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const dist = Math.abs((p.x - first.x) * dy - (p.y - first.y) * dx) / len;
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist <= epsilon) return [first, last];
  const left = rdp(points.slice(0, index + 1), epsilon);
  const right = rdp(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

const needsMenu = (snap: Snap): boolean => snap.kind === 'node' || snap.kind === 'onPipe';

interface Draft {
  mode: 'pipe' | 'polyline' | 'freehand';
  start: Snap;
  /** committed interior vertices (polyline) / raw trail (freehand), panel 2D */
  vertices: Vec2[];
  cursor: Vec2;
  /** work-plane depth captured when the draw started (node snaps adopt the
   * snapped node's depth, so the whole stroke lands in that plane) */
  depthM: number;
}

/** Direct geometry edit: dragging a selected pipe's endpoint handle moves
 * that one node (changing the pipe's length), with node/grid snaps plus
 * length snapping at ½ in (imperial) / 1 cm (metric) increments. */
interface EndpointDrag {
  nodeId: string;
  elementId: string;
  /** the dragged node's out-of-plane depth, held constant through the drag */
  depthM: number;
  /** original endpoint positions (panel 2D) for the dashed prior-pose ghost */
  ghost: [Vec2, Vec2];
  /** every element incident to the dragged node — their spans move with the
   * pointer, so onPipe-snapping to them would chase a moving target */
  incidentElementIds: ReadonlySet<string>;
  readout: EndpointDragReadout;
}

/** Group body drag (PLANFILE-multiselect-drag-constraints): grabbing a pipe
 * span (onPipe snap) moves every node of the dragged elements by the pointer
 * delta in this panel's plane. Constraints on, the targets go through the
 * kinematic solver; off, they are written directly and lengths follow. */
interface BodyDrag {
  elementIds: string[];
  /** document positions of the dragged node set at gesture start */
  orig: Record<string, Vec3>;
  /** panel-2D pointer at mousedown */
  start2: Vec2;
  /** crossed the click threshold — selection committed, the paired Konva
   * click suppressed */
  moved: boolean;
  /** selection to commit once the drag actually moves (grabbing an
   * unselected pipe selects it; modifier adds instead of replacing) */
  pendingSelect: { elementId: string; mode: 'replace' | 'add' } | null;
}

/** Length-snap increment in metres for the endpoint drag / scrub. */
export const lengthStepM = (units: 'imperial' | 'metric'): number =>
  units === 'imperial' ? 0.5 * M_PER_IN : 0.01;

/** Live view transforms per panel, for the scripted-verification seam
 * (window.__riglab.getView(panelId)). */
export const publishedViews: Partial<Record<OrthoPanelId, ViewTransform>> = {};

export function SketchCanvas({ panelId }: { panelId: OrthoPanelId }) {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const beginGesture = useAppStore((s) => s.beginGesture);
  const endGesture = useAppStore((s) => s.endGesture);
  // Konva shapes take literal colors (no CSS variables), so the drawing
  // palette re-renders off the night flag
  const night = useThemeStore((s) => s.night);
  const C = scenePalette(night);
  const tool = useEditorStore((s) => s.tool);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const posePositions = useEditorStore((s) => s.posePositions);
  const playback = useEditorStore((s) => s.playback);
  const tracing = useEditorStore((s) => s.tracing);
  const tracePath = useEditorStore((s) => s.tracePath);
  const appendTrace = useEditorStore((s) => s.appendTrace);
  const setPendingConnect = useEditorStore((s) => s.setPendingConnect);
  const setDiagnostics = useEditorStore((s) => s.setDiagnostics);
  const violated = useEditorStore((s) => s.violated);
  const equilibriumOn = useEditorStore((s) => s.equilibriumOn);
  const constraintsOn = useEditorStore((s) => s.constraintsOn);
  const snapPrefs = useEditorStore((s) => s.snapPrefs);
  const equilibrium = useEditorStore((s) => s.equilibrium);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const focusElementId = useEditorStore((s) => s.focusElementId);
  const setFocusElement = useEditorStore((s) => s.setFocusElement);
  const workDepthM = useEditorStore((s) => s.panelDepths[panelId]);
  const setPanelDepth = useEditorStore((s) => s.setPanelDepth);
  const activePanel = useEditorStore((s) => s.activePanel);
  const setActivePanel = useEditorStore((s) => s.setActivePanel);
  const setDragNode3 = useEditorStore((s) => s.setDragNode);
  const dragNodeId = useEditorStore((s) => s.dragNodeId);
  const panelsVisible = useEditorStore((s) => s.panelsVisible);
  const quadMaximized = useEditorStore((s) => s.quadMaximized);

  const mech: Mechanism | null = doc?.mechanism ?? null;
  const isoOctant = useEditorStore((s) => s.isoOctant);
  // the iso panel's frame follows the chosen viewing octant (all eight are
  // precomputed, so the reference stays stable per octant for the memos)
  const frame = panelId === 'iso' ? isoFrame(isoOctant) : PANEL_FRAME[panelId];

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState<ViewTransform>(() => {
    const v = initialView(800, 500);
    // the top panel looks down at the x-z plane: center near the wearer
    return panelId === 'top' ? { ...v, cy: 0 } : v;
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hoverSnap, setHoverSnap] = useState<Snap | null>(null);
  const [dragNode, setDragNode] = useState<{ nodeId: string; depthM: number } | null>(null);
  /** tear-off state for a drag that started on a wearer-connected node
   * (skeleton-bound, anchor-attached, or plain grounded): the node holds its
   * point until the pointer travels TEAR_OFF_PX from mousedown, then the
   * connection is released and the drag continues live */
  const dragTetherRef = useRef<{ torn: boolean } | null>(null);
  const [endpointDrag, setEndpointDrag] = useState<EndpointDrag | null>(null);
  const [bodyDrag, setBodyDrag] = useState<BodyDrag | null>(null);
  const [hoveredElementId, setHoveredElementId] = useState<string | null>(null);
  const [bindFrom, setBindFrom] = useState<string | null>(null);
  // force-tool drafting (§8.1: ropes/elastics/bowden/torsion drawn with their
  // own tools). Rope routes through clicked waypoints; elastic/bowden are
  // click-drag; bowden needs two segments; torsion couples two picked pivots.
  const [ropeDraft, setRopeDraft] = useState<{
    points: Snap[];
    cursor: Vec2;
    depthM: number;
  } | null>(null);
  const [dragCord, setDragCord] = useState<{
    tool: 'elastic' | 'bowden';
    start: Snap;
    cursor: Vec2;
    depthM: number;
  } | null>(null);
  const [bowdenA, setBowdenA] = useState<{ start: Snap; end: Snap; depthM: number } | null>(null);
  const [torsionA, setTorsionA] = useState<{ pivotId: string; nodeId: string } | null>(null);
  /** while panning (middle-drag / space+drag): the world point grabbed at
   * pan start — each move re-centers so it stays glued under the cursor */
  const panRef = useRef<Vec2 | null>(null);
  /** where the last mousedown landed, to tell a click from a drag/pan */
  const mouseDownScreenRef = useRef<Vec2 | null>(null);
  /** the mousedown BEFORE that — a genuine double-click's two clicks are
   * coincident, so the anchor toggle can reject Konva's time-based dblclick
   * firing for two rapid clicks at DIFFERENT spots (same caveat the
   * polyline/rope finishers guard with isCoincidentFinish) */
  const prevMouseDownScreenRef = useRef<Vec2 | null>(null);
  /** marquee (drag-box) selection, in screen coords while dragging */
  const [marquee, setMarquee] = useState<{ start: Vec2; cursor: Vec2 } | null>(null);
  /** space held ⇒ drag pans instead of drawing the marquee */
  const spaceDownRef = useRef(false);
  /** set when a marquee commits on mouseup — the Konva click that fires for
   * the same down/up pair on a shape must not replace the fresh selection */
  const marqueeCommittedRef = useRef(false);

  /** New pivots drawn in this panel hinge about the panel's normal
   * (PLANFILE-3d-conversion.md decision 2). */
  const panelHinge: PivotJoint = useMemo(
    () => ({ kind: 'hinge', axis: { ...frame.zAxis } }),
    [frame],
  );

  const pivotAtNode = useCallback(
    (nodeId: string) =>
      mech?.elements.find((e) => e.type === 'pivot' && e.nodeId === nodeId)?.id ?? null,
    [mech],
  );

  // shift/cmd-click toggles membership in the selection; plain click replaces
  const clickSelect = useCallback(
    (elementId: string, evt: MouseEvent) => {
      if (marqueeCommittedRef.current) return; // that "click" was a marquee drag
      if (evt.shiftKey || evt.metaKey || evt.ctrlKey) toggleSelect(elementId);
      else select(elementId);
    },
    [select, toggleSelect],
  );

  const resetForceDrafts = useCallback(() => {
    setRopeDraft(null);
    setDragCord(null);
    setBowdenA(null);
    setTorsionA(null);
  }, []);

  // a stationary left-click on a node: select the joint element living there
  // (pivots/sliders have no stroke of their own to click on the canvas);
  // modifier click toggles membership. The joint/realization popover is on
  // right-click (onStageContextMenu).
  const selectJointAtNode = useCallback(
    (nodeId: string, evt: MouseEvent) => {
      if (!mech) return;
      const joint = mech.elements.find(
        (el) => (el.type === 'pivot' || el.type === 'slider') && el.nodeId === nodeId,
      );
      if (joint) clickSelect(joint.id, evt);
    },
    [mech, clickSelect],
  );

  // right-click on a node: open the joint popover there; the joint element
  // joins the selection unless it's already part of it (a right-click must
  // not collapse a multi-selection that includes it)
  const openJointPopover = useCallback(
    (nodeId: string) => {
      if (!mech) return;
      const joint = mech.elements.find(
        (el) => (el.type === 'pivot' || el.type === 'slider') && el.nodeId === nodeId,
      );
      if (joint && !useEditorStore.getState().selectedElementIds.includes(joint.id)) {
        select(joint.id);
      }
      setOpenPopover({ kind: 'joint', nodeId });
    },
    [mech, select, setOpenPopover],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(120, r.width);
      const h = Math.max(120, r.height);
      setSize({ w, h });
      setView((v) => ({ ...v, w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Two-finger touch pinch/pan — the touch-device arm of the zoompinch-spike
  // fallback (trackpad pan/pinch is the wheel path in onWheel). Runs the same
  // pure viewTransform helpers, so content stays vector-sharp and
  // pointer-anchored. Only acts on ≥2 touch pointers, so single-pointer
  // draw/drag/select events pass straight through to Konva (behavior contract).
  const hasDoc = doc != null;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasDoc) return;
    const pointers = new Map<number, Vec2>();
    let last: { a: Vec2; b: Vec2 } | null = null;
    const localPos = (e: PointerEvent): Vec2 => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const twoPointers = (): { a: Vec2; b: Vec2 } | null => {
      const pts = [...pointers.values()];
      return pts.length >= 2 ? { a: pts[0]!, b: pts[1]! } : null;
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      pointers.set(e.pointerId, localPos(e));
      last = twoPointers();
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'touch' || !pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, localPos(e));
      const curr = twoPointers();
      if (!curr || !last) return;
      e.preventDefault();
      const step = pinchStep(last, curr);
      setView((v) => zoomAt(panBy(v, step.panDxPx, step.panDyPx), step.anchor, step.factor));
      last = curr;
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      last = twoPointers();
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove, { passive: false });
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [hasDoc]);

  // debug seam: publish this panel's live view transform (scale/cx/cy
  // px-per-m) so scripted browser checks can assert pan/zoom without parsing
  // canvas pixels (window.__riglab.getView(panelId) reads this map)
  useEffect(() => {
    publishedViews[panelId] = view;
  }, [view, panelId]);

  const pose = useMemo(() => {
    const clip = playback.clipName ? getClip(playback.clipName) : undefined;
    return clip ? samplePose(clip, playback.tS, { amplitude: playback.amplitude }) : REST_POSE;
  }, [playback.clipName, playback.tS, playback.amplitude]);

  /** posed wearer skeleton — 3D points for bindings, projected for drawing */
  const skeleton: SkeletonFrame | null = useMemo(
    () => (doc ? computeSkeleton(doc.wearer, pose) : null),
    [doc, pose],
  );
  const silhouette = useMemo(
    () => (doc && skeleton ? projectSilhouette(skeleton, headRadiusM(doc.wearer), frame) : null),
    [doc, skeleton, frame],
  );

  const docPositions = useMemo(() => {
    const out: Record<string, Vec3> = {};
    for (const n of mech?.nodes ?? []) out[n.id] = n.position;
    return out;
  }, [mech?.nodes]);
  const renderPositions = pickRenderPositions({
    docPositions,
    posePositions,
    settledPositions: equilibriumOn ? equilibrium.positions : null,
    dragging: dragNode !== null || bodyDrag !== null,
  });

  /** the document pose projected into this panel's plane — everything the
   * stage draws, snaps and marquees reads these 2D coordinates */
  const projected = useMemo(
    () => projectPositions(renderPositions, frame),
    [renderPositions, frame],
  );

  // DOF-pill click-to-zoom: consume the one-shot focus request by centering
  // the element's bounding box (padded) and selecting it. Every panel zooms;
  // the store clears the request after the panels had a frame to react.
  useEffect(() => {
    if (!focusElementId || !mech) return;
    const el = mech.elements.find((x) => x.id === focusElementId);
    if (el) {
      const ids = new Set<string>();
      if (el.type === 'link' || el.type === 'telescope' || el.type === 'elastic') {
        ids.add(el.nodeA);
        ids.add(el.nodeB);
      } else if (el.type === 'bentLink') for (const id of el.nodeIds) ids.add(id);
      else if (el.type === 'rope') for (const id of el.path) ids.add(id);
      else if (el.type === 'bowden') for (const id of [el.a1, el.a2, el.b1, el.b2]) ids.add(id);
      else if (el.type === 'pivot' || el.type === 'slider') ids.add(el.nodeId);
      else if (el.type === 'torsionCable') {
        for (const pid of [el.pivotA, el.pivotB]) {
          const p = mech.elements.find((x) => x.id === pid);
          if (p?.type === 'pivot') ids.add(p.nodeId);
        }
      }
      const pts = [...ids].map((id) => projected[id]).filter((p): p is Vec2 => !!p);
      if (pts.length > 0) {
        const minX = Math.min(...pts.map((p) => p.x));
        const maxX = Math.max(...pts.map((p) => p.x));
        const minY = Math.min(...pts.map((p) => p.y));
        const maxY = Math.max(...pts.map((p) => p.y));
        const spanX = Math.max(maxX - minX, 0.2);
        const spanY = Math.max(maxY - minY, 0.2);
        setView((v) => ({
          ...v,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          scale: Math.min(3000, Math.max(40, Math.min(v.w / (spanX * 2.5), v.h / (spanY * 2.5)))),
        }));
        useEditorStore.getState().select(focusElementId);
      }
    }
    // one panel's timeout clears the request for all — each already zoomed
    const t = setTimeout(() => {
      if (useEditorStore.getState().focusElementId === focusElementId) setFocusElement(null);
    }, 0);
    return () => clearTimeout(t);
  }, [focusElementId, mech, projected, setFocusElement]);

  const stagePointer = (e: Konva.KonvaEventObject<MouseEvent>): Vec2 | null => {
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    return p ? { x: p.x, y: p.y } : null;
  };

  /** The snap grid IS the visible grid (Joe: "grid snapping doesn't work" —
   * it rounded to an invisible 0.5" lattice while the DRAWN grid is 0.1 m):
   * one adaptive step shared by the renderer, the snap context, and the
   * iso ground lattice. */
  const gridStepM = view.scale > 700 ? GRID_M * 4 : 0.1;

  /** ISO grid snaps land on the projected GROUND lattice (world x/z at the
   * visible step), matching the drawn isometric grid — not axis-aligned
   * panel-2D rounding. Full step vectors in panel 2D. */
  const gridBasis = useMemo(() => {
    if (panelId !== 'iso') return undefined;
    const px = projectToPanel({ x: gridStepM, y: 0, z: 0 }, frame);
    const pz = projectToPanel({ x: 0, y: 0, z: gridStepM }, frame);
    return { u: px, v: pz };
  }, [panelId, frame, gridStepM]);

  /** Shared context for findSnap / findBentLinkHit — assumes `mech` checked. */
  const snapContext = useCallback(
    (exclude?: ReadonlySet<string>, excludeElements?: ReadonlySet<string>) => ({
      mechanism: mech!,
      positions: projected,
      silhouette,
      tolM: SNAP_TOL_PX / view.scale,
      gridM: gridStepM,
      exclude,
      excludeElements,
      sources: { ends: snapPrefs.ends, pipes: snapPrefs.pipes, grid: snapPrefs.grid },
      gridBasis,
    }),
    [view.scale, mech, projected, silhouette, snapPrefs, gridBasis, gridStepM],
  );

  const snapAt = useCallback(
    (screen: Vec2, exclude?: ReadonlySet<string>, excludeElements?: ReadonlySet<string>): Snap => {
      const world = toWorld(view, screen);
      if (!mech) return { kind: 'grid', pos: world };
      return findSnap(world, snapContext(exclude, excludeElements));
    },
    [view, mech, snapContext],
  );

  /** Lift a panel-2D point into document space at a work-plane depth. */
  const to3D = useCallback(
    (p: Vec2, depthM: number): Vec3 => panelToWorld(p, frame, depthM),
    [frame],
  );

  /** The document-space (Vec3) position a snap stands for. Node/onPipe snaps
   * carry their own depth (existing geometry); skeleton/anchor snaps resolve
   * on the posed 3D skeleton; grid snaps lift at the given work depth. */
  const vec3OfSnap = useCallback(
    (snap: Snap, depthM: number): Vec3 => {
      switch (snap.kind) {
        case 'node':
          return renderPositions[snap.nodeId] ?? to3D(snap.pos, depthM);
        case 'onPipe': {
          const el = mech?.elements.find((e) => e.id === snap.elementId);
          if (el && (el.type === 'link' || el.type === 'telescope')) {
            const a = renderPositions[el.nodeA];
            const b = renderPositions[el.nodeB];
            if (a && b) {
              return {
                x: a.x + (b.x - a.x) * snap.t,
                y: a.y + (b.y - a.y) * snap.t,
                z: a.z + (b.z - a.z) * snap.t,
              };
            }
          }
          return to3D(snap.pos, depthM);
        }
        case 'skeleton':
          return skeleton ? { ...skeleton.points[snap.point] } : to3D(snap.pos, depthM);
        case 'anchor':
          return skeleton ? { ...skeleton.anchors[snap.anchor] } : to3D(snap.pos, depthM);
        case 'grid':
          return to3D(snap.pos, depthM);
      }
    },
    [mech, renderPositions, skeleton, to3D],
  );

  /** Depth a snap implies for the work plane: existing geometry and wearer
   * points adopt their own depth; the grid keeps the current one. */
  const depthOfSnap = useCallback(
    (snap: Snap, fallback: number): number =>
      snap.kind === 'grid' ? fallback : panelDepthOf(vec3OfSnap(snap, fallback), frame),
    [vec3OfSnap, frame],
  );

  const snapToEndSpec = useCallback(
    (snap: Snap, connect: 'pivot' | 'weld' | 'slider' | 'detach', depthM: number): EndSpec => {
      if (connect === 'detach') return { kind: 'newNode', pos: vec3OfSnap(snap, depthM) };
      switch (snap.kind) {
        case 'node':
          return {
            kind: 'existingNode',
            nodeId: snap.nodeId,
            connect: connect === 'weld' ? 'weld' : 'pivot',
          };
        case 'onPipe':
          return {
            kind: 'onPipe',
            elementId: snap.elementId,
            t: snap.t,
            connect: connect === 'slider' ? 'slider' : connect === 'weld' ? 'weld' : 'pivot',
          };
        case 'skeleton':
          return { kind: 'boundNode', pos: vec3OfSnap(snap, depthM), point: snap.point };
        case 'anchor':
          return { kind: 'anchorNode', pos: vec3OfSnap(snap, depthM), anchor: snap.anchor };
        case 'grid':
          return { kind: 'newNode', pos: to3D(snap.pos, depthM) };
      }
    },
    [vec3OfSnap, to3D],
  );

  /** Clicking existing geometry retunes the panel's work plane to it. */
  const adoptDepth = useCallback(
    (snap: Snap) => {
      if (snap.kind === 'grid') return;
      const d = depthOfSnap(snap, workDepthM);
      if (Math.abs(d - workDepthM) > 1e-9) setPanelDepth(panelId, d);
    },
    [depthOfSnap, workDepthM, setPanelDepth, panelId],
  );

  const commitPipe = useCallback(
    (d: Draft, endSnap: Snap, endConnect: 'pivot' | 'weld' | 'slider' | 'detach') => {
      if (!doc || !mech) return;
      const startSpec = snapToEndSpec(d.start, 'pivot', d.depthM);
      const endSpec = snapToEndSpec(endSnap, endConnect, d.depthM);
      const flat2 =
        d.mode === 'freehand'
          ? rdp([d.start.pos, ...d.vertices, endSnap.pos], 0.015)
          : [d.start.pos, ...d.vertices, endSnap.pos];
      if (flat2.length < 2) return;
      // endpoints take their snap's true 3D position; interior vertices lift
      // at the stroke's work-plane depth (bentLinks draw planar, planfile)
      const vertices: Vec3[] = flat2.map((p, i) =>
        i === 0
          ? vec3OfSnap(d.start, d.depthM)
          : i === flat2.length - 1
            ? vec3OfSnap(endSnap, d.depthM)
            : to3D(p, d.depthM),
      );
      updateCurrent((cur) => addPipe(cur, vertices, startSpec, endSpec, panelHinge).doc);
    },
    [doc, mech, updateCurrent, snapToEndSpec, vec3OfSnap, to3D, panelHinge],
  );

  const finishPipe = useCallback(
    (d: Draft, endSnap: Snap, screen: Vec2) => {
      setDraft(null);
      setHoverSnap(null);
      if (needsMenu(endSnap)) {
        const options: Array<'pivot' | 'weld' | 'slider' | 'detach'> =
          endSnap.kind === 'onPipe'
            ? ['pivot', 'weld', 'slider', 'detach']
            : ['pivot', 'weld', 'detach'];
        setPendingConnect({
          screen,
          options,
          choose: (option) => {
            setPendingConnect(null);
            commitPipe(d, endSnap, option);
          },
          cancel: () => setPendingConnect(null),
        });
      } else {
        commitPipe(d, endSnap, 'pivot');
      }
    },
    [commitPipe, setPendingConnect],
  );

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const screen = stagePointer(e);
    if (!screen || !mech || !doc) return;
    prevMouseDownScreenRef.current = mouseDownScreenRef.current;
    mouseDownScreenRef.current = screen;
    setActivePanel(panelId);
    // canvas mousedown dismisses floating popovers and inline edits
    const editor = useEditorStore.getState();
    if (editor.openPopover) editor.setOpenPopover(null);
    if (editor.lengthEdit) editor.setLengthEdit(null);
    // right button never starts a drag/marquee/draft — it opens the joint
    // popover via onStageContextMenu
    if (e.evt.button === 2) return;
    // middle-mouse or space+drag pans in EVERY tool — it must never draw,
    // select, or extend a draft; plain drag on empty space marquees (select)
    if (e.evt.button === 1 || spaceDownRef.current) {
      panRef.current = toWorld(view, screen);
      return;
    }
    const snap = snapAt(screen);

    if (tool === 'select') {
      marqueeCommittedRef.current = false;
      if (snap.kind === 'node') {
        adoptDepth(snap);
        const depthM = depthOfSnap(snap, workDepthM);
        // constraints ON: only an endpoint of a selected, unlocked pipe drags
        // as a LENGTH edit (direct geometry move); any other node drags as a
        // solver pose. Constraints OFF: any pipe endpoint is a direct
        // geometry edit — length locks are part of constraint checking
        // (PLANFILE-multiselect-drag-constraints)
        const spanOwner = (requireSelected: boolean, requireUnlocked: boolean) =>
          mech.elements.find(
            (el) =>
              (el.type === 'link' || el.type === 'telescope') &&
              (el.nodeA === snap.nodeId || el.nodeB === snap.nodeId) &&
              (!requireSelected || selectedElementIds.includes(el.id)) &&
              (!requireUnlocked || !el.lengthLocked),
          );
        const owner = constraintsOn
          ? spanOwner(true, true)
          : (spanOwner(true, false) ?? spanOwner(false, false));
        if (owner && (owner.type === 'link' || owner.type === 'telescope')) {
          const a = projected[owner.nodeA];
          const b = projected[owner.nodeB];
          const a3 = renderPositions[owner.nodeA];
          const b3 = renderPositions[owner.nodeB];
          if (a && b && a3 && b3) {
            const nodeId = snap.nodeId;
            const incident = new Set<string>();
            for (const el of mech.elements) {
              if (
                (el.type === 'link' || el.type === 'telescope') &&
                (el.nodeA === nodeId || el.nodeB === nodeId)
              )
                incident.add(el.id);
              else if (el.type === 'bentLink' && el.nodeIds.includes(nodeId)) incident.add(el.id);
            }
            // a wearer-connected endpoint holds its point until the pointer
            // crosses the tear-off deadzone, same as the plain node drag
            const endNode = mech.nodes.find((x) => x.id === nodeId);
            const endConnected =
              endNode?.kind === 'anchor' ||
              mech.skeletonBindings.some((b) => b.nodeId === nodeId) ||
              mech.anchorBindings.some((b) => b.nodeId === nodeId);
            dragTetherRef.current = endConnected ? { torn: false } : null;
            beginGesture();
            setHoverSnap(null);
            setEndpointDrag({
              nodeId,
              elementId: owner.id,
              depthM,
              ghost: [a, b],
              incidentElementIds: incident,
              readout: {
                lengthM: Math.hypot(b3.x - a3.x, b3.y - a3.y, b3.z - a3.z),
                snapped: false,
              },
            });
            return;
          }
        }
        const grabbed = mech.nodes.find((x) => x.id === snap.nodeId);
        const connected =
          grabbed?.kind === 'anchor' ||
          mech.skeletonBindings.some((b) => b.nodeId === snap.nodeId) ||
          mech.anchorBindings.some((b) => b.nodeId === snap.nodeId);
        dragTetherRef.current = connected ? { torn: false } : null;
        beginGesture();
        setDragNode({ nodeId: snap.nodeId, depthM });
        setDragNode3(snap.nodeId);
        useEditorStore.getState().clearTrace();
      } else {
        // grabbing a pipe BODY moves it (with the rest of the selection when
        // it is part of one, or when the modifier adds it) instead of
        // drawing a marquee. Straight pipes arrive as onPipe snaps; bent
        // pipes emit no onPipe snap (drawing can't attach mid-polyline), so
        // their body gets its own segment hit-test.
        const bentHit =
          snap.kind === 'onPipe' ? null : findBentLinkHit(toWorld(view, screen), snapContext());
        const bodyElementId = snap.kind === 'onPipe' ? snap.elementId : bentHit?.elementId;
        if (!bodyElementId) {
          setMarquee({ start: screen, cursor: screen });
          return;
        }
        const withModifier = e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey;
        const inSelection = selectedElementIds.includes(bodyElementId);
        const elementIds = inSelection
          ? [...selectedElementIds]
          : withModifier
            ? [...selectedElementIds, bodyElementId]
            : [bodyElementId];
        const nodeIds = groupDragNodeIds(mech, elementIds);
        if (nodeIds.length === 0) return;
        const wanted = new Set(nodeIds);
        const orig: Record<string, Vec3> = {};
        for (const n of mech.nodes) if (wanted.has(n.id)) orig[n.id] = n.position;
        if (snap.kind === 'onPipe') {
          adoptDepth(snap);
        } else if (bentHit) {
          // same work-plane adoption as adoptDepth, lifted from the hit
          // segment's endpoints at the hit parameter
          const a3 = renderPositions[bentHit.nodeA];
          const b3 = renderPositions[bentHit.nodeB];
          if (a3 && b3) {
            const pos3: Vec3 = {
              x: a3.x + (b3.x - a3.x) * bentHit.t,
              y: a3.y + (b3.y - a3.y) * bentHit.t,
              z: a3.z + (b3.z - a3.z) * bentHit.t,
            };
            const depth = panelDepthOf(pos3, frame);
            if (Math.abs(depth - workDepthM) > 1e-9) setPanelDepth(panelId, depth);
          }
        }
        beginGesture();
        setHoverSnap(null);
        setDragNode3(nodeIds[0]!);
        setBodyDrag({
          elementIds,
          orig,
          start2: toWorld(view, screen),
          moved: false,
          pendingSelect: inSelection
            ? null
            : { elementId: bodyElementId, mode: withModifier ? 'add' : 'replace' },
        });
      }
      return;
    }
    if (tool === 'pipe' || tool === 'freehand') {
      adoptDepth(snap);
      setDraft({
        mode: tool,
        start: snap,
        vertices: [],
        cursor: snap.pos,
        depthM: depthOfSnap(snap, workDepthM),
      });
      return;
    }
    if (tool === 'polyline') {
      if (!draft) {
        adoptDepth(snap);
        setDraft({
          mode: 'polyline',
          start: snap,
          vertices: [],
          cursor: snap.pos,
          depthM: depthOfSnap(snap, workDepthM),
        });
      } else setDraft({ ...draft, vertices: [...draft.vertices, snap.pos] });
      return;
    }
    if (tool === 'rope') {
      // click waypoints; double-click (two clicks on one spot) finishes.
      // Points landing on a pipe become eyelets.
      adoptDepth(snap);
      setRopeDraft((d) =>
        d
          ? { ...d, points: [...d.points, snap] }
          : { points: [snap], cursor: snap.pos, depthM: depthOfSnap(snap, workDepthM) },
      );
      return;
    }
    if (tool === 'elastic' || tool === 'bowden') {
      adoptDepth(snap);
      setDragCord({ tool, start: snap, cursor: snap.pos, depthM: depthOfSnap(snap, workDepthM) });
      return;
    }
    if (tool === 'torsionCable') {
      if (snap.kind !== 'node') return;
      const pivotId = pivotAtNode(snap.nodeId);
      if (!pivotId) return; // torsion couples pivots; ignore non-pivot nodes
      if (!torsionA) {
        setTorsionA({ pivotId, nodeId: snap.nodeId });
      } else {
        if (torsionA.pivotId !== pivotId) {
          updateCurrent((cur) => addTorsionCable(cur, torsionA.pivotId, pivotId).doc);
        }
        setTorsionA(null);
      }
      return;
    }
    if (tool === 'bind') {
      if (snap.kind === 'node') setBindFrom(snap.nodeId);
      else if (snap.kind === 'skeleton' && bindFrom) {
        updateCurrent((cur) => addSkeletonBinding(cur, snap.point, bindFrom));
        setBindFrom(null);
      }
      return;
    }
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const screen = stagePointer(e);
    if (!screen || !mech || !doc) return;

    if (panRef.current) {
      // capture the anchor NOW: the setView updater runs later, and mouseup
      // may have nulled the ref by then (the crash Joe hit); panTo keeps the
      // grabbed canvas point glued to the cursor with no incremental drift
      const grabbed = panRef.current;
      setView((v) => panTo(v, grabbed, screen));
      return;
    }

    if (tool === 'select' && marquee) {
      setMarquee((m) => (m ? { ...m, cursor: screen } : m));
      return;
    }

    if (tool === 'select' && bodyDrag) {
      const start = mouseDownScreenRef.current;
      const movedPx = start ? Math.hypot(screen.x - start.x, screen.y - start.y) : Infinity;
      if (!bodyDrag.moved && movedPx < 4) return;
      let drag = bodyDrag;
      if (!drag.moved) {
        // the drag is real: commit the selection to the grabbed pipe (when it
        // wasn't already selected) and suppress the Konva click that fires
        // for this same down/up pair
        if (drag.pendingSelect) {
          const editor = useEditorStore.getState();
          if (drag.pendingSelect.mode === 'add')
            editor.setSelection([...editor.selectedElementIds, drag.pendingSelect.elementId]);
          else editor.select(drag.pendingSelect.elementId);
        }
        marqueeCommittedRef.current = true;
        drag = { ...drag, moved: true };
        setBodyDrag(drag);
      }
      // pointer delta in the panel plane, lifted to a world-space delta
      // (depth 0: the frame axes are orthonormal, so out-of-plane depth is
      // preserved per node)
      const w2 = toWorld(view, screen);
      const delta = panelToWorld({ x: w2.x - drag.start2.x, y: w2.y - drag.start2.y }, frame, 0);
      const targets = translatedTargets(drag.orig, delta);
      if (!constraintsOn) {
        updateCurrent((cur) => moveNodes(cur, targets));
        return;
      }
      const liveDoc = useAppStore.getState().current;
      const liveMech = liveDoc?.mechanism;
      if (!liveDoc || !liveMech) return;
      const channelValues = Object.fromEntries(liveMech.inputs.map((c) => [c.name, c.value]));
      try {
        const result = solve(
          liveMech,
          {
            channelValues,
            dragTargets: { ...bindingTargets(liveMech, liveDoc.wearer, pose), ...targets },
            groundTargets: anchorTargets(liveMech, liveDoc.wearer, pose),
            // shift held: every dragged node locks to this panel's plane at
            // its own depth (the translated target IS in that plane)
            planeLocks: e.evt.shiftKey
              ? Object.fromEntries(
                  Object.entries(targets).map(([id, t]) => [
                    id,
                    { point: t, normal: { ...frame.zAxis } },
                  ]),
                )
              : undefined,
          },
          'kinematic',
        );
        setDiagnostics(
          { dof: result.diagnostics.dof, classification: result.diagnostics.classification },
          result.diagnostics.violated,
        );
        // same drag-ratchet invariant as the node drag: never write a
        // non-converged pose back into the document
        if (result.diagnostics.converged) {
          updateCurrent((cur) => moveNodes(cur, result.positions));
        }
      } catch {
        // a solver throw must not break the drag gesture
      }
      return;
    }

    if (tool === 'select' && endpointDrag) {
      // tear-off (slice B, same as the node drag): a wearer-connected
      // endpoint holds until the pointer leaves the deadzone, then the
      // connection releases and the length edit continues live
      const endTether = dragTetherRef.current;
      if (endTether && !endTether.torn) {
        const start = mouseDownScreenRef.current;
        const movedPx = start ? Math.hypot(screen.x - start.x, screen.y - start.y) : Infinity;
        if (movedPx < TEAR_OFF_PX) return;
        endTether.torn = true;
        updateCurrent((cur) => releaseNodeConnection(cur, endpointDrag.nodeId));
      }
      // direct geometry edit: move ONE node; node/skeleton/anchor snaps win,
      // else the (grid-snapped, when Grid is on) pointer lifted at the
      // node's own depth. Length ticks are gone (Joe's request) — the grid
      // is the only construction aid.
      const liveDoc = useAppStore.getState().current;
      const liveMech = liveDoc?.mechanism;
      const el = liveMech?.elements.find((x) => x.id === endpointDrag.elementId);
      if (!liveMech || !el || (el.type !== 'link' && el.type !== 'telescope')) return;
      const otherId = el.nodeA === endpointDrag.nodeId ? el.nodeB : el.nodeA;
      const other = liveMech.nodes.find((n) => n.id === otherId)?.position;
      if (!other) return;
      const snap = snapAt(screen, new Set([endpointDrag.nodeId]), endpointDrag.incidentElementIds);
      // a 'grid' snap carries the grid-rounded point (or the raw pointer
      // when Grid is toggled off) — lift it either way
      const pos: Vec3 = vec3OfSnap(snap, endpointDrag.depthM);
      const snapped = snap.kind !== 'grid' || snapPrefs.grid;
      updateCurrent((cur) => moveNodes(cur, { [endpointDrag.nodeId]: pos }));
      setEndpointDrag({
        ...endpointDrag,
        readout: {
          lengthM: Math.hypot(pos.x - other.x, pos.y - other.y, pos.z - other.z),
          snapped,
        },
      });
      return;
    }

    if (tool === 'select' && dragNode) {
      // tear-off (slice B): a wearer-connected node holds its point until
      // the pointer leaves the deadzone; crossing it releases the connection
      // (still inside this gesture's undo step) and the drag continues live
      const tether = dragTetherRef.current;
      if (tether && !tether.torn) {
        const start = mouseDownScreenRef.current;
        const movedPx = start ? Math.hypot(screen.x - start.x, screen.y - start.y) : Infinity;
        if (movedPx < TEAR_OFF_PX) return;
        tether.torn = true;
        updateCurrent((cur) => releaseNodeConnection(cur, dragNode.nodeId));
      }
      // solve from the LIVE document, not this render's closure — fast event
      // bursts can outrun React renders, and a stale mechanism here would
      // solve from outdated geometry
      const world2 = toWorld(view, screen);
      const liveDoc = useAppStore.getState().current;
      const liveMech = liveDoc?.mechanism;
      if (!liveDoc || !liveMech) return;
      // a drag that lands on a skeleton point snaps to it and binds on
      // release (planfile §7.3: bind silhouette points to nodes — available
      // in select); a pack-frame anchor attracts the same way and grounds;
      // another end / a pipe body attracts when a join is possible there
      const dropSnap = snapAt(screen, new Set([dragNode.nodeId]));
      const bindSnap =
        dropSnap.kind === 'skeleton' || dropSnap.kind === 'anchor'
          ? dropSnap
          : dropSnap.kind === 'node' && canAttachNodes(liveMech, dragNode.nodeId, dropSnap.nodeId)
            ? dropSnap
            : dropSnap.kind === 'onPipe' &&
                canAttachNodeToLink(liveMech, dragNode.nodeId, dropSnap.elementId)
              ? dropSnap
              : null;
      setHoverSnap(bindSnap);
      // panel-plane-constrained target: the pointer moves the node in this
      // panel's plane at the node's own out-of-plane depth; a plain-grid
      // fall-through carries the grid-rounded point (raw when Grid is off)
      const target: Vec3 = bindSnap
        ? vec3OfSnap(bindSnap, dragNode.depthM)
        : to3D(dropSnap.kind === 'grid' ? dropSnap.pos : world2, dragNode.depthM);
      // constraints off: the node moves directly — incident pipe lengths
      // follow the drawn geometry (no solve, no length lock)
      if (!constraintsOn) {
        updateCurrent((cur) => moveNodes(cur, { [dragNode.nodeId]: target }));
        if (tracing) appendTrace(target);
        return;
      }
      const targets = {
        ...bindingTargets(liveMech, liveDoc.wearer, pose),
        [dragNode.nodeId]: target,
      };
      const channelValues = Object.fromEntries(liveMech.inputs.map((c) => [c.name, c.value]));
      try {
        const result = solve(
          liveMech,
          {
            channelValues,
            dragTargets: targets,
            groundTargets: anchorTargets(liveMech, liveDoc.wearer, pose),
            // shift held: the dragged node locks to this panel's plane at
            // its own depth (the drag target IS in that plane)
            planeLocks: e.evt.shiftKey
              ? { [dragNode.nodeId]: { point: target, normal: { ...frame.zAxis } } }
              : undefined,
          },
          'kinematic',
        );
        setDiagnostics(
          { dof: result.diagnostics.dof, classification: result.diagnostics.classification },
          result.diagnostics.violated,
        );
        // never write a non-converged pose back into the document — rest
        // lengths are recomputed from it, so residual violation would compound
        if (result.diagnostics.converged) {
          updateCurrent((cur) => moveNodes(cur, result.positions));
          if (tracing) {
            const p = result.positions[dragNode.nodeId];
            if (p) appendTrace(p);
          }
        }
      } catch {
        // the solver is rewritten in a parallel worktree — a throw here must
        // not break the drag gesture (the node simply doesn't move)
      }
      return;
    }

    const snap = snapAt(screen, dragNode ? new Set([dragNode.nodeId]) : undefined);
    // idle select keeps node snaps (hotspot halo) plus skeleton/anchor snaps —
    // the wearer handles are hidden until hovered, so the snap is what
    // reveals the handle under the pointer
    setHoverSnap(
      tool === 'select'
        ? snap.kind === 'node' || snap.kind === 'skeleton' || snap.kind === 'anchor'
          ? snap
          : null
        : snap,
    );

    if (draft) {
      if (draft.mode === 'freehand') {
        const world = toWorld(view, screen);
        const last = draft.vertices[draft.vertices.length - 1] ?? draft.start.pos;
        if (Math.hypot(world.x - last.x, world.y - last.y) > 4 / view.scale) {
          setDraft({ ...draft, vertices: [...draft.vertices, world], cursor: world });
        } else {
          setDraft({ ...draft, cursor: world });
        }
      } else {
        setDraft({ ...draft, cursor: snap.pos });
      }
    }
    // functional updates only touch the cursor: a mousemove firing before React
    // commits an appended waypoint must not clobber `points` with a stale closure
    if (ropeDraft) setRopeDraft((d) => (d ? { ...d, cursor: snap.pos } : d));
    if (dragCord) setDragCord((d) => (d ? { ...d, cursor: snap.pos } : d));
  };

  const onMouseUp = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const screen = stagePointer(e);
    // a pan release must not fall through to the tool handlers (an active
    // draft would otherwise commit a stroke at the release point)
    const wasPanning = panRef.current !== null;
    panRef.current = null;
    if (wasPanning || !screen || !mech) return;

    if (tool === 'select' && marquee) {
      setMarquee(null);
      const movedPx = Math.hypot(screen.x - marquee.start.x, screen.y - marquee.start.y);
      // a stationary click stays a click (onStageClick clears the selection)
      if (movedPx < 4) return;
      // the marquee is 2D by design (src/design/marquee.ts): hit-test this
      // panel's projected coordinates
      const rect = normalizedRect(toWorld(view, marquee.start), toWorld(view, screen));
      const ids = elementIdsInRect(mech, projected, rect);
      const editor = useEditorStore.getState();
      // shift/cmd at release adds to the selection; plain drag replaces it
      editor.setSelection(
        e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey
          ? [...editor.selectedElementIds, ...ids]
          : ids,
      );
      marqueeCommittedRef.current = true;
      return;
    }

    if (tool === 'select' && bodyDrag) {
      setBodyDrag(null);
      setDragNode3(null);
      endGesture();
      // a stationary release stays a click — the paired Konva click on the
      // pipe handles selection as before
      return;
    }

    if (tool === 'select' && endpointDrag) {
      const start = mouseDownScreenRef.current;
      const movedPx = start ? Math.hypot(screen.x - start.x, screen.y - start.y) : Infinity;
      const { nodeId, depthM, incidentElementIds } = endpointDrag;
      const tether = dragTetherRef.current;
      setEndpointDrag(null);
      dragTetherRef.current = null;
      endGesture();
      // a stationary click on an endpoint handle selects the joint there
      if (movedPx < 4) {
        selectJointAtNode(nodeId, e.evt);
        return;
      }
      // a connected endpoint released inside the deadzone never moved — the
      // release point must not re-bind it elsewhere
      if (tether && !tether.torn) return;
      // dropping the end binds/joins exactly like the node drag: skeleton
      // point → binding; pack-frame anchor → grounded there; another end →
      // merge into one attached joint; a pipe body → split & pin (the ops
      // refuse degenerate merges, e.g. the pipe's own other end)
      const dropSnap = snapAt(screen, new Set([nodeId]), incidentElementIds);
      if (dropSnap.kind === 'skeleton') {
        updateCurrent((cur) => addSkeletonBinding(cur, dropSnap.point, nodeId));
      } else if (dropSnap.kind === 'anchor') {
        updateCurrent((cur) =>
          groundNodeAtAnchor(
            cur,
            nodeId,
            dropSnap.anchor,
            vec3OfSnap(dropSnap, depthM),
            panelHinge,
          ),
        );
      } else if (dropSnap.kind === 'node') {
        updateCurrent((cur) => attachNodes(cur, nodeId, dropSnap.nodeId, panelHinge));
      } else if (dropSnap.kind === 'onPipe') {
        updateCurrent((cur) =>
          attachNodeToLink(cur, nodeId, dropSnap.elementId, dropSnap.t, panelHinge),
        );
      }
      return;
    }

    if (tool === 'select' && dragNode) {
      const start = mouseDownScreenRef.current;
      const movedPx = start ? Math.hypot(screen.x - start.x, screen.y - start.y) : Infinity;
      const { nodeId, depthM } = dragNode;
      const tether = dragTetherRef.current;
      setDragNode(null);
      setDragNode3(null);
      dragTetherRef.current = null;
      endGesture();
      setHoverSnap(null);
      // a stationary click on a node selects the joint element living there
      // (pivots/sliders have no stroke of their own to click on the canvas);
      // the joint popover is on right-click
      if (movedPx < 4) {
        selectJointAtNode(nodeId, e.evt);
        return;
      }
      // a connected node released inside the deadzone never moved — the
      // release point (up to TEAR_OFF_PX away) must not re-bind it elsewhere
      if (tether && !tether.torn) return;
      // dropped on a skeleton binding point → bind the node to it, so it now
      // tracks that body point during clip playback (planfile §7.3); dropped
      // on a pack-frame anchor → ground it there, same as drawing onto one;
      // dropped on another end / a pipe body → join them into one attached
      // joint (the ops refuse degenerate merges — shared elements, existing
      // joints on the dragged node)
      const dropSnap = snapAt(screen, new Set([nodeId]));
      if (dropSnap.kind === 'skeleton') {
        updateCurrent((cur) => addSkeletonBinding(cur, dropSnap.point, nodeId));
      } else if (dropSnap.kind === 'anchor') {
        updateCurrent((cur) =>
          groundNodeAtAnchor(
            cur,
            nodeId,
            dropSnap.anchor,
            vec3OfSnap(dropSnap, depthM),
            panelHinge,
          ),
        );
      } else if (dropSnap.kind === 'node') {
        updateCurrent((cur) => attachNodes(cur, nodeId, dropSnap.nodeId, panelHinge));
      } else if (dropSnap.kind === 'onPipe') {
        updateCurrent((cur) =>
          attachNodeToLink(cur, nodeId, dropSnap.elementId, dropSnap.t, panelHinge),
        );
      }
      return;
    }
    if ((tool === 'elastic' || tool === 'bowden') && dragCord) {
      const endSnap = snapAt(screen);
      const start = dragCord.start.pos;
      if (Math.hypot(endSnap.pos.x - start.x, endSnap.pos.y - start.y) < 0.02) {
        setDragCord(null); // too short — cancelled click
        return;
      }
      const a = snapToEndSpec(dragCord.start, 'pivot', dragCord.depthM);
      const b = snapToEndSpec(endSnap, 'pivot', dragCord.depthM);
      if (tool === 'elastic') {
        updateCurrent((cur) => addElastic(cur, a, b).doc);
      } else if (!bowdenA) {
        // first stroke: remember segment A, prompt for segment B
        setBowdenA({ start: dragCord.start, end: endSnap, depthM: dragCord.depthM });
      } else {
        const a0 = snapToEndSpec(bowdenA.start, 'pivot', bowdenA.depthM);
        const a1 = snapToEndSpec(bowdenA.end, 'pivot', bowdenA.depthM);
        updateCurrent((cur) => addBowden(cur, a0, a1, a, b).doc);
        setBowdenA(null);
      }
      setDragCord(null);
      return;
    }
    if (draft && (draft.mode === 'pipe' || draft.mode === 'freehand')) {
      const endSnap = snapAt(screen);
      const start = draft.start.pos;
      if (
        draft.mode === 'pipe' &&
        Math.hypot(endSnap.pos.x - start.x, endSnap.pos.y - start.y) < 0.02
      ) {
        setDraft(null); // too short — treat as a cancelled click
        return;
      }
      finishPipe(draft, endSnap, screen);
    }
  };

  // a stationary click on empty canvas (the Stage itself, not a shape) clears
  // the selection; modifier-clicks keep it so shift-click accumulation works
  const onStageClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'select' || e.target !== e.target.getStage()) return;
    if (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey) return;
    const screen = stagePointer(e);
    const start = mouseDownScreenRef.current;
    if (!screen || !start || Math.hypot(screen.x - start.x, screen.y - start.y) >= 4) return;
    clearSelection();
  };

  // right-click on a node opens the joint/realization popover (left click
  // only selects); the browser context menu is suppressed either way
  const onStageContextMenu = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.evt.preventDefault();
    if (tool !== 'select' || !mech) return;
    const screen = stagePointer(e);
    if (!screen) return;
    const snap = snapAt(screen);
    if (snap.kind === 'node') openJointPopover(snap.nodeId);
  };

  const onDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const screen = stagePointer(e);
    if (!screen || !mech) return;
    if (tool === 'polyline' && draft) {
      // Same Konva time-based-dblclick caveat as the rope path: only a
      // coincident double-click finishes; rapid distinct clicks keep drafting.
      const committed = [draft.start.pos, ...draft.vertices];
      if (!isCoincidentFinish(committed)) return;
      const endSnap = snapAt(screen);
      // The double-click's own mousedowns injected the finish position into
      // vertices (twice); strip duplicates and the vertex coincident with the
      // endpoint so it doesn't become a degenerate interior vertex.
      const interior = dedupConsecutive(draft.vertices).filter(
        (v, i, arr) =>
          i < arr.length - 1 || Math.hypot(v.x - endSnap.pos.x, v.y - endSnap.pos.y) > 1e-6,
      );
      finishPipe({ ...draft, vertices: interior }, endSnap, screen);
      return;
    }
    if (tool === 'rope' && ropeDraft) {
      const pts = ropeDraft.points;
      // See isCoincidentFinish: a real finish is only the case where the two
      // clicks landed on the same spot — the last two waypoints coincident.
      if (!isCoincidentFinish(pts.map((s) => s.pos))) return;
      const dedup = pts.filter(
        (s, i) =>
          i === 0 || Math.hypot(s.pos.x - pts[i - 1]!.pos.x, s.pos.y - pts[i - 1]!.pos.y) > 1e-6,
      );
      if (dedup.length >= 2) {
        const specs = dedup.map((s) => snapToEndSpec(s, 'pivot', ropeDraft.depthM));
        updateCurrent((cur) => addRope(cur, specs).doc);
      }
      setRopeDraft(null);
      return;
    }
    if (tool === 'select') {
      // only a COINCIDENT pair of clicks is a real double-click — Konva's
      // dblclick is time-based, so two rapid dblclicks at different nodes
      // fire a spurious third event spanning both, double-toggling anchors
      const prev = prevMouseDownScreenRef.current;
      if (!prev || Math.hypot(screen.x - prev.x, screen.y - prev.y) >= 4) return;
      const snap = snapAt(screen);
      if (snap.kind === 'node') {
        const node = mech.nodes.find((n) => n.id === snap.nodeId);
        if (node) {
          // anchoring materializes a ground hinge about this panel's normal
          // (setNodeKind), so the anchored chain end stays in-plane
          updateCurrent((cur) =>
            setNodeKind(cur, snap.nodeId, node.kind === 'anchor' ? 'free' : 'anchor', panelHinge),
          );
        }
      }
    }
  };

  // Wheel navigation: every wheel scroll is a cursor-anchored zoom (mouse
  // notch, trackpad scroll, and trackpad pinch alike — gesture.ts normalizes
  // the deltas). Panning is middle-drag / space+drag / two-finger touch.
  // Applied to `view` state (never a CSS transform), so Konva re-renders
  // vector-sharp per point (§11 acceptance).
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const screen = stagePointer(e as unknown as Konva.KonvaEventObject<MouseEvent>);
    if (!screen) return;
    setView((v) => zoomAt(v, screen, wheelZoomFactor(e.evt)));
  };

  // space held = drag pans (the marquee took over plain empty-space drag);
  // tracked on window so the hand is available regardless of focus, but not
  // while typing in a field
  useEffect(() => {
    const isTyping = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA';
    };
    const onDown = (ev: KeyboardEvent) => {
      if (ev.code === 'Space' && !isTyping(ev)) spaceDownRef.current = true;
    };
    const onUp = (ev: KeyboardEvent) => {
      if (ev.code === 'Space') spaceDownRef.current = false;
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  // escape aborts this panel's in-progress drafts/gestures. Its OWN effect,
  // registered once (every setter here is identity-stable): the delete/nudge
  // handler below re-registers whenever its deps change, and EditorShell's
  // Escape handler clears the selection — a listener torn down and re-added
  // DURING the Escape dispatch is not invoked for that very event, which is
  // exactly how ESC used to fail to abort a mid-drag pipe (Joe's report).
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      setDraft(null);
      setBindFrom(null);
      setPendingConnect(null);
      resetForceDrafts();
      setEndpointDrag(null);
      setMarquee(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPendingConnect, resetForceDrafts]);

  // keyboard: delete selection (active panel only — one deleter for a global
  // selection), arrows nudge the selection's nodes in this panel's plane
  useEffect(() => {
    const NUDGE: Record<string, Vec2> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: 1 },
      ArrowDown: { x: 0, y: -1 },
    };
    const onKey = (ev: KeyboardEvent) => {
      if (selectedElementIds.length === 0 || !mech || !doc || activePanel !== panelId) return;
      const target = ev.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        // one updateCurrent = one undo entry for the whole selection
        updateCurrent((cur) => selectedElementIds.reduce((d, id) => deleteElement(d, id), cur));
        clearSelection();
        return;
      }
      const dir = NUDGE[ev.key];
      if (!dir) return;
      ev.preventDefault();
      // arrow nudge (PLANFILE-multiselect-drag-constraints): one length-snap
      // step (½ in / 1 cm) per press, one undo entry per press. Same regime
      // as the drags — constraints off writes directly, on goes through the
      // solver and keeps only a converged pose.
      const step = lengthStepM(doc.unitsPreference ?? 'imperial');
      const delta = panelToWorld({ x: dir.x * step, y: dir.y * step }, frame, 0);
      const nodeIds = groupDragNodeIds(mech, selectedElementIds);
      if (nodeIds.length === 0) return;
      const wanted = new Set(nodeIds);
      const orig: Record<string, Vec3> = {};
      for (const n of mech.nodes) if (wanted.has(n.id)) orig[n.id] = n.position;
      const targets = translatedTargets(orig, delta);
      if (!constraintsOn) {
        updateCurrent((cur) => moveNodes(cur, targets));
        return;
      }
      const channelValues = Object.fromEntries(mech.inputs.map((c) => [c.name, c.value]));
      try {
        const result = solve(
          mech,
          {
            channelValues,
            dragTargets: { ...bindingTargets(mech, doc.wearer, pose), ...targets },
            groundTargets: anchorTargets(mech, doc.wearer, pose),
          },
          'kinematic',
        );
        if (result.diagnostics.converged) updateCurrent((cur) => moveNodes(cur, result.positions));
      } catch {
        // a solver throw must not break the nudge (the selection stays put)
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectedElementIds,
    mech,
    doc,
    activePanel,
    panelId,
    frame,
    pose,
    constraintsOn,
    updateCurrent,
    clearSelection,
  ]);

  if (!doc || !mech) {
    return <div ref={containerRef} style={{ flex: 1 }} data-testid="sketch-canvas" />;
  }

  const S = (p: Vec2) => toScreen(view, p);
  const nodePos = (id: string): Vec2 => projected[id] ?? { x: 0, y: 0 };
  const flat = (pts: Vec2[]) => pts.flatMap((p) => [S(p).x, S(p).y]);
  const seg3 = (a?: Vec3, b?: Vec3): number =>
    a && b ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) : 0;

  // adaptive grid: 0.1 m lines, plus 0.5" when zoomed in. Upright panels
  // draw the panel-plane square grid; ISO draws the projected GROUND grid —
  // the world x/z lattice through the origin, i.e. the classic isometric
  // diamond grid — matching where iso grid-snaps land (Joe's request).
  const gridLines: Array<{ pts: number[]; strong: boolean }> = [];
  {
    const step = gridStepM;
    const w0 = toWorld(view, { x: 0, y: size.h });
    const w1 = toWorld(view, { x: size.w, y: 0 });
    if (panelId === 'iso') {
      // panel-2D directions of the world ground axes; a ground lattice point
      // (a·step, 0, b·step) lands at step·(a·PX + b·PZ) in panel 2D
      const PX = projectToPanel({ x: 1, y: 0, z: 0 }, frame);
      const PZ = projectToPanel({ x: 0, y: 0, z: 1 }, frame);
      const det = PX.x * PZ.y - PX.y * PZ.x;
      const toLattice = (p: Vec2) => ({
        a: (p.x * PZ.y - p.y * PZ.x) / det / step,
        b: (PX.x * p.y - PX.y * p.x) / det / step,
      });
      const at = (a: number, b: number): Vec2 => ({
        x: step * (a * PX.x + b * PZ.x),
        y: step * (a * PX.y + b * PZ.y),
      });
      // lattice range covering the visible rect (its corners, inverted)
      const corners = [w0, w1, { x: w0.x, y: w1.y }, { x: w1.x, y: w0.y }].map(toLattice);
      const aMin = Math.floor(Math.min(...corners.map((c) => c.a)));
      const aMax = Math.ceil(Math.max(...corners.map((c) => c.a)));
      const bMin = Math.floor(Math.min(...corners.map((c) => c.b)));
      const bMax = Math.ceil(Math.max(...corners.map((c) => c.b)));
      for (let a = aMin; a <= aMax; a++) {
        gridLines.push({ pts: flat([at(a, bMin), at(a, bMax)]), strong: a === 0 });
      }
      for (let b = bMin; b <= bMax; b++) {
        gridLines.push({ pts: flat([at(aMin, b), at(aMax, b)]), strong: b === 0 });
      }
    } else {
      for (let x = Math.floor(w0.x / step) * step; x <= w1.x; x += step) {
        gridLines.push({
          pts: flat([
            { x, y: w0.y },
            { x, y: w1.y },
          ]),
          strong: Math.abs(x) < 1e-9,
        });
      }
      for (let y = Math.floor(w0.y / step) * step; y <= w1.y; y += step) {
        gridLines.push({
          pts: flat([
            { x: w0.x, y },
            { x: w1.x, y },
          ]),
          strong: Math.abs(y) < 1e-9,
        });
      }
    }
  }

  const memberCount = new Map<string, number>();
  for (const el of mech.elements) {
    const bump = (id: string) => memberCount.set(id, (memberCount.get(id) ?? 0) + 1);
    if (el.type === 'link' || el.type === 'telescope') {
      bump(el.nodeA);
      bump(el.nodeB);
    } else if (el.type === 'bentLink') el.nodeIds.forEach(bump);
  }

  // joint glyph language (design handoff §1): pivot = ring, weld = filled
  // square, slider = rounded slot, anchor = diamond, bound = green ring
  const pivotByNode = new Map<string, PivotElement>();
  const sliderByNode = new Map<string, SliderElement>();
  for (const el of mech.elements) {
    if (el.type === 'pivot') pivotByNode.set(el.nodeId, el);
    else if (el.type === 'slider') sliderByNode.set(el.nodeId, el);
  }

  const boundNodes = new Set(mech.skeletonBindings.map((b) => b.nodeId));

  const selectedSet = new Set(selectedElementIds);
  const strokeFor = (id: string): string =>
    violated.includes(id) ? '#d22' : selectedSet.has(id) ? '#d80' : C.ink;
  const pipeWidth = (id: string): number => (selectedSet.has(id) ? 5.5 : 5);

  // white endpoint handles on selected pipes (drag = length edit); adjacent
  // selected pipes share joint nodes, so dedupe by node (locked if any
  // selected pipe at the node is length-locked)
  const endpointByNode = new Map<string, { nodeId: string; locked: boolean }>();
  for (const el of mech.elements) {
    if (!selectedSet.has(el.id)) continue;
    if (el.type === 'link' || el.type === 'telescope') {
      for (const nodeId of [el.nodeA, el.nodeB]) {
        const locked = el.lengthLocked === true || endpointByNode.get(nodeId)?.locked === true;
        endpointByNode.set(nodeId, { nodeId, locked });
      }
    }
  }
  const selectedEndpointNodes = [...endpointByNode.values()];

  // every node the selection touches gets a soft persistent halo, so
  // selected joints and points read as selected the way the orange pipe
  // stroke does (PLANFILE-multiselect-drag-constraints)
  const selectedNodeIds = groupDragNodeIds(mech, selectedElementIds);

  const hoverElement = (id: string) => tool === 'select' && setHoveredElementId(id);
  const unhoverElement = (id: string) => setHoveredElementId((cur) => (cur === id ? null : cur));

  const compressionRopes = new Set(equilibrium.ropesRequiringCompression);
  const cordStroke = (id: string, base: string): string =>
    compressionRopes.has(id) || violated.includes(id)
      ? '#d22'
      : selectedSet.has(id)
        ? '#d80'
        : base;
  const showForces =
    equilibriumOn && (equilibrium.status === 'converged' || equilibrium.status === 'nonConverged');
  const units = doc.unitsPreference;
  const isActive = activePanel === panelId;

  // wearer snap targets (skeleton points, pack-frame anchors) stay hidden
  // until they matter: a node/endpoint drag in flight shows them ALL (they
  // are drop targets); otherwise — armed draw tools included — only the one
  // the cursor is snapping to / hovering shows (via hoverSnap)
  const wearerTargetsVisible = dragNode !== null || endpointDrag !== null;

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        // minWidth 0 + hidden overflow let this flex item shrink below the
        // Konva stage's fixed pixel width, so the info panel docks on-screen
        // instead of pushing the row wide (flexbox min-width:auto)
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
        touchAction: 'none',
      }}
      data-testid={`sketch-canvas-${panelId}`}
    >
      <Stage
        width={size.w}
        height={size.h}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onClick={onStageClick}
        onDblClick={onDblClick}
        onContextMenu={onStageContextMenu}
        onWheel={onWheel}
      >
        <Layer listening={false}>
          {gridLines.map((g, i) => (
            <Line
              // biome-ignore lint/suspicious/noArrayIndexKey: grid lines are positional, regenerated wholesale, and never reorder
              key={i}
              points={g.pts}
              stroke={g.strong ? C.gridStrong : C.gridWeak}
              strokeWidth={1}
            />
          ))}
          {/* ground plane at world y = 0 (slice C): the solver's floor —
              free nodes cannot be dragged or settle below it. Not in `top`
              (that view maps the ground plane itself). Upright panels draw
              it as a horizontal line; ISO projects the ground's ±x/±z axes
              instead — a flat line would be wrong under an axonometric
              projection (PLANFILE-iso-view.md). */}
          {panelId === 'iso'
            ? (
                [
                  [
                    { x: -100, y: 0, z: 0 },
                    { x: 100, y: 0, z: 0 },
                  ],
                  [
                    { x: 0, y: 0, z: -100 },
                    { x: 0, y: 0, z: 100 },
                  ],
                ] as const
              ).map((axis, i) => (
                <Line
                  // biome-ignore lint/suspicious/noArrayIndexKey: two fixed ground axes, never reordered
                  key={`ga${i}`}
                  points={flat(axis.map((w) => projectToPanel(w, frame)))}
                  stroke={C.silhouette}
                  strokeWidth={1.5}
                  dash={[10, 6]}
                />
              ))
            : panelId !== 'top' && (
                <Line
                  points={[0, S({ x: 0, y: 0 }).y, size.w, S({ x: 0, y: 0 }).y]}
                  stroke={C.silhouette}
                  strokeWidth={1.5}
                  dash={[10, 6]}
                />
              )}
          {silhouette?.outlines.map((poly, i) => (
            <Line
              // biome-ignore lint/suspicious/noArrayIndexKey: silhouette outlines are a fixed projection, regenerated wholesale, never reordered
              key={`s${i}`}
              points={flat(poly)}
              stroke={C.silhouette}
              strokeWidth={2.5}
              lineCap="round"
              lineJoin="round"
            />
          ))}
          {/* sketch-figure shapes: egg head, joint rings, fists, foot ovals */}
          {silhouette?.loops.map((poly, i) => (
            <Line
              // biome-ignore lint/suspicious/noArrayIndexKey: silhouette loops are a fixed projection, regenerated wholesale, never reordered
              key={`sl${i}`}
              points={flat(poly)}
              stroke={C.silhouette}
              strokeWidth={2}
              lineJoin="round"
              closed
            />
          ))}
          {/* skeleton binding points and structural anchors stay snappable
              underlay points (planfile §7.1) but only DRAW while a gesture
              can use them or the pointer hovers one (wearerTargetsVisible;
              DECISIONS.md) — a pivot dropped on a skeleton point binds to
              it; dropped on a pack-frame anchor it grounds there */}
          {silhouette &&
            Object.entries(silhouette.points).map(([name, p]) =>
              wearerTargetsVisible ||
              (hoverSnap?.kind === 'skeleton' && hoverSnap.point === name) ? (
                <Circle
                  key={`sp${name}`}
                  x={S(p).x}
                  y={S(p).y}
                  radius={4}
                  stroke="#7a9"
                  strokeWidth={1.5}
                />
              ) : null,
            )}
          {silhouette &&
            Object.entries(silhouette.anchors).map(([name, p]) =>
              wearerTargetsVisible ||
              (hoverSnap?.kind === 'anchor' && hoverSnap.anchor === name) ? (
                <Rect
                  key={`sa${name}`}
                  x={S(p).x - 3}
                  y={S(p).y - 3}
                  width={6}
                  height={6}
                  stroke="#a97"
                  strokeWidth={1.5}
                />
              ) : null,
            )}
        </Layer>

        <Layer>
          {mech.elements.map((el) => {
            if (el.type === 'link' || el.type === 'telescope') {
              return (
                <Line
                  key={el.id}
                  points={flat([nodePos(el.nodeA), nodePos(el.nodeB)])}
                  stroke={strokeFor(el.id)}
                  strokeWidth={el.type === 'telescope' ? pipeWidth(el.id) + 1 : pipeWidth(el.id)}
                  lineCap="round"
                  onClick={(e) => tool === 'select' && clickSelect(el.id, e.evt)}
                  onMouseEnter={() => hoverElement(el.id)}
                  onMouseLeave={() => unhoverElement(el.id)}
                  hitStrokeWidth={12}
                />
              );
            }
            if (el.type === 'bentLink') {
              return (
                <Line
                  key={el.id}
                  points={flat(el.nodeIds.map(nodePos))}
                  stroke={strokeFor(el.id)}
                  strokeWidth={pipeWidth(el.id)}
                  lineCap="round"
                  lineJoin="round"
                  onClick={(e) => tool === 'select' && clickSelect(el.id, e.evt)}
                  onMouseEnter={() => hoverElement(el.id)}
                  onMouseLeave={() => unhoverElement(el.id)}
                  hitStrokeWidth={12}
                />
              );
            }
            if (el.type === 'rope') {
              return (
                <Line
                  key={el.id}
                  points={flat(el.path.map(nodePos))}
                  stroke={cordStroke(el.id, C.rope)}
                  strokeWidth={2}
                  dash={[4, 4]}
                  lineCap="round"
                  lineJoin="round"
                  onClick={(e) => tool === 'select' && clickSelect(el.id, e.evt)}
                  hitStrokeWidth={12}
                />
              );
            }
            if (el.type === 'elastic') {
              const a = S(nodePos(el.nodeA));
              const b = S(nodePos(el.nodeB));
              return (
                <Line
                  key={el.id}
                  points={zigzag(a, b, 9, 6)}
                  stroke={cordStroke(el.id, '#2a8a4a')}
                  strokeWidth={2.5}
                  lineJoin="round"
                  onClick={(e) => tool === 'select' && clickSelect(el.id, e.evt)}
                  hitStrokeWidth={12}
                />
              );
            }
            if (el.type === 'bowden') {
              const a1 = S(nodePos(el.a1));
              const a2 = S(nodePos(el.a2));
              const b1 = S(nodePos(el.b1));
              const b2 = S(nodePos(el.b2));
              const midA = { x: (a1.x + a2.x) / 2, y: (a1.y + a2.y) / 2 };
              const midB = { x: (b1.x + b2.x) / 2, y: (b1.y + b2.y) / 2 };
              const stroke = cordStroke(el.id, '#8a5cd0');
              return (
                <Group key={el.id} onClick={(e) => tool === 'select' && clickSelect(el.id, e.evt)}>
                  {/* faint tie between the two coupled segments (routing-independent) */}
                  <Line
                    points={[midA.x, midA.y, midB.x, midB.y]}
                    stroke="#8a5cd0"
                    strokeWidth={1}
                    dash={[1, 5]}
                    opacity={0.5}
                    listening={false}
                  />
                  <Line
                    points={[a1.x, a1.y, a2.x, a2.y]}
                    stroke={stroke}
                    strokeWidth={2.5}
                    dash={[8, 3, 2, 3]}
                    lineCap="round"
                    hitStrokeWidth={12}
                  />
                  <Line
                    points={[b1.x, b1.y, b2.x, b2.y]}
                    stroke={stroke}
                    strokeWidth={2.5}
                    dash={[8, 3, 2, 3]}
                    lineCap="round"
                    hitStrokeWidth={12}
                  />
                </Group>
              );
            }
            if (el.type === 'torsionCable') {
              const pa = mech.elements.find((e) => e.id === el.pivotA);
              const pb = mech.elements.find((e) => e.id === el.pivotB);
              if (pa?.type !== 'pivot' || pb?.type !== 'pivot') return null;
              const a = S(nodePos(pa.nodeId));
              const b = S(nodePos(pb.nodeId));
              return (
                <Line
                  key={el.id}
                  points={[a.x, a.y, b.x, b.y]}
                  stroke={selectedSet.has(el.id) ? '#d80' : '#c0459a'}
                  strokeWidth={1.5}
                  dash={[2, 4]}
                  onClick={(e) => tool === 'select' && clickSelect(el.id, e.evt)}
                  hitStrokeWidth={12}
                />
              );
            }
            return null;
          })}

          {/* binding leader lines */}
          {silhouette &&
            mech.skeletonBindings.map((b) => {
              const from = projected[b.nodeId];
              const to = silhouette.points[b.point];
              if (!from || !to) return null;
              return (
                <Line
                  key={b.id}
                  points={flat([from, to])}
                  stroke="#4a4"
                  strokeWidth={1.5}
                  dash={[3, 5]}
                  listening={false}
                />
              );
            })}

          {/* hinge-plane arcs: a thin arc swept between a pivot's pipes IN its
              hinge plane (Joe's ask), so the plane the pivot works in reads at
              a glance. The 3D arc is projected like everything else — a true
              circular arc when the panel faces the hinge axis, foreshortened
              to a slit edge-on. Radius scales with zoom (≈18px). */}
          {mech.elements.map((el) => {
            if (el.type !== 'pivot') return null;
            const arc = pivotArcPoints(mech, el, renderPositions, 18 / view.scale, 20);
            if (!arc) return null;
            return (
              <Line
                key={`arc-${el.id}`}
                points={flat(arc.map((p) => projectToPanel(p, frame)))}
                stroke={selectedSet.has(el.id) ? '#d80' : '#8ab'}
                strokeWidth={1.2}
                lineCap="round"
                listening={false}
              />
            );
          })}

          {/* dashed ghost of the pre-drag pose during an endpoint length edit */}
          {endpointDrag && (
            <Line
              points={flat(endpointDrag.ghost)}
              stroke={C.dim}
              strokeWidth={3}
              dash={[6, 5]}
              lineCap="round"
              listening={false}
            />
          )}

          {tracePath.length > 1 && (
            <Line
              points={flat(tracePath.map((p) => projectToPanel(p, frame)))}
              stroke="#e80"
              strokeWidth={1.5}
              listening={false}
            />
          )}

          {draft && (
            <Line
              points={flat([draft.start.pos, ...draft.vertices, draft.cursor])}
              stroke="#888"
              strokeWidth={2}
              dash={[6, 4]}
              listening={false}
            />
          )}

          {/* force-tool previews */}
          {ropeDraft && (
            <Line
              points={flat([...ropeDraft.points.map((s) => s.pos), ropeDraft.cursor])}
              stroke="#88a"
              strokeWidth={1.5}
              dash={[3, 3]}
              listening={false}
            />
          )}
          {dragCord && dragCord.tool === 'elastic' && (
            <Line
              points={zigzag(S(dragCord.start.pos), S(dragCord.cursor))}
              stroke="#2a8a4a"
              strokeWidth={2}
              opacity={0.7}
              listening={false}
            />
          )}
          {dragCord && dragCord.tool === 'bowden' && (
            <Line
              points={flat([dragCord.start.pos, dragCord.cursor])}
              stroke="#8a5cd0"
              strokeWidth={2.5}
              dash={[8, 3, 2, 3]}
              opacity={0.7}
              listening={false}
            />
          )}
          {bowdenA && (
            <Line
              points={flat([bowdenA.start.pos, bowdenA.end.pos])}
              stroke="#8a5cd0"
              strokeWidth={2.5}
              dash={[8, 3, 2, 3]}
              listening={false}
            />
          )}
          {torsionA && projected[torsionA.nodeId] && (
            <Circle
              x={S(projected[torsionA.nodeId]!).x}
              y={S(projected[torsionA.nodeId]!).y}
              radius={10}
              stroke="#c0459a"
              strokeWidth={2}
              listening={false}
            />
          )}

          {/* equilibrium force readouts + rope-compression warnings (§5.2) */}
          {showForces &&
            mech.elements.filter(carriesForceLabel).map((el) => {
              const anchor = forceLabelAnchor(el, (id) => projected[id]);
              if (!anchor) return null;
              const p = S(anchor);
              const compression = compressionRopes.has(el.id);
              const label = compression
                ? '⚠ needs compression'
                : formatForce(equilibrium.elementForces[el.id] ?? 0, units);
              return (
                <Text
                  key={`force-${el.id}`}
                  x={p.x + 6}
                  y={p.y - 6}
                  text={label}
                  fontSize={11}
                  fill={compression ? '#c00' : C.tension}
                  shadowColor={C.halo}
                  shadowBlur={2}
                  shadowOpacity={1}
                  listening={false}
                />
              );
            })}

          {/* soft halo behind the hovered node hotspot (select tool) */}
          {tool === 'select' && hoverSnap?.kind === 'node' && (
            <Circle
              x={S(hoverSnap.pos).x}
              y={S(hoverSnap.pos).y}
              radius={13}
              fill="rgba(34,136,221,.15)"
              listening={false}
            />
          )}

          {/* soft persistent halo behind every node of the selection */}
          {selectedNodeIds.map((id) => {
            const p = S(nodePos(id));
            return (
              <Circle
                key={`sel-${id}`}
                x={p.x}
                y={p.y}
                radius={13}
                fill="rgba(221,136,0,0.2)"
                listening={false}
              />
            );
          })}

          {mech.nodes.map((n) => {
            const p = S(nodePos(n.id));
            // glyph priority: anchor > bound > slider > weld/pivot > end dot
            if (n.kind === 'anchor') {
              return (
                <Rect
                  key={n.id}
                  x={p.x}
                  y={p.y}
                  width={13}
                  height={13}
                  offsetX={6.5}
                  offsetY={6.5}
                  rotation={45}
                  fill={C.ink}
                />
              );
            }
            if (boundNodes.has(n.id)) {
              return (
                <Group key={n.id}>
                  <Circle
                    x={p.x}
                    y={p.y}
                    radius={7.5}
                    fill={C.nodeFill}
                    stroke="#2a2"
                    strokeWidth={3}
                  />
                  {(memberCount.get(n.id) ?? 0) >= 2 && (
                    <Circle x={p.x} y={p.y} radius={2.2} fill="#2a2" listening={false} />
                  )}
                </Group>
              );
            }
            const slider = sliderByNode.get(n.id);
            if (slider) {
              const along = mech.elements.find((e) => e.id === slider.alongElementId);
              let rotation = 0;
              if (along && (along.type === 'link' || along.type === 'telescope')) {
                const a = S(nodePos(along.nodeA));
                const b = S(nodePos(along.nodeB));
                rotation = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
              }
              return (
                <Rect
                  key={n.id}
                  x={p.x}
                  y={p.y}
                  width={30}
                  height={16}
                  offsetX={15}
                  offsetY={8}
                  rotation={rotation}
                  cornerRadius={8}
                  fill={C.nodeFill}
                  stroke="#28d"
                  strokeWidth={3}
                />
              );
            }
            const pivot = pivotByNode.get(n.id);
            const members = memberCount.get(n.id) ?? 0;
            const fullyWelded =
              pivot !== undefined &&
              pivot.welds.length >= pivot.memberIds.length - 1 &&
              pivot.welds.length > 0;
            if (fullyWelded) {
              return (
                <Rect
                  key={n.id}
                  x={p.x - 7}
                  y={p.y - 7}
                  width={14}
                  height={14}
                  fill={bindFrom === n.id ? '#d80' : C.ink}
                />
              );
            }
            if (pivot !== undefined || members >= 2) {
              const stroke =
                bindFrom === n.id ? '#d80' : pivot?.joint.kind === 'spherical' ? '#a6c' : '#28d';
              return (
                <Group key={n.id}>
                  <Circle
                    x={p.x}
                    y={p.y}
                    radius={7.5}
                    fill={C.nodeFill}
                    stroke={stroke}
                    strokeWidth={3}
                  />
                  {/* attachment dot: this end JOINS ≥2 pipes (a hollow ring
                      alone can also be a lone pipe's realized pin) */}
                  {members >= 2 && (
                    <Circle x={p.x} y={p.y} radius={2.2} fill={stroke} listening={false} />
                  )}
                </Group>
              );
            }
            return (
              <Circle
                key={n.id}
                x={p.x}
                y={p.y}
                radius={5.5}
                fill={bindFrom === n.id ? '#d80' : '#28d'}
              />
            );
          })}

          {/* white endpoint handles on the selected pipe (drag = length edit) */}
          {selectedEndpointNodes.map(({ nodeId, locked }) => {
            const p = S(nodePos(nodeId));
            return (
              <Circle
                key={`h-${nodeId}`}
                x={p.x}
                y={p.y}
                radius={9}
                fill={C.nodeFill}
                stroke="#d80"
                strokeWidth={3}
                opacity={locked ? 0.55 : 1}
                listening={false}
              />
            );
          })}

          {/* red snap ring: in select mode only while a node drag is live
              (bind feedback) — idle skeleton/anchor hover just reveals the
              handle above, without suggesting an action. With grid snapping
              off, the 'grid' fallback is the RAW pointer — no ring. */}
          {hoverSnap &&
            (snapPrefs.grid || hoverSnap.kind !== 'grid') &&
            (tool !== 'select' || (hoverSnap.kind !== 'node' && dragNode !== null)) && (
              <Circle
                x={S(hoverSnap.pos).x}
                y={S(hoverSnap.pos).y}
                radius={8}
                stroke={hoverSnap.kind === 'grid' ? C.snap : '#e33'}
                strokeWidth={1.5}
                listening={false}
              />
            )}

          {marquee && (
            <Rect
              x={Math.min(marquee.start.x, marquee.cursor.x)}
              y={Math.min(marquee.start.y, marquee.cursor.y)}
              width={Math.abs(marquee.cursor.x - marquee.start.x)}
              height={Math.abs(marquee.cursor.y - marquee.start.y)}
              fill="rgba(42,120,214,0.08)"
              stroke="#2a78d6"
              strokeWidth={1}
              dash={[4, 4]}
              listening={false}
            />
          )}
        </Layer>
      </Stage>

      {/* HTML overlays above the stage: dimension chips per panel; the joint
          popover and selection card only in the last-touched (active) panel */}
      <DimensionChips
        doc={doc}
        mech={mech}
        view={view}
        positions={projected}
        lengths={{
          of: (a, b) => seg3(renderPositions[a], renderPositions[b]),
        }}
        hoveredElementId={hoveredElementId}
        endpointDrag={
          endpointDrag ? { elementId: endpointDrag.elementId, ...endpointDrag.readout } : null
        }
        dragging={endpointDrag !== null || dragNode !== null || bodyDrag !== null}
      />
      {isActive && (
        <JointPopover
          mech={mech}
          view={view}
          positions={projected}
          container={containerRef.current}
          frame={frame}
        />
      )}
      {/* the selection card opens in the nearest OTHER viewport so it never
          covers the geometry being worked on (selectionCardHost); it hides
          during any drag, in any panel (dragNodeId covers cross-panel drags,
          the local states cover this panel's endpoint drags) */}
      {(panelId === 'iso'
        ? activePanel === 'iso'
        : selectionCardHost(activePanel, panelsVisible, quadMaximized) === panelId) &&
        tool === 'select' &&
        !endpointDrag &&
        !dragNode &&
        !bodyDrag &&
        dragNodeId === null && (
          <SelectionCard doc={doc} mech={mech} view={view} positions={projected} size={size} />
        )}
    </div>
  );
}
