// Shared v7 test fixtures for the state/design test suites. Deliberately
// self-contained (no src/examples, no src/bom/testHelpers) so these suites
// stay green while other layers are converted in parallel
// (PLANFILE-3d-conversion.md). Round-number materials mirror the BOM helper
// set so nesting/mass arithmetic stays independently checkable.
import type { MaterialsDb, Mechanism, MechanismElement, Project } from '../schema';
import { createEmptyProject } from '../schema';

export function testMaterials(): MaterialsDb {
  return {
    pipes: [
      // OD 30 mm, ID 24 mm, 0.5 kg/m
      makePipe('PA', 'Pipe A', 'NPS', '3/4', 0.03, 0.024, 0.5),
      // OD 50 mm, ID 40 mm, 0.8 kg/m
      makePipe('PB', 'Pipe B', 'NPS', '1', 0.05, 0.04, 0.8),
      // telescope pair: TO.ID(23.3) − TI.OD(22) = 1.3 mm → slip
      makePipe('TO', 'Tele outer', 'NPS', '3/4', 0.03, 0.0233, 0.5),
      makePipe('TI', 'Tele inner', 'CTS', '3/4', 0.022, 0.018, 0.3),
      // bad outer: TX.ID(20) − TI.OD(22) = −2 mm → press (incompatible)
      makePipe('TX', 'Tele outer bad', 'NPS', '3/4', 0.03, 0.02, 0.5),
    ],
    fittings: [
      {
        id: 'F-tee',
        type: 'tee',
        sizingSystem: 'NPS',
        nominalSize: '3/4',
        massKg: 0.07,
        socketDepthM: 0.02,
        approximate: true,
      },
    ],
    cordage: [
      { id: 'rope', name: 'rope', kind: 'rope', linearDensityKgPerM: 0.01, approximate: true },
      {
        id: 'bungee',
        name: 'bungee',
        kind: 'elastic',
        linearDensityKgPerM: 0.02,
        defaultStiffnessNPerM: 300,
        approximate: true,
      },
    ],
    sheets: [],
    hardware: [{ id: 'hw-conduitbox', name: 'conduit box', massKg: 0.12, approximate: true }],
    genericPipeLinearDensityKgPerM: 0.25,
    unitPrices: {},
  };
}

function makePipe(
  id: string,
  name: string,
  sizingSystem: 'NPS' | 'CTS',
  nominalSize: string,
  odM: number,
  idM: number,
  dens: number,
): MaterialsDb['pipes'][number] {
  return {
    id,
    name,
    sizingSystem,
    nominalSize,
    outerDiameterM: odM,
    innerDiameterM: idM,
    linearDensityKgPerM: dens,
    approximate: true,
  };
}

/** v7 node: Vec3 position, z defaults to 0 (a sketch drawn in the z=0 panel). */
export const node = (id: string, x: number, y: number, z = 0): Mechanism['nodes'][number] => ({
  id,
  kind: 'free',
  position: { x, y, z },
});

/** Minimal v7 compound mechanism. */
export function mech(
  elements: MechanismElement[],
  nodes: Mechanism['nodes'],
  extras: Partial<Mechanism> = {},
): Mechanism {
  return {
    id: 'm1',
    name: 'm1',
    nodes,
    elements,
    pointMasses: [],
    skeletonBindings: [],
    anchorBindings: [],
    inputs: [],
    namedStates: [],
    ...extras,
  };
}

/** v7 project wrapping one compound mechanism with the round-number stock. */
export function projectWith(mechanism: Mechanism, extras: Partial<Project> = {}): Project {
  return {
    ...createEmptyProject('p1', 'test'),
    materials: testMaterials(),
    mechanism,
    ...extras,
  };
}
