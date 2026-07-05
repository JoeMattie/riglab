// Empty-selection panel content (§8.2a): mechanism-level summary — DOF,
// element counts, gravity, unbound channels; plus weight total and
// resolution progress in the design face.
import { computeBom } from '../../../bom';
import { elementTypeLabel, mechanismResolution } from '../../../design/resolution';
import type { Mechanism, Project } from '../../../schema';
import type { SolveDiagnostics } from '../../../solver';
import type { Face } from '../../../state/editorStore';
import { useEditorStore } from '../../../state/editorStore';
import { Badge } from '../../components/badge';
import { kilograms, Row, Section } from './fields';

export function MechanismSummary({
  doc,
  mech,
  face,
  diagnostics,
}: {
  doc: Project;
  mech: Mechanism;
  face: Face;
  diagnostics?: SolveDiagnostics;
}) {
  const dof = useEditorStore((s) => s.dof);

  const counts = new Map<string, number>();
  for (const el of mech.elements) {
    const label = elementTypeLabel(el.type);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  const resolution = mechanismResolution(mech, doc.materials, diagnostics);
  const unbound = resolution.items.filter((i) => i.kind === 'unboundChannel');

  return (
    <div data-testid="mechanism-summary">
      <Section title="Mechanism">
        <Row label="name">{mech.name}</Row>
        <Row label="view">{mech.viewOrientation}</Row>
        {dof && (
          <Row label="DOF">
            <Badge variant="secondary" data-testid="summary-dof">
              {dof.dof} · {dof.classification}
            </Badge>
          </Row>
        )}
        <Row label="gravity">{mech.gravityOn ? 'on' : 'off'}</Row>
      </Section>

      <Section title="Elements">
        {counts.size === 0 && <div className="text-muted-foreground">nothing drawn yet</div>}
        {[...counts.entries()].map(([label, n]) => (
          <Row key={label} label={label}>
            {n}
          </Row>
        ))}
      </Section>

      {unbound.length > 0 && (
        <Section title="Unbound channels">
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {unbound.map((i) => (
              <li key={i.id} className="text-amber-700" data-testid="unbound-channel">
                {i.label}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {face === 'design' && (
        <Section title="Design progress">
          <Row label="weight">
            <span data-testid="summary-weight">
              {kilograms(
                computeBom([mech], doc.materials, doc.bomSettings).weights.grandTotalKg,
                doc.unitsPreference,
              )}
            </span>
          </Row>
          <Row label="resolved">
            <span data-testid="summary-progress">
              {resolution.progress.resolved} of {resolution.progress.total} items
            </span>
          </Row>
          {resolution.items.length > 0 && (
            <div className="mt-1 text-muted-foreground text-xs">
              {resolution.items.length} unresolved item{resolution.items.length > 1 ? 's' : ''} —
              select an element to fix it
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
