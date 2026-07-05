// One global solve loop for the quad workspace (PLANFILE-3d-conversion.md):
// the compound mechanism is solved once per edit/scrub at the shell level —
// diagnostics (DOF pill), the playback pose, and the equilibrium overlay all
// land in the editor store, and every panel just projects the result. Panels
// still run their own transient solves inside a drag gesture (dragNodeId is
// set), during which this loop stands back.
import { useEffect, useMemo } from 'react';
import { projectControlChannels } from '../../controls';
import { elementLinearDensities } from '../../design/densities';
import { solve } from '../../solver';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { anchorTargets, bindingTargets, getClip, REST_POSE, samplePose } from '../../wearer';
import { readEquilibrium } from './forces';

export function useGlobalSolve() {
  const doc = useAppStore((s) => s.current);
  const playback = useEditorStore((s) => s.playback);
  const heldChannels = useEditorStore((s) => s.heldChannels);
  const equilibriumOn = useEditorStore((s) => s.equilibriumOn);
  const dragNodeId = useEditorStore((s) => s.dragNodeId);

  const pose = useMemo(() => {
    const clip = playback.clipName ? getClip(playback.clipName) : undefined;
    return clip ? samplePose(clip, playback.tS, { amplitude: playback.amplitude }) : REST_POSE;
  }, [playback.clipName, playback.tS, playback.amplitude]);

  // live control channel values (§4.4): controls + a playing control clip
  // drive input channels by name, overlaid on the authored input values
  const controlChannels = useMemo(
    () =>
      doc
        ? projectControlChannels({
            controls: doc.controls,
            controlClips: doc.controlClips,
            controlClipName: playback.controlClipName,
            tS: playback.tS,
            speed: playback.speed,
            heldChannels: new Set(heldChannels),
          })
        : {},
    [doc, playback.controlClipName, playback.tS, playback.speed, heldChannels],
  );

  // diagnostics on edit; pose-driven solve during playback/scrub
  useEffect(() => {
    if (!doc) return;
    const mech = doc.mechanism;
    const st = useEditorStore.getState();
    const channelValues = {
      ...Object.fromEntries(mech.inputs.map((c) => [c.name, c.value])),
      ...controlChannels,
    };
    try {
      const result = solve(
        mech,
        {
          channelValues,
          dragTargets: bindingTargets(mech, doc.wearer, pose),
          groundTargets: anchorTargets(mech, doc.wearer, pose),
        },
        'kinematic',
      );
      st.setDiagnostics(
        { dof: result.diagnostics.dof, classification: result.diagnostics.classification },
        result.diagnostics.violated,
      );
      if (
        playback.clipName &&
        (mech.skeletonBindings.length > 0 || mech.anchorBindings.length > 0)
      ) {
        st.setPosePositions(result.positions);
      } else if (!dragNodeId) {
        st.setPosePositions(null);
      }
    } catch {
      // the 3D solver lands in a parallel worktree — a throw here degrades to
      // drawn geometry instead of breaking the shell
    }
  }, [doc, pose, controlChannels, playback.clipName, dragNodeId]);

  // Equilibrium force overlays (§5.2), behind the explicit toggle. Recomputed
  // on edit/scrub but not per drag frame (labels refresh on release). The
  // readout degrades to `unavailable` instead of throwing while the solver's
  // equilibrium mode is mid-rewrite.
  useEffect(() => {
    if (!doc || !equilibriumOn || dragNodeId) return;
    const mech = doc.mechanism;
    const channelValues = {
      ...Object.fromEntries(mech.inputs.map((c) => [c.name, c.value])),
      ...controlChannels,
    };
    const readout = readEquilibrium(() =>
      solve(
        mech,
        {
          channelValues,
          dragTargets: bindingTargets(mech, doc.wearer, pose),
          groundTargets: anchorTargets(mech, doc.wearer, pose),
          // materials integration (§4.2): engineered pipes weigh what their
          // material weighs; sketch pipes use the configurable generic density
          linkDensityKgPerM: doc.materials.genericPipeLinearDensityKgPerM,
          elementLinearDensityKgPerM: elementLinearDensities(mech, doc.materials),
        },
        'equilibrium',
      ),
    );
    useEditorStore.getState().setEquilibrium(readout);
  }, [doc, equilibriumOn, dragNodeId, pose, controlChannels]);

  return pose;
}
