// Shared by the info panel and the resolution checklist: a diagnostics view
// assembled from readouts the UI already has (DOF badge + equilibrium
// overlay) — solver-shaped, but no extra solve.
import type { SolveDiagnostics } from '../../../solver';
import { useEditorStore } from '../../../state/editorStore';

export function useDiagnosticsShim(): SolveDiagnostics | undefined {
  const dof = useEditorStore((s) => s.dof);
  const violated = useEditorStore((s) => s.violated);
  const equilibrium = useEditorStore((s) => s.equilibrium);
  if (!dof) return undefined;
  return {
    dof: dof.dof,
    classification: dof.classification as SolveDiagnostics['classification'],
    converged: true,
    residual: 0,
    violated,
    ropesRequiringCompression: equilibrium.ropesRequiringCompression,
  };
}
