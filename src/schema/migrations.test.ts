import { describe, expect, it } from 'vitest';
import {
  fixtureProject,
  fixtureProjectV1,
  fixtureProjectV2,
  fixtureProjectV3,
  fixtureProjectV4,
  fixtureProjectV5,
  fixtureProjectV6,
} from './fixtures';
import { emptyMaterialsDb } from './materials';
import type { PivotElement } from './mechanism';
import {
  applyMigrations,
  type Migration,
  MigrationError,
  migrateToLatest,
  migrations,
} from './migrations';
import { type Project, SCHEMA_VERSION } from './project';

describe('migration registry', () => {
  it('has a migration for every version between 1 and current', () => {
    for (let v = 1; v < SCHEMA_VERSION; v++) {
      expect(migrations[v], `missing migration from v${v}`).toBeTypeOf('function');
    }
  });
});

describe('applyMigrations pipeline (synthetic registry)', () => {
  const registry: Record<number, Migration> = {
    5: (doc) => ({ ...doc, addedInV6: true }),
    6: (doc) => ({ ...doc, addedInV7: 'yes' }),
  };

  it('chains migrations and stamps intermediate versions', () => {
    const out = applyMigrations({ schemaVersion: 5, name: 'x' }, 5, 7, registry);
    expect(out).toEqual({ schemaVersion: 7, name: 'x', addedInV6: true, addedInV7: 'yes' });
  });

  it('throws a MigrationError when a step is missing', () => {
    expect(() => applyMigrations({ schemaVersion: 4 }, 4, 7, registry)).toThrow(MigrationError);
  });
});

describe('v1 → latest migration chain', () => {
  it('upgrades a Phase 0 document through every step and validates as v7', () => {
    const migrated = migrateToLatest(fixtureProjectV1());
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.wearer).toEqual({ heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 });
    expect(migrated.bomSettings).toEqual({ heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 });
    expect(migrated.controls).toEqual([]);
    // the two assembly instances of mech-1 became suffixed copies + groups
    expect(migrated.groups.map((g) => g.id)).toEqual(['inst-1', 'inst-2']);
    expect(migrated.mechanism.nodes.some((n) => n.id === 'n2@inst-1')).toBe(true);
    expect(migrated.mechanism.nodes.some((n) => n.id === 'n2@inst-2')).toBe(true);
    // v1 dropped skeleton/anchor bindings; the assembly wearer-anchor binding
    // still becomes an anchorBindings entry
    expect(migrated.mechanism.anchorBindings).toEqual([
      { id: 'bind-1', anchor: 'hipRectFrontL', nodeId: 'n1@inst-1' },
    ]);
  });
});

describe('v2 → v3 migration', () => {
  it('adds default bomSettings to a v2 document, leaving the rest intact', () => {
    const migrated = migrateToLatest(fixtureProjectV2());
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.bomSettings).toEqual({ heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 });
    expect(migrated.wearer).toEqual({ heightM: 1.8, shoulderWidthM: 0.48, hipWidthM: 0.37 });
    expect(migrated.mechanism.skeletonBindings.map((b) => b.id)).toEqual([
      'sb-1@inst-1',
      'sb-1@inst-2',
    ]);
  });
});

describe('v3 → v4 migration', () => {
  it('re-stamps a v3 document unchanged (lengthLocked is optional)', () => {
    expect(migrateToLatest(fixtureProjectV3())).toEqual(migrateToLatest(fixtureProjectV6()));
  });
});

describe('v4 → v5 migration', () => {
  it('adds empty controls + controlClips arrays (§4.4)', () => {
    const v4 = fixtureProjectV4();
    expect(v4.controls).toBeUndefined();
    const migrated = migrateToLatest(v4);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.controls).toEqual([]);
    expect(migrated.controlClips).toEqual([]);
    expect(migrated).toEqual(migrateToLatest(fixtureProjectV6()));
  });
});

describe('v5 → v6 migration', () => {
  it('adds an empty anchorBindings array to each mechanism', () => {
    const v5 = fixtureProjectV5();
    expect((v5.mechanisms as Array<Record<string, unknown>>)[0]!.anchorBindings).toBeUndefined();
    const migrated = migrateToLatest(v5);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    // no mechanism-level anchor bindings, so only the assembly-binding one
    expect(migrated.mechanism.anchorBindings).toEqual([
      { id: 'bind-1', anchor: 'hipRectFrontL', nodeId: 'n1@inst-1' },
    ]);
    expect(migrated.mechanism.skeletonBindings.map((b) => b.id)).toEqual([
      'sb-1@inst-1',
      'sb-1@inst-2',
    ]);
  });
});

