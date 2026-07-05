// The perspective panel's scene hook (PLANFILE-3d-conversion.md): derive
// everything the 3D viewport draws from the compound mechanism's solved pose
// — mannequin, tubes/cables, mass inventory, CG, and the seesaw balance
// report. The global solve loop (useGlobalSolve) already left the pose in
// the editor store; this hook only projects and rolls up.
import { useMemo } from 'react';
import { type BalanceQuery, balanceReport, massInventory } from '../../analysis';
import type { Vec3, WearerAnchor } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { computeSkeleton, getClip, REST_POSE, samplePose } from '../../wearer';
import { pickRenderPositions } from '../editor/forces';
import { mannequinTubes, mechanismPrimitives } from './scene';

export function useCompoundScene(pivot: BalanceQuery) {
  const project = useAppStore((s) => s.current);
  const tS = useEditorStore((s) => s.playback.tS);
  const clipName = useEditorStore((s) => s.playback.clipName);
  const amplitude = useEditorStore((s) => s.playback.amplitude);
  const posePositions = useEditorStore((s) => s.posePositions);
  const equilibriumOn = useEditorStore((s) => s.equilibriumOn);
  const settled = useEditorStore((s) => s.equilibrium.positions);
  const dragNodeId = useEditorStore((s) => s.dragNodeId);

  return useMemo(() => {
    if (!project) return null;
    const clip = clipName ? getClip(clipName) : null;
    const pose = clip ? samplePose(clip, tS, { amplitude }) : REST_POSE;
    const frame = computeSkeleton(project.wearer, pose);

    const mech = project.mechanism;
    const docPositions: Record<string, Vec3> = {};
    for (const n of mech.nodes) docPositions[n.id] = n.position;
    const positions = pickRenderPositions({
      docPositions,
      posePositions,
      settledPositions: equilibriumOn ? settled : null,
      dragging: dragNodeId !== null,
    });

    const prims = mechanismPrimitives(mech.elements, positions, project.materials.pipes);
    const mannequin = mannequinTubes(frame);

    // mounted controls (§4.4) ride their attach point — a yoke on handR
    // follows the hand through the walk clip
    const controlMounts: { id: string; name: string; world: Vec3 }[] = [];
    for (const control of project.controls) {
      if (!control.mount) continue;
      const world =
        control.mount.kind === 'node'
          ? positions[control.mount.nodeId]
          : frame.anchors[control.mount.anchor];
      if (world) controlMounts.push({ id: control.id, name: control.name, world });
    }

    // mass/CG/seesaw rollup over the global solve output (src/analysis)
    const anchors: Partial<Record<WearerAnchor, Vec3>> = frame.anchors;
    const inventory = massInventory(project, positions, anchors);

    return {
      positions,
      frame,
      mannequin,
      prims,
      controlMounts,
      masses: inventory.masses,
      totalMassKg: inventory.totalMassKg,
      cg: inventory.cg,
      report: balanceReport(inventory.masses, pivot),
    };
  }, [project, tS, clipName, amplitude, posePositions, equilibriumOn, settled, dragNodeId, pivot]);
}

export type CompoundScene = NonNullable<ReturnType<typeof useCompoundScene>>;
