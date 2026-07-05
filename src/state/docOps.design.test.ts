// Design-face assignment ops (§8.2, §8.2a): material/realization assignment
// (single + bulk), inline length editing, behavior-parameter patching, and the
// maturity auto-flip rule (derivedMaturity — see DECISIONS.md).
import { describe, expect, it } from 'vitest';
import { mech, node, testMaterials } from '../bom/testHelpers';
import type {
  ElasticElement,
  LinkElement,
  Mechanism,
  PivotElement,
  Project,
  RopeElement,
  SliderElement,
  TelescopeElement,
} from '../schema';
import { createEmptyProject } from '../schema';
import {
  assignCordageMaterial,
  assignEndRealization,
  assignNodeRealization,
  assignPipeMaterial,
  assignRealization,
  assignTelescopeMaterial,
  patchElement,
  setLinkLength,
} from './docOps';

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
  maxLengthM: 3,
  lengthM: 2,
  sliding: false,
  pointMasses: [],
  ...over,
});

const pivot = (id: string): PivotElement => ({
  id,
  type: 'pivot',
  maturity: 'sketch',
  nodeId: 'n1',
  memberIds: ['e1', 'e2'],
  welds: [],
});

const slider = (id: string): SliderElement => ({
  id,
  type: 'slider',
  maturity: 'sketch',
  nodeId: 'n1',
  alongElementId: 'e1',
  travelMin: 0,
  travelMax: 1,
});

const rope = (id: string): RopeElement => ({
  id,
  type: 'rope',
  maturity: 'sketch',
  path: ['n1', 'n2'],
  lengthM: 1,
});

const elastic = (id: string): ElasticElement => ({
  id,
  type: 'elastic',
  maturity: 'sketch',
  nodeA: 'n1',
  nodeB: 'n2',
  restLengthM: 1,
  stiffnessNPerM: 200,
  tensionOnly: true,
});

function project(m: Mechanism): Project {
  const p = createEmptyProject('p1', 'test');
  return { ...p, materials: testMaterials(), mechanisms: [m] };
}

const elOf = (doc: Project, id: string) => doc.mechanisms[0]!.elements.find((e) => e.id === id)!;
const nodeOf = (doc: Project, id: string) => doc.mechanisms[0]!.nodes.find((n) => n.id === id)!;

describe('assignPipeMaterial', () => {
  it('assigns to links/bentLinks and auto-flips maturity; unassigning flips back', () => {
    const doc = project(mech([link('L1')], [node('n1', 0, 0), node('n2', 1, 0)]));
    const next = assignPipeMaterial(doc, 'm1', ['L1'], 'PA');
    expect(elOf(next, 'L1')).toMatchObject({ pipeMaterialId: 'PA', maturity: 'engineered' });
    const cleared = assignPipeMaterial(next, 'm1', ['L1'], undefined);
    expect(elOf(cleared, 'L1')).toMatchObject({ pipeMaterialId: undefined, maturity: 'sketch' });
  });

  it('bulk-assigns to every structural element in the id list, ignoring others', () => {
    const doc = project(
      mech([link('L1'), link('L2'), rope('R1')], [node('n1', 0, 0), node('n2', 1, 0)]),
    );
    const next = assignPipeMaterial(doc, 'm1', ['L1', 'L2', 'R1'], 'PB');
    expect(elOf(next, 'L1')).toMatchObject({ pipeMaterialId: 'PB' });
    expect(elOf(next, 'L2')).toMatchObject({ pipeMaterialId: 'PB' });
    expect(elOf(next, 'R1')).not.toHaveProperty('pipeMaterialId');
  });
});

describe('assignTelescopeMaterial', () => {
  it('assigns members independently; engineered only when both are set', () => {
    const doc = project(mech([telescope('T1')], [node('n1', 0, 0), node('n2', 2, 0)]));
    const outer = assignTelescopeMaterial(doc, 'm1', 'T1', 'outer', 'TO');
    expect(elOf(outer, 'T1')).toMatchObject({ outerPipeMaterialId: 'TO', maturity: 'sketch' });
    const both = assignTelescopeMaterial(outer, 'm1', 'T1', 'inner', 'TI');
    expect(elOf(both, 'T1')).toMatchObject({ innerPipeMaterialId: 'TI', maturity: 'engineered' });
  });
});

