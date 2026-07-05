// The panel sketch canvas (PLANFILE-3d-conversion.md): every quad ortho
// panel hosts this full editing surface over the whole compound mechanism,
// projected into the panel's plane. The document is Vec3; this component
// projects for drawing/snapping and lifts pointer input back through the
// panel frame at the panel's active work-plane depth (snapping to existing
// geometry adopts that geometry's depth so connections land exactly).
import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { elementIdsInRect, normalizedRect } from '../../design/marquee';
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
  PANEL_FRAME,
  panelDepthOf,
  panelToWorld,
  projectPositions,
  projectToPanel,
} from '../quad/panelProject';
import { M_PER_IN } from '../units';
import { DimensionChips, type EndpointDragReadout } from './DimensionChips';
import { carriesForceLabel, forceLabelAnchor, formatForce, pickRenderPositions } from './forces';
import { pinchStep, wheelGesture } from './gesture';
import { JointPopover } from './JointPopover';
import { SelectionCard } from './SelectionCard';
import { dedupConsecutive, findSnap, GRID_M, isCoincidentFinish, type Snap } from './snapping';
import { scenePalette } from './theme';
import { initialView, panBy, toScreen, toWorld, type ViewTransform, zoomAt } from './viewTransform';

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
  const equilibrium = useEditorStore((s) => s.equilibrium);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const focusElementId = useEditorStore((s) => s.focusElementId);
  const setFocusElement = useEditorStore((s) => s.setFocusElement);
  const workDepthM = useEditorStore((s) => s.panelDepths[panelId]);
  const setPanelDepth = useEditorStore((s) => s.setPanelDepth);
  const activePanel = useEditorStore((s) => s.activePanel);
  const setActivePanel = useEditorStore((s) => s.setActivePanel);
  const setDragNode3 = useEditorStore((s) => s.setDragNode);

  const mech: Mechanism | null = doc?.mechanism ?? null;
  const frame = PANEL_FRAME[panelId];

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
  const panRef = useRef<{ x: number; y: number } | null>(null);
  /** where the last mousedown landed, to tell a click from a drag/pan */
  const mouseDownScreenRef = useRef<Vec2 | null>(null);
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

  // a stationary click on a node: select the joint element living there (if
  // any) and open the joint popover at the node (design handoff §6)
  const openJointPopover = useCallback(
    (nodeId: string, evt: MouseEvent) => {
      if (!mech) return;
      const joint = mech.elements.find(
        (el) => (el.type === 'pivot' || el.type === 'slider') && el.nodeId === nodeId,
      );
      if (joint) clickSelect(joint.id, evt);
      setOpenPopover({ kind: 'joint', nodeId });
    },
    [mech, clickSelect, setOpenPopover],
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
    dragging: dragNode !== null,
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

  const snapAt = useCallback(
    (screen: Vec2, exclude?: ReadonlySet<string>, excludeElements?: ReadonlySet<string>): Snap => {
      const world = toWorld(view, screen);
      if (!mech) return { kind: 'grid', pos: world };
      return findSnap(world, {
        mechanism: mech,
        positions: projected,
        silhouette,
        tolM: SNAP_TOL_PX / view.scale,
        gridM: GRID_M,
        exclude,
        excludeElements,
      });
    },
    [view, mech, projected, silhouette],
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
    mouseDownScreenRef.current = screen;
    setActivePanel(panelId);
    // canvas mousedown dismisses floating popovers and inline edits
    const editor = useEditorStore.getState();
    if (editor.openPopover) editor.setOpenPopover(null);
    if (editor.lengthEdit) editor.setLengthEdit(null);
    const snap = snapAt(screen);

    if (tool === 'select') {
      marqueeCommittedRef.current = false;
      // middle-mouse or space+drag pans; plain drag on empty space marquees
      if (e.evt.button === 1 || spaceDownRef.current) {
        panRef.current = screen;
        return;
      }
      if (snap.kind === 'node') {
        adoptDepth(snap);
        const depthM = depthOfSnap(snap, workDepthM);
        // an endpoint of a selected, unlocked pipe drags as a LENGTH edit
        // (direct geometry move); any other node drags as a pose
        const owner = mech.elements.find(
          (el) =>
            (el.type === 'link' || el.type === 'telescope') &&
            selectedElementIds.includes(el.id) &&
            !el.lengthLocked &&
            (el.nodeA === snap.nodeId || el.nodeB === snap.nodeId),
        );
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
        setMarquee({ start: screen, cursor: screen });
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
      setView((v) => panBy(v, screen.x - panRef.current!.x, screen.y - panRef.current!.y));
      panRef.current = screen;
      return;
    }

    if (tool === 'select' && marquee) {
      setMarquee((m) => (m ? { ...m, cursor: screen } : m));
      return;
    }

    if (tool === 'select' && endpointDrag) {
      // direct geometry edit: move ONE node; node/skeleton/anchor snaps win,
      // then length ticks (½ in / 1 cm), else the raw pointer lifted at the
      // node's own depth
      const world2 = toWorld(view, screen);
      const liveDoc = useAppStore.getState().current;
      const liveMech = liveDoc?.mechanism;
      const el = liveMech?.elements.find((x) => x.id === endpointDrag.elementId);
      if (!liveMech || !el || (el.type !== 'link' && el.type !== 'telescope')) return;
      const otherId = el.nodeA === endpointDrag.nodeId ? el.nodeB : el.nodeA;
      const other = liveMech.nodes.find((n) => n.id === otherId)?.position;
      if (!other) return;
      const snap = snapAt(screen, new Set([endpointDrag.nodeId]), endpointDrag.incidentElementIds);
      let pos: Vec3;
      let snapped: boolean;
      if (snap.kind !== 'grid') {
        pos = vec3OfSnap(snap, endpointDrag.depthM);
        snapped = true;
      } else {
        const raw3 = to3D(world2, endpointDrag.depthM);
        const d = {
          x: raw3.x - other.x,
          y: raw3.y - other.y,
          z: raw3.z - other.z,
        };
        const raw = Math.hypot(d.x, d.y, d.z);
        const step = lengthStepM(doc.unitsPreference ?? 'imperial');
        const tick = Math.round(raw / step) * step;
        if (raw > 1e-9 && Math.abs(tick - raw) < (SNAP_TOL_PX * 0.5) / view.scale && tick > 0) {
          const s = tick / raw;
          pos = { x: other.x + d.x * s, y: other.y + d.y * s, z: other.z + d.z * s };
          snapped = true;
        } else {
          pos = raw3;
          snapped = false;
        }
      }
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
      // in select); a pack-frame anchor attracts the same way and grounds
      const dropSnap = snapAt(screen, new Set([dragNode.nodeId]));
      const bindSnap = dropSnap.kind === 'skeleton' || dropSnap.kind === 'anchor' ? dropSnap : null;
      setHoverSnap(bindSnap);
      // panel-plane-constrained target: the pointer moves the node in this
      // panel's plane at the node's own out-of-plane depth
      const target: Vec3 = bindSnap
        ? vec3OfSnap(bindSnap, dragNode.depthM)
        : to3D(world2, dragNode.depthM);
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
    setHoverSnap(tool === 'select' ? (snap.kind === 'node' ? snap : null) : snap);

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
    panRef.current = null;
    if (!screen || !mech) return;

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

    if (tool === 'select' && endpointDrag) {
      const start = mouseDownScreenRef.current;
      const movedPx = start ? Math.hypot(screen.x - start.x, screen.y - start.y) : Infinity;
      const nodeId = endpointDrag.nodeId;
      setEndpointDrag(null);
      endGesture();
      // a stationary click on an endpoint handle opens the joint popover
      if (movedPx < 4) openJointPopover(nodeId, e.evt);
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
      // (pivots/sliders have no stroke of their own to click on the canvas)
      // and opens the joint popover for one-click type changes
      if (movedPx < 4) {
        openJointPopover(nodeId, e.evt);
        return;
      }
      // a connected node released inside the deadzone never moved — the
      // release point (up to TEAR_OFF_PX away) must not re-bind it elsewhere
      if (tether && !tether.torn) return;
      // dropped on a skeleton binding point → bind the node to it, so it now
      // tracks that body point during clip playback (planfile §7.3); dropped
      // on a pack-frame anchor → ground it there, same as drawing onto one
      const dropSnap = snapAt(screen, new Set([nodeId]));
      if (dropSnap.kind === 'skeleton') {
        updateCurrent((cur) => addSkeletonBinding(cur, dropSnap.point, nodeId));
      } else if (dropSnap.kind === 'anchor') {
        updateCurrent((cur) =>
          groundNodeAtAnchor(cur, nodeId, dropSnap.anchor, vec3OfSnap(dropSnap, depthM)),
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
      const snap = snapAt(screen);
      if (snap.kind === 'node') {
        const node = mech.nodes.find((n) => n.id === snap.nodeId);
        if (node) {
          updateCurrent((cur) =>
            setNodeKind(cur, snap.nodeId, node.kind === 'anchor' ? 'free' : 'anchor'),
          );
        }
      }
    }
  };

  // Wheel navigation via the vendored gesture model (the zoompinch-spike
  // fallback): ctrl+wheel / trackpad-pinch → cursor-anchored zoom; plain wheel /
  // two-finger scroll → pan. Applied to `view` state (never a CSS transform), so
  // Konva re-renders vector-sharp per point (§11 acceptance).
  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const screen = stagePointer(e as unknown as Konva.KonvaEventObject<MouseEvent>);
    if (!screen) return;
    const g = wheelGesture(e.evt);
    setView((v) => (g.kind === 'zoom' ? zoomAt(v, screen, g.factor) : panBy(v, g.dxPx, g.dyPx)));
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

  // keyboard: delete selection (active panel only — one deleter for a global
  // selection), escape cancels this panel's draft/bind
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setDraft(null);
        setBindFrom(null);
        setPendingConnect(null);
        resetForceDrafts();
        setEndpointDrag(null);
        setMarquee(null);
      }
      if (
        (ev.key === 'Delete' || ev.key === 'Backspace') &&
        selectedElementIds.length > 0 &&
        mech &&
        activePanel === panelId
      ) {
        const target = ev.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        // one updateCurrent = one undo entry for the whole selection
        updateCurrent((cur) => selectedElementIds.reduce((d, id) => deleteElement(d, id), cur));
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectedElementIds,
    mech,
    activePanel,
    panelId,
    updateCurrent,
    clearSelection,
    setPendingConnect,
    resetForceDrafts,
  ]);

  if (!doc || !mech) {
    return <div ref={containerRef} style={{ flex: 1 }} data-testid="sketch-canvas" />;
  }

  const S = (p: Vec2) => toScreen(view, p);
  const nodePos = (id: string): Vec2 => projected[id] ?? { x: 0, y: 0 };
  const flat = (pts: Vec2[]) => pts.flatMap((p) => [S(p).x, S(p).y]);
  const seg3 = (a?: Vec3, b?: Vec3): number =>
    a && b ? Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) : 0;

  // adaptive grid: 0.1 m lines, plus 0.5" when zoomed in
  const gridLines: Array<{ pts: number[]; strong: boolean }> = [];
  {
    const step = view.scale > 700 ? GRID_M * 4 : 0.1;
    const w0 = toWorld(view, { x: 0, y: size.h });
    const w1 = toWorld(view, { x: size.w, y: 0 });
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

  // white endpoint handles on selected pipes (drag = length edit)
  const selectedEndpointNodes: Array<{ nodeId: string; locked: boolean }> = [];
  for (const el of mech.elements) {
    if (!selectedSet.has(el.id)) continue;
    if (el.type === 'link' || el.type === 'telescope') {
      selectedEndpointNodes.push(
        { nodeId: el.nodeA, locked: el.lengthLocked === true },
        { nodeId: el.nodeB, locked: el.lengthLocked === true },
      );
    }
  }

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
              (that view maps the ground plane itself). */}
          {panelId !== 'top' && (
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
              strokeWidth={2}
              lineJoin="round"
            />
          ))}
          {/* skeleton binding points and structural anchors are always shown
              (planfile §7.1: named anchors and skeleton points are snappable
              underlay points) — a pivot dropped on a skeleton point binds to
              it; dropped on a pack-frame anchor it grounds there */}
          {silhouette &&
            Object.entries(silhouette.points).map(([name, p]) => (
              <Circle
                key={`sp${name}`}
                x={S(p).x}
                y={S(p).y}
                radius={4}
                stroke="#7a9"
                strokeWidth={1.5}
              />
            ))}
          {silhouette &&
            Object.entries(silhouette.anchors).map(([name, p]) => (
              <Rect
                key={`sa${name}`}
                x={S(p).x - 3}
                y={S(p).y - 3}
                width={6}
                height={6}
                stroke="#a97"
                strokeWidth={1.5}
              />
            ))}
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
                <Circle
                  key={n.id}
                  x={p.x}
                  y={p.y}
                  radius={7.5}
                  fill={C.nodeFill}
                  stroke="#2a2"
                  strokeWidth={3}
                />
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
              return (
                <Circle
                  key={n.id}
                  x={p.x}
                  y={p.y}
                  radius={7.5}
                  fill={C.nodeFill}
                  stroke={
                    bindFrom === n.id ? '#d80' : pivot?.joint.kind === 'spherical' ? '#a6c' : '#28d'
                  }
                  strokeWidth={3}
                />
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

          {hoverSnap && (tool !== 'select' || hoverSnap.kind !== 'node') && (
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
        dragging={endpointDrag !== null || dragNode !== null}
      />
      {isActive && (
        <JointPopover mech={mech} view={view} positions={projected} size={size} frame={frame} />
      )}
      {isActive && tool === 'select' && !endpointDrag && !dragNode && (
        <SelectionCard doc={doc} mech={mech} view={view} positions={projected} size={size} />
      )}
    </div>
  );
}
