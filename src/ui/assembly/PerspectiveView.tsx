// The quad workspace's perspective panel (PLANFILE-3d-conversion.md):
// orbit-controlled scene of the wearer mannequin plus the solved compound
// mechanism, a global CG marker, and a live analysis sidebar (mass, CG,
// seesaw balance about a chosen axis) reading src/analysis. Supports
// click-to-select on elements and node dragging on the screen-parallel plane
// through the node — no drawing tools here (deferred).
import { Line, OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import { Plane, Vector3 } from 'three';
import type { BalanceQuery } from '../../analysis';
import type { Vec3 } from '../../schema';
import { solve } from '../../solver';
import { useAppStore } from '../../state/appStore';
import { moveNodes, setPointMassKg } from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { anchorTargets, bindingTargets, getClip, REST_POSE, samplePose } from '../../wearer';
import { GripHandle, usePillDrag } from '../editor/pillDrag';
import { panelStyle, scenePalette, T } from '../editor/theme';
import { placeAxis } from './axis';
import { PipeModelLayer } from './PipeModelLayer';
import { buildPipeModel } from './pipeModel';
import type { CablePrim, TubePrim } from './scene';
import { type CompoundScene, useCompoundScene } from './useCompoundScene';

const tuple = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

/** Literal tube colors per style (three.js can't resolve CSS variables). */
type TubeStyleColors = { engineered: string; sketch: string };

/** Pivot-axis presets for the seesaw report (§5.4). The hips carry the seesaw
 * spine; the shoulders are the other natural fulcrum. Axis is wearer-left (+z);
 * front is +x. */
const PIVOTS: { key: string; label: string; query: BalanceQuery }[] = [
  {
    key: 'hips',
    label: 'Hips',
    query: {
      axisPoint: { x: 0, y: 0.95, z: 0 },
      axisDir: { x: 0, y: 0, z: 1 },
      frontDir: { x: 1, y: 0, z: 0 },
      counterweightPoint: { x: -1.6, y: 1, z: 0 },
    },
  },
  {
    key: 'shoulders',
    label: 'Shoulders',
    query: {
      axisPoint: { x: 0, y: 1.43, z: 0 },
      axisDir: { x: 0, y: 0, z: 1 },
      frontDir: { x: 1, y: 0, z: 0 },
      counterweightPoint: { x: -1.6, y: 1.4, z: 0 },
    },
  },
];

/** One capsule per tube primitive; geometry is rebuilt when the pose changes
 * (tube count is small — tens per creature — so per-frame rebuild is fine). */
function Tube({
  t,
  color,
  opacity = 1,
  onClick,
}: {
  t: TubePrim;
  color: string;
  opacity?: number;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const placed = useMemo(() => placeAxis(t.a, t.b), [t]);
  if (!placed) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: r3f <mesh> is a three.js scene node, not a DOM element — the a11y rule does not apply
    <mesh position={placed.mid} quaternion={placed.quat} onClick={onClick}>
      <capsuleGeometry args={[t.radiusM, placed.len, 3, 12]} />
      <meshStandardMaterial
        color={color}
        roughness={0.55}
        transparent={opacity < 1}
        opacity={opacity}
      />
    </mesh>
  );
}

function Tubes({
  tubes,
  color,
  styleColors,
  opacity,
  selectedIds,
  selectedColor,
  onSelect,
}: {
  tubes: TubePrim[];
  /** override for every tube (mannequin) */
  color?: string;
  /** per-maturity colors when no override is given */
  styleColors?: TubeStyleColors;
  opacity?: number;
  selectedIds?: ReadonlySet<string>;
  selectedColor?: string;
  onSelect?: (elementId: string, e: ThreeEvent<MouseEvent>) => void;
}) {
  return (
    <>
      {tubes.map((t, i) => {
        const selected = t.elementId !== undefined && selectedIds?.has(t.elementId);
        return (
          <Tube
            // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per pose
            key={i}
            t={t}
            color={
              selected && selectedColor
                ? selectedColor
                : (color ?? (styleColors ?? { engineered: '#e7e9ee', sketch: '#94a0b4' })[t.style])
            }
            opacity={opacity}
            onClick={
              onSelect && t.elementId !== undefined
                ? (e) => {
                    e.stopPropagation();
                    onSelect(t.elementId!, e);
                  }
                : undefined
            }
          />
        );
      })}
    </>
  );
}

function Cables({
  cables,
  color,
  selectedIds,
  selectedColor,
  onSelect,
}: {
  cables: CablePrim[];
  color: string;
  selectedIds?: ReadonlySet<string>;
  selectedColor?: string;
  onSelect?: (elementId: string, e: ThreeEvent<MouseEvent>) => void;
}) {
  return (
    <>
      {cables.map((c, i) => {
        const selected = c.elementId !== undefined && selectedIds?.has(c.elementId);
        return (
          <Line
            // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per pose
            key={i}
            points={c.points.map(tuple)}
            color={selected && selectedColor ? selectedColor : color}
            lineWidth={2}
            onClick={
              onSelect && c.elementId !== undefined
                ? (e) => {
                    e.stopPropagation();
                    onSelect(c.elementId!, e);
                  }
                : undefined
            }
          />
        );
      })}
    </>
  );
}

/** Node handles: small spheres that select/drag. A drag moves the node in
 * the screen-parallel (camera-facing) plane through the node, feeding the
 * same solve-then-moveNodes loop as the 2D panels. */
function NodeHandles({ scene }: { scene: CompoundScene }) {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const beginGesture = useAppStore((s) => s.beginGesture);
  const endGesture = useAppStore((s) => s.endGesture);
  const setDragNode = useEditorStore((s) => s.setDragNode);
  const playback = useEditorStore((s) => s.playback);
  const C = scenePalette(useThemeStore((s) => s.night));
  const dragRef = useRef<{ nodeId: string; plane: Plane } | null>(null);

  const pose = useMemo(() => {
    const clip = playback.clipName ? getClip(playback.clipName) : undefined;
    return clip ? samplePose(clip, playback.tS, { amplitude: playback.amplitude }) : REST_POSE;
  }, [playback.clipName, playback.tS, playback.amplitude]);

  if (!doc) return null;

  const onDown = (nodeId: string) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const p = scene.positions[nodeId];
    if (!p) return;
    // screen-parallel plane through the node: normal = camera view direction
    const normal = new Vector3();
    e.camera.getWorldDirection(normal);
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3(p.x, p.y, p.z));
    dragRef.current = { nodeId, plane };
    (e.target as { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
    beginGesture();
    setDragNode(nodeId);
    useEditorStore.getState().clearTrace();
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const drag = dragRef.current;
    if (!drag) return;
    e.stopPropagation();
    const hit = new Vector3();
    if (!e.ray.intersectPlane(drag.plane, hit)) return;
    const liveDoc = useAppStore.getState().current;
    const liveMech = liveDoc?.mechanism;
    if (!liveDoc || !liveMech) return;
    const targets = {
      ...bindingTargets(liveMech, liveDoc.wearer, pose),
      [drag.nodeId]: { x: hit.x, y: hit.y, z: hit.z },
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
      useEditorStore
        .getState()
        .setDiagnostics(
          { dof: result.diagnostics.dof, classification: result.diagnostics.classification },
          result.diagnostics.violated,
        );
      if (result.diagnostics.converged) {
        updateCurrent((cur) => moveNodes(cur, result.positions));
      }
    } catch {
      // solver mid-rewrite in a parallel worktree — skip the frame
    }
  };

  const onUp = (e: ThreeEvent<PointerEvent>) => {
    if (!dragRef.current) return;
    e.stopPropagation();
    dragRef.current = null;
    setDragNode(null);
    endGesture();
  };

  return (
    <>
      {doc.mechanism.nodes.map((n) => {
        const p = scene.positions[n.id];
        if (!p) return null;
        return (
          <mesh
            key={n.id}
            position={tuple(p)}
            onPointerDown={onDown(n.id)}
            onPointerMove={onMove}
            onPointerUp={onUp}
          >
            <sphereGeometry args={[0.018, 10, 10]} />
            <meshStandardMaterial color={n.kind === 'anchor' ? C.ink : '#4a7fd6'} roughness={0.4} />
          </mesh>
        );
      })}
    </>
  );
}

export function Scene3D({ scene }: { scene: CompoundScene }) {
  const doc = useAppStore((s) => s.current);
  const assemblyRender = useEditorStore((s) => s.assemblyRender);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const dragNodeId = useEditorStore((s) => s.dragNodeId);
  // three.js materials take literal colors (no CSS variables), so the scene
  // palette re-renders off the night flag
  const C = scenePalette(useThemeStore((s) => s.night));

  // Solved pipe-and-fittings model, rebuilt as the pose changes so it stays
  // live during playback.
  const pipeModel = useMemo(() => {
    if (assemblyRender !== 'pipe' || !doc) return null;
    return buildPipeModel(doc.mechanism, scene.positions, doc.materials);
  }, [assemblyRender, doc, scene.positions]);

  const selectedSet = useMemo(() => new Set(selectedElementIds), [selectedElementIds]);
  const onSelect = (elementId: string, e: ThreeEvent<MouseEvent>) => {
    if (e.nativeEvent.shiftKey || e.nativeEvent.metaKey || e.nativeEvent.ctrlKey)
      toggleSelect(elementId);
    else select(elementId);
  };

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[2, 4, 3]} intensity={1.1} />
      <directionalLight position={[-3, 2, -2]} intensity={0.35} />
      <gridHelper args={[6, 24, C.grid3dCenter, C.grid3d]} />

      {/* wearer mannequin (capsules, not 1-px lines — §8.3 visibility) */}
      <Tubes tubes={scene.mannequin} color={C.mannequin} />
      {/* schematic pack frame: hip rectangle + back rails, same strokes as
          the 2D underlay so anchored geometry reads against its mount */}
      <Tubes tubes={scene.packFrame} color={C.mannequin} />
      {/* sketch-figure joints: head ball, ring joints, fists, feet */}
      {scene.mannequinJoints.map((b, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per pose
        <mesh key={i} position={tuple(b.center)}>
          <sphereGeometry args={[b.radiusM, 16, 16]} />
          <meshStandardMaterial color={C.mannequin} roughness={0.55} />
        </mesh>
      ))}

      {/* mechanism structure: wireframe tubes, or the solved pipe model.
          Cables (ropes/elastics/bowden) are physical in both renders. */}
      {pipeModel ? (
        <PipeModelLayer model={pipeModel} />
      ) : (
        <Tubes
          tubes={scene.prims.tubes}
          styleColors={{ engineered: C.pvc, sketch: C.sketchTube }}
          selectedIds={selectedSet}
          selectedColor={C.accent}
          onSelect={onSelect}
        />
      )}
      <Cables
        cables={scene.prims.cables}
        color={C.rope}
        selectedIds={selectedSet}
        selectedColor={C.accent}
        onSelect={onSelect}
      />

      {/* node handles: click-select joints, drag in the camera-facing plane */}
      <NodeHandles scene={scene} />

      {/* mounted controls (§4.4) — ride their attach point (e.g. a yoke on handR) */}
      {scene.controlMounts.map((c) => (
        <mesh key={c.id} position={tuple(c.world)}>
          <boxGeometry args={[0.06, 0.06, 0.12]} />
          <meshStandardMaterial color="#0ea5a0" />
        </mesh>
      ))}

      {/* point-mass markers */}
      {scene.masses
        .filter((m) => m.source !== 'link')
        .map((m) => (
          <mesh key={m.id} position={tuple(m.world)}>
            <sphereGeometry args={[0.03, 12, 12]} />
            <meshStandardMaterial color="#8a5cf6" />
          </mesh>
        ))}

      {/* CG marker + drop line to the ground */}
      {scene.totalMassKg > 0 && (
        <>
          <mesh position={tuple(scene.cg)}>
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshStandardMaterial color={C.accent} />
          </mesh>
          <Line
            points={[tuple(scene.cg), [scene.cg.x, 0, scene.cg.z]]}
            color={C.accent}
            lineWidth={1.5}
            dashed
            dashSize={0.03}
            gapSize={0.02}
          />
        </>
      )}

      <OrbitControls makeDefault enabled={dragNodeId === null} target={[0, 1, 0]} />
    </>
  );
}

