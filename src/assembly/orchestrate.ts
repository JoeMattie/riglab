// 3D assembly orchestration (§5.4): solve every instanced mechanism in its own
// plane (clip pose → skeleton-binding drag targets, plus channel inputs), then
// compose the results into world space. This is the kinematic-layering driver
// the 3D Assembly viewport reads each frame; it stays pure (no store, no UI) so
// the Phase-4 acceptance criteria can be asserted against it directly.
import { elementLinearDensities } from '../design/densities';
import type { Mechanism, Project, Vec2 } from '../schema';
import { solve } from '../solver';
import { bindingTargets } from '../wearer/bindings';
import { computeSkeleton, type JointPose, REST_POSE } from '../wearer/skeleton';
import {
  type Composition,
  composeAssembly,
  type InstanceSolveData,
  type LocalMass,
} from './compose';

export interface ComposeProjectOptions {
  /** wearer pose (e.g. sampled from a movement clip); defaults to rest */
  pose?: JointPose;
  /** input-channel value overrides by name, applied across all mechanisms */
  channelValues?: Record<string, number>;
  /** foam sheet density (kg/m²) per material id, for foam-plate mass */
  sheetDensityKgPerM2?: Record<string, number>;
  /** include engineered-pipe self-weight (developed length × material linear
   * density) in the mass/CG rollup; defaults on so the 3D CG reflects the PVC.
   * Set false to weigh only explicit point/foam masses (§5.4). */
  includePipeMass?: boolean;
}

/** Per-instance distributed pipe masses in local 2D space: each drawn segment
 * contributes density×length at its midpoint, so the composed CG accounts for
 * the pipe, not only bolt-on masses. Uses the same linear densities the
 * equilibrium solver and BOM use (§4.2). */
function pipeLocalMasses(
  mech: Mechanism,
  positions: Record<string, Vec2>,
  densities: Record<string, number>,
): LocalMass[] {
  const out: LocalMass[] = [];
  const seg = (a: Vec2, b: Vec2, kgPerM: number, name?: string) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 0)
      out.push({ pos: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, massKg: kgPerM * len, name });
  };
  for (const el of mech.elements) {
    const d = densities[el.id];
    if (d == null) continue;
    if (el.type === 'link' || el.type === 'telescope') {
      const a = positions[el.nodeA];
      const b = positions[el.nodeB];
      if (a && b) seg(a, b, d, el.subsystemTag);
    } else if (el.type === 'bentLink') {
      for (let i = 1; i < el.nodeIds.length; i++) {
        const a = positions[el.nodeIds[i - 1]!];
        const b = positions[el.nodeIds[i]!];
        if (a && b) seg(a, b, d, el.subsystemTag);
      }
    }
  }
  return out;
}

/** Solve + compose a whole project's assembly at one pose. Each instance's
 * mechanism is solved in kinematic mode with its skeleton bindings driven by
 * the pose, so a movement clip animates every bound instance in 3D. */
export function composeProject(project: Project, opts: ComposeProjectOptions = {}): Composition {
  const pose = opts.pose ?? REST_POSE;
  const wearer = computeSkeleton(project.wearer, pose);
  const mechById = new Map(project.mechanisms.map((m) => [m.id, m]));
  const solves: Record<string, InstanceSolveData> = {};

  for (const inst of project.assembly.instances) {
    const mech = mechById.get(inst.mechanismId);
    if (!mech) continue;
    const dragTargets = bindingTargets(mech, project.wearer, pose);
    const channelValues: Record<string, number> = {
      ...Object.fromEntries(mech.inputs.map((c) => [c.name, c.value])),
      ...opts.channelValues,
    };
    const result = solve(mech, { channelValues, dragTargets }, 'kinematic');
    const localMasses =
      opts.includePipeMass === false
        ? undefined
        : pipeLocalMasses(mech, result.positions, elementLinearDensities(mech, project.materials));
    solves[inst.id] = { nodes: result.positions, localMasses };
  }

  return composeAssembly(project.assembly, wearer, solves, {
    sheetDensityKgPerM2: opts.sheetDensityKgPerM2,
  });
}
