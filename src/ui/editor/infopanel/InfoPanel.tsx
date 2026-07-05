// The info panel (§8.2a): one selection-reactive inspector column. Since the
// interface overhaul it lives inside the design-face right dock (which owns
// the frame); the sketch face's contextual replacement is the floating
// SelectionCard, which embeds the same ElementInspector/MultiInspector
// bodies, so no capability differs between the two hosts. Empty selection →
// mechanism summary; one element → full inspector; several → shared/bulk.
import { useAppStore } from '../../../state/appStore';
import { useEditorStore } from '../../../state/editorStore';
import { useDiagnosticsShim } from './diagnosticsShim';
import { ElementInspector } from './ElementInspector';
import { MechanismSummary } from './MechanismSummary';
import { MultiInspector } from './MultiInspector';

export function InfoPanel() {
  const doc = useAppStore((s) => s.current);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const face = useEditorStore((s) => s.face);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const diagnostics = useDiagnosticsShim();

  const mech = doc?.mechanisms.find((m) => m.id === activeMechanismId) ?? null;
  if (!doc || !mech) return null;

  // drop stale ids (deleted elements) without writing state during render
  const selected = selectedElementIds
    .map((id) => mech.elements.find((e) => e.id === id))
    .filter((e) => e !== undefined);

  return (
    <div className="flex flex-col text-sm" data-testid="info-panel">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="font-semibold">
          {selected.length === 0 ? 'Mechanism' : selected.length === 1 ? 'Element' : 'Selection'}
        </span>
      </div>
      {selected.length === 0 && (
        <MechanismSummary doc={doc} mech={mech} face={face} diagnostics={diagnostics} />
      )}
      {selected.length === 1 && (
        <ElementInspector
          doc={doc}
          mech={mech}
          el={selected[0]!}
          face={face}
          diagnostics={diagnostics}
        />
      )}
      {selected.length > 1 && <MultiInspector doc={doc} mech={mech} els={selected} face={face} />}
    </div>
  );
}
