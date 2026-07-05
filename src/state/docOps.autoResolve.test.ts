// applyAutoResolve folds a proposal through the assignment ops — one call,
// consistent maturity (PLANFILE-marquee-autoresolve.md).
import { describe, expect, it } from 'vitest';
import type { ProposedChange } from '../design/autoResolve';
import type { BentLinkElement, PivotElement, SliderElement, TelescopeElement } from '../schema';
import { fixtureProject } from '../schema/fixtures';
import { applyAutoResolve } from './docOps';

const el = <T>(doc: ReturnType<typeof fixtureProject>, id: string): T =>
  doc.mechanisms[0]!.elements.find((e) => e.id === id) as T;

describe('applyAutoResolve', () => {
  it('applies material, telescope, realization, and end changes in one pass', () => {
    const doc = fixtureProject();
    const changes: ProposedChange[] = [
      { elementId: 'e-bent', slot: 'pipeMaterial', after: 'pipe-npn-075', reason: 'r' },
      { elementId: 'e-tel', slot: 'innerPipeMaterial', after: 'pipe-cts-075', reason: 'r' },
      { elementId: 'e-slider', slot: 'realization', after: 'conduitBox', reason: 'r' },
      { elementId: 'e-bent', slot: 'endRealizationA', after: 'heatWrapPivot', reason: 'r' },
    ];
    const out = applyAutoResolve(doc, 'mech-1', changes);

    const bent = el<BentLinkElement>(out, 'e-bent');
    expect(bent.pipeMaterialId).toBe('pipe-npn-075');
    expect(bent.endRealizationA).toBe('heatWrapPivot');
    expect(bent.maturity).toBe('engineered'); // maturity derives with the assignment
    expect(el<TelescopeElement>(out, 'e-tel').innerPipeMaterialId).toBe('pipe-cts-075');
    const slider = el<SliderElement>(out, 'e-slider');
    expect(slider.realization).toBe('conduitBox');
    expect(slider.maturity).toBe('engineered');
  });

  it('replaces existing assignments when the proposal says so', () => {
    const doc = fixtureProject();
    const out = applyAutoResolve(doc, 'mech-1', [
      {
        elementId: 'e-pivot',
        slot: 'realization',
        before: 'heatWrapPivot',
        after: 'nestedSleeve',
        reason: 'r',
      },
    ]);
    expect(el<PivotElement>(out, 'e-pivot').realization).toBe('nestedSleeve');
  });

  it('is a no-op for an empty proposal', () => {
    const doc = fixtureProject();
    expect(applyAutoResolve(doc, 'mech-1', [])).toEqual(doc);
  });
});
