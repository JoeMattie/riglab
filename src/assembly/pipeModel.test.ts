import { describe, expect, it } from 'vitest';
import type { MaterialsDb, Mechanism, Vec3 } from '../schema';
import { dot, sub } from './math3';
import { buildPipeModel, classifyFitting, GENERIC_PIPE_OD_M, type PipeCylinder } from './pipeModel';

const V = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

const materials = {
  pipes: [
    {
      id: 'pvc34',
      name: 'PVC 3/4"',
      sizingSystem: 'NPS',
      nominalSize: '3/4',
      outerDiameterM: 0.0267,
      innerDiameterM: 0.0205,
      linearDensityKgPerM: 0.32,
      approximate: false,
    },
    {
      id: 'pvc12',
      name: 'PVC 1/2"',
      sizingSystem: 'NPS',
      nominalSize: '1/2',
      outerDiameterM: 0.0213,
      innerDiameterM: 0.0158,
      linearDensityKgPerM: 0.24,
      approximate: false,
    },
  ],
  fittings: [
    {
      id: 'f-coupling',
      type: 'coupling',
      sizingSystem: 'NPS',
      nominalSize: '3/4',
      massKg: 0.02,
      socketDepthM: 0.025,
      approximate: false,
    },
    {
      id: 'f-tee',
      type: 'tee',
      sizingSystem: 'NPS',
      nominalSize: '3/4',
      massKg: 0.05,
      socketDepthM: 0.03,
      approximate: false,
    },
  ],
  cordage: [],
  sheets: [],
  hardware: [],
} as unknown as MaterialsDb;

/** Minimal mechanism wrapper — only the fields buildPipeModel touches. */
const mech = (elements: unknown[]): Mechanism =>
  ({
    id: 'm1',
    name: 'm',
    elements,
  }) as never;

const link = (id: string, a: string, b: string, engineered = true, matId = 'pvc34') => ({
  id,
  type: 'link',
  maturity: engineered ? 'engineered' : 'sketch',
  nodeA: a,
  nodeB: b,
  pipeMaterialId: engineered ? matId : undefined,
  pointMasses: [],
});

const pivot = (id: string, nodeId: string, memberIds: string[], realization?: string) => ({
  id,
  type: 'pivot',
  maturity: 'engineered',
  nodeId,
  memberIds,
  welds: [],
  realization,
});

const cyls = (model: ReturnType<typeof buildPipeModel>, role: string): PipeCylinder[] =>
  model.prims.filter((p): p is PipeCylinder => p.kind === 'cylinder' && p.role === role);

describe('classifyFitting', () => {
  it('classifies by member count and angle', () => {
    const straight = [V(1, 0, 0), V(-1, 0, 0)];
    const ell = [V(1, 0, 0), V(0, 1, 0)];
    const fortyFive = [V(1, 0, 0), V(-Math.SQRT1_2, Math.SQRT1_2, 0)];
    expect(classifyFitting(straight)).toBe('coupling');
    expect(classifyFitting(ell)).toBe('elbow90');
    expect(classifyFitting(fortyFive)).toBe('elbow45');
    expect(classifyFitting([V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0)])).toBe('tee');
    expect(classifyFitting([V(1, 0, 0), V(-1, 0, 0), V(0, 1, 0), V(0, -1, 0)])).toBe('cross');
    expect(classifyFitting([V(1, 0, 0)])).toBe('cap');
  });
});

