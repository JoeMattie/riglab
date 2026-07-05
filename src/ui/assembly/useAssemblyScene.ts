import { useMemo } from 'react';
import { type BalanceQuery, balanceReport, composeProject } from '../../assembly';
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

    return {
      composition,
      mannequin,
      instances,
      report: balanceReport(composition.masses, pivot),
    };
  }, [project, tS, clipName, amplitude, pivot]);
}
