// 3D Assembly viewport (§8.3): orbit-controlled scene of the wearer mannequin
// plus every mechanism instance lifted into world space, a global CG marker,
// and a live analysis sidebar (mass, CG, seesaw balance about a chosen axis).
// The clip transport (kept mounted by the shell) animates the whole creature
// here. Placement gizmos translate/rotate the selected fixed-drive instance.
import { OrbitControls, TransformControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import type { Group, Object3D } from 'three';
import type { BalanceQuery } from '../../assembly';
import type { Vec3 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { setInstanceTransform, setPointMassKg } from '../../state/docOps';
import { EDGE, panelStyle, T } from '../editor/theme';
import type { Segment } from './scene';
import { useAssemblyScene } from './useAssemblyScene';

const tuple = (v: Vec3): [number, number, number] => [v.x, v.y, v.z];

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

function Segments({ data, color, width }: { data: Segment[]; color: string; width: number }) {
  // one BufferGeometry of line segments; cheap enough to rebuild per frame
  const positions = useMemo(() => {
    const arr = new Float32Array(data.length * 6);
    data.forEach(([a, b], i) => {
      arr.set([a.x, a.y, a.z, b.x, b.y, b.z], i * 6);
    });
    return arr;
  }, [data]);
  if (data.length === 0) return null;
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} linewidth={width} />
    </lineSegments>
  );
}

interface Scene3DProps {
  selectedInstanceId: string | null;
  scene: NonNullable<ReturnType<typeof useAssemblyScene>>;
}

function Scene3D({ selectedInstanceId, scene }: Scene3DProps) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const instances = useAppStore((s) => s.current?.assembly.instances);
  const gizmoRef = useRef<Group>(null);

  const { bones, instanceLines, composition } = scene;
  const cg = composition.cg;
  const selected = instances?.find((i) => i.id === selectedInstanceId);
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
      <ambientLight intensity={0.9} />
      <directionalLight position={[2, 4, 3]} intensity={0.6} />
      <gridHelper args={[6, 24, T.border, T.hairline]} />

      {/* wearer mannequin */}
      <Segments data={bones} color="#c8ccd4" width={1} />

      {/* mechanism instances */}
      {instanceLines.map((inst) => (
        <Segments
          key={inst.id}
          data={inst.segments}
          color={inst.id === selectedInstanceId ? T.accent : '#5b6472'}
          width={inst.id === selectedInstanceId ? 3 : 2}
        />
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
            <meshStandardMaterial color={T.accent} />
          </mesh>
          <Segments data={[[cg, { x: cg.x, y: 0, z: cg.z }]]} color={T.accent} width={1} />
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
    <div style={{ position: 'absolute', inset: 0, background: '#f6f7f9' }}>
      <Canvas
        camera={{ position: [2.4, 1.6, 2.6], fov: 45 }}
        style={{ position: 'absolute', inset: 0 }}
      >
        {scene && <Scene3D selectedInstanceId={selectedInstanceId} scene={scene} />}
      </Canvas>

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
                  background: pivotKey === p.key ? T.accentTint : '#f4f4f5',
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