/** The full perspective quadrant: canvas + render toggle + analysis sidebar. */
export function PerspectiveView() {
  const [pivotKey, setPivotKey] = useState('hips');
  const [analysisOpen, setAnalysisOpen] = useState(true);
  const pivot = PIVOTS.find((p) => p.key === pivotKey)!.query;
  const scene = useCompoundScene(pivot);
  const project = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const drag = usePillDrag();

  if (!scene) return null;

  return (
    <div
      style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, background: T.viewport }}
      data-testid="perspective-panel"
    >
      <Canvas
        camera={{ position: [2.4, 1.6, 2.6], fov: 45 }}
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* transparent canvas: the container's T.viewport background shows
            through, so day/night theming needs no three.js color */}
        <Scene3D scene={scene} />
      </Canvas>

      {/* docked below the actions-chip band like the sidebar: at narrow
          viewports the app-level chip reaches into this quadrant's top edge
          and would swallow the toggle's clicks */}
      <RenderTogglePill style={{ top: 44, left: 8 }} />

      {/* analysis sidebar (src/analysis): mass, CG, seesaw balance. Docked
          below the floating actions chip (which overlays this quadrant's
          top-right corner at z 40) so its header is never buried; drag by
          the grip to move it anywhere. */}
      <div
        style={{
          position: 'absolute',
          top: 44,
          right: 8,
          bottom: 8,
          zIndex: 30,
          transform: `translate(${drag.offset.x}px, ${drag.offset.y}px)`,
        }}
      >
        {analysisOpen ? (
          <div
            data-testid="analysis-sidebar"
            style={{
              ...panelStyle,
              width: 232,
              maxHeight: '100%',
              overflowY: 'auto',
              padding: 12,
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <GripHandle testid="analysis-sidebar-handle" drag={drag} vertical />
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: T.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                }}
              >
                Analysis
              </span>
              <button
                type="button"
                data-testid="analysis-toggle"
                onClick={() => setAnalysisOpen(false)}
                style={{
                  marginLeft: 'auto',
                  border: 'none',
                  background: 'none',
                  color: T.faint,
                  cursor: 'pointer',
                  fontSize: 13,
                  padding: 0,
                }}
              >
                ✕
              </button>
            </div>
            <Section title="Totals">
              <Row label="Total mass" value={`${scene.totalMassKg.toFixed(2)} kg`} />
              <Row
                label="CG (x, y, z)"
                value={`${scene.cg.x.toFixed(2)}, ${scene.cg.y.toFixed(2)}, ${scene.cg.z.toFixed(2)}`}
              />
            </Section>

            <Section title="Seesaw balance">
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {PIVOTS.map((p) => (
                  <button
                    type="button"
                    key={p.key}
                    onClick={() => setPivotKey(p.key)}
                    style={{
                      flex: 1,
                      border: 'none',
                      borderRadius: 8,
                      padding: '5px 0',
                      cursor: 'pointer',
                      background: pivotKey === p.key ? T.accentTint : T.chip,
                      color: pivotKey === p.key ? T.accentText : T.muted,
                      fontSize: 12,
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <Row label="Front moment" value={`${scene.report.frontMomentNm.toFixed(1)} N·m`} />
              <Row label="Back moment" value={`${scene.report.backMomentNm.toFixed(1)} N·m`} />
              <Row
                label="Imbalance"
                value={`${scene.report.imbalanceNm.toFixed(1)} N·m ${
                  scene.report.heavySide === 'balanced' ? '' : `(${scene.report.heavySide}-heavy)`
                }`}
              />
              {scene.report.suggestedCounterweightKg != null && (
                <Row
                  label="Add counterweight"
                  value={`${scene.report.suggestedCounterweightKg.toFixed(2)} kg`}
                />
              )}
            </Section>

            {project && project.pointMasses.length > 0 && (
              <Section title="Point masses">
                {project.pointMasses.map((m) => (
                  <div
                    key={m.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}
                  >
                    <span style={{ flex: 1, fontSize: 12.5 }}>{m.name}</span>
                    <input
                      type="number"
                      step="0.05"
                      min="0"
                      value={m.massKg}
                      onChange={(e) =>
                        updateCurrent((doc) => setPointMassKg(doc, m.id, Number(e.target.value)))
                      }
                      style={{
                        width: 62,
                        border: `1px solid ${T.border}`,
                        borderRadius: 6,
                        padding: '3px 6px',
                        fontSize: 12,
                      }}
                    />
                    <span style={{ fontSize: 11, color: T.muted }}>kg</span>
                  </div>
                ))}
              </Section>
            )}
          </div>
        ) : (
          <button
            type="button"
            data-testid="analysis-toggle"
            onClick={() => setAnalysisOpen(true)}
            style={{
              ...panelStyle,
              padding: '6px 10px',
              font: `500 12px ${T.sans}`,
              color: T.text,
              cursor: 'pointer',
            }}
          >
            Analysis
          </button>
        )}
      </div>
    </div>
  );
}

/** Wireframe ↔ pipe-model toggle (the "solve pipe model" button). */
export function RenderTogglePill({ style }: { style?: React.CSSProperties } = {}) {
  const assemblyRender = useEditorStore((s) => s.assemblyRender);
  const setAssemblyRender = useEditorStore((s) => s.setAssemblyRender);
  const drag = usePillDrag();
  const options = [
    { key: 'wire' as const, label: 'Wireframe' },
    { key: 'pipe' as const, label: 'Pipe model' },
  ];
  return (
    <div
      style={{
        ...panelStyle,
        position: 'absolute',
        zIndex: 30,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        padding: 3,
        ...style,
        transform: `translate(${drag.offset.x}px, ${drag.offset.y}px)`,
      }}
    >
      <GripHandle testid="render-toggle-handle" drag={drag} vertical />
      {options.map((o) => (
        <button
          type="button"
          key={o.key}
          data-testid={`render-${o.key}`}
          onClick={() => setAssemblyRender(o.key)}
          style={{
            border: 'none',
            borderRadius: 9,
            padding: '5px 12px',
            cursor: 'pointer',
            fontSize: 12,
            background: assemblyRender === o.key ? T.accentTint : 'transparent',
            color: assemblyRender === o.key ? T.accentText : T.muted,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: T.muted,
          textTransform: 'uppercase',
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '2px 0' }}
    >
      <span style={{ color: T.muted }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
