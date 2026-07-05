// Pure conflict-list derivation for the DOF pill (design handoff §9): turns
// the diagnostics the editor already has (violated element ids, rope
// compression flags, the DOF classification) into concrete rows, each with a
// click-to-zoom target and — where a docOp genuinely applies — a one-click
// fix. Framework-free so it unit-tests without a DOM.
import { elementTypeLabel } from '../../design/resolution';
import type { Mechanism, Project } from '../../schema';
import { setLengthLocked } from '../../state/docOps';

export interface Conflict {
  key: string;
  /** zoom target; absent for mechanism-wide rows with no locked candidate */
  elementId?: string;
  label: string;
  issue: string;
  fix?: { label: string; apply(doc: Project): Project };
}

const shortLabel = (mech: Mechanism, id: string): string => {
  const el = mech.elements.find((e) => e.id === id);
  return el ? `${elementTypeLabel(el.type)} ${id.slice(0, 4)}` : id.slice(0, 4);
};

export function deriveConflicts(
  mech: Mechanism,
  dof: { dof: number; classification: string } | null,
  violated: string[],
  ropesRequiringCompression: string[],
): Conflict[] {
  const out: Conflict[] = [];
  const compression = new Set(ropesRequiringCompression);

  for (const id of [...new Set(violated)]) {
    if (compression.has(id)) continue; // reported below with better wording
    const el = mech.elements.find((e) => e.id === id);
    const label = shortLabel(mech, id);
    if (el && (el.type === 'link' || el.type === 'telescope') && el.lengthLocked) {
      out.push({
        key: `v-${id}`,
        elementId: id,
        label,
        issue: 'locked length in conflict',
        fix: {
          label: 'unlock length',
          apply: (doc) => setLengthLocked(doc, id, false),
        },
      });
    } else if (el?.type === 'pivot' && el.angleLimit) {
      out.push({ key: `v-${id}`, elementId: id, label, issue: 'angle limit hit' });
    } else if (el?.type === 'rope') {
      out.push({ key: `v-${id}`, elementId: id, label, issue: 'taut limit hit' });
    } else {
      out.push({ key: `v-${id}`, elementId: id, label, issue: 'constraint violated' });
    }
  }

  for (const id of compression) {
    out.push({
      key: `c-${id}`,
      elementId: id,
      label: shortLabel(mech, id),
      issue: 'requires compression',
    });
  }

  if (dof?.classification === 'overconstrained') {
    const locked = mech.elements.find(
      (e) => (e.type === 'link' || e.type === 'telescope') && e.lengthLocked,
    );
    out.push({
      key: 'overconstrained',
      elementId: locked?.id,
      label: 'mechanism',
      issue: 'over-constrained',
      fix: locked
        ? {
            label: 'unlock a length',
            apply: (doc) => setLengthLocked(doc, locked.id, false),
          }
        : undefined,
    });
  }

  return out;
}
