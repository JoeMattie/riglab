import { describe, expect, it } from 'vitest';
import { fixtureProject } from '../../schema/fixtures';
import type { SolveResult } from '../../solver';
import {
  carriesForceLabel,
  forceLabelAnchor,
  forceLabelElementIds,
  formatForce,
  N_PER_LBF,
  pickRenderPositions,
  readEquilibrium,
  solverStatusLabel,
  toLbf,
} from './forces';

const mockResult = (over?: Partial<SolveResult>): SolveResult => ({
  positions: {},
  forces: { elements: {}, pivotReactions: {}, requiredInputs: {} },
  diagnostics: {
    dof: 1,
    classification: 'mechanism',
    converged: true,
    residual: 0,
    violated: [],
    ropesRequiringCompression: [],
  },
  ...over,
});

describe('force formatting', () => {
  it('reports newtons in metric, newtons + lbf in imperial', () => {
    expect(formatForce(N_PER_LBF, 'metric')).toBe('4.4 N');
    expect(formatForce(N_PER_LBF, 'imperial')).toBe('4.4 N (1.0 lbf)');
  });
  it('converts newtons to lbf', () => {
    expect(toLbf(N_PER_LBF)).toBeCloseTo(1, 6);
    expect(toLbf(2 * N_PER_LBF)).toBeCloseTo(2, 6);
  });
});

describe('which elements get force labels', () => {
  const mech = fixtureProject().mechanisms[0]!;
  it('labels rope/elastic/bowden only', () => {
    expect(forceLabelElementIds(mech).sort()).toEqual(['e-bowden', 'e-elastic', 'e-rope']);
    const rope = mech.elements.find((e) => e.id === 'e-rope')!;
    const link = mech.elements.find((e) => e.id === 'e-link')!;
    expect(carriesForceLabel(rope)).toBe(true);
    expect(carriesForceLabel(link)).toBe(false);
  });
  it('anchors an elastic label at the segment midpoint', () => {
    const elastic = mech.elements.find((e) => e.id === 'e-elastic')!;
    const pos = (id: string) => mech.nodes.find((n) => n.id === id)?.position;
    // e-elastic spans n7 (3,1) and n4 (1.5,0.1)
    expect(forceLabelAnchor(elastic, pos)).toEqual({ x: 2.25, y: 0.55 });
  });
});

describe('readEquilibrium (mocked solver)', () => {
  it('maps a converged result into the overlay readout', () => {
    const readout = readEquilibrium(() =>
      mockResult({
        forces: {
          elements: { 'e-rope': 12.5 },
          pivotReactions: {},
          requiredInputs: { 'steer.pitch': 3.2 },
        },
      }),
    );
    expect(readout.status).toBe('converged');
    expect(readout.elementForces['e-rope']).toBe(12.5);
    expect(readout.requiredInputs['steer.pitch']).toBe(3.2);
  });

  it('flags a non-converged result and surfaces ropes that require compression', () => {
    const readout = readEquilibrium(() =>
      mockResult({
        diagnostics: {
          dof: 1,
          classification: 'mechanism',
          converged: false,
          residual: 0.4,
          violated: ['e-rope'],
          ropesRequiringCompression: ['e-rope'],
        },
      }),
    );
    expect(readout.status).toBe('nonConverged');
    expect(readout.ropesRequiringCompression).toEqual(['e-rope']);
  });

  it('carries the settled pose through so the canvas can render the sag', () => {
    const settled = { n1: { x: 0, y: -0.3 }, n2: { x: 1, y: 0 } };
    const readout = readEquilibrium(() => mockResult({ positions: settled }));
    expect(readout.positions).toEqual(settled);
  });

  it('degrades to unavailable when the solver throws (equilibrium not yet implemented)', () => {
    const readout = readEquilibrium(() => {
      throw new Error('equilibrium mode lands in Phase 2');
    });
    expect(readout.status).toBe('unavailable');
    expect(readout.elementForces).toEqual({});
    expect(readout.ropesRequiringCompression).toEqual([]);
    expect(readout.positions).toBeNull();
  });
});

describe('pickRenderPositions (which pose the canvas draws)', () => {
  const doc = { n1: { x: 0, y: 0 }, n2: { x: 1, y: 0 } };
  const settled = { n1: { x: 0, y: -0.3 } };
  const dragPose = { n1: { x: 0.5, y: 0.5 } };

  it('renders the settled equilibrium pose when the forces overlay is on', () => {
    const out = pickRenderPositions({
      docPositions: doc,
      posePositions: null,
      settledPositions: settled,
      dragging: false,
    });
    expect(out.n1).toEqual({ x: 0, y: -0.3 });
    // nodes missing from the settled solve (added since) fall back to drawn geometry
    expect(out.n2).toEqual({ x: 1, y: 0 });
  });

  it('prefers the live drag pose over a stale settled pose during a gesture', () => {
    const out = pickRenderPositions({
      docPositions: doc,
      posePositions: dragPose,
      settledPositions: settled,
      dragging: true,
    });
    expect(out.n1).toEqual({ x: 0.5, y: 0.5 });
  });

  it('falls back to playback pose, then drawn geometry, when no settled pose exists', () => {
    expect(
      pickRenderPositions({
        docPositions: doc,
        posePositions: dragPose,
        settledPositions: null,
        dragging: false,
      }).n1,
    ).toEqual({ x: 0.5, y: 0.5 });
    expect(
      pickRenderPositions({
        docPositions: doc,
        posePositions: null,
        settledPositions: null,
        dragging: false,
      }),
    ).toEqual(doc);
  });
});

describe('solver status labels', () => {
  it('names every status', () => {
    expect(solverStatusLabel('converged')).toBe('converged');
    expect(solverStatusLabel('settling')).toBe('settling…');
    expect(solverStatusLabel('nonConverged')).toBe('non-converged');
    expect(solverStatusLabel('unavailable')).toBe('solver unavailable');
    expect(solverStatusLabel('idle')).toBe('off');
  });
});
