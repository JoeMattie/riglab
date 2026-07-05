// applyAutoResolve folds a proposal through the assignment ops — one call,
// consistent maturity (PLANFILE-marquee-autoresolve.md).
import { describe, expect, it } from 'vitest';
import type { ProposedChange } from '../design/autoResolve';
import { mech, node, projectWith } from '../design/testFixtures';
import type {
  BentLinkElement,
  PivotElement,
  Project,
  SliderElement,
  TelescopeElement,
} from '../schema';
import { applyAutoResolve } from './docOps';

function fixture(): Project {
  const bent: BentLinkElement = {
    id: 'e-bent',
    type: 'bentLink',
    maturity: 'sketch',
    nodeIds: ['n1', 'n2', 'n3'],
    filletRadiiM: [0.08],
    pointMasses: [],
  };
  const tel: TelescopeElement = {
    id: 'e-tel',
    type: 'telescope',
    maturity: 'sketch',
    nodeA: 'n3',
    nodeB: 'n4',
    minLengthM: 0.3,
    maxLengthM: 0.6,
    lengthM: 0.5,
    sliding: false,
    outerPipeMaterialId: 'TO',
    pointMasses: [],
  };
  const pivot: PivotElement = {
    id: 'e-pivot',
    type: 'pivot',
    maturity: 'engineered',
    nodeId: 'n2',
    joint: { kind: 'hinge', axis: { x: 0, y: 0, z: 1 } },
    memberIds: ['e-bent', 'e-tel'],
    welds: [],
    realization: 'heatWrapPivot',
  };
  const slider: SliderElement = {
    id: 'e-slider',
    type: 'slider',
    maturity: 'sketch',
    nodeId: 'n4',
    alongElementId: 'e-bent',
    travelMin: 0.1,
    travelMax: 0.9,
  };
  return projectWith(
    mech(
      [bent, tel, pivot, slider],
      [node('n1', 0, 0), node('n2', 1, 0.2), node('n3', 1.5, 0.1), node('n4', 2, 0)],
    ),
  );
}

const el = <T>(doc: Project, id: string): T => doc.mechanism.elements.find((e) => e.id === id) as T;

describe('applyAutoResolve', () => {
  it('applies material, telescope, realization, and end changes in one pass', () => {
    const changes: ProposedChange[] = [
      { elementId: 'e-bent', slot: 'pipeMaterial', after: 'PA', reason: 'r' },
      { elementId: 'e-tel', slot: 'innerPipeMaterial', after: 'TI', reason: 'r' },
      { elementId: 'e-slider', slot: 'realization', after: 'conduitBox', reason: 'r' },
      { elementId: 'e-bent', slot: 'endRealizationA', after: 'heatWrapPivot', reason: 'r' },
    ];
    const out = applyAutoResolve(fixture(), changes);

    const bent = el<BentLinkElement>(out, 'e-bent');
    expect(bent.pipeMaterialId).toBe('PA');
    expect(bent.endRealizationA).toBe('heatWrapPivot');
    expect(bent.maturity).toBe('engineered'); // maturity derives with the assignment
    expect(el<TelescopeElement>(out, 'e-tel').innerPipeMaterialId).toBe('TI');
    const slider = el<SliderElement>(out, 'e-slider');
    expect(slider.realization).toBe('conduitBox');
    expect(slider.maturity).toBe('engineered');
  });

  it('replaces existing assignments when the proposal says so', () => {
    const out = applyAutoResolve(fixture(), [
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
    const doc = fixture();
    expect(applyAutoResolve(doc, [])).toEqual(doc);
  });
});
