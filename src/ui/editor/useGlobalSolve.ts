// One global solve loop for the quad workspace (PLANFILE-3d-conversion.md):
// the compound mechanism is solved once per edit/scrub at the shell level —
// diagnostics (DOF pill), the playback pose, and the equilibrium overlay all
// land in the editor store, and every panel just projects the result. Panels
// still run their own transient solves inside a drag gesture (dragNodeId is
// set), during which this loop stands back.
import { useEffect, useMemo, useRef } from 'react';
import { projectControlChannels } from '../../controls';
import { elementLinearDensities } from '../../design/densities';
import type { Project, Vec3 } from '../../schema';
import { solve } from '../../solver';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { anchorTargets, bindingTargets, getClip, REST_POSE, samplePose } from '../../wearer';
import { readEquilibrium } from './forces';

// Relaxation budgets for the equilibrium readout (PLANFILE-forces-playback-
// perf). During playback each frame advances the settle a few substeps from
// the previous frame's pose (seed) — a damped transient that tracks the
// animation at interactive cost (~5 ms on the full creature) and is presented
// as 'settling'. Pause/edit gets a generous budget: three pose-quiescence
// windows (~330 ms worst case on the full creature), after which a mechanism
// that still hasn't settled is honestly 'non-converged' — measured pre-change
// behavior was the same verdict after a 1.7 s uncapped solve per frame.
const PLAYBACK_EQ_SUBSTEP_BUDGET = 10;
const PAUSED_EQ_SUBSTEP_BUDGET = 1200;

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

  // element densities only change with the document, not per frame
  const densities = useMemo(
    () => (doc ? elementLinearDensities(doc.mechanism, doc.materials) : {}),
    [doc],
  );

  // last settled equilibrium positions, used to warm-start the next solve;
  // valid only for the same document (an edit invalidates it)
  const eqSeedRef = useRef<{ doc: Project; positions: Record<string, Vec3> } | null>(null);

  // Equilibrium force overlays (§5.2), behind the explicit toggle. Recomputed
  // per playback/scrub frame and on edit — never per drag frame (labels
  // refresh on release). Playback frames are warm-started from the previous
  // frame's settled pose and substep-budgeted so the readout tracks the
  // animation without blowing the frame budget (PLANFILE-forces-playback-perf);
  // pausing reruns with the larger paused budget for the settled readout.
  // Degrades to `unavailable` instead of throwing.
  useEffect(() => {
    if (!doc || !equilibriumOn || dragNodeId) return;
    const mech = doc.mechanism;
    const channelValues = {
      ...Object.fromEntries(mech.inputs.map((c) => [c.name, c.value])),
      ...controlChannels,
    };
    const playing = playback.playing;
    const seed = eqSeedRef.current?.doc === doc ? eqSeedRef.current.positions : undefined;
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
          elementLinearDensityKgPerM: densities,
          seedPositions: seed,
          maxSubsteps: playing ? PLAYBACK_EQ_SUBSTEP_BUDGET : PAUSED_EQ_SUBSTEP_BUDGET,
        },
        'equilibrium',
      ),
    );
    if (readout.positions) eqSeedRef.current = { doc, positions: readout.positions };
    // a budget-truncated playback frame is mid-relaxation, not a failed solve
    useEditorStore
      .getState()
      .setEquilibrium(
        playing && readout.status === 'nonConverged' ? { ...readout, status: 'settling' } : readout,
      );
  }, [doc, equilibriumOn, dragNodeId, pose, controlChannels, playback.playing, densities]);

  return pose;
}
