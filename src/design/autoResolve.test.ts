// Acceptance tests for the parts-minimizing auto-resolver (feature planfile
// PLANFILE-marquee-autoresolve.md). Written before the implementation.
import { describe, expect, it } from 'vitest';
import type { Mechanism, MechanismElement, PipeMaterial, Project } from '../schema';
import { createEmptyProject } from '../schema';
import { autoResolve } from './autoResolve';

// ── synthetic pipe stock with known nesting relations ──────────────────────
// clearance = ID(outer) − OD(inner); slip band is 0.5–1.5 mm (§6.1)
//   big  ⊃ mid   : 25.0 − 24.0 = 1.0 mm  → slip
//   big  ⊃ alt   : 25.0 − 23.8 = 1.2 mm  → slip
//   mid  ⊃ small : 20.0 − 19.6 = 0.4 mm  → snug (not slip)
//   big  ⊃ small : 25.0 − 19.6 = 5.4 mm  → sloppy
const mm = (v: number) => v / 1000;
const pipe = (id: string, odMm: number, idMm: number): PipeMaterial => ({
  id,
  name: id,
  sizingSystem: 'NPS',
  nominalSize: id,
  outerDiameterM: mm(odMm),
  innerDiameterM: mm(idMm),
  linearDensityKgPerM: 0.3,
  approximate: false,
});
const PIPES = [
  pipe('big', 30, 25),
  pipe('mid', 24, 20),
  pipe('alt', 23.8, 19),
  pipe('small', 19.6, 15),
];

const node = (id: string, x: number) => ({ id, kind: 'free' as const, position: { x, y: 0 } });
const link = (
  id: string,
  a: string,
  b: string,
  extra: Partial<Extract<MechanismElement, { type: 'link' }>> = {},
): MechanismElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA: a,
  nodeB: b,
  pointMasses: [],
  ...extra,
});

function makeProject(elements: MechanismElement[], nodeCount = 4): Project {
  const doc = createEmptyProject('p1', 'test');
  doc.materials = { ...doc.materials, pipes: PIPES, unitPrices: {} };
  const mech: Mechanism = {
    id: 'm1',
    name: 'mech',
    viewOrientation: 'side-left',
    gravityOn: false,
    nodes: Array.from({ length: nodeCount }, (_, i) => node(`n${i + 1}`, i)),
    elements,
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
    namedStates: [],
  };
  return { ...doc, mechanisms: [mech] };
}

const change = (
  proposal: ReturnType<typeof autoResolve>,
  elementId: string,
  slot: string,
): { before?: string; after: string; reason: string } | undefined =>
  proposal.changes.find((c) => c.elementId === elementId && c.slot === slot);

describe('autoResolve — pipe material fill', () => {
  it('assigns the most-used project size to unassigned links', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n2', { pipeMaterialId: 'mid' }),
      link('l2', 'n2', 'n3', { pipeMaterialId: 'mid' }),
      link('l3', 'n3', 'n4'),
    ]);
    const p = autoResolve(doc, 'm1', {});
    expect(change(p, 'l3', 'pipeMaterial')?.after).toBe('mid');
  });

  it('with no assignments anywhere, picks the stock size with the most slip partners', () => {
    const doc = makeProject([link('l1', 'n1', 'n2')]);
    const p = autoResolve(doc, 'm1', {});
    // big slips over mid and alt (2 partners); every other pipe has 1 or 0
    expect(change(p, 'l1', 'pipeMaterial')?.after).toBe('big');
  });

  it('never touches an assigned material without resolveAssigned', () => {
    const doc = makeProject([link('l1', 'n1', 'n2', { pipeMaterialId: 'small' })]);
    const p = autoResolve(doc, 'm1', {});
    expect(change(p, 'l1', 'pipeMaterial')).toBeUndefined();
  });
});

