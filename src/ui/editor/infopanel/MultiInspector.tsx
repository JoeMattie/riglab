// Multi-selection inspector (§8.2a): shared editable properties — the §8.2
// bulk material/realization assignment surface. Assignment controls are
// design-face scope; the sketch face shows the selection composition only.
import { autoResolve } from '../../../design/autoResolve';
import { elementTypeLabel } from '../../../design/resolution';
import type { JointRealization, MechanismElement, Project } from '../../../schema';
import { useAppStore } from '../../../state/appStore';
import {
  assignCordageMaterial,
  assignPipeMaterial,
  assignRealization,
} from '../../../state/docOps';
import { type Face, useEditorStore } from '../../../state/editorStore';
import { Button } from '../../components/button';
import { AssignSelect, REALIZATION_OPTIONS, Row, Section } from './fields';

/** The one shared value across `values`, or null when mixed/empty. */
function sharedValue<T>(values: (T | undefined)[]): T | null {
  const first = values[0];
  return values.length > 0 && values.every((v) => v === first) ? (first ?? null) : null;
}

export function MultiInspector({
  doc,
  els,
  face,
}: {
  doc: Project;
  els: MechanismElement[];
  face: Face;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const setAutoProposal = useEditorStore((s) => s.setAutoProposal);
  const setRightTab = useEditorStore((s) => s.setRightTab);

  const counts = new Map<string, number>();
  for (const el of els) {
    const label = elementTypeLabel(el.type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const structural = els.filter(
    (e): e is Extract<MechanismElement, { type: 'link' | 'bentLink' }> =>
      e.type === 'link' || e.type === 'bentLink',
  );
  const cordage = els.filter(
    (e): e is Extract<MechanismElement, { type: 'rope' | 'elastic' | 'bowden' }> =>
      e.type === 'rope' || e.type === 'elastic' || e.type === 'bowden',
  );
  const joints = els.filter(
    (e): e is Extract<MechanismElement, { type: 'pivot' | 'slider' }> =>
      e.type === 'pivot' || e.type === 'slider',
  );
  const ids = els.map((e) => e.id);

  return (
    <div data-testid="multi-inspector">
      <Section title="Selection">
        <Row label="selected">
          <span data-testid="selection-count">{els.length} elements</span>
        </Row>
        {[...counts.entries()].map(([label, n]) => (
          <Row key={label} label={label}>
            {n}
          </Row>
        ))}
        {face === 'design' && (
          <div className="px-3 py-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="auto-resolve-selection"
              onClick={() => {
                // proposal scoped to the selection; the preview lives in the
                // checklist tab, so hand the user over to it
                setAutoProposal({
                  docRef: doc,
                  changes: autoResolve(doc, { elementIds: ids }).changes,
                });
                setRightTab('checklist');
              }}
            >
              Auto-resolve selection
            </Button>
          </div>
        )}
      </Section>

      {face === 'design' && structural.length > 0 && (
        <Section title={`Pipe material (${structural.length})`}>
          <AssignSelect
            value={sharedValue(structural.map((e) => e.pipeMaterialId))}
            options={doc.materials.pipes.map((p) => ({ id: p.id, label: p.name }))}
            placeholder="mixed — assign to all…"
            testId="bulk-material-select"
            onChange={(id) => updateCurrent((cur) => assignPipeMaterial(cur, ids, id))}
          />
        </Section>
      )}

      {face === 'design' && cordage.length > 0 && (
        <Section title={`Cordage (${cordage.length})`}>
          <AssignSelect
            value={sharedValue(cordage.map((e) => e.cordageMaterialId))}
            options={doc.materials.cordage.map((c) => ({ id: c.id, label: c.name }))}
            placeholder="mixed — assign to all…"
            testId="bulk-cordage-select"
            onChange={(id) => updateCurrent((cur) => assignCordageMaterial(cur, ids, id))}
          />
        </Section>
      )}

      {face === 'design' && joints.length > 0 && (
        <Section title={`Realization (${joints.length})`}>
          <AssignSelect
            value={sharedValue(joints.map((e) => e.realization))}
            options={REALIZATION_OPTIONS}
            placeholder="mixed — assign to all…"
            testId="bulk-realization-select"
            onChange={(r) =>
              updateCurrent((cur) => assignRealization(cur, ids, r as JointRealization | undefined))
            }
          />
        </Section>
      )}

      {face === 'sketch' && (
        <div className="px-3 py-2 text-muted-foreground text-xs">
          Switch to the Design face for bulk material and realization assignment.
        </div>
      )}
    </div>
  );
}