describe('buildPipeModel', () => {
  const world = { a: V(0, 0, 0), b: V(1, 0, 0), c: V(2, 0, 0), d: V(1, 1, 0) };
  const item = { mechanismId: 'm1', nodeWorld: world };

  it('engineered links become true-OD pipe; sketch links become ghosts', () => {
    const m = mech([link('l1', 'a', 'b'), link('l2', 'b', 'c', false)]);
    const model = buildPipeModel([m], [item], materials);
    const pipes = cyls(model, 'pipe');
    expect(pipes).toHaveLength(2);
    expect(pipes[0]).toMatchObject({ radiusM: 0.0267 / 2, ghost: false });
    expect(pipes[1]).toMatchObject({ radiusM: GENERIC_PIPE_OD_M / 2, ghost: true });
    expect(model.pipeCount).toBe(2);
    expect(model.ghostCount).toBeGreaterThan(0);
  });

  it('a fitting-realized joint grows one socket per member, sized by the DB', () => {
    const m = mech([
      link('l1', 'a', 'b'),
      link('l2', 'b', 'c'),
      pivot('p1', 'b', ['l1', 'l2'], 'fitting'),
    ]);
    const model = buildPipeModel([m], [item], materials);
    const sockets = cyls(model, 'fitting');
    expect(sockets).toHaveLength(2);
    expect(model.fittingCount).toBe(1);
    // collinear members → coupling; socket length = socketDepth × 1.6
    for (const s of sockets) {
      const len = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z);
      expect(len).toBeCloseTo(0.025 * 1.6, 6);
      expect(s.radiusM).toBeCloseTo((0.0267 / 2) * 1.3, 6);
    }
  });

  it('a three-member fitting joint classifies as a tee (its socket depth)', () => {
    const m = mech([
      link('l1', 'a', 'b'),
      link('l2', 'b', 'c'),
      link('l3', 'b', 'd'),
      pivot('p1', 'b', ['l1', 'l2', 'l3'], 'fitting'),
    ]);
    const model = buildPipeModel([m], [item], materials);
    const sockets = cyls(model, 'fitting');
    expect(sockets).toHaveLength(3);
    const len = Math.hypot(
      sockets[0]!.b.x - sockets[0]!.a.x,
      sockets[0]!.b.y - sockets[0]!.a.y,
      sockets[0]!.b.z - sockets[0]!.a.z,
    );
    expect(len).toBeCloseTo(0.03 * 1.6, 6); // tee socket, not coupling
  });

  it('boltThrough renders a thin pin perpendicular to the members', () => {
    const m = mech([
      link('l1', 'a', 'b'),
      link('l2', 'b', 'd'),
      pivot('p1', 'b', ['l1', 'l2'], 'boltThrough'),
    ]);
    const model = buildPipeModel([m], [item], materials);
    const pin = cyls(model, 'pin')[0]!;
    const axis = sub(pin.b, pin.a);
    expect(Math.abs(dot(axis, V(1, 0, 0)))).toBeLessThan(1e-9); // ⊥ l1 (a→b is +x)
    expect(pin.radiusM).toBeLessThan(0.01);
  });

  it('an engineered telescope renders coaxial outer and inner pipes', () => {
    const m = mech([
      {
        id: 't1',
        type: 'telescope',
        maturity: 'engineered',
        nodeA: 'a',
        nodeB: 'c',
        minLengthM: 1,
        maxLengthM: 3,
        lengthM: 2,
        sliding: false,
        outerPipeMaterialId: 'pvc34',
        innerPipeMaterialId: 'pvc12',
        overlapM: 0.2,
        pointMasses: [],
      },
    ]);
    const model = buildPipeModel([m], [item], materials);
    const pipes = cyls(model, 'pipe');
    expect(pipes).toHaveLength(2);
    const radii = pipes.map((p) => p.radiusM).sort((x, y) => x - y);
    expect(radii[0]).toBeCloseTo(0.0213 / 2, 6);
    expect(radii[1]).toBeCloseTo(0.0267 / 2, 6);
    // each member reaches L/2 + overlap/2 = 1.1 of the 2 m span
    for (const p of pipes) {
      const len = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y, p.b.z - p.a.z);
      expect(len).toBeCloseTo(1.1, 6);
    }
  });

  it('tube junctions without a joint element get a blob sphere', () => {
    const m = mech([link('l1', 'a', 'b'), link('l2', 'b', 'c')]);
    const model = buildPipeModel([m], [item], materials);
    const spheres = model.prims.filter((p) => p.kind === 'sphere');
    expect(spheres).toHaveLength(1);
  });

  it('ghost items mark every primitive as ghost', () => {
    const m = mech([link('l1', 'a', 'b')]);
    const model = buildPipeModel([m], [{ ...item, ghost: true }], materials);
    expect(model.prims.every((p) => p.ghost)).toBe(true);
  });
});