describe('assignRealization', () => {
  it('assigns to pivots and sliders (bulk) and auto-flips maturity', () => {
    const doc = project(
      mech([pivot('P1'), slider('S1'), link('L1')], [node('n1', 0, 0), node('n2', 1, 0)]),
    );
    const next = assignRealization(doc, 'm1', ['P1', 'S1', 'L1'], 'boltThrough');
    expect(elOf(next, 'P1')).toMatchObject({ realization: 'boltThrough', maturity: 'engineered' });
    expect(elOf(next, 'S1')).toMatchObject({ realization: 'boltThrough', maturity: 'engineered' });
    expect(elOf(next, 'L1')).not.toHaveProperty('realization');
    const cleared = assignRealization(next, 'm1', ['P1'], undefined);
    expect(elOf(cleared, 'P1')).toMatchObject({ realization: undefined, maturity: 'sketch' });
  });
});

describe('assignNodeRealization', () => {
  it('materializes a free-pin pivot for an implicit joint, then removes it on clear', () => {
    // n2 joins two links with no explicit pivot element — an implicit free pin
    const doc = project(
      mech(
        [link('L1', { nodeB: 'n2' }), link('L2', { nodeA: 'n2', nodeB: 'n3' })],
        [node('n1', 0, 0), node('n2', 1, 0), node('n3', 2, 0)],
      ),
    );
    expect(doc.mechanisms[0]!.elements.some((e) => e.type === 'pivot')).toBe(false);
    const next = assignNodeRealization(doc, 'm1', 'n2', 'fitting');
    const created = next.mechanisms[0]!.elements.find((e) => e.type === 'pivot');
    expect(created).toMatchObject({
      nodeId: 'n2',
      realization: 'fitting',
      maturity: 'engineered',
      welds: [],
      memberIds: ['L1', 'L2'],
    });
    const cleared = assignNodeRealization(next, 'm1', 'n2', undefined);
    expect(cleared.mechanisms[0]!.elements.some((e) => e.type === 'pivot')).toBe(false);
  });

  it('updates an existing joint element in place and keeps welded pins on clear', () => {
    const welded: PivotElement = { ...pivot('P1'), welds: [['e1', 'e2']] };
    const doc = project(mech([welded], [node('n1', 0, 0), node('n2', 1, 0)]));
    const next = assignNodeRealization(doc, 'm1', 'n1', 'boltThrough');
    expect(elOf(next, 'P1')).toMatchObject({ realization: 'boltThrough', maturity: 'engineered' });
    // a welded pin is not bare, so clearing keeps the element (drops maturity)
    const cleared = assignNodeRealization(next, 'm1', 'n1', undefined);
    expect(elOf(cleared, 'P1')).toMatchObject({ realization: undefined, maturity: 'sketch' });
  });

  it('is a no-op on a node with fewer than two members', () => {
    const doc = project(mech([link('L1')], [node('n1', 0, 0), node('n2', 1, 0)]));
    const next = assignNodeRealization(doc, 'm1', 'n2', 'fitting');
    expect(next.mechanisms[0]!.elements.some((e) => e.type === 'pivot')).toBe(false);
  });
});

describe('assignEndRealization', () => {
  it('sets a link end realization without affecting maturity (ends are optional)', () => {
    const doc = project(mech([link('L1')], [node('n1', 0, 0), node('n2', 1, 0)]));
    const next = assignEndRealization(doc, 'm1', 'L1', 'A', 'heatWrapPivot');
    expect(elOf(next, 'L1')).toMatchObject({
      endRealizationA: 'heatWrapPivot',
      maturity: 'sketch',
    });
    const b = assignEndRealization(next, 'm1', 'L1', 'B', 'fitting');
    expect(elOf(b, 'L1')).toMatchObject({ endRealizationB: 'fitting' });
  });
});

