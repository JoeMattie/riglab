// Shared BOM test fixtures. Round-number materials so allowance arithmetic is
// exact and independently checkable. Test-support only — not app code.
import type { BomSettings, MaterialsDb, Mechanism, MechanismElement } from '../schema';

export const BOM_SETTINGS: BomSettings = { heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 };

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
      makeFitting('F-coupling', 'coupling', 'NPS', '3/4', 0.05, 0.02),
      makeFitting('F-elbow90', 'elbow90', 'NPS', '3/4', 0.06, 0.02),
      makeFitting('F-tee', 'tee', 'NPS', '3/4', 0.07, 0.02),
      makeFitting('F-cross', 'cross', 'NPS', '3/4', 0.09, 0.02),
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
      {
        id: 'bowden',
        name: 'bowden',
        kind: 'bowdenCable',
        linearDensityKgPerM: 0.05,
        approximate: true,
      },
    ],
    sheets: [],
    hardware: [
      { id: 'hw-conduitbox', name: 'conduit box', massKg: 0.12, approximate: true },
      { id: 'hw-boltset', name: 'bolt set', massKg: 0.02, approximate: true },
    ],
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

function makeFitting(
  id: string,
  type: MaterialsDb['fittings'][number]['type'],
  sizingSystem: 'NPS' | 'CTS',
  nominalSize: string,
  massKg: number,
  socketDepthM: number,
): MaterialsDb['fittings'][number] {
  return { id, type, sizingSystem, nominalSize, massKg, socketDepthM, approximate: true };
}

/** Minimal single-mechanism wrapper. */
export function mech(
  elements: MechanismElement[],
  nodes: Mechanism['nodes'],
  extras: Partial<Mechanism> = {},
): Mechanism {
  return {
    id: 'm1',
    name: 'm1',
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes,
    elements,
    pointMasses: [],
    skeletonBindings: [],
    inputs: [],
    namedStates: [],
    ...extras,
  };
}

export const node = (id: string, x: number, y: number): Mechanism['nodes'][number] => ({
  id,
  kind: 'free',
  position: { x, y },
});