// ---------------------------------------------------------------------------
// v6 → v7 (fully-3D single compound mechanism)
// ---------------------------------------------------------------------------

function baseV6(over: {
  mechanisms: unknown[];
  assembly?: Record<string, unknown>;
  controls?: unknown[];
}): Record<string, unknown> {
  return {
    schemaVersion: 6,
    id: 'proj',
    name: 'Proj',
    unitsPreference: 'metric',
    materials: emptyMaterialsDb(),
    mechanisms: over.mechanisms,
    assembly: {
      instances: [],
      bindings: [],
      pointMasses: [],
      foamPlates: [],
      ...(over.assembly ?? {}),
    },
    controls: over.controls ?? [],
    controlClips: [],
    wearer: { heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 },
    wearerAnchorOverrides: {},
    bomSettings: { heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 },
  };
}

function v6Mech(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: id,
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes: [],
    elements: [],
    pointMasses: [],
    skeletonBindings: [],
    anchorBindings: [],
    inputs: [],
    namedStates: [],
    ...extra,
  };
}

/** Two links joined by a pivot at n2 — the minimal hinged linkage. */
function v6LinkageMech(id: string): Record<string, unknown> {
  return v6Mech(id, {
    nodes: [
      { id: 'n1', kind: 'anchor', position: { x: 0, y: 0 } },
      { id: 'n2', kind: 'free', position: { x: 1, y: 0 } },
      { id: 'n3', kind: 'free', position: { x: 1, y: 1 } },
    ],
    elements: [
      { id: 'e1', type: 'link', maturity: 'sketch', nodeA: 'n1', nodeB: 'n2', pointMasses: [] },
      { id: 'e2', type: 'link', maturity: 'sketch', nodeA: 'n2', nodeB: 'n3', pointMasses: [] },
      {
        id: 'p1',
        type: 'pivot',
        maturity: 'sketch',
        nodeId: 'n2',
        memberIds: ['e1', 'e2'],
        welds: [],
      },
    ],
    namedStates: [{ name: 'rest', positions: { n2: { x: 1, y: 0 } }, channelValues: {} }],
  });
}

function v6Inst(
  id: string,
  mechanismId: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    name: id,
    mechanismId,
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
    mirror: false,
    transformDrive: { kind: 'fixed' },
    ...extra,
  };
}

function pivots(p: Project): PivotElement[] {
  return p.mechanism.elements.filter((e): e is PivotElement => e.type === 'pivot');
}

function hingeAxis(pivot: PivotElement): { x: number; y: number; z: number } {
  if (pivot.joint.kind !== 'hinge') throw new Error('expected a hinge joint');
  return pivot.joint.axis;
}