describe('assignCordageMaterial', () => {
  it('assigns to cordage elements, flips maturity, and adopts an elastic stiffness preset', () => {
    const doc = project(
      mech([rope('R1'), elastic('E1'), link('L1')], [node('n1', 0, 0), node('n2', 1, 0)]),
    );
    const next = assignCordageMaterial(doc, 'm1', ['R1', 'E1', 'L1'], 'bungee');
    expect(elOf(next, 'R1')).toMatchObject({ cordageMaterialId: 'bungee', maturity: 'engineered' });
    // the bungee preset carries defaultStiffnessNPerM 300 (§4.2 presets)
    expect(elOf(next, 'E1')).toMatchObject({ cordageMaterialId: 'bungee', stiffnessNPerM: 300 });
    expect(elOf(next, 'L1')).not.toHaveProperty('cordageMaterialId');
  });

  it('assigning a cordage without a stiffness preset keeps the elastic k', () => {
    const doc = project(mech([elastic('E1')], [node('n1', 0, 0), node('n2', 1, 0)]));
    const next = assignCordageMaterial(doc, 'm1', ['E1'], 'rope');
    expect(elOf(next, 'E1')).toMatchObject({ cordageMaterialId: 'rope', stiffnessNPerM: 200 });
  });
});

describe('setLinkLength', () => {
  it('keeps endpoint A fixed and moves B along the current direction', () => {
    const doc = project(mech([link('L1')], [node('n1', 1, 1), node('n2', 4, 5)])); // length 5
    const next = setLinkLength(doc, 'm1', 'L1', 10);
    expect(nodeOf(next, 'n1').position).toEqual({ x: 1, y: 1 });
    const b = nodeOf(next, 'n2').position;
    expect(b.x).toBeCloseTo(7, 9);
    expect(b.y).toBeCloseTo(9, 9);
  });

  it('degenerate zero-length links extend along +x; non-positive lengths are ignored', () => {
    const doc = project(mech([link('L1')], [node('n1', 2, 3), node('n2', 2, 3)]));
    const next = setLinkLength(doc, 'm1', 'L1', 2);
    expect(nodeOf(next, 'n2').position).toEqual({ x: 4, y: 3 });
    expect(setLinkLength(doc, 'm1', 'L1', 0)).toBe(doc);
    expect(setLinkLength(doc, 'm1', 'L1', -1)).toBe(doc);
  });

  it('telescopes clamp to [min, max] and update the length parameter too', () => {
    const doc = project(mech([telescope('T1')], [node('n1', 0, 0), node('n2', 2, 0)]));
    const next = setLinkLength(doc, 'm1', 'T1', 99);
    expect(elOf(next, 'T1')).toMatchObject({ lengthM: 3 }); // clamped to maxLengthM
    expect(nodeOf(next, 'n2').position).toEqual({ x: 3, y: 0 });
    const low = setLinkLength(doc, 'm1', 'T1', 0.1);
    expect(elOf(low, 'T1')).toMatchObject({ lengthM: 0.5 });
  });
});

describe('patchElement', () => {
  it('patches behavior parameters of a matching-type element', () => {
    const doc = project(mech([rope('R1')], [node('n1', 0, 0), node('n2', 1, 0)]));
    const next = patchElement(doc, 'm1', 'R1', 'rope', { lengthM: 2.5 });
    expect(elOf(next, 'R1')).toMatchObject({ lengthM: 2.5 });
  });

  it('is a no-op when the element type does not match', () => {
    const doc = project(mech([rope('R1')], [node('n1', 0, 0), node('n2', 1, 0)]));
    const next = patchElement(doc, 'm1', 'R1', 'elastic', { restLengthM: 9 });
    expect(elOf(next, 'R1')).toMatchObject({ lengthM: 1 });
    expect(elOf(next, 'R1')).not.toHaveProperty('restLengthM');
  });
});
