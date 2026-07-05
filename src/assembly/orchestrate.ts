// 3D assembly orchestration (§5.4): solve every instanced mechanism in its own
// plane (clip pose → skeleton-binding drag targets, plus channel inputs), then
// compose the results into world space. This is the kinematic-layering driver
// the 3D Assembly viewport reads each frame; it stays pure (no store, no UI) so
// the Phase-4 acceptance criteria can be asserted against it directly.
import type { Project } from '../schema';
import { solve } from '../solver';
import { bindingTargets } from '../wearer/bindings';
import { computeSkeleton, type JointPose, REST_POSE } from '../wearer/skeleton';
import { type Composition, composeAssembly, type InstanceSolveData } from './compose';

export interface ComposeProjectOptions {
  /** wearer pose (e.g. sampled from a movement clip); defaults to rest */
  pose?: JointPose;
  /** input-channel value overrides by name, applied across all mechanisms */
  channelValues?: Record<string, number>;
  /** foam sheet density (kg/m²) per material id, for foam-plate mass */
  sheetDensityKgPerM2?: Record<string, number>;
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
    solves[inst.id] = { nodes: result.positions };
  }

  return composeAssembly(project.assembly, wearer, solves, {
    sheetDensityKgPerM2: opts.sheetDensityKgPerM2,
  });
}
