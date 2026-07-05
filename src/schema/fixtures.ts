// Test fixtures. A project exercising every element type — used by schema,
// persistence, and export/import round-trip tests. Not imported by app code.
import type { Project } from './project';
import { SCHEMA_VERSION } from './project';

export function fixtureProject(): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: 'fixture-project',
    name: 'Fixture',
    unitsPreference: 'imperial',
    materials: {
      pipes: [
        {
          id: 'pipe-npn-075',
          name: 'PVC Sch 40 3/4"',
          sizingSystem: 'NPS',
          nominalSize: '3/4',
          outerDiameterM: 0.0267,
          innerDiameterM: 0.0209,
          linearDensityKgPerM: 0.34,
          approximate: true,
        },
        {
          id: 'pipe-cts-075',
          name: 'CPVC CTS 3/4"',
          sizingSystem: 'CTS',
          nominalSize: '3/4',
          outerDiameterM: 0.0222,
          innerDiameterM: 0.0184,
          linearDensityKgPerM: 0.22,
          approximate: true,
        },
      ],
      fittings: [
        {
          id: 'tee-075',
          type: 'tee',
          sizingSystem: 'NPS',
          nominalSize: '3/4',
          massKg: 0.06,
          socketDepthM: 0.018,
          approximate: true,
        },
      ],
      cordage: [
        {
          id: 'paracord',
          name: 'paracord',
          kind: 'rope',
          linearDensityKgPerM: 0.006,
          approximate: true,
        },
        {
          id: 'bungee6',
          name: '6mm bungee',
          kind: 'elastic',
          linearDensityKgPerM: 0.02,
          defaultStiffnessNPerM: 300,
          approximate: true,
        },
      ],
      sheets: [{ id: 'eva12', name: 'EVA 12mm', arealDensityKgPerM2: 1.1, approximate: true }],
      hardware: [{ id: 'conduit-box', name: 'conduit box', massKg: 0.12, approximate: true }],
      genericPipeLinearDensityKgPerM: 0.25,
      unitPrices: { 'pipe-npn-075': 1.2 },
    },
    mechanisms: [
      {
        id: 'mech-1',
        name: 'test mechanism',
        viewOrientation: 'side-left',
        gravityOn: true,
        nodes: [
          { id: 'n1', kind: 'anchor', position: { x: 0, y: 0 } },
          { id: 'n2', kind: 'free', position: { x: 0.5, y: 0 } },
          { id: 'n3', kind: 'free', position: { x: 1, y: 0.2 } },
          { id: 'n4', kind: 'free', position: { x: 1.5, y: 0.1 } },
          { id: 'n5', kind: 'driven', position: { x: 2, y: 0 }, channelId: 'ch1' },
          { id: 'n6', kind: 'free', position: { x: 2.5, y: 0 } },
          { id: 'n7', kind: 'anchor', position: { x: 3, y: 1 } },
        ],
        elements: [
          {
            id: 'e-link',
            type: 'link',
            maturity: 'engineered',
            subsystemTag: 'boom',
            nodeA: 'n1',
            nodeB: 'n2',
            pipeMaterialId: 'pipe-npn-075',
            endRealizationA: 'heatWrapPivot',
            endRealizationB: 'fitting',
            pointMasses: [{ id: 'pm1', name: 'speaker', massKg: 0.8, t: 0.5 }],
          },
          {
            id: 'e-bent',
            type: 'bentLink',
            maturity: 'sketch',
            nodeIds: ['n2', 'n3', 'n4'],
            filletRadiiM: [0.08],
            pointMasses: [],
          },
          {
            id: 'e-tel',
            type: 'telescope',
            maturity: 'engineered',
            nodeA: 'n4',
            nodeB: 'n5',
            minLengthM: 0.3,
            maxLengthM: 0.6,
            lengthM: 0.5,
            sliding: false,
            outerPipeMaterialId: 'pipe-npn-075',
            innerPipeMaterialId: 'pipe-cts-075',
            pointMasses: [],
          },
          {
            id: 'e-pivot',
            type: 'pivot',
            maturity: 'engineered',
            nodeId: 'n2',
            memberIds: ['e-link', 'e-bent'],
            welds: [],
            angleLimit: { memberA: 'e-link', memberB: 'e-bent', minRad: -1.2, maxRad: 1.2 },
            torsionSpring: {
              memberA: 'e-link',
              memberB: 'e-bent',
              stiffnessNmPerRad: 4,
              restAngleRad: 0,
            },
            realization: 'heatWrapPivot',
          },
          {
            id: 'e-slider',
            type: 'slider',
            maturity: 'sketch',
            nodeId: 'n6',
            alongElementId: 'e-link',
            travelMin: 0.1,
            travelMax: 0.9,
          },
          {
            id: 'e-rope',
            type: 'rope',
            maturity: 'sketch',
            path: ['n7', 'n3', 'n5'],
            lengthM: 2.2,
            cordageMaterialId: 'paracord',
          },
          {
            id: 'e-elastic',
            type: 'elastic',
            maturity: 'sketch',
            nodeA: 'n7',
            nodeB: 'n4',
            restLengthM: 0.9,
            stiffnessNPerM: 300,
            tensionOnly: true,
            pretensionN: 5,
            cordageMaterialId: 'bungee6',
          },
          {
            id: 'e-bowden',
            type: 'bowden',
            maturity: 'sketch',
            a1: 'n1',
            a2: 'n2',
            b1: 'n5',
            b2: 'n6',
            restLengthAM: 0.5,
            restLengthBM: 0.5,
          },
          {
            id: 'e-torsion',
            type: 'torsionCable',
            maturity: 'sketch',
            pivotA: 'e-pivot',
            pivotB: 'e-pivot',
            ratio: 1,
            backlashRad: 0.05,
          },
        ],
        pointMasses: [{ id: 'npm-1', name: 'head weight', massKg: 2.5, nodeId: 'n4' }],
        skeletonBindings: [{ id: 'sb-1', point: 'handR', nodeId: 'n6' }],
        anchorBindings: [{ id: 'ab-1', anchor: 'beltR', nodeId: 'n1' }],
        inputs: [
          {
            id: 'ch1',
            name: 'steer.pitch',
            kind: 'angle',
            min: -0.8,
            max: 0.8,
            value: 0,
            locked: false,
          },
        ],
        namedStates: [
          {
            name: 'rest',
            positions: { n2: { x: 0.5, y: 0 } },
            channelValues: { ch1: 0 },
          },
        ],
      },
    ],
    assembly: {
      instances: [
        {
          id: 'inst-1',
          name: 'left instance',
          mechanismId: 'mech-1',
          position: { x: 0, y: 1, z: 0.2 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          mirror: false,
          transformDrive: { kind: 'wearerAnchor', anchor: 'beltL' },
        },
        {
          id: 'inst-2',
          name: 'right instance',
          mechanismId: 'mech-1',
          position: { x: 0, y: 1, z: -0.2 },
          quaternion: { x: 0, y: 0, z: 0, w: 1 },
          mirror: true,
          transformDrive: {
            kind: 'instanceNodes',
            instanceId: 'inst-1',
            originNodeId: 'n1',
            axisNodeId: 'n2',
          },
        },
      ],
      bindings: [
        {
          id: 'bind-1',
          instanceId: 'inst-1',
          anchorNodeId: 'n1',
          target: { kind: 'wearerAnchor', anchor: 'hipRectFrontL' },
        },
        {
          id: 'bind-2',
          instanceId: 'inst-2',
          anchorNodeId: 'n1',
          target: { kind: 'instanceNode', instanceId: 'inst-1', nodeId: 'n7' },
        },
      ],
      pointMasses: [
        {
          id: 'mass-1',
          name: 'battery',
          massKg: 1.4,
          attach: { kind: 'wearerAnchor', anchor: 'beltBack' },
        },
      ],
      foamPlates: [
        {
          id: 'plate-1',
          name: 'side plate',
          polygon: [
            { x: 0, y: 0 },
            { x: 0.4, y: 0 },
            { x: 0.2, y: 0.3 },
          ],
          sheetMaterialId: 'eva12',
          attach: { kind: 'instanceNode', instanceId: 'inst-1', nodeId: 'n3' },
        },
      ],
    },
    // Controls/controlClips (§4.4) are exercised with populated data in
    // controls.test.ts; the fixture keeps them empty so the migration-chain
    // equality tests (which produce empty arrays for old docs) hold.
    controls: [],
    controlClips: [],
    wearer: { heightM: 1.8, shoulderWidthM: 0.48, hipWidthM: 0.37 },
    wearerAnchorOverrides: {
      shoulderL: { x: 0.02, y: 1.45, z: 0.19 },
    },
    bomSettings: { heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 },
  };
}

