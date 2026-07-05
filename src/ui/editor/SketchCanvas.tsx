import type Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Group, Layer, Line, Rect, Stage, Text } from 'react-konva';
import type { Mechanism, Vec2 } from '../../schema';
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
  moveNodes,
  setNodeKind,
} from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { bindingTargets, computeSilhouette, getClip, REST_POSE, samplePose } from '../../wearer';
import { carriesForceLabel, forceLabelAnchor, formatForce, readEquilibrium } from './forces';
import { pinchStep, wheelGesture } from './gesture';
import { dedupConsecutive, findSnap, GRID_M, isCoincidentFinish, type Snap } from './snapping';
import { initialView, panBy, toScreen, toWorld, type ViewTransform, zoomAt } from './viewTransform';

const SNAP_TOL_PX = 14;

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

function snapToEndSpec(snap: Snap, connect: 'pivot' | 'weld' | 'slider' | 'detach'): EndSpec {
  if (connect === 'detach') return { kind: 'newNode', pos: snap.pos };
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
      return { kind: 'boundNode', pos: snap.pos, point: snap.point };
    case 'anchor':
      return { kind: 'anchorNode', pos: snap.pos };
    case 'grid':
      return { kind: 'newNode', pos: snap.pos };
  }
}

const needsMenu = (snap: Snap): boolean => snap.kind === 'node' || snap.kind === 'onPipe';

interface Draft {
  mode: 'pipe' | 'polyline' | 'freehand';
  start: Snap;
  vertices: Vec2[]; // committed interior vertices (polyline) / raw trail (freehand)
  cursor: Vec2;
}

