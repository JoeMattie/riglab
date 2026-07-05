import { useMemo } from 'react';
import { type BalanceQuery, balanceReport, composeProject, defaultPlacement } from '../../assembly';
import type { Vec3 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { computeSkeleton, getClip, REST_POSE, samplePose } from '../../wearer';
import {
  type InstancePrimitives,
  instancePrimitives,
  mannequinTubes,
  type TubePrim,
} from './scene';

export interface InstancePrims {
  id: string;
  name: string;
  mechanismId: string;
  driven: boolean;
  prims: InstancePrimitives;
}

export interface GhostPrims {
  mechanismId: string;
  name: string;
  prims: InstancePrimitives;
  /** lifted nodes at the default plane — feeds the pipe model for ghosts */
  nodeWorld: Record<string, Vec3>;
}

/** Solve + compose the whole assembly at the current playback pose and derive
 * everything the 3D viewport draws. Recomputes as the clip scrubs (tS) — the
 * transport's raf loop advances tS in the store, so playback animates the
 * bound instances here without a second loop. */
export function useAssemblyScene(pivot: BalanceQuery) {
  const project = useAppStore((s) => s.current);
  const tS = useEditorStore((s) => s.playback.tS);
  const clipName = useEditorStore((s) => s.playback.clipName);
  const amplitude = useEditorStore((s) => s.playback.amplitude);

  return useMemo(() => {
    if (!project) return null;
    const clip = clipName ? getClip(clipName) : null;
    const pose = clip ? samplePose(clip, tS, { amplitude }) : REST_POSE;
    const frame = computeSkeleton(project.wearer, pose);
    const composition = composeProject(project, { pose });
    const mechById = new Map(project.mechanisms.map((m) => [m.id, m]));

    const instances: InstancePrims[] = project.assembly.instances.map((inst) => {
      const composed = composition.instances[inst.id];
      const mech = mechById.get(inst.mechanismId);
      return {
        id: inst.id,
        name: inst.name,
        mechanismId: inst.mechanismId,
        driven: inst.transformDrive.kind !== 'fixed',
        prims:
          composed && mech
            ? instancePrimitives(mech.elements, composed.nodeWorld, project.materials.pipes)
            : { tubes: [], cables: [] },
      };
    });

    const mannequin: TubePrim[] = mannequinTubes(frame);

    // Ghost synthesis (PLANFILE-quad-workspace): mechanisms with no instance
    // still show, at their view-orientation default plane. Composed through
    // the same pipeline via a synthetic fixed-drive assembly; excluded from
    // mass/CG/seesaw (includePipeMass off, no point masses) — ghosts are a
    // preview, not placed structure.
    const placedMechIds = new Set(project.assembly.instances.map((i) => i.mechanismId));
    const unplaced = project.mechanisms.filter(
      (m) => !placedMechIds.has(m.id) && m.elements.length > 0,
    );
    const ghostComposition =
      unplaced.length > 0
        ? composeProject(
            {
              ...project,
              assembly: {
                instances: unplaced.map((m) => ({
                  id: `ghost:${m.id}`,
                  name: m.name,
                  mechanismId: m.id,
                  ...defaultPlacement(m.viewOrientation),
                  mirror: false,
                  transformDrive: { kind: 'fixed' as const },
                })),
                bindings: [],
                pointMasses: [],
                foamPlates: [],
              },
            },
            { pose, includePipeMass: false },
          )
        : null;
    const ghosts: GhostPrims[] = unplaced.map((m) => {
      const composed = ghostComposition?.instances[`ghost:${m.id}`];
      return {
        mechanismId: m.id,
        name: m.name,
        prims: composed
          ? instancePrimitives(m.elements, composed.nodeWorld, project.materials.pipes)
          : { tubes: [], cables: [] },
        nodeWorld: composed?.nodeWorld ?? {},
      };
    });

    return {
      composition,
      mannequin,
      instances,
      ghosts,
      report: balanceReport(composition.masses, pivot),
    };
  }, [project, tS, clipName, amplitude, pivot]);
}
