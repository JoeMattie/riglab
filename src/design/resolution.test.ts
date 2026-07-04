// Resolution/checklist computation (§8.2, §8.2a) — written before the
// implementation per the tests-first rule. Item taxonomy and the maturity
// derivation rule are documented in DECISIONS.md (Phase 3 — design face UI).
import { describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../bom/testHelpers';
import type {
  LinkElement,
  PivotElement,
  RopeElement,
  SliderElement,
  TelescopeElement,
} from '../schema';
import type { SolveDiagnostics } from '../solver';
import { derivedMaturity, elementResolutionItems, mechanismResolution } from './resolution';

const materials = testMaterials();

const link = (id: string, over: Partial<LinkElement> = {}): LinkElement => ({
  id,
  type: 'link',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  pointMasses: [],
  ...over,
});

const telescope = (id: string, over: Partial<TelescopeElement> = {}): TelescopeElement => ({
  id,
  type: 'telescope',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  minLengthM: 0.5,
  maxLengthM: 1.5,
  lengthM: 1,
  sliding: false,
  pointMasses: [],
  ...over,
});

const pivot = (id: string, over: Partial<PivotElement> = {}): PivotElement => ({
  id,
  type: 'pivot',
  maturity: 'sketch',
  nodeId: 'n1',
  memberIds: ['e1', 'e2'],
  welds: [],
  ...over,
});

const rope = (id: string): RopeElement => ({
  id,
  type: 'rope',
  maturity: 'sketch',
  path: ['n1', 'n2'],
  lengthM: 1,
});

const slider = (id: string, over: Partial<SliderElement> = {}): SliderElement => ({
  id,
  type: 'slider',
  maturity: 'sketch',
  nodeId: 'n1',
  alongElementId: 'e1',
  travelMin: 0,
  travelMax: 1,
  ...over,
});

const nodes = [node('n1', 0, 0), node('n2', 1, 0)];

const diag = (over: Partial<SolveDiagnostics> = {}): SolveDiagnostics => ({
  dof: 1,
  classification: 'mechanism',
  converged: true,
  residual: 0,
  violated: [],
  ropesRequiringCompression: [],
  ...over,
});

describe('elementResolutionItems', () => {
  it('link without a pipe material yields one missingMaterial todo; assigned link is resolved', () => {
    const bare = link('L1');
    const m = mech([bare], nodes);
    const items = elementResolutionItems(bare, m, materials);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'missingMaterial', elementId: 'L1', severity: 'todo' });

    const assigned = link('L2', { pipeMaterialId: 'PA' });
    expect(elementResolutionItems(assigned, mech([assigned], nodes), materials)).toEqual([]);
  });

  it('telescope reports one missingMaterial per unassigned member', () => {
    const bare = telescope('T1');
    const m = mech([bare], nodes);
    const items = elementResolutionItems(bare, m, materials);
    expect(items.map((i) => i.kind)).toEqual(['missingMaterial', 'missingMaterial']);

    const half = telescope('T2', { outerPipeMaterialId: 'TO' });
    expect(elementResolutionItems(half, mech([half], nodes), materials)).toHaveLength(1);
  });

  it('telescope with an incompatible (non-slip) pair warns; a slip pair is resolved', () => {
    const bad = telescope('T1', { outerPipeMaterialId: 'TX', innerPipeMaterialId: 'TI' });
    const items = elementResolutionItems(bad, mech([bad], nodes), materials);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: 'telescopeNestingIncompatible',
      elementId: 'T1',
      severity: 'warning',
    });

    const good = telescope('T2', { outerPipeMaterialId: 'TO', innerPipeMaterialId: 'TI' });
    expect(elementResolutionItems(good, mech([good], nodes), materials)).toEqual([]);
  });

  it('pivot/slider without a realization yield missingRealization; realized ones are resolved', () => {
    const p = pivot('P1');
    const s = slider('S1');
    const m = mech([p, s], nodes);
    expect(elementResolutionItems(p, m, materials)[0]?.kind).toBe('missingRealization');
    expect(elementResolutionItems(s, m, materials)[0]?.kind).toBe('missingRealization');

    const pr = pivot('P2', { realization: 'heatWrapPivot' });
    const sr = slider('S2', { realization: 'conduitBox' });
    expect(elementResolutionItems(pr, mech([pr], nodes), materials)).toEqual([]);
    expect(elementResolutionItems(sr, mech([sr], nodes), materials)).toEqual([]);
  });

  it('rope flagged by diagnostics gets a ropeRequiresCompression warning', () => {
    const r = rope('R1');
    const m = mech([r], nodes);
    expect(elementResolutionItems(r, m, materials)).toEqual([]);
    const items = elementResolutionItems(
      r,
      m,
      materials,
      diag({ ropesRequiringCompression: ['R1'] }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'ropeRequiresCompression', severity: 'warning' });
  });
});

