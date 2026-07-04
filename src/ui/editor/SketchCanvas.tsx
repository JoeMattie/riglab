import Konva from 'konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, Layer, Line, Rect, Stage } from 'react-konva';
import { addPipe, deleteElement, moveNodes, setNodeKind, addSkeletonBinding } from '../../state/docOps';
import type { EndSpec } from '../../state/docOps';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { solve } from '../../solver';
import type { Mechanism, Vec2 } from '../../schema';
import { REST_POSE, bindingTargets, computeSilhouette, getClip, samplePose } from '../../wearer';
import { GRID_M, findSnap, type Snap } from './snapping';
import { initialView, panBy, toScreen, toWorld, zoomAt, type ViewTransform } from './viewTransform';

const SNAP_TOL_PX = 14;

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
      return { kind: 'existingNode', nodeId: snap.nodeId, connect: connect === 'weld' ? 'weld' : 'pivot' };
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
  const selectedElementId = useEditorStore((s) => s.selectedElementId);
  const select = useEditorStore((s) => s.select);
  const posePositions = useEditorStore((s) => s.posePositions);
  const setPosePositions = useEditorStore((s) => s.setPosePositions);
  const playback = useEditorStore((s) => s.playback);
  const tracing = useEditorStore((s) => s.tracing);
  const tracePath = useEditorStore((s) => s.tracePath);
  const appendTrace = useEditorStore((s) => s.appendTrace);
  const setPendingConnect = useEditorStore((s) => s.setPendingConnect);
  const setDiagnostics = useEditorStore((s) => s.setDiagnostics);
  const violated = useEditorStore((s) => s.violated);

  const mech: Mechanism | null = doc?.mechanisms.find((m) => m.id === activeMechanismId) ?? null;

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState<ViewTransform>(() => initialView(800, 500));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hoverSnap, setHoverSnap] = useState<Snap | null>(null);
  const [dragNode, setDragNode] = useState<string | null>(null);
  const [bindFrom, setBindFrom] = useState<string | null>(null);
  const panRef = useRef<{ x: number; y: number } | null>(null);

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
      const result = solve(mech, { channelValues: {}, dragTargets: targets }, 'kinematic');
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
      const result = solve(liveMech, { channelValues: {}, dragTargets: targets }, 'kinematic');
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
  };

  const onMouseUp = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const screen = stagePointer(e);
    panRef.current = null;
    if (!screen || !mech) return;

    if (tool === 'select' && dragNode) {
      setDragNode(null);
      endGesture();
      return;
    }
    if (draft && (draft.mode === 'pipe' || draft.mode === 'freehand')) {
      const endSnap = snapAt(screen);
      const start = draft.start.pos;
      if (draft.mode === 'pipe' && Math.hypot(endSnap.pos.x - start.x, endSnap.pos.y - start.y) < 0.02) {
        setDraft(null); // too short — treat as a cancelled click
        return;
      }
      finishPipe(draft, endSnap, screen);
    }
  };

  const onDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const screen = stagePointer(e);
    if (!screen || !mech) return;
    if (tool === 'polyline' && draft) {
      const endSnap = snapAt(screen);
      finishPipe(draft, endSnap, screen);
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

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const screen = stagePointer(e as unknown as Konva.KonvaEventObject<MouseEvent>);
    if (!screen) return;
    setView((v) => zoomAt(v, screen, e.evt.deltaY > 0 ? 0.9 : 1.1));
  };

  // keyboard: delete selection, escape cancels draft/bind
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setDraft(null);
        setBindFrom(null);
        setPendingConnect(null);
      }
      if ((ev.key === 'Delete' || ev.key === 'Backspace') && selectedElementId && mech) {
        const target = ev.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        updateCurrent((cur) => deleteElement(cur, mech.id, selectedElementId));
        select(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedElementId, mech, updateCurrent, select, setPendingConnect]);

  if (!doc || !mech) {
    return (
      <div ref={containerRef} style={{ flex: 1, display: 'grid', placeItems: 'center', color: '#888' }}>
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
      gridLines.push({ pts: flat([{ x, y: w0.y }, { x, y: w1.y }]), strong: Math.abs(x) < 1e-9 });
    }
    for (let y = Math.floor(w0.y / step) * step; y <= w1.y; y += step) {
      gridLines.push({ pts: flat([{ x: w0.x, y }, { x: w1.x, y }]), strong: Math.abs(y) < 1e-9 });
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

  const strokeFor = (id: string): string =>
    violated.includes(id) ? '#d22' : selectedElementId === id ? '#d80' : '#324';

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative' }} data-testid="sketch-canvas">
      <Stage
        width={size.w}
        height={size.h}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onDblClick={onDblClick}
        onWheel={onWheel}
      >
        <Layer listening={false}>
          {gridLines.map((g, i) => (
            <Line key={i} points={g.pts} stroke={g.strong ? '#c8c8d4' : '#ededf2'} strokeWidth={1} />
          ))}
          {silhouette?.outlines.map((poly, i) => (
            <Line key={`s${i}`} points={flat(poly)} stroke="#b9c0cc" strokeWidth={2} lineJoin="round" />
          ))}
          {showSilhouettePoints &&
            silhouette &&
            Object.entries(silhouette.points).map(([name, p]) => (
              <Circle key={`sp${name}`} x={S(p).x} y={S(p).y} radius={4} stroke="#7a9" strokeWidth={1.5} />
            ))}
          {showSilhouettePoints &&
            silhouette &&
            Object.entries(silhouette.anchors).map(([name, p]) => (
              <Rect key={`sa${name}`} x={S(p).x - 3} y={S(p).y - 3} width={6} height={6} stroke="#a97" strokeWidth={1.5} />
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
                  onClick={() => tool === 'select' && select(el.id)}
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
                  onClick={() => tool === 'select' && select(el.id)}
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
                <Line key={b.id} points={flat([from, to])} stroke="#4a4" strokeWidth={1} dash={[3, 4]} listening={false} />
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

          {mech.nodes.map((n) => {
            const p = S(nodePos(n.id));
            if (n.kind === 'anchor') {
              return (
                <Rect key={n.id} x={p.x - 5} y={p.y - 5} width={10} height={10} fill="#222" />
              );
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