describe('autoResolve — pivots prefer nesting over hardware', () => {
  const pivot = (id: string, nodeId: string, memberIds: string[], welds: [string, string][] = []) =>
    ({
      id,
      type: 'pivot',
      maturity: 'sketch',
      nodeId,
      memberIds,
      welds,
    }) as MechanismElement;

  it('chooses nestedSleeve when the joined pair already slip-fits, and puts the end allowance on the inner member', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n2', { pipeMaterialId: 'big' }),
      link('l2', 'n2', 'n3', { pipeMaterialId: 'mid' }),
      pivot('p1', 'n2', ['l1', 'l2']),
    ]);
    const p = autoResolve(doc, 'm1', {});
    expect(change(p, 'p1', 'realization')?.after).toBe('nestedSleeve');
    // l2 is the inner member and terminates at n2 via its A end
    expect(change(p, 'l2', 'endRealizationA')?.after).toBe('nestedSleeve');
    expect(change(p, 'l1', 'endRealizationB')).toBeUndefined();
  });

  it('resizes a material it proposed itself in the same run to unlock a slip fit', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n2', { pipeMaterialId: 'big' }),
      link('l2', 'n2', 'n3'), // unassigned — the fill pass would pick big
      pivot('p1', 'n2', ['l1', 'l2']),
    ]);
    const p = autoResolve(doc, 'm1', {});
    // instead of big/big + heat-wrap, the run resizes its own fill to nest
    expect(change(p, 'l2', 'pipeMaterial')?.after).toBe('mid');
    expect(change(p, 'p1', 'realization')?.after).toBe('nestedSleeve');
  });

  it('falls back to heatWrapPivot when no slip fit is reachable (fill-gaps mode)', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n2', { pipeMaterialId: 'big' }),
      link('l2', 'n2', 'n3', { pipeMaterialId: 'small' }), // sloppy inside big
      pivot('p1', 'n2', ['l1', 'l2']),
    ]);
    const p = autoResolve(doc, 'm1', {});
    expect(change(p, 'p1', 'realization')?.after).toBe('heatWrapPivot');
    expect(change(p, 'l2', 'pipeMaterial')).toBeUndefined(); // assigned — untouched
  });

  it('with resolveAssigned, resizes one assigned member to reach a slip fit', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n2', { pipeMaterialId: 'big' }),
      link('l2', 'n2', 'n3', { pipeMaterialId: 'small' }),
      pivot('p1', 'n2', ['l1', 'l2']),
    ]);
    const p = autoResolve(doc, 'm1', { resolveAssigned: true });
    const resize = change(p, 'l2', 'pipeMaterial');
    expect(resize?.after).toBe('mid');
    expect(resize?.before).toBe('small');
    expect(change(p, 'p1', 'realization')?.after).toBe('nestedSleeve');
  });

  it('welded two-member pivots become heatWrapRigid with one wrap end', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n2', { pipeMaterialId: 'big' }),
      link('l2', 'n2', 'n3', { pipeMaterialId: 'big' }),
      pivot('p1', 'n2', ['l1', 'l2'], [['l1', 'l2']]),
    ]);
    const p = autoResolve(doc, 'm1', {});
    expect(change(p, 'p1', 'realization')?.after).toBe('heatWrapRigid');
    const wrapEnds = p.changes.filter(
      (c) => c.after === 'heatWrapRigid' && c.slot.startsWith('endRealization'),
    );
    expect(wrapEnds).toHaveLength(1); // exactly one member carries the wrap
  });

  it('pivots with 3+ members never propose nesting', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n2', { pipeMaterialId: 'big' }),
      link('l2', 'n2', 'n3', { pipeMaterialId: 'mid' }),
      link('l3', 'n2', 'n4', { pipeMaterialId: 'mid' }),
      pivot('p1', 'n2', ['l1', 'l2', 'l3']),
    ]);
    const p = autoResolve(doc, 'm1', {});
    expect(change(p, 'p1', 'realization')?.after).toBe('heatWrapPivot');
  });

  it('does not replace an existing realization without resolveAssigned, and only upgrades purchased hardware with it', () => {
    const elements = [
      link('l1', 'n1', 'n2', { pipeMaterialId: 'big' }),
      link('l2', 'n2', 'n3', { pipeMaterialId: 'mid' }),
      pivot('p1', 'n2', ['l1', 'l2']),
    ];
    (elements[2] as Extract<MechanismElement, { type: 'pivot' }>).realization = 'boltThrough';
    const doc = makeProject(elements);
    expect(autoResolve(doc, 'm1', {}).changes).toEqual([]);
    const p = autoResolve(doc, 'm1', { resolveAssigned: true });
    expect(change(p, 'p1', 'realization')?.after).toBe('nestedSleeve');
  });
});

