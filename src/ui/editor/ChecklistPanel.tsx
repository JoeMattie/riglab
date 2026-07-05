// Resolution checklist (§8.2): every unresolved item as a clickable to-do.
// Clicking selects the element, switches the dock to the inspector, and
// drops a one-shot focus hint so exactly the needed control lights up.
// Zero items ⇒ "buildable".
import { mechanismResolution, type ResolutionItem } from '../../design/resolution';
import { useAppStore } from '../../state/appStore';
import { type FocusHint, useEditorStore } from '../../state/editorStore';
import { Badge } from '../components/badge';
import { useDiagnosticsShim } from './infopanel/diagnosticsShim';

function hintFor(item: ResolutionItem): FocusHint | null {
  switch (item.kind) {
    case 'missingMaterial':
    case 'telescopeNestingIncompatible':
      return { control: 'material' };
    case 'missingRealization':
      return { control: 'realization' };
    case 'unboundChannel':
      return item.channelId ? { control: 'channel', channelId: item.channelId } : null;
    default:
      return null;
  }
}

export function ChecklistPanel() {
  const doc = useAppStore((s) => s.current);
  const activeMechanismId = useEditorStore((s) => s.activeMechanismId);
  const select = useEditorStore((s) => s.select);
  const setRightTab = useEditorStore((s) => s.setRightTab);
  const setFocusHint = useEditorStore((s) => s.setFocusHint);
  const diagnostics = useDiagnosticsShim();

  const mech = doc?.mechanisms.find((m) => m.id === activeMechanismId) ?? null;
  if (!doc || !mech) return null;

  const { items, progress } = mechanismResolution(mech, doc.materials, diagnostics);
  const buildable = items.length === 0;

  const fix = (item: ResolutionItem) => {
    if (item.elementId) {
      select(item.elementId);
      setRightTab('inspector');
    }
    setFocusHint(hintFor(item));
  };

  return (
    <div data-testid="checklist-panel" className="flex flex-col text-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span data-testid="checklist-progress">
          {progress.resolved} of {progress.total} resolved
        </span>
        {buildable ? (
          <Badge data-testid="checklist-buildable">buildable</Badge>
        ) : (
          <Badge variant="secondary">{items.length} open</Badge>
        )}
      </div>
      {buildable ? (
        <div className="px-3 py-2 text-muted-foreground">
          Nothing unresolved — every element is buildable as engineered.
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {items.map((item) => {
            const clickable = item.elementId !== undefined || item.kind === 'unboundChannel';
            return (
              <li key={item.id} className="border-b">
                {clickable ? (
                  <button
                    type="button"
                    data-testid="checklist-item"
                    data-kind={item.kind}
                    className="w-full cursor-pointer px-3 py-1.5 text-left hover:bg-accent"
                    onClick={() => fix(item)}
                  >
                    <ItemLabel item={item} />
                  </button>
                ) : (
                  <div data-testid="checklist-item" data-kind={item.kind} className="px-3 py-1.5">
                    <ItemLabel item={item} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ItemLabel({ item }: { item: ResolutionItem }) {
  return (
    <span className={item.severity === 'warning' ? 'text-destructive' : ''}>
      {item.severity === 'warning' ? '⚠ ' : ''}
      {item.label}
    </span>
  );
}