describe('v6 → v7 migration', () => {
  it('migrates the full fixture chain 1→latest into a valid compound project', () => {
    // migrateToLatest validates against projectSchema and throws on failure
    const migrated = migrateToLatest(fixtureProjectV1());
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.mechanism.id).toBe('fixture-project-mechanism');
    expect(migrated.mechanism.name).toBe('Fixture');
    // instance-node attachment binding unified n1@inst-2 into n7@inst-1
    expect(migrated.mechanism.nodes.some((n) => n.id === 'n1@inst-2')).toBe(false);
    const link2 = migrated.mechanism.elements.find((e) => e.id === 'e-link@inst-2');
    if (link2?.type !== 'link') throw new Error('missing lifted link');
    expect(link2.nodeA).toBe('n7@inst-1');
    // suffixed named states, one per instance
    expect(migrated.mechanism.namedStates.map((s) => s.name)).toEqual([
      'rest — left instance',
      'rest — right instance',
    ]);
    // the statically baked instanceNodes drive is flagged on its group
    expect(migrated.groups.find((g) => g.id === 'inst-2')?.note).toBe(
      "re-joint needed: this plane was driven by another mechanism's nodes (static bake)",
    );
    expect(migrated.groups.find((g) => g.id === 'inst-1')?.note).toBeUndefined();
    // assembly masses landed at project level
    expect(migrated.pointMasses).toEqual([
      {
        id: 'mass-1',
        name: 'battery',
        massKg: 1.4,
        attach: { kind: 'wearerAnchor', anchor: 'beltBack' },
      },
    ]);
    expect(migrated.foamPlates[0]!.attach).toEqual({ kind: 'node', nodeId: 'n3@inst-1' });
  });

  it('rotates hinge axes with the instance: pivots get the rotated plane normal', () => {
    // 90° about +x: local plane normal +z → world −y; local (1,1) → (1,0,1)
    const doc = baseV6({
      mechanisms: [v6LinkageMech('m1')],
      assembly: {
        instances: [
          v6Inst('i1', 'm1', {
            quaternion: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 },
          }),
        ],
      },
    });
    const out = migrateToLatest(doc);
    const axis = hingeAxis(pivots(out)[0]!);
    expect(axis.x).toBeCloseTo(0, 12);
    expect(axis.y).toBeCloseTo(-1, 12);
    expect(axis.z).toBeCloseTo(0, 12);
    const n3 = out.mechanism.nodes.find((n) => n.id === 'n3')!;
    expect(n3.position.x).toBeCloseTo(1, 12);
    expect(n3.position.y).toBeCloseTo(0, 12);
    expect(n3.position.z).toBeCloseTo(1, 12);
  });

  it('duplicates a twice-instanced mechanism with suffixed ids, mirrored x, flipped hinge axis', () => {
    const doc = baseV6({
      mechanisms: [v6LinkageMech('m1')],
      assembly: {
        instances: [v6Inst('iA', 'm1'), v6Inst('iB', 'm1', { mirror: true })],
      },
    });
    const out = migrateToLatest(doc);
    expect(out.mechanism.nodes.map((n) => n.id)).toEqual([
      'n1@iA',
      'n2@iA',
      'n3@iA',
      'n1@iB',
      'n2@iB',
      'n3@iB',
    ]);
    const n2A = out.mechanism.nodes.find((n) => n.id === 'n2@iA')!;
    const n2B = out.mechanism.nodes.find((n) => n.id === 'n2@iB')!;
    expect(n2A.position.x).toBeCloseTo(1, 12);
    expect(n2B.position.x).toBeCloseTo(-1, 12);
    const [pivotA, pivotB] = pivots(out);
    expect(pivotA!.id).toBe('p1@iA');
    expect(pivotB!.id).toBe('p1@iB');
    expect(pivotB!.nodeId).toBe('n2@iB');
    expect(pivotB!.memberIds).toEqual(['e1@iB', 'e2@iB']);
    expect(hingeAxis(pivotA!).z).toBeCloseTo(1, 12);
    expect(hingeAxis(pivotB!).z).toBeCloseTo(-1, 12);
    // named states are lifted per copy and disambiguated by instance name
    expect(out.mechanism.namedStates.map((s) => s.name)).toEqual(['rest — iA', 'rest — iB']);
    expect(out.mechanism.namedStates[1]!.positions['n2@iB']!.x).toBeCloseTo(-1, 12);
    expect(out.groups.map((g) => g.id)).toEqual(['iA', 'iB']);
  });

  it('dedupes channels by name (first wins) and remaps node.channelId + state values', () => {
    const channel = (id: string) => ({
      id,
      name: 'steer',
      kind: 'angle',
      min: -1,
      max: 1,
      value: 0,
      locked: false,
    });
    const doc = baseV6({
      mechanisms: [
        v6Mech('m1', { inputs: [channel('c1')] }),
        v6Mech('m2', {
          inputs: [channel('c9')],
          nodes: [{ id: 'd1', kind: 'driven', position: { x: 0, y: 0 }, channelId: 'c9' }],
          namedStates: [{ name: 's', positions: {}, channelValues: { c9: 0.5 } }],
        }),
      ],
    });
    const out = migrateToLatest(doc);
    expect(out.mechanism.inputs).toHaveLength(1);
    expect(out.mechanism.inputs[0]!.id).toBe('c1');
    expect(out.mechanism.nodes.find((n) => n.id === 'd1')!.channelId).toBe('c1');
    expect(out.mechanism.namedStates[0]!.channelValues).toEqual({ c1: 0.5 });
  });

  it('unifies instance-node attachment bindings: the anchor node dissolves everywhere', () => {
    const m2 = v6Mech('m2', {
      nodes: [
        { id: 'a1', kind: 'anchor', position: { x: 0, y: 0 } },
        { id: 'b1', kind: 'free', position: { x: 1, y: 0 } },
      ],
      elements: [
        { id: 'e9', type: 'link', maturity: 'sketch', nodeA: 'a1', nodeB: 'b1', pointMasses: [] },
      ],
      pointMasses: [{ id: 'pm9', name: 'weight', massKg: 1, nodeId: 'a1' }],
      namedStates: [{ name: 's', positions: { a1: { x: 0, y: 0 } }, channelValues: {} }],
    });
    const doc = baseV6({
      mechanisms: [v6LinkageMech('m1'), m2],
      assembly: {
        instances: [v6Inst('i1', 'm1'), v6Inst('i2', 'm2')],
        bindings: [
          {
            id: 'bb',
            instanceId: 'i2',
            anchorNodeId: 'a1',
            target: { kind: 'instanceNode', instanceId: 'i1', nodeId: 'n3' },
          },
        ],
      },
    });
    const out = migrateToLatest(doc);
    expect(out.mechanism.nodes.some((n) => n.id === 'a1')).toBe(false);
    const e9 = out.mechanism.elements.find((e) => e.id === 'e9');
    if (e9?.type !== 'link') throw new Error('missing link e9');
    expect(e9.nodeA).toBe('n3');
    expect(e9.nodeB).toBe('b1');
    expect(out.mechanism.pointMasses.find((m) => m.id === 'pm9')!.nodeId).toBe('n3');
    const state = out.mechanism.namedStates.find((s) => s.name === 's')!;
    expect(Object.keys(state.positions)).toEqual(['n3']);
  });

  it('moves assembly masses and plates to project level with resolved node ids', () => {
    const doc = baseV6({
      mechanisms: [v6LinkageMech('m1')],
      assembly: {
        instances: [v6Inst('i1', 'm1')],
        pointMasses: [
          {
            id: 'apm-1',
            name: 'battery',
            massKg: 2,
            attach: { kind: 'instanceNode', instanceId: 'i1', nodeId: 'n2' },
          },
          {
            id: 'apm-2',
            name: 'clip',
            massKg: 0.1,
            attach: { kind: 'wearerAnchor', anchor: 'beltBack' },
          },
        ],
        foamPlates: [
          {
            id: 'fp-1',
            name: 'plate',
            areaM2: 0.1,
            attach: { kind: 'instanceNode', instanceId: 'i1', nodeId: 'n1' },
          },
        ],
      },
    });
    const out = migrateToLatest(doc);
    expect(out.pointMasses).toEqual([
      { id: 'apm-1', name: 'battery', massKg: 2, attach: { kind: 'node', nodeId: 'n2' } },
      {
        id: 'apm-2',
        name: 'clip',
        massKg: 0.1,
        attach: { kind: 'wearerAnchor', anchor: 'beltBack' },
      },
    ]);
    expect(out.foamPlates).toEqual([
      { id: 'fp-1', name: 'plate', areaM2: 0.1, attach: { kind: 'node', nodeId: 'n1' } },
    ]);
  });

  it('flags statically baked instanceNodes drives and unresolvable drives on their groups', () => {
    const doc = baseV6({
      mechanisms: [v6LinkageMech('m1'), v6LinkageMech2('m2'), v6LinkageMech2('m3')],
      assembly: {
        instances: [
          v6Inst('i1', 'm1'),
          v6Inst('i2', 'm2', {
            transformDrive: {
              kind: 'instanceNodes',
              instanceId: 'i1',
              originNodeId: 'n1',
              axisNodeId: 'n2',
            },
          }),
          v6Inst('i3', 'm3', {
            transformDrive: {
              kind: 'instanceNodes',
              instanceId: 'missing',
              originNodeId: 'n1',
              axisNodeId: 'n2',
            },
          }),
        ],
      },
    });
    const out = migrateToLatest(doc);
    expect(out.groups.find((g) => g.id === 'i1')?.note).toBeUndefined();
    expect(out.groups.find((g) => g.id === 'i2')?.note).toBe(
      "re-joint needed: this plane was driven by another mechanism's nodes (static bake)",
    );
    expect(out.groups.find((g) => g.id === 'i3')?.note).toBe(
      're-joint needed: transform drive could not be resolved',
    );
  });

  it('rewrites instance-node control mounts to lifted node ids (mirrored, suffixed)', () => {
    const control = (id: string, mount: unknown) => ({
      id,
      name: id,
      type: 'lever',
      mount,
      axes: [],
    });
    const doc = baseV6({
      mechanisms: [v6LinkageMech('m1')],
      assembly: {
        instances: [v6Inst('iA', 'm1'), v6Inst('iB', 'm1', { mirror: true })],
      },
      controls: [
        control('ctl-1', { kind: 'instanceNode', instanceId: 'iB', nodeId: 'n2' }),
        control('ctl-2', { kind: 'wearerAnchor', anchor: 'handR' }),
        control('ctl-3', { kind: 'instanceNode', instanceId: 'gone', nodeId: 'n2' }),
      ],
    });
    const out = migrateToLatest(doc);
    expect(out.controls[0]!.mount).toEqual({ kind: 'node', nodeId: 'n2@iB' });
    expect(out.controls[1]!.mount).toEqual({ kind: 'wearerAnchor', anchor: 'handR' });
    // a mount whose instance is gone drops: the control becomes desk-fixed
    expect(out.controls[2]!.mount).toBeUndefined();
  });

  it('places uninstanced mechanisms at their viewOrientation default and keeps ids unsuffixed', () => {
    const doc = baseV6({ mechanisms: [v6LinkageMech('m1')] }); // side-left, no instances
    const out = migrateToLatest(doc);
    // side-left default placement: identity rotation at z standoff 0.25
    const n2 = out.mechanism.nodes.find((n) => n.id === 'n2')!;
    expect(n2.position).toEqual({ x: 1, y: 0, z: 0.25 });
    expect(hingeAxis(pivots(out)[0]!).z).toBeCloseTo(1, 12);
    expect(out.groups).toEqual([{ id: 'm1', name: 'm1', elementIds: ['e1', 'e2', 'p1'] }]);
    expect(out.mechanism.namedStates.map((s) => s.name)).toEqual(['rest']);
  });

  it('resolves wearerAnchor transform drives at the frozen rest-pose anchor position', () => {
    const doc = baseV6({
      mechanisms: [v6LinkageMech('m1')],
      assembly: {
        instances: [
          v6Inst('i1', 'm1', { transformDrive: { kind: 'wearerAnchor', anchor: 'beltL' } }),
        ],
      },
    });
    const out = migrateToLatest(doc);
    // beltL at rest pose: (0, 0.53·H, hipW/2 + 0.02) with H=1.75, hipW=0.36
    const n1 = out.mechanism.nodes.find((n) => n.id === 'n1')!;
    expect(n1.position.x).toBeCloseTo(0, 12);
    expect(n1.position.y).toBeCloseTo(0.53 * 1.75, 12);
    expect(n1.position.z).toBeCloseTo(0.2, 12);
  });
});

