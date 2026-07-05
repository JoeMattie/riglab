// Groups (PLANFILE-3d-conversion.md): named selection sets over the compound
// mechanism — the successors of the per-plane "mechanisms". This section
// lives in the info panel's empty-selection view: create a group from the
// current selection, rename inline, click to select the members, delete.
// Migration notes ("re-joint needed: …") surface here and in the checklist.
import { useAppStore } from '../../../state/appStore';
import { clearGroupNote, createGroup, deleteGroup, renameGroup } from '../../../state/docOps';
import { useEditorStore } from '../../../state/editorStore';
import { Button } from '../../components/button';
import { Section } from './fields';

export function GroupsSection() {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const setSelection = useEditorStore((s) => s.setSelection);

  if (!doc) return null;

  const create = () => {
    updateCurrent(
      (cur) => createGroup(cur, `group ${cur.groups.length + 1}`, selectedElementIds).doc,
    );
  };

  return (
    <Section title="Groups">
      <div className="flex flex-col gap-1" data-testid="groups-section">
        {doc.groups.length === 0 && (
          <div className="text-muted-foreground text-xs">
            No groups yet — select elements and create one to name a subsystem.
          </div>
        )}
        {doc.groups.map((g) => (
          <div key={g.id} className="flex flex-col gap-0.5" data-testid="group-row">
            <div className="flex items-center gap-1">
              <input
                data-testid="group-name-input"
                value={g.name}
                onChange={(e) => updateCurrent((cur) => renameGroup(cur, g.id, e.target.value))}
                className="w-0 flex-1 border-b bg-transparent text-sm outline-none"
              />
              <button
                type="button"
                data-testid="group-select"
                title="select this group's elements"
                onClick={() => setSelection(g.elementIds)}
                className="cursor-pointer border-none bg-transparent p-0 text-primary text-xs underline-offset-2 hover:underline"
              >
                select {g.elementIds.length}
              </button>
              <button
                type="button"
                data-testid="group-delete"
                title="delete the group (its elements survive)"
                onClick={() => updateCurrent((cur) => deleteGroup(cur, g.id))}
                className="cursor-pointer border-none bg-transparent p-0 text-muted-foreground text-xs hover:text-destructive"
              >
                ✕
              </button>
            </div>
            {g.note && (
              <div
                className="flex items-start gap-1 text-amber-700 text-xs"
                data-testid="group-note"
              >
                <span className="min-w-0 flex-1">⚠ {g.note}</span>
                <button
                  type="button"
                  data-testid="group-note-dismiss"
                  title="dismiss this note"
                  onClick={() => updateCurrent((cur) => clearGroupNote(cur, g.id))}
                  className="cursor-pointer border-none bg-transparent p-0 text-muted-foreground hover:text-foreground"
                >
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-1 h-6 w-full text-xs"
          data-testid="group-create"
          disabled={selectedElementIds.length === 0}
          onClick={create}
        >
          {selectedElementIds.length > 0
            ? `Group ${selectedElementIds.length} selected element${selectedElementIds.length > 1 ? 's' : ''}`
            : 'Group selection…'}
        </Button>
      </div>
    </Section>
  );
}