describe('autoResolve — sliders, telescopes, scope, determinism', () => {
  it('sliders get a conduit box', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n3', { pipeMaterialId: 'big' }),
      {
        id: 's1',
        type: 'slider',
        maturity: 'sketch',
        nodeId: 'n2',
        alongElementId: 'l1',
        travelMin: 0,
        travelMax: 1,
      },
    ]);
    const p = autoResolve(doc, 'm1', {});
    expect(change(p, 's1', 'realization')?.after).toBe('conduitBox');
  });

  it('completes a telescope with a slip-fit partner for the assigned member', () => {
    const doc = makeProject([
      {
        id: 't1',
        type: 'telescope',
        maturity: 'sketch',
        nodeA: 'n1',
        nodeB: 'n2',
        minLengthM: 0.3,
        maxLengthM: 0.6,
        lengthM: 0.5,
        sliding: true,
        outerPipeMaterialId: 'big',
        pointMasses: [],
      },
    ]);
    const p = autoResolve(doc, 'm1', {});
    expect(change(p, 't1', 'innerPipeMaterial')?.after).toBe('mid');
  });

  it('proposes nothing rather than a bad fit when no slip partner exists', () => {
    const doc = makeProject([
      {
        id: 't1',
        type: 'telescope',
        maturity: 'sketch',
        nodeA: 'n1',
        nodeB: 'n2',
        minLengthM: 0.3,
        maxLengthM: 0.6,
        lengthM: 0.5,
        sliding: true,
        outerPipeMaterialId: 'small', // nothing slips inside small
        pointMasses: [],
      },
    ]);
    const p = autoResolve(doc, 'm1', {});
    expect(change(p, 't1', 'innerPipeMaterial')).toBeUndefined();
  });

  it('elementIds scopes the proposal to the selection', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n2'),
      link('l2', 'n2', 'n3'),
      link('l3', 'n3', 'n4'),
    ]);
    const p = autoResolve(doc, 'm1', { elementIds: ['l2'] });
    expect(p.changes.map((c) => c.elementId)).toEqual(['l2']);
  });

  it('is deterministic: identical input gives an identical proposal', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n2', { pipeMaterialId: 'big' }),
      link('l2', 'n2', 'n3'),
      {
        id: 'p1',
        type: 'pivot',
        maturity: 'sketch',
        nodeId: 'n2',
        memberIds: ['l1', 'l2'],
        welds: [],
      },
    ]);
    expect(autoResolve(doc, 'm1', {})).toEqual(autoResolve(doc, 'm1', {}));
  });

  it('every change carries a human-readable reason', () => {
    const doc = makeProject([
      link('l1', 'n1', 'n2', { pipeMaterialId: 'big' }),
      link('l2', 'n2', 'n3'),
      {
        id: 'p1',
        type: 'pivot',
        maturity: 'sketch',
        nodeId: 'n2',
        memberIds: ['l1', 'l2'],
        welds: [],
      },
    ]);
    for (const c of autoResolve(doc, 'm1', {}).changes) {
      expect(c.reason.length).toBeGreaterThan(5);
    }
  });
});
