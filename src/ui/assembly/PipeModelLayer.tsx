// r3f renderer for the pipe-and-fittings model (PLANFILE-quad-workspace
// slice 3): dumb mapping from the pure buildPipeModel primitives to meshes.
import type { PipeCylinder, PipeModel, PipeRole } from '../../assembly';
import { placeAxis } from './axis';

/** PVC-ish palette: white pipe, gray fitting bodies, dark wrap bands. */
const ROLE_COLOR: Record<PipeRole, string> = {
  pipe: '#eceef2',
  fitting: '#c6cad3',
  sleeve: '#c6cad3',
  band: '#3f4652',
  pin: '#7a8290',
};

const GHOST_OPACITY = 0.28;

function Cyl({ c }: { c: PipeCylinder }) {
  const placed = placeAxis(c.a, c.b);
  if (!placed) return null;
  return (
    <mesh position={placed.mid} quaternion={placed.quat}>
      <cylinderGeometry args={[c.radiusM, c.radiusM, placed.len, 16]} />
      <meshStandardMaterial
        color={ROLE_COLOR[c.role]}
        roughness={c.role === 'band' ? 0.8 : 0.45}
        transparent={c.ghost}
        opacity={c.ghost ? GHOST_OPACITY : 1}
      />
    </mesh>
  );
}

export function PipeModelLayer({ model }: { model: PipeModel }) {
  return (
    <>
      {model.prims.map((p, i) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: primitives are positional per pose
        const key = i;
        switch (p.kind) {
          case 'cylinder':
            return <Cyl key={key} c={p} />;
          case 'sphere':
            return (
              <mesh key={key} position={[p.center.x, p.center.y, p.center.z]}>
                <sphereGeometry args={[p.radiusM, 14, 14]} />
                <meshStandardMaterial
                  color={ROLE_COLOR.pipe}
                  roughness={0.45}
                  transparent={p.ghost}
                  opacity={p.ghost ? GHOST_OPACITY : 1}
                />
              </mesh>
            );
          case 'box':
            return (
              <mesh key={key} position={[p.center.x, p.center.y, p.center.z]}>
                <boxGeometry args={[p.halfExtentM * 2, p.halfExtentM * 2, p.halfExtentM * 2]} />
                <meshStandardMaterial
                  color="#8d949f"
                  roughness={0.6}
                  transparent={p.ghost}
                  opacity={p.ghost ? GHOST_OPACITY : 1}
                />
              </mesh>
            );
        }
      })}
    </>
  );
}
