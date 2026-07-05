// Quad workspace (PLANFILE-quad-workspace slice 4): Rhino-style 2×2 grid —
// Top / Perspective / Front / Side. Ortho panels show the whole composed
// assembly projected into their plane; the panel matching the active
// mechanism's view orientation hosts the full SketchCanvas editor in place
// (click a ghost to activate its mechanism), the others are read-only
// projections with their own pan/zoom. Double-click a panel header to
// maximize/restore.
import { Canvas } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { Group, Layer, Line, Stage } from 'react-konva';
import { type BalanceQuery, defaultPlacement } from '../../assembly';
import type { Quaternion, Vec2, Vec3 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { type QuadPanelId, useEditorStore } from '../../state/editorStore';
import { RenderTogglePill, Scene3D } from '../assembly/AssemblyView';
import type { InstancePrimitives } from '../assembly/scene';
import { useAssemblyScene } from '../assembly/useAssemblyScene';
import { type PanelOverlayItem, SketchCanvas } from '../editor/SketchCanvas';
import { T } from '../editor/theme';
import { initialView, panBy, toScreen, type ViewTransform, zoomAt } from '../editor/viewTransform';
import {
  type OrthoPanelId,
  PANEL_FRAME,
  panelForOrientation,
  projectToLocal,
  projectToPanel,
} from './panelProject';

type SceneData = NonNullable<ReturnType<typeof useAssemblyScene>>;

/** The seesaw report is unused here; any valid pivot satisfies the hook. */
const QUAD_PIVOT: BalanceQuery = {
  axisPoint: { x: 0, y: 0.95, z: 0 },
  axisDir: { x: 0, y: 0, z: 1 },
  frontDir: { x: 1, y: 0, z: 0 },
};

/** World segments (tubes + cable runs) of one composed mechanism entry. */
function segments3(prims: InstancePrimitives): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = prims.tubes.map((t) => [t.a, t.b] as [Vec3, Vec3]);
  for (const c of prims.cables) {
    for (let i = 1; i < c.points.length; i++) out.push([c.points[i - 1]!, c.points[i]!]);
  }
  return out;
}

interface PickableGhost {
  mechanismId: string;
  unplaced: boolean;
  segments: [Vec3, Vec3][];
}

function panelGhosts(scene: SceneData): PickableGhost[] {
  return [
    ...scene.instances.map((e) => ({
      mechanismId: e.mechanismId,
      unplaced: false,
      segments: segments3(e.prims),
    })),
    ...scene.ghosts.map((g) => ({
      mechanismId: g.mechanismId,
      unplaced: true,
      segments: segments3(g.prims),
    })),
  ];
}

/** Read-only orthographic projection panel with its own pan/zoom; clicking a
 * mechanism makes it active (it then edits in its own hosting panel). */