/** A version-1 document as Phase 0 wrote it (no skeletonBindings, no wearer
 * params, no bomSettings) — used to test the full 1→latest migration chain
 * against real old data. */
export function fixtureProjectV1(): Record<string, unknown> {
  const p = fixtureProject() as unknown as Record<string, unknown>;
  const { wearer: _wearer, bomSettings: _bom, controls: _c, controlClips: _cc, ...rest } = p;
  return {
    ...rest,
    schemaVersion: 1,
    mechanisms: (p.mechanisms as Array<Record<string, unknown>>).map((m) => {
      const { skeletonBindings: _sb, anchorBindings: _ab, ...mRest } = m;
      return mRest;
    }),
  };
}

/** A version-2 document (skeletonBindings + wearer present, but no
 * bomSettings) — exercises the 2→3 migration in isolation. */
export function fixtureProjectV2(): Record<string, unknown> {
  const p = fixtureProject() as unknown as Record<string, unknown>;
  const { bomSettings: _bom, controls: _c, controlClips: _cc, ...rest } = p;
  return { ...rest, schemaVersion: 2 };
}

/** A version-3 document — like v4 minus the stamp (lengthLocked optional/absent)
 * and the v5 controls fields — exercises the stamp-only 3→4 migration. */
export function fixtureProjectV3(): Record<string, unknown> {
  const p = fixtureProject() as unknown as Record<string, unknown>;
  const { controls: _c, controlClips: _cc, ...rest } = p;
  return { ...rest, schemaVersion: 3 };
}

/** A version-4 document (no controls/controlClips yet) — exercises the 4→5
 * migration that adds the empty control arrays (§4.4). */
export function fixtureProjectV4(): Record<string, unknown> {
  const p = fixtureProject() as unknown as Record<string, unknown>;
  const { controls: _c, controlClips: _cc, ...rest } = p;
  return { ...rest, schemaVersion: 4 };
}

/** A version-5 document (no anchorBindings yet) — exercises the 5→6
 * migration that adds the empty wearer-anchor attachment array. */
export function fixtureProjectV5(): Record<string, unknown> {
  const p = fixtureProject() as unknown as Record<string, unknown>;
  return {
    ...p,
    schemaVersion: 5,
    mechanisms: (p.mechanisms as Array<Record<string, unknown>>).map((m) => {
      const { anchorBindings: _ab, ...mRest } = m;
      return mRest;
    }),
  };
}
