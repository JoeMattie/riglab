// Pure helpers for the equilibrium force overlays (§5.2, §8.3). Kept
// framework-free so they unit-test against mocked SolveResult values without a
// DOM — the live solver's equilibrium mode lands in a parallel branch.
import type { Mechanism, MechanismElement, UnitsPreference, Vec2 } from '../../schema';
import type { SolveResult } from '../../solver';
import type { EquilibriumReadout } from '../../state/editorStore';

/** 1 pound-force in newtons (exact, per the international avoirdupois pound). */
export const N_PER_LBF = 4.4482216152605;

export const toLbf = (newtons: number): number => newtons / N_PER_LBF;

/** Force readout near a cord element. Newtons always; pounds too when the
 * project is in imperial units (§5.2 reports "N and lbf"). */
export function formatForce(newtons: number, units: UnitsPreference): string {
  const n = `${newtons.toFixed(1)} N`;
  return units === 'imperial' ? `${n} (${toLbf(newtons).toFixed(1)} lbf)` : n;
}

/** Element types that carry an inline tension/force label when equilibrium is
 * on: ropes, elastics, bowden cables (§5.2). */
export function carriesForceLabel(el: MechanismElement): boolean {
  return el.type === 'rope' || el.type === 'elastic' || el.type === 'bowden';
}

export function forceLabelElementIds(mech: Mechanism): string[] {
  return mech.elements.filter(carriesForceLabel).map((e) => e.id);
}

/** Anchor point for an element's force label, in mechanism (world) space. */
export function forceLabelAnchor(
  el: MechanismElement,
  pos: (nodeId: string) => Vec2 | undefined,
): Vec2 | null {
  const mid = (a?: Vec2, b?: Vec2): Vec2 | null =>
    a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  if (el.type === 'elastic') return mid(pos(el.nodeA), pos(el.nodeB));
  if (el.type === 'bowden') return mid(pos(el.a1), pos(el.a2));
  if (el.type === 'rope') {
    const pts = el.path.map(pos).filter((p): p is Vec2 => !!p);
    if (pts.length < 2) return null;
    // midpoint of the middle segment reads better than a centroid on a routed path
    const i = Math.max(0, Math.floor((pts.length - 1) / 2));
    return mid(pts[i], pts[i + 1] ?? pts[i]);
  }
  return null;
}

/** Run the equilibrium solve and fold the result into the overlay readout,
 * degrading to `unavailable` if the solver throws (its equilibrium mode is not
 * implemented in every worktree). `run` is injected so this is trivially
 * testable with a mocked SolveResult. */
export function readEquilibrium(run: () => SolveResult): EquilibriumReadout {
  try {
    const r = run();
    return {
      status: r.diagnostics.converged ? 'converged' : 'nonConverged',
      elementForces: r.forces.elements,
      requiredInputs: r.forces.requiredInputs,
      ropesRequiringCompression: r.diagnostics.ropesRequiringCompression,
      positions: r.positions,
    };
  } catch {
    return {
      status: 'unavailable',
      elementForces: {},
      requiredInputs: {},
      ropesRequiringCompression: [],
      positions: null,
    };
  }
}

/** Which pose the canvas renders (§5.2). A live node drag always wins (the
 * equilibrium readout is frozen during the gesture, so it would be stale);
 * otherwise the settled equilibrium pose wins while the forces overlay is on —
 * merged over drawn geometry so nodes added since the last solve still render
 * — and the kinematic playback pose / drawn geometry come last. */
export function pickRenderPositions(opts: {
  docPositions: Record<string, Vec2>;
  posePositions: Record<string, Vec2> | null;
  settledPositions: Record<string, Vec2> | null;
  dragging: boolean;
}): Record<string, Vec2> {
  const { docPositions, posePositions, settledPositions, dragging } = opts;
  if (!dragging && settledPositions) return { ...docPositions, ...settledPositions };
  return posePositions ?? docPositions;
}

export function solverStatusLabel(status: EquilibriumReadout['status']): string {
  switch (status) {
    case 'idle':
      return 'off';
    case 'settling':
      return 'settling…';
    case 'converged':
      return 'converged';
    case 'nonConverged':
      return 'non-converged';
    case 'unavailable':
      return 'solver unavailable';
  }
}
