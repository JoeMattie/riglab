// Auto-resolve launcher + preview (PLANFILE-marquee-autoresolve.md): a design-
// face action that proposes materials and realizations minimizing purchased
// parts, shown as a reviewable change list. Nothing touches the document until
// Apply, which commits every surviving row in one undo step. The proposal
// remembers the document object it was computed from; any edit makes it stale
// and the preview withdraws instead of applying against moved ground.
import { useState } from 'react';
import { autoResolve, type ProposedChange } from '../../design/autoResolve';
import { elementTypeLabel } from '../../design/resolution';
import type { JointRealization, Mechanism, Project } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { applyAutoResolve } from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { Button } from '../components/button';
import { Checkbox } from '../components/checkbox';
import { REALIZATION_LABELS } from './infopanel/fields';

const SLOT_LABELS: Record<ProposedChange['slot'], string> = {
  pipeMaterial: 'pipe',
  outerPipeMaterial: 'outer pipe',
  innerPipeMaterial: 'inner pipe',
  realization: 'realization',
  endRealizationA: 'end A',
  endRealizationB: 'end B',
};

const isMaterialSlot = (slot: ProposedChange['slot']) =>
  slot === 'pipeMaterial' || slot === 'outerPipeMaterial' || slot === 'innerPipeMaterial';

export function AutoResolvePanel({ doc, mech }: { doc: Project; mech: Mechanism }) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const proposal = useEditorStore((s) => s.autoProposal);
  const setAutoProposal = useEditorStore((s) => s.setAutoProposal);
  const select = useEditorStore((s) => s.select);

  const fresh = proposal !== null && proposal.docRef === doc && proposal.mechId === mech.id;

  const valueLabel = (c: ProposedChange, id: string | undefined): string => {
    if (id === undefined) return '—';
    return isMaterialSlot(c.slot)
      ? (doc.materials.pipes.find((p) => p.id === id)?.name ?? id)
      : REALIZATION_LABELS[id as JointRealization];
  };

  if (!fresh) {
    return (
      <AutoResolveLauncher
        label="Auto-resolve"
        run={(resolveAssigned) =>
          setAutoProposal({
            docRef: doc,
            mechId: mech.id,
            changes: autoResolve(doc, mech.id, { resolveAssigned }).changes,
          })
        }
      />
    );
  }

  const apply = () => {
    updateCurrent((cur) => applyAutoResolve(cur, mech.id, proposal.changes));
    setAutoProposal(null);
  };
  const dismiss = (c: ProposedChange) =>
    setAutoProposal({
      ...proposal,
      changes: proposal.changes.filter((x) => !(x.elementId === c.elementId && x.slot === c.slot)),
    });

  return (
    <div data-testid="auto-resolve-preview" className="border-b bg-muted/40">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-medium">
          {proposal.changes.length === 0
            ? 'Nothing to auto-resolve'
            : `Auto-resolve proposes ${proposal.changes.length} change${
                proposal.changes.length === 1 ? '' : 's'
              }`}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-testid="auto-resolve-cancel"
          onClick={() => setAutoProposal(null)}
        >
          Cancel
        </Button>
      </div>
      {proposal.changes.length > 0 && (
        <>
          <ul className="m-0 flex max-h-64 list-none flex-col overflow-y-auto p-0">
            {proposal.changes.map((c) => {
              const el = mech.elements.find((e) => e.id === c.elementId);
              return (
                <li key={`${c.elementId}|${c.slot}`} className="flex items-start border-b">
                  <button
                    type="button"
                    data-testid="auto-resolve-change"
                    className="min-w-0 flex-1 cursor-pointer px-3 py-1.5 text-left hover:bg-accent"
                    onClick={() => select(c.elementId)}
                  >
                    <span className="block">
                      {el ? elementTypeLabel(el.type) : c.elementId} · {SLOT_LABELS[c.slot]}:{' '}
                      {c.before !== undefined && (
                        <span className="text-muted-foreground line-through">
                          {valueLabel(c, c.before)}
                        </span>
                      )}{' '}
                      <span className="font-medium">{valueLabel(c, c.after)}</span>
                    </span>
                    <span className="block text-muted-foreground text-xs">{c.reason}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="auto-resolve-dismiss"
                    aria-label="dismiss this change"
                    className="cursor-pointer px-2 py-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => dismiss(c)}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-muted-foreground text-xs">
              Parts heuristic — no strength check
            </span>
            <Button type="button" size="sm" data-testid="auto-resolve-apply" onClick={apply}>
              Apply {proposal.changes.length}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** The launch row: run button + the explicit re-solve opt-in. */
function AutoResolveLauncher({
  label,
  run,
}: {
  label: string;
  run: (resolveAssigned: boolean) => void;
}) {
  const [resolveAssigned, setResolveAssigned] = useState(false);
  return (
    <div className="flex items-center gap-3 border-b px-3 py-2">
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="auto-resolve-run"
        onClick={() => run(resolveAssigned)}
      >
        {label}
      </Button>
      <label className="flex items-center gap-1.5 text-muted-foreground text-xs">
        <Checkbox
          data-testid="auto-resolve-reassign"
          checked={resolveAssigned}
          onCheckedChange={(v) => setResolveAssigned(v === true)}
        />
        may change existing assignments
      </label>
    </div>
  );
}
