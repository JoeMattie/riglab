// The info panel (§8.2a): one selection-reactive right-side inspector serving
// both faces. Collapsible and never a prerequisite for drawing (§8.1 zero
// forms). Empty selection → mechanism summary; one element → full inspector;
// several → shared/bulk properties.
import { useState } from 'react';
import { useAppStore } from '../../../state/appStore';
import { useEditorStore } from '../../../state/editorStore';
import { Button } from '../../components/button';
import { useDiagnosticsShim } from './diagnosticsShim';
import { ElementInspector } from './ElementInspector';
import { MechanismSummary } from './MechanismSummary';
import { MultiInspector } from './MultiInspector';

/** `embedded` drops the standalone width/border/collapse chrome when the
 * panel lives inside the design face's right dock (which owns the frame). */
export function InfoPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const doc = useAppStore((s) => s.current);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const face = useEditorStore((s) => s.face);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const diagnostics = useDiagnosticsShim();
  const [collapsed, setCollapsed] = useState(false);

  const mech = doc?.mechanisms.find((m) => m.id === activeMechanismId) ?? null;
  if (!doc || !mech) return null;

  if (collapsed && !embedded) {
    return (
      <div className="flex shrink-0 flex-col border-l bg-background p-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-1"
          data-testid="info-panel-expand"
          title="show info panel"
          onClick={() => setCollapsed(false)}
        >
          ⓘ
        </Button>
      </div>
    );
  }

  // drop stale ids (deleted elements) without writing state during render
  const selected = selectedElementIds
    .map((id) => mech.elements.find((e) => e.id === id))
    .filter((e) => e !== undefined);

  return (
    <div
      className={
        embedded
          ? 'flex flex-col text-sm'
          : 'flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-background text-sm'
      }
      data-testid="info-panel"
    >
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="font-semibold">
          {selected.length === 0 ? 'Mechanism' : selected.length === 1 ? 'Element' : 'Selection'}
        </span>
        {!embedded && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1 text-muted-foreground"
            data-testid="info-panel-collapse"
            title="collapse info panel"
            onClick={() => setCollapsed(true)}
          >
            ›
          </Button>
        )}
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