export function SketchCanvas() {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const beginGesture = useAppStore((s) => s.beginGesture);
  const endGesture = useAppStore((s) => s.endGesture);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const tool = useEditorStore((s) => s.tool);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const posePositions = useEditorStore((s) => s.posePositions);
  const setPosePositions = useEditorStore((s) => s.setPosePositions);
  const playback = useEditorStore((s) => s.playback);
  const tracing = useEditorStore((s) => s.tracing);
  const tracePath = useEditorStore((s) => s.tracePath);
  const appendTrace = useEditorStore((s) => s.appendTrace);
  const setPendingConnect = useEditorStore((s) => s.setPendingConnect);
  const setDiagnostics = useEditorStore((s) => s.setDiagnostics);
  const violated = useEditorStore((s) => s.violated);
  const equilibriumOn = useEditorStore((s) => s.equilibriumOn);
  const equilibrium = useEditorStore((s) => s.equilibrium);
  const setEquilibrium = useEditorStore((s) => s.setEquilibrium);

  const mech: Mechanism | null = doc?.mechanisms.find((m) => m.id === activeMechanismId) ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState<ViewTransform>(() => initialView(800, 500));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hoverSnap, setHoverSnap] = useState<Snap | null>(null);
  const [dragNode, setDragNode] = useState<string | null>(null);
  const [bindFrom, setBindFrom] = useState<string | null>(null);
  // force-tool drafting (§8.1: ropes/elastics/bowden/torsion drawn with their
  // own tools). Rope routes through clicked waypoints; elastic/bowden are
  // click-drag; bowden needs two segments; torsion couples two picked pivots.
  const [ropeDraft, setRopeDraft] = useState<{ points: Snap[]; cursor: Vec2 } | null>(null);
  const [dragCord, setDragCord] = useState<{
    tool: 'elastic' | 'bowden';
    start: Snap;
    cursor: Vec2;
  } | null>(null);
  const [bowdenA, setBowdenA] = useState<{ start: Snap; end: Snap } | null>(null);
  const [torsionA, setTorsionA] = useState<{ pivotId: string; nodeId: string } | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  /** where the last mousedown landed, to tell a click from a drag/pan */
  const mouseDownScreenRef = useRef<Vec2 | null>(null);

  const pivotAtNode = useCallback(
    (nodeId: string) =>
      mech?.elements.find((e) => e.type === 'pivot' && e.nodeId === nodeId)?.id ?? null,
    [mech],
  );

  // shift/cmd-click toggles membership in the selection; plain click replaces
  const clickSelect = useCallback(
    (elementId: string, evt: MouseEvent) => {
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

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(200, r.width);
      const h = Math.max(200, r.height);
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
  const hasMech = mech != null;
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !hasMech) return;
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
  }, [hasMech]);

  // debug seam: publish the live view transform (scale/cx/cy px-per-m) so
  // scripted browser checks can assert pan/zoom without parsing canvas pixels
  useEffect(() => {
    const w = window as unknown as { __riglab?: Record<string, unknown> };
    if (!w.__riglab) w.__riglab = {};
    w.__riglab.getView = () => view;
  }, [view]);

  const pose = useMemo(() => {
    const clip = playback.clipName ? getClip(playback.clipName) : undefined;
    return clip ? samplePose(clip, playback.tS, { amplitude: playback.amplitude }) : REST_POSE;
  }, [playback.clipName, playback.tS, playback.amplitude]);

  const silhouette = useMemo(
    () => (doc && mech ? computeSilhouette(doc.wearer, pose, mech.viewOrientation) : null),
    [doc, mech, pose],
  );

  const docPositions = useMemo(() => {
    const out: Record<string, Vec2> = {};
    for (const n of mech?.nodes ?? []) out[n.id] = n.position;
    return out;
  }, [mech?.nodes]);
  const renderPositions = posePositions ?? docPositions;

  const runSolve = useCallback(
    (dragTargets: Record<string, Vec2>) => {
      if (!doc || !mech) return null;
      const targets = { ...bindingTargets(mech, doc.wearer, pose), ...dragTargets };
      const channelValues = Object.fromEntries(mech.inputs.map((c) => [c.name, c.value]));
      const result = solve(mech, { channelValues, dragTargets: targets }, 'kinematic');
      setDiagnostics(
        { dof: result.diagnostics.dof, classification: result.diagnostics.classification },
        result.diagnostics.converged ? result.diagnostics.violated : result.diagnostics.violated,
      );
      return result;
    },
    [doc, mech, pose, setDiagnostics],
  );

  // diagnostics on edit; pose-driven solve during playback/scrub
  useEffect(() => {
    if (!mech) return;
    const result = runSolve({});
    if (!result) return;
    if (playback.clipName && mech.skeletonBindings.length > 0) {
      setPosePositions(result.positions);
    } else if (!dragNode) {
      setPosePositions(null);
    }
  }, [mech, runSolve, playback.clipName, dragNode, setPosePositions]);

  // Equilibrium force overlays (§5.2), behind the explicit toggle. Recomputed
  // on edit/scrub but not per drag frame (labels refresh on release). The
  // solver's equilibrium mode may be unavailable in this worktree — readEquilibrium
  // degrades to an `unavailable` status instead of throwing.
  useEffect(() => {
    if (!mech || !doc || !equilibriumOn || dragNode) return;
    const channelValues = Object.fromEntries(mech.inputs.map((c) => [c.name, c.value]));
    const targets = bindingTargets(mech, doc.wearer, pose);
    const readout = readEquilibrium(() =>
      solve(mech, { channelValues, dragTargets: targets }, 'equilibrium'),
    );
    setEquilibrium(readout);
  }, [mech, doc, equilibriumOn, dragNode, pose, setEquilibrium]);

  const stagePointer = (e: Konva.KonvaEventObject<MouseEvent>): Vec2 | null => {
    const stage = e.target.getStage();
    const p = stage?.getPointerPosition();
    return p ? { x: p.x, y: p.y } : null;
  };

  const snapAt = useCallback(
    (screen: Vec2, exclude?: ReadonlySet<string>): Snap => {
      const world = toWorld(view, screen);
      if (!mech) return { kind: 'grid', pos: world };
      return findSnap(world, {
        mechanism: mech,
        positions: renderPositions,
        silhouette,
        tolM: SNAP_TOL_PX / view.scale,
        gridM: GRID_M,
        exclude,
      });
    },
    [view, mech, renderPositions, silhouette],
  );

  const commitPipe = useCallback(
    (d: Draft, endSnap: Snap, endConnect: 'pivot' | 'weld' | 'slider' | 'detach') => {
      if (!doc || !mech) return;
      const startSpec = snapToEndSpec(d.start, 'pivot');
      const endSpec = snapToEndSpec(endSnap, endConnect);
      const vertices =
        d.mode === 'freehand'
          ? rdp([d.start.pos, ...d.vertices, endSnap.pos], 0.015)
          : [d.start.pos, ...d.vertices, endSnap.pos];
      if (vertices.length < 2) return;
      updateCurrent((cur) => addPipe(cur, mech.id, vertices, startSpec, endSpec).doc);
    },
    [doc, mech, updateCurrent],
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
    if (!screen || !mech) return;
    mouseDownScreenRef.current = screen;
    const snap = snapAt(screen);

    if (tool === 'select') {
      if (snap.kind === 'node') {
        beginGesture();
        setDragNode(snap.nodeId);
        useEditorStore.getState().clearTrace();
      } else {
        panRef.current = screen;
      }
      return;
    }
    if (tool === 'pipe' || tool === 'freehand') {
      setDraft({ mode: tool, start: snap, vertices: [], cursor: snap.pos });
      return;
    }
    if (tool === 'polyline') {
      if (!draft) setDraft({ mode: 'polyline', start: snap, vertices: [], cursor: snap.pos });
      else setDraft({ ...draft, vertices: [...draft.vertices, snap.pos] });
      return;
    }
    if (tool === 'rope') {
      // click waypoints; double-click (two clicks on one spot) finishes.
      // Points landing on a pipe become eyelets.
      setRopeDraft((d) =>
        d ? { ...d, points: [...d.points, snap] } : { points: [snap], cursor: snap.pos },
      );
      return;
    }
    if (tool === 'elastic' || tool === 'bowden') {
      setDragCord({ tool, start: snap, cursor: snap.pos });
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
          updateCurrent((cur) => addTorsionCable(cur, mech.id, torsionA.pivotId, pivotId).doc);
        }
        setTorsionA(null);
      }
      return;
    }
    if (tool === 'bind') {
      if (snap.kind === 'node') setBindFrom(snap.nodeId);
      else if (snap.kind === 'skeleton' && bindFrom) {
        updateCurrent((cur) => addSkeletonBinding(cur, mech.id, snap.point, bindFrom));
        setBindFrom(null);
      }
      return;
    }
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const screen = stagePointer(e);
    if (!screen || !mech) return;

    if (panRef.current) {
      setView((v) => panBy(v, screen.x - panRef.current!.x, screen.y - panRef.current!.y));
      panRef.current = screen;
      return;
    }

    if (tool === 'select' && dragNode) {
      // solve from the LIVE document, not this render's closure — fast event
      // bursts can outrun React renders, and a stale mechanism here would
      // solve from outdated geometry
      const world = toWorld(view, screen);
      const liveDoc = useAppStore.getState().current;
      const liveMech = liveDoc?.mechanisms.find((m) => m.id === mech.id);
      if (!liveDoc || !liveMech) return;
      const targets = {
        ...bindingTargets(liveMech, liveDoc.wearer, pose),
        [dragNode]: world,
      };
      const channelValues = Object.fromEntries(liveMech.inputs.map((c) => [c.name, c.value]));
      const result = solve(liveMech, { channelValues, dragTargets: targets }, 'kinematic');
      setDiagnostics(
        { dof: result.diagnostics.dof, classification: result.diagnostics.classification },
        result.diagnostics.violated,
      );
      // never write a non-converged pose back into the document — rest
      // lengths are recomputed from it, so residual violation would compound
      if (result.diagnostics.converged) {
        updateCurrent((cur) => moveNodes(cur, mech.id, result.positions));
        if (tracing) {
          const p = result.positions[dragNode];
          if (p) appendTrace(p);
        }
      }
      return;
    }

    const snap = snapAt(screen, dragNode ? new Set([dragNode]) : undefined);
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

    if (tool === 'select' && dragNode) {
      const start = mouseDownScreenRef.current;
      const movedPx = start ? Math.hypot(screen.x - start.x, screen.y - start.y) : Infinity;
      const nodeId = dragNode;
      setDragNode(null);
      endGesture();
      // a stationary click on a node selects the joint element living there —
      // pivots/sliders have no stroke of their own to click on the canvas
      if (movedPx < 4) {
        const joint = mech.elements.find(
          (el) => (el.type === 'pivot' || el.type === 'slider') && el.nodeId === nodeId,
        );
        if (joint) clickSelect(joint.id, e.evt);
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
      const a = snapToEndSpec(dragCord.start, 'pivot');
      const b = snapToEndSpec(endSnap, 'pivot');
      if (tool === 'elastic') {
        updateCurrent((cur) => addElastic(cur, mech.id, a, b).doc);
      } else if (!bowdenA) {
        // first stroke: remember segment A, prompt for segment B
        setBowdenA({ start: dragCord.start, end: endSnap });
      } else {
        const a0 = snapToEndSpec(bowdenA.start, 'pivot');
        const a1 = snapToEndSpec(bowdenA.end, 'pivot');
        updateCurrent((cur) => addBowden(cur, mech.id, a0, a1, a, b).doc);
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
        const specs = dedup.map((s) => snapToEndSpec(s, 'pivot'));
        updateCurrent((cur) => addRope(cur, mech.id, specs).doc);
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
            setNodeKind(cur, mech.id, snap.nodeId, node.kind === 'anchor' ? 'free' : 'anchor'),
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

  // keyboard: delete selection, escape cancels draft/bind
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setDraft(null);
        setBindFrom(null);
        setPendingConnect(null);
        resetForceDrafts();
      }
      if (
        (ev.key === 'Delete' || ev.key === 'Backspace') &&
        selectedElementIds.length > 0 &&
        mech
      ) {
        const target = ev.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        // one updateCurrent = one undo entry for the whole selection
        updateCurrent((cur) =>
          selectedElementIds.reduce((d, id) => deleteElement(d, mech.id, id), cur),
        );
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    selectedElementIds,
    mech,
    updateCurrent,
    clearSelection,
    setPendingConnect,
    resetForceDrafts,
  ]);

  if (!doc || !mech) {
    return (
      <div
        ref={containerRef}
        style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#888' }}
      >
        <p>Create a mechanism to start sketching.</p>
      </div>
    );
  }

  const S = (p: Vec2) => toScreen(view, p);
  const nodePos = (id: string): Vec2 => renderPositions[id] ?? { x: 0, y: 0 };
  const flat = (pts: Vec2[]) => pts.flatMap((p) => [S(p).x, S(p).y]);

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

  const boundNodes = new Set(mech.skeletonBindings.map((b) => b.nodeId));
  const showSilhouettePoints = tool !== 'select' || bindFrom !== null;

  const selectedSet = new Set(selectedElementIds);
  const strokeFor = (id: string): string =>
    violated.includes(id) ? '#d22' : selectedSet.has(id) ? '#d80' : '#324';

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
      data-testid="sketch-canvas"
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
              stroke={g.strong ? '#c8c8d4' : '#ededf2'}
              strokeWidth={1}
            />
          ))}
          {silhouette?.outlines.map((poly, i) => (
            <Line
              // biome-ignore lint/suspicious/noArrayIndexKey: silhouette outlines are a fixed projection, regenerated wholesale, never reordered
              key={`s${i}`}
              points={flat(poly)}
              stroke="#b9c0cc"
              strokeWidth={2}
              lineJoin="round"
            />
          ))}
          {showSilhouettePoints &&
            silhouette &&
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
          {showSilhouettePoints &&
            silhouette &&
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
                  strokeWidth={el.type === 'telescope' ? 5 : 3.5}
                  lineCap="round"
                  onClick={(e) => tool === 'select' && clickSelect(el.id, e.evt)}
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
                  strokeWidth={3.5}
                  lineCap="round"
                  lineJoin="round"
                  onClick={(e) => tool === 'select' && clickSelect(el.id, e.evt)}
                  hitStrokeWidth={12}
                />
              );
            }
            if (el.type === 'rope') {
              return (
                <Line
                  key={el.id}
                  points={flat(el.path.map(nodePos))}
                  stroke={cordStroke(el.id, '#557')}
                  strokeWidth={1.5}
                  dash={[3, 3]}
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
                  points={zigzag(a, b)}
                  stroke={cordStroke(el.id, '#2a8a4a')}
                  strokeWidth={2}
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
              const from = renderPositions[b.nodeId];
              const to = silhouette.points[b.point];
              if (!from || !to) return null;
              return (
                <Line
                  key={b.id}
                  points={flat([from, to])}
                  stroke="#4a4"
                  strokeWidth={1}
                  dash={[3, 4]}
                  listening={false}
                />
              );
            })}

          {tracePath.length > 1 && (
            <Line points={flat(tracePath)} stroke="#e80" strokeWidth={1.5} listening={false} />
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
          {torsionA && renderPositions[torsionA.nodeId] && (
            <Circle
              x={S(renderPositions[torsionA.nodeId]!).x}
              y={S(renderPositions[torsionA.nodeId]!).y}
              radius={10}
              stroke="#c0459a"
              strokeWidth={2}
              listening={false}
            />
          )}

          {/* equilibrium force readouts + rope-compression warnings (§5.2) */}
          {showForces &&
            mech.elements.filter(carriesForceLabel).map((el) => {
              const anchor = forceLabelAnchor(el, (id) => renderPositions[id]);
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
                  fill={compression ? '#c00' : '#036'}
                  shadowColor="#fff"
                  shadowBlur={2}
                  shadowOpacity={1}
                  listening={false}
                />
              );
            })}

          {mech.nodes.map((n) => {
            const p = S(nodePos(n.id));
            if (n.kind === 'anchor') {
              return <Rect key={n.id} x={p.x - 5} y={p.y - 5} width={10} height={10} fill="#222" />;
            }
            const isPivot = (memberCount.get(n.id) ?? 0) >= 2;
            return (
              <Circle
                key={n.id}
                x={p.x}
                y={p.y}
                radius={isPivot ? 6 : 5}
                fill={boundNodes.has(n.id) ? '#2a2' : bindFrom === n.id ? '#d80' : '#28d'}
                stroke={isPivot ? '#fff' : undefined}
                strokeWidth={isPivot ? 2 : 0}
              />
            );
          })}

          {hoverSnap && (
            <Circle
              x={S(hoverSnap.pos).x}
              y={S(hoverSnap.pos).y}
              radius={8}
              stroke={hoverSnap.kind === 'grid' ? '#bbb' : '#e33'}
              strokeWidth={1.5}
              listening={false}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