describe('mechanismResolution', () => {
  it('collects element items plus unbound channels and overconstraint warnings', () => {
    const m = mech([link('L1'), pivot('P1')], nodes, {
      inputs: [
        {
          id: 'ch1',
          name: 'steer',
          kind: 'angle' as const,
          min: 0,
          max: 1,
          value: 0,
          locked: false,
        },
      ],
    });
    const res = mechanismResolution(
      m,
      materials,
      diag({ dof: -1, classification: 'overconstrained' }),
    );
    const kinds = res.items.map((i) => i.kind).sort();
    expect(kinds).toEqual([
      'missingMaterial',
      'missingRealization',
      'overconstrained',
      'unboundChannel',
    ]);
    const unbound = res.items.find((i) => i.kind === 'unboundChannel');
    expect(unbound?.channelId).toBe('ch1');
  });

  it('a channel bound to a driven node is not unbound', () => {
    const m = mech([], [{ ...node('n1', 0, 0), kind: 'driven' as const, channelId: 'ch1' }], {
      inputs: [
        {
          id: 'ch1',
          name: 'jaw',
          kind: 'displacement' as const,
          min: 0,
          max: 1,
          value: 0,
          locked: false,
        },
      ],
    });
    expect(mechanismResolution(m, materials).items).toEqual([]);
  });

  it('progress counts assignment slots (materials, realizations, channel bindings), not warnings', () => {
    const m = mech(
      [
        link('L1', { pipeMaterialId: 'PA' }), // resolved slot
        link('L2'), // open slot
        telescope('T1', { outerPipeMaterialId: 'TX', innerPipeMaterialId: 'TI' }), // 2 resolved slots + nesting warning
        pivot('P1'), // open slot
      ],
      nodes,
    );
    const res = mechanismResolution(m, materials);
    // slots: L1, L2, T1 outer, T1 inner, P1 → total 5, resolved 3
    expect(res.progress).toEqual({ resolved: 3, total: 5 });
    // the nesting warning is an item but not a slot
    expect(res.items.some((i) => i.kind === 'telescopeNestingIncompatible')).toBe(true);
  });

  it('item ids are unique and stable', () => {
    const m = mech([link('L1'), telescope('T1'), pivot('P1')], nodes);
    const res = mechanismResolution(m, materials);
    const ids = res.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(mechanismResolution(m, materials).items.map((i) => i.id)).toEqual(ids);
  });
});

describe('derivedMaturity', () => {
  it('links/bentLinks are engineered once a pipe material is assigned', () => {
    expect(derivedMaturity(link('L1'))).toBe('sketch');
    expect(derivedMaturity(link('L1', { pipeMaterialId: 'PA' }))).toBe('engineered');
  });

  it('telescopes need both members; pivots/sliders need a realization', () => {
    expect(derivedMaturity(telescope('T1', { outerPipeMaterialId: 'TO' }))).toBe('sketch');
    expect(
      derivedMaturity(telescope('T1', { outerPipeMaterialId: 'TO', innerPipeMaterialId: 'TI' })),
    ).toBe('engineered');
    expect(derivedMaturity(pivot('P1'))).toBe('sketch');
    expect(derivedMaturity(pivot('P1', { realization: 'boltThrough' }))).toBe('engineered');
    expect(derivedMaturity(slider('S1', { realization: 'conduitBox' }))).toBe('engineered');
  });

  it('cordage elements are engineered once a cordage material is assigned', () => {
    const r = rope('R1');
    expect(derivedMaturity(r)).toBe('sketch');
    expect(derivedMaturity({ ...r, cordageMaterialId: 'rope' })).toBe('engineered');
  });
});