function GhostPanelCanvas({
  panelId,
  scene,
  onPick,
}: {
  panelId: OrthoPanelId;
  scene: SceneData;
  onPick(mechanismId: string): void;
}) {
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewTransform | null>(null);
  const pan = useRef<{ x: number; y: number; moved: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(120, r.width);
      const h = Math.max(120, r.height);
      setView((v) => {
        if (v) return { ...v, w, h };
        const init = initialView(w, h);
        // the top panel looks down at the x-z plane: center near the wearer
        return panelId === 'top' ? { ...init, cy: 0 } : init;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [panelId]);

  const frame = PANEL_FRAME[panelId];
  const ghosts = panelGhosts(scene);

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', position: 'relative' }}
      data-testid={`quad-ghost-${panelId}`}
    >
      {view && (
        <Stage
          width={view.w}
          height={view.h}
          onMouseDown={(e) => {
            const p = e.target.getStage()?.getPointerPosition();
            if (p) pan.current = { x: p.x, y: p.y, moved: 0 };
          }}
          onMouseMove={(e) => {
            const p = e.target.getStage()?.getPointerPosition();
            if (!p || !pan.current) return;
            const dx = p.x - pan.current.x;
            const dy = p.y - pan.current.y;
            pan.current = { x: p.x, y: p.y, moved: pan.current.moved + Math.hypot(dx, dy) };
            setView((v) => (v ? panBy(v, dx, dy) : v));
          }}
          onMouseUp={() => {
            // keep `moved` around briefly so click handlers can veto a pick
            const moved = pan.current?.moved ?? 0;
            pan.current = null;
            if (moved > 4) suppressPick.current = true;
            setTimeout(() => {
              suppressPick.current = false;
            }, 0);
          }}
          onWheel={(e) => {
            e.evt.preventDefault();
            const stage = e.target.getStage();
            const p = stage?.getPointerPosition();
            if (!p) return;
            const factor = Math.exp(-e.evt.deltaY * 0.0015);
            setView((v) => (v ? zoomAt(v, p, factor) : v));
          }}
        >
          <Layer listening={false}>
            {scene.mannequin.map((t, i) => {
              const a = toScreen(view, projectToPanel(t.a, frame));
              const b = toScreen(view, projectToPanel(t.b, frame));
              return (
                <Line
                  // biome-ignore lint/suspicious/noArrayIndexKey: bones are positional per pose
                  key={i}
                  points={[a.x, a.y, b.x, b.y]}
                  stroke="#c6ccd6"
                  strokeWidth={3}
                  lineCap="round"
                />
              );
            })}
          </Layer>
          <Layer>
            {ghosts.map((g, gi) => {
              const active = g.mechanismId === activeMechanismId;
              return (
                <Group
                  // biome-ignore lint/suspicious/noArrayIndexKey: a mechanism can appear twice (mirrored instances)
                  key={`${g.mechanismId}:${gi}`}
                  onClick={() => {
                    if (!suppressPick.current) onPick(g.mechanismId);
                  }}
                  onTap={() => onPick(g.mechanismId)}
                  onMouseEnter={(e) => {
                    const stage = e.target.getStage();
                    if (stage) stage.container().style.cursor = 'pointer';
                  }}
                  onMouseLeave={(e) => {
                    const stage = e.target.getStage();
                    if (stage) stage.container().style.cursor = '';
                  }}
                >
                  {g.segments.map((seg, i) => {
                    const a = toScreen(view, projectToPanel(seg[0], frame));
                    const b = toScreen(view, projectToPanel(seg[1], frame));
                    return (
                      <Line
                        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional per pose
                        key={i}
                        points={[a.x, a.y, b.x, b.y]}
                        stroke={active ? T.selected : g.unplaced ? '#aab2bf' : '#5b6472'}
                        strokeWidth={active ? 3.5 : 3}
                        opacity={g.unplaced ? 0.6 : 1}
                        lineCap="round"
                        hitStrokeWidth={12}
                      />
                    );
                  })}
                </Group>
              );
            })}
          </Layer>
        </Stage>
      )}
    </div>
  );
}

/** Module-level so Stage-level pan handling can veto Group click picks. */
const suppressPick = { current: false };

function OrthoPanel({ panelId, scene }: { panelId: OrthoPanelId; scene: SceneData }) {
  const doc = useAppStore((s) => s.current);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const setActiveMechanism = useEditorStore((s) => s.setActiveMechanism);

  const activeMech = doc?.mechanisms.find((m) => m.id === activeMechanismId) ?? null;
  const hostsActive = !!activeMech && panelForOrientation(activeMech.viewOrientation) === panelId;

  if (!doc || !activeMech || !hostsActive) {
    return <GhostPanelCanvas panelId={panelId} scene={scene} onPick={setActiveMechanism} />;
  }

  // Active mechanism placement: first placed instance, else the default plane.
  const inst = doc.assembly.instances.find((i) => i.mechanismId === activeMech.id);
  const composed = inst ? scene.composition.instances[inst.id] : undefined;
  const base: { origin: Vec3; rot: Quaternion; mirror: boolean } = composed
    ? { origin: composed.origin, rot: composed.rot, mirror: composed.mirror }
    : (() => {
        const p = defaultPlacement(activeMech.viewOrientation);
        return { origin: p.position, rot: p.quaternion, mirror: false };
      })();
  const proj = (w: Vec3): Vec2 => projectToLocal(w, base.origin, base.rot, base.mirror);

  const items: PanelOverlayItem[] = panelGhosts(scene)
    .filter((g) => g.mechanismId !== activeMech.id)
    .map((g) => ({
      mechanismId: g.mechanismId,
      name: doc.mechanisms.find((m) => m.id === g.mechanismId)?.name ?? g.mechanismId,
      segments: g.segments.map(([a, b]) => [proj(a), proj(b)] as [Vec2, Vec2]),
    }));

  return <SketchCanvas overlay={{ items, onPick: setActiveMechanism }} />;
}

function PerspectivePanel({ scene }: { scene: SceneData }) {
  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
      <Canvas
        camera={{ position: [2.4, 1.6, 2.6], fov: 45 }}
        style={{ position: 'absolute', inset: 0 }}
      >
        <color attach="background" args={['#eef0f4']} />
        <Scene3D selectedInstanceId={null} scene={scene} />
      </Canvas>
      <RenderTogglePill style={{ top: 8, left: 8 }} />
    </div>
  );
}

export function QuadView() {
  const scene = useAssemblyScene(QUAD_PIVOT);
  const quadMaximized = useEditorStore((s) => s.quadMaximized);
  const setQuadMaximized = useEditorStore((s) => s.setQuadMaximized);

  if (!scene) return null;

  const panels: { id: QuadPanelId; title: string; body: React.ReactNode }[] = [
    { id: 'top', title: 'Top', body: <OrthoPanel panelId="top" scene={scene} /> },
    { id: 'persp', title: 'Perspective', body: <PerspectivePanel scene={scene} /> },
    { id: 'front', title: 'Front', body: <OrthoPanel panelId="front" scene={scene} /> },
    { id: 'side', title: 'Side', body: <OrthoPanel panelId="side" scene={scene} /> },
  ];
  const visible = quadMaximized ? panels.filter((p) => p.id === quadMaximized) : panels;

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'grid',
        gap: 2,
        background: T.border,
        gridTemplateColumns: quadMaximized ? '1fr' : '1fr 1fr',
        gridTemplateRows: quadMaximized ? '1fr' : '1fr 1fr',
      }}
    >
      {visible.map((p) => (
        <div
          key={p.id}
          data-testid={`quad-panel-${p.id}`}
          style={{
            position: 'relative',
            overflow: 'hidden',
            background: '#fcfcfd',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <button
            type="button"
            onDoubleClick={() => setQuadMaximized(quadMaximized === p.id ? null : p.id)}
            title="double-click to maximize / restore"
            style={{
              padding: '3px 10px',
              font: `500 10.5px ${T.sans}`,
              letterSpacing: '.07em',
              textTransform: 'uppercase',
              color: T.muted,
              border: 'none',
              borderBottom: `1px solid ${T.hairline}`,
              background: 'none',
              textAlign: 'left',
              userSelect: 'none',
              cursor: 'default',
              flex: 'none',
            }}
          >
            {p.title}
          </button>
          <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}>
            {p.body}
          </div>
        </div>
      ))}
    </div>
  );
}
