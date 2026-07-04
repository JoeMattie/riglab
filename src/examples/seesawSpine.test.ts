import { describe, expect, it } from 'vitest';
import { computeBom } from '../bom';
import type { JointRealization, Mechanism } from '../schema';
import { buildSeesawSpineProject, loadSeesawSpine } from '.';

const HEATWRAP = new Set<JointRealization>(['heatWrapPivot', 'heatWrapRigid']);
const NESTED = new Set<JointRealization>(['nestedSleeve', 'nestedCoupler', 'clickDetachable']);

describe('bundled seesaw-spine example', () => {
  it('the JSON artifact validates and matches the builder (no drift)', () => {
    const loaded = loadSeesawSpine();
    expect(loaded).toEqual(buildSeesawSpineProject());
    expect(loaded.schemaVersion).toBe(3);
  });

  it('is a dimensionally plausible elevation truss with tagged pipes and masses', () => {
    const mech = loadSeesawSpine().mechanisms[0]!;
    expect(mech.viewOrientation).toBe('side-left');
    expect(mech.gravityOn).toBe(true);
    const tags = new Set(
      mech.elements.map((e) => ('subsystemTag' in e ? e.subsystemTag : undefined)),
    );
    expect(tags).toEqual(new Set(['neck', 'spine', 'tail']));
    expect(mech.pointMasses.map((m) => m.name).sort()).toEqual(['head', 'tail']);
    // no creature-specific language leaks into identifiers/strings
    const blob = JSON.stringify(mech).toLowerCase();
    expect(blob.includes('raptor')).toBe(false);
  });
});

/** Independently computed expected cut-list total, reimplementing the §6.2
 * allowance arithmetic from the example's geometry + realizations + material
 * numbers — NOT by calling computeBom. All structural pipes share one material,
 * so a heat-wrap end's partner OD equals the pipe's own OD. */
describe('ACCEPTANCE Phase 3 (§11) — seesaw-spine cut list', () => {
  const project = loadSeesawSpine();
  const mech: Mechanism = project.mechanisms[0]!;
  const pipe = project.materials.pipes.find((p) => p.id === 'pipe-nps-sch40-075')!;
  const coupling = project.materials.fittings.find(
    (f) => f.sizingSystem === 'NPS' && f.nominalSize === '3/4' && f.type === 'coupling',
  )!;
  const factor = project.bomSettings.heatWrapAllowanceFactor;
  const posOf = new Map(mech.nodes.map((n) => [n.id, n.position]));

  const endAllowance = (r: JointRealization | undefined): number => {
    if (!r) return 0;
    if (HEATWRAP.has(r)) return factor * pipe.outerDiameterM;
    if (r === 'fitting') return -coupling.socketDepthM;
    if (NESTED.has(r)) return 2 * pipe.outerDiameterM;
    return 0; // boltThrough / ropeLashing / conduitBox
  };

  it('total structural pipe length equals Σ(link lengths ± allowances) exactly', () => {
    let expected = 0;
    let heatwrapEnds = 0;
    for (const el of mech.elements) {
      if (el.type !== 'link') continue;
      const a = posOf.get(el.nodeA)!;
      const b = posOf.get(el.nodeB)!;
      const base = Math.hypot(a.x - b.x, a.y - b.y);
      expected += Math.max(
        0,
        base + endAllowance(el.endRealizationA) + endAllowance(el.endRealizationB),
      );
      if (el.endRealizationA && HEATWRAP.has(el.endRealizationA)) heatwrapEnds++;
      if (el.endRealizationB && HEATWRAP.has(el.endRealizationB)) heatwrapEnds++;
    }

    const bom = computeBom(mech ? [mech] : [], project.materials, project.bomSettings);
    const actual = bom.cutList
      .filter((p) => p.kind === 'pipe')
      .reduce((sum, p) => sum + p.lengthM * p.quantity, 0);
    expect(actual).toBeCloseTo(expected, 9);

    // heat-wrap connectors are separate short parts (§1): one per heat-wrap end
    const connectors = bom.cutList.filter((p) => p.kind === 'heatWrapConnector');
    const connectorQty = connectors.reduce((s, p) => s + p.quantity, 0);
    expect(connectorQty).toBe(heatwrapEnds);
    for (const c of connectors) expect(c.lengthM).toBeCloseTo(0.1, 9);
  });

  it('reports the four coupling fittings and no unresolved / missing-fitting issues', () => {
    const bom = computeBom([mech], project.materials, project.bomSettings);
    const couplings = bom.fittings.find((f) => f.type === 'coupling' && f.nominalSize === '3/4');
    expect(couplings?.quantity).toBe(4);
    expect(couplings?.resolved).toBe(true);
    expect(bom.unresolved.count).toBe(0);
    expect(bom.warnings).toHaveLength(0);
    expect(bom.techniqueSummary.bends).toBe(0); // no bentLinks in this example
  });

  it('changing a pipe size updates the weight rollup by the analytic delta', () => {
    const before = computeBom([mech], project.materials, project.bomSettings);

    // vertNeck has bolt-through ends (no heat-wrap connectors), so swapping its
    // material changes only its own pipe mass: Δ = length × (new − old) density.
    const swapped = structuredClone(project);
    const vn = swapped.mechanisms[0]!.elements.find((e) => e.id === 'vertNeck')!;
    if (vn.type !== 'link') throw new Error('vertNeck must be a link');
    vn.pipeMaterialId = 'pipe-nps-sch40-100';
    const after = computeBom(swapped.mechanisms, swapped.materials, swapped.bomSettings);

    const a = posOf.get('tNeck')!;
    const b = posOf.get('bNeck')!;
    const geomLen = Math.hypot(a.x - b.x, a.y - b.y); // 0.10 m
    const d075 = project.materials.pipes.find((p) => p.id === 'pipe-nps-sch40-075')!;
    const d100 = project.materials.pipes.find((p) => p.id === 'pipe-nps-sch40-100')!;
    const expectedDelta = geomLen * (d100.linearDensityKgPerM - d075.linearDensityKgPerM);

    expect(after.weights.grandTotalKg - before.weights.grandTotalKg).toBeCloseTo(expectedDelta, 9);
  });
});