/** Same linkage, distinct ids — avoids collisions with v6LinkageMech copies
 * that keep unsuffixed ids (single-instance mechanisms). */
function v6LinkageMech2(id: string): Record<string, unknown> {
  return v6Mech(id, {
    nodes: [
      { id: `${id}-n1`, kind: 'anchor', position: { x: 0, y: 0 } },
      { id: `${id}-n2`, kind: 'free', position: { x: 1, y: 0 } },
    ],
    elements: [
      {
        id: `${id}-e1`,
        type: 'link',
        maturity: 'sketch',
        nodeA: `${id}-n1`,
        nodeB: `${id}-n2`,
        pointMasses: [],
      },
    ],
  });
}

describe('migrateToLatest', () => {
  it('passes a current-version document through validation', () => {
    const p = fixtureProject();
    expect(migrateToLatest(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('rejects documents from a newer app', () => {
    expect(() => migrateToLatest({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer app/);
  });

  it('rejects a missing or invalid schemaVersion', () => {
    expect(() => migrateToLatest({})).toThrow(MigrationError);
    expect(() => migrateToLatest({ schemaVersion: 0 })).toThrow(MigrationError);
    expect(() => migrateToLatest({ schemaVersion: 'one' })).toThrow(MigrationError);
    expect(() => migrateToLatest(null)).toThrow(MigrationError);
  });

  it('rejects a structurally invalid document with a useful error', () => {
    expect(() => migrateToLatest({ schemaVersion: SCHEMA_VERSION, name: '' })).toThrow(
      /failed validation/,
    );
  });
});
