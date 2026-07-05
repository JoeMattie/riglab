// 3D Assembly viewport (§8.3): orbit-controlled scene of the wearer mannequin
// plus every mechanism instance lifted into world space, a global CG marker,
// and a live analysis sidebar (mass, CG, seesaw balance about a chosen axis).
// The clip transport (kept mounted by the shell) animates the whole creature
// here. Placement gizmos translate/rotate the selected fixed-drive instance.
import { Line, OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import type { Group, Object3D } from 'three';
import { type BalanceQuery, buildPipeModel, type PipeModelItem } from '../../assembly';
import type { Vec3 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { addInstance, setInstanceTransform, setPointMassKg } from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { EDGE, panelStyle, scenePalette, T } from '../editor/theme';
import { placeAxis } from './axis';
import { PipeModelLayer } from './PipeModelLayer';
import type { CablePrim, TubePrim } from './scene';
import { useAssemblyScene } from './useAssemblyScene';

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
function Tube({ t, color, opacity = 1 }: { t: TubePrim; color: string; opacity?: number }) {
  const placed = useMemo(() => placeAxis(t.a, t.b), [t]);
  if (!placed) return null;
  return (
    <mesh position={placed.mid} quaternion={placed.quat}>
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
}: {
  tubes: TubePrim[];
  /** override for every tube (selection accent, mannequin) */
  color?: string;
  /** per-maturity colors when no override is given */
  styleColors?: TubeStyleColors;
  opacity?: number;
}) {
  return (
    <>
      {tubes.map((t, i) => (
        <Tube
          // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per pose
          key={i}
          t={t}
          color={color ?? (styleColors ?? { engineered: '#e7e9ee', sketch: '#94a0b4' })[t.style]}
          opacity={opacity}
        />
      ))}
    </>
  );
}

function Cables({ cables, color }: { cables: CablePrim[]; color: string }) {
  return (
    <>
      {cables.map((c, i) => (
        <Line
          // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per pose
          key={i}
          points={c.points.map(tuple)}
          color={color}
          lineWidth={2}
        />
      ))}
    </>
  );
}

interface Scene3DProps {
  selectedInstanceId: string | null;
  scene: NonNullable<ReturnType<typeof useAssemblyScene>>;
}

export function Scene3D({ selectedInstanceId, scene }: Scene3DProps) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const docInstances = useAppStore((s) => s.current?.assembly.instances);
  const mechanisms = useAppStore((s) => s.current?.mechanisms);
  const materials = useAppStore((s) => s.current?.materials);
  const assemblyRender = useEditorStore((s) => s.assemblyRender);
  const gizmoRef = useRef<Group>(null);
  // three.js materials take literal colors (no CSS variables), so the scene
  // palette re-renders off the night flag
  const C = scenePalette(useThemeStore((s) => s.night));

  const { mannequin, instances, composition, controlMounts } = scene;

  // Solved pipe-and-fittings model, rebuilt as the pose changes so it stays
  // live during playback; ghosts included translucently.
  const pipeModel = useMemo(() => {
    if (assemblyRender !== 'pipe' || !mechanisms || !materials) return null;
    const items: PipeModelItem[] = [
      ...instances.map((inst) => ({
        mechanismId: inst.mechanismId,
        nodeWorld: composition.instances[inst.id]?.nodeWorld ?? {},
      })),
      ...scene.ghosts.map((g) => ({
        mechanismId: g.mechanismId,
        nodeWorld: g.nodeWorld,
        ghost: true,
      })),
    ];
    return buildPipeModel(mechanisms, items, materials);
  }, [assemblyRender, mechanisms, materials, instances, composition, scene.ghosts]);
  const cg = composition.cg;
  const selected = docInstances?.find((i) => i.id === selectedInstanceId);
  const selectable = selected && selected.transformDrive.kind === 'fixed';

  const commitGizmo = () => {
    const obj = gizmoRef.current;
    if (!obj || !selected) return;
    updateCurrent((doc) =>
      setInstanceTransform(doc, selected.id, {
        position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        quaternion: {
          x: obj.quaternion.x,
          y: obj.quaternion.y,
          z: obj.quaternion.z,
          w: obj.quaternion.w,
        },
      }),
    );
  };

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[2, 4, 3]} intensity={1.1} />
      <directionalLight position={[-3, 2, -2]} intensity={0.35} />
      <gridHelper args={[6, 24, C.grid3dCenter, C.grid3d]} />

      {/* wearer mannequin (capsules, not 1-px lines — §8.3 visibility) */}
      <Tubes tubes={mannequin} color={C.mannequin} />

      {/* mechanism structure: wireframe tubes, or the solved pipe model.
          Cables (ropes/elastics/bowden) are physical in both renders. */}
      {pipeModel ? (
        <PipeModelLayer model={pipeModel} />
      ) : (
        <>
          {instances.map((inst) => {
            const sel = inst.id === selectedInstanceId;
            return (
              <group key={inst.id}>
                <Tubes
                  tubes={inst.prims.tubes}
                  color={sel ? C.accent : undefined}
                  styleColors={{ engineered: C.pvc, sketch: C.sketchTube }}
                />
              </group>
            );
          })}
          {/* unplaced mechanisms ghosted at their default plane (synthesis) */}
          {scene.ghosts.map((g) => (
            <Tubes
              key={g.mechanismId}
              tubes={g.prims.tubes}
              styleColors={{ engineered: C.pvc, sketch: C.sketchTube }}
              opacity={0.3}
            />
          ))}
        </>
      )}
      {instances.map((inst) => (
        <Cables
          key={inst.id}
          cables={inst.prims.cables}
          color={inst.id === selectedInstanceId ? C.accent : C.rope}
        />
      ))}
      {scene.ghosts.map((g) => (
        <Cables key={g.mechanismId} cables={g.prims.cables} color={C.silhouette} />
      ))}

      {/* mounted controls (§4.4) — ride their attach point (e.g. a yoke on handR) */}
      {controlMounts.map((c) => (
        <mesh key={c.id} position={tuple(c.world)}>
          <boxGeometry args={[0.06, 0.06, 0.12]} />
          <meshStandardMaterial color="#0ea5a0" />
        </mesh>
      ))}

      {/* point-mass markers */}
      {composition.masses.map((m) => (
        <mesh key={m.id} position={tuple(m.world)}>
          <sphereGeometry args={[0.03, 12, 12]} />
          <meshStandardMaterial color="#8a5cf6" />
        </mesh>
      ))}

      {/* CG marker + drop line to the ground */}
      {composition.totalMassKg > 0 && (
        <>
          <mesh position={tuple(cg)}>
            <sphereGeometry args={[0.05, 16, 16]} />
            <meshStandardMaterial color={C.accent} />
          </mesh>
          <Line
            points={[tuple(cg), [cg.x, 0, cg.z]]}
            color={C.accent}
            lineWidth={1.5}
            dashed
            dashSize={0.03}
            gapSize={0.02}
          />
        </>
      )}

      {/* placement gizmo for the selected fixed-drive instance */}
      {selectable && selected && (
        <>
          <group
            ref={gizmoRef}
            position={tuple(selected.position)}
            quaternion={[
              selected.quaternion.x,
              selected.quaternion.y,
              selected.quaternion.z,
              selected.quaternion.w,
            ]}
          />
          {gizmoRef.current && (
            <TransformControls
              object={gizmoRef.current as Object3D}
              mode="translate"
              onMouseUp={commitGizmo}
            />
          )}
        </>
      )}

      <OrbitControls makeDefault target={[0, 1, 0]} />
    </>
  );
}

export function AssemblyView() {
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [pivotKey, setPivotKey] = useState('hips');
  const pivot = PIVOTS.find((p) => p.key === pivotKey)!.query;
  const scene = useAssemblyScene(pivot);
  const project = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);

  return (
    <div style={{ position: 'absolute', inset: 0, background: T.viewport }}>
      <Canvas
        camera={{ position: [2.4, 1.6, 2.6], fov: 45 }}
        style={{ position: 'absolute', inset: 0 }}
      >
        {/* transparent canvas: the container's T.viewport background shows
            through, so day/night theming needs no three.js color */}
        {scene && <Scene3D selectedInstanceId={selectedInstanceId} scene={scene} />}
      </Canvas>

      <RenderTogglePill />

      {/* analysis + scene-tree sidebar */}
      <div
        style={{
          ...panelStyle,
          position: 'absolute',
          top: 64,
          right: EDGE,
          bottom: 76,
          width: 300,
          overflowY: 'auto',
          padding: 14,
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <Section title="Assembly">
          <Row
            label="Total mass"
            value={`${(scene?.composition.totalMassKg ?? 0).toFixed(2)} kg`}
          />
          <Row
            label="CG (x, y, z)"
            value={
              scene
                ? `${scene.composition.cg.x.toFixed(2)}, ${scene.composition.cg.y.toFixed(2)}, ${scene.composition.cg.z.toFixed(2)}`
                : '—'
            }
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
          {scene && (
            <>
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
            </>
          )}
        </Section>

        {scene && scene.ghosts.length > 0 && (
          <Section title="Unplaced">
            {scene.ghosts.map((g) => (
              <div
                key={g.mechanismId}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}
              >
                <span style={{ flex: 1, fontSize: 12.5, color: T.muted }}>{g.name}</span>
                <button
                  type="button"
                  onClick={() => updateCurrent((doc) => addInstance(doc, g.mechanismId).doc)}
                  style={{
                    border: 'none',
                    borderRadius: 6,
                    padding: '3px 10px',
                    cursor: 'pointer',
                    background: T.accentTint,
                    color: T.accentText,
                    fontSize: 11.5,
                  }}
                >
                  Place
                </button>
              </div>
            ))}
          </Section>
        )}

        <Section title="Instances">
          {project?.assembly.instances.map((inst) => (
            <div
              key={inst.id}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}
            >
              <button
                type="button"
                onClick={() =>
                  setSelectedInstanceId(inst.id === selectedInstanceId ? null : inst.id)
                }
                style={{
                  flex: 1,
                  textAlign: 'left',
                  border: 'none',
                  background: inst.id === selectedInstanceId ? T.accentTint : 'transparent',
                  color: inst.id === selectedInstanceId ? T.accentText : T.text,
                  borderRadius: 6,
                  padding: '4px 6px',
                  cursor: 'pointer',
                  fontSize: 12.5,
                }}
              >
                {inst.name}
                {inst.transformDrive.kind !== 'fixed' && (
                  <span style={{ color: T.muted, fontSize: 10.5 }}> · driven</span>
                )}
              </button>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                  fontSize: 11,
                  color: T.muted,
                }}
              >
                <input
                  type="checkbox"
                  checked={inst.mirror}
                  onChange={(e) =>
                    updateCurrent((doc) =>
                      setInstanceTransform(doc, inst.id, { mirror: e.target.checked }),
                    )
                  }
                />
                mirror
              </label>
            </div>
          ))}
        </Section>

        <Section title="Point masses">
          {project?.assembly.pointMasses.map((m) => (
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
                  width: 68,
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
      </div>
    </div>
  );
}

/** Wireframe ↔ pipe-model toggle (the "solve pipe model" button): floating
 * pill on the viewport's left edge, mirroring the 2D tool pill's position. */
export function RenderTogglePill({ style }: { style?: React.CSSProperties } = {}) {
  const assemblyRender = useEditorStore((s) => s.assemblyRender);
  const setAssemblyRender = useEditorStore((s) => s.setAssemblyRender);
  const options = [
    { key: 'wire' as const, label: 'Wireframe' },
    { key: 'pipe' as const, label: 'Pipe model' },
  ];
  return (
    <div
      style={{
        ...panelStyle,
        position: 'absolute',
        top: 64,
        left: EDGE,
        zIndex: 30,
        display: 'flex',
        gap: 2,
        padding: 3,
        ...style,
      }}
    >
      {options.map((o) => (
        <button
          type="button"
          key={o.key}
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
