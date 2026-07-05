import { describe, expect, it } from 'vitest';
import type { Assembly, Quaternion } from '../schema';
import { emptyAssembly } from '../schema/assembly';
import { DEFAULT_WEARER } from '../schema/project';
import { computeSkeleton, REST_POSE, type SkeletonFrame } from '../wearer/skeleton';
import { balanceReport, composeAssembly, GRAVITY, type InstanceSolveData } from './compose';
import { rotate } from './math3';

const wearer: SkeletonFrame = computeSkeleton(DEFAULT_WEARER, REST_POSE);
const ID: Quaternion = { x: 0, y: 0, z: 0, w: 1 };
// 90° about world +y: local +x → world −z, local +z → world +x
const YAW90: Quaternion = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };

function near(a: number, b: number, tol = 1e-9) {
  expect(Math.abs(a - b)).toBeLessThan(tol);
}

describe('composeAssembly — lifting 2D nodes into 3D', () => {
  it('fixed instance lifts local (x,y) to world (x,y,0) at its origin', () => {
    const asm: Assembly = {
      ...emptyAssembly(),
      instances: [
        {
          id: 'i1',
          name: 'A',
          mechanismId: 'm1',
          position: { x: 1, y: 2, z: 3 },
          quaternion: ID,
          mirror: false,
          transformDrive: { kind: 'fixed' },
        },
      ],
    };
    const solves: Record<string, InstanceSolveData> = {
      i1: { nodes: { n: { x: 0.5, y: 0.25 } } },
    };
    const c = composeAssembly(asm, wearer, solves);
    const w = c.instances.i1!.nodeWorld.n!;
    near(w.x, 1.5);
    near(w.y, 2.25);
    near(w.z, 3);
  });

  it('mirror flag reflects the local x axis', () => {
    const asm: Assembly = {
      ...emptyAssembly(),
      instances: [
        {
          id: 'i1',
          name: 'A',
          mechanismId: 'm1',
          position: { x: 0, y: 0, z: 0 },
          quaternion: ID,
          mirror: true,
          transformDrive: { kind: 'fixed' },
        },
      ],
    };
    const c = composeAssembly(asm, wearer, { i1: { nodes: { n: { x: 0.7, y: 0.2 } } } });
    near(c.instances.i1!.nodeWorld.n!.x, -0.7);
    near(c.instances.i1!.nodeWorld.n!.y, 0.2);
  });

  it('quaternion orients the mechanism plane', () => {
    const asm: Assembly = {
      ...emptyAssembly(),
      instances: [
        {
          id: 'i1',
          name: 'A',
          mechanismId: 'm1',
          position: { x: 0, y: 0, z: 0 },
          quaternion: YAW90,
          mirror: false,
          transformDrive: { kind: 'fixed' },
        },
      ],
    };
    const c = composeAssembly(asm, wearer, { i1: { nodes: { n: { x: 1, y: 0 } } } });
    // local +x under a +90° yaw maps to world −z
    const w = c.instances.i1!.nodeWorld.n!;
    near(w.x, 0, 1e-9);
    near(w.z, -1, 1e-9);
  });

  it('glues an instance origin to a wearer anchor frame', () => {
    const asm: Assembly = {
      ...emptyAssembly(),
      instances: [
        {
          id: 'i1',
          name: 'A',
          mechanismId: 'm1',
          position: { x: 0, y: 0, z: 0 },
          quaternion: ID,
          mirror: false,
          transformDrive: { kind: 'wearerAnchor', anchor: 'beltBack' },
        },
      ],
    };
    const c = composeAssembly(asm, wearer, { i1: { nodes: { n: { x: 0, y: 0 } } } });
    expect(c.instances.i1!.nodeWorld.n!).toEqual(wearer.anchors.beltBack);
  });
});

describe('composeAssembly — transform-drive by another instance (pan × pitch, §5.4)', () => {
  it("derives the child plane origin+axis from the parent's solved nodes", () => {
    const asm: Assembly = {
      ...emptyAssembly(),
      instances: [
        {
          id: 'pan',
          name: 'pan',
          mechanismId: 'top',
          position: { x: 0, y: 0, z: 0 },
          quaternion: ID,
          mirror: false,
          transformDrive: { kind: 'fixed' },
        },
        {
          id: 'pitch',
          name: 'pitch',
          mechanismId: 'side',
          position: { x: 0, y: 0, z: 0 },
          quaternion: ID,
          mirror: false,
          transformDrive: {
            kind: 'instanceNodes',
            instanceId: 'pan',
            originNodeId: 'o',
            axisNodeId: 'a',
          },
        },
      ],
    };
    // pan solved in a top-view plane: origin at (2,1) heading toward +x-of-plane.
    // Its own transform is fixed identity so its 2D (x,y) lift to world (x,y,0).
    const solves: Record<string, InstanceSolveData> = {
      pan: { nodes: { o: { x: 2, y: 1 }, a: { x: 3, y: 1 } } },
      pitch: { nodes: { tip: { x: 1, y: 0 } } },
    };
    const c = composeAssembly(asm, wearer, solves);
    // parent heading o→a is world +x, so child local +x → world +x, +y → up.
    const tip = c.instances.pitch!.nodeWorld.tip!;
    near(tip.x, 3); // origin (2,1,0) + local x=1 along world +x
    near(tip.y, 1);
    near(tip.z, 0);
  });
});

describe('composeAssembly — mass rollup + CG', () => {
  it('computes total mass and CG of point masses', () => {
    const asm: Assembly = {
      ...emptyAssembly(),
      pointMasses: [
        { id: 'a', name: 'a', massKg: 1, attach: { kind: 'wearerAnchor', anchor: 'spineTop' } },
        { id: 'b', name: 'b', massKg: 3, attach: { kind: 'wearerAnchor', anchor: 'beltBack' } },
      ],
    };
    const c = composeAssembly(asm, wearer, {});
    near(c.totalMassKg, 4);
    // CG = (1·spineTop + 3·beltBack) / 4
    const sp = wearer.anchors.spineTop;
    const bb = wearer.anchors.beltBack;
    near(c.cg.x, (sp.x + 3 * bb.x) / 4, 1e-9);
    near(c.cg.y, (sp.y + 3 * bb.y) / 4, 1e-9);
  });

  it('drops masses whose attach target dangles', () => {
    const asm: Assembly = {
      ...emptyAssembly(),
      pointMasses: [
        {
          id: 'x',
          name: 'x',
          massKg: 5,
          attach: { kind: 'instanceNode', instanceId: 'nope', nodeId: 'n' },
        },
      ],
    };
    const c = composeAssembly(asm, wearer, {});
    expect(c.totalMassKg).toBe(0);
    expect(c.masses).toHaveLength(0);
  });
});

describe('balanceReport — seesaw moment about a chosen axis (§5.4)', () => {
  const axis = { axisPoint: { x: 0, y: 1, z: 0 }, axisDir: { x: 0, y: 0, z: 1 } };

  it('2 kg at 0.5 m vs 1 kg at 1.0 m balances', () => {
    const masses = [
      {
        id: 'f',
        name: 'f',
        massKg: 2,
        world: { x: 0.5, y: 1, z: 0 },
        source: 'pointMass' as const,
      },
      { id: 'b', name: 'b', massKg: 1, world: { x: -1, y: 1, z: 0 }, source: 'pointMass' as const },
    ];
    const r = balanceReport(masses, axis);
    near(r.frontMomentNm, 2 * GRAVITY * 0.5, 1e-6);
    near(r.backMomentNm, 1 * GRAVITY * 1.0, 1e-6);
    expect(r.heavySide).toBe('balanced');
    near(r.imbalanceNm, 0, 1e-6);
  });

  it('vertical offset does not change the moment about a horizontal axis', () => {
    const flat = balanceReport(
      [{ id: 'm', name: 'm', massKg: 2, world: { x: 0.5, y: 1, z: 0 }, source: 'pointMass' }],
      axis,
    );
    const raised = balanceReport(
      [{ id: 'm', name: 'm', massKg: 2, world: { x: 0.5, y: 3.7, z: 0 }, source: 'pointMass' }],
      axis,
    );
    near(flat.frontMomentNm, raised.frontMomentNm, 1e-9);
  });

  it('suggests a counterweight on the light side that zeroes the imbalance', () => {
    const masses = [
      {
        id: 'f',
        name: 'f',
        massKg: 4,
        world: { x: 0.5, y: 1, z: 0 },
        source: 'pointMass' as const,
      },
    ];
    const r = balanceReport(masses, {
      ...axis,
      counterweightPoint: { x: -0.4, y: 1, z: 0 },
    });
    expect(r.heavySide).toBe('front');
    // required: m·g·0.4 = 4·g·0.5 → m = 5 kg
    near(r.suggestedCounterweightKg ?? 0, 5, 1e-6);
  });
});

describe('math3.rotate', () => {
  it('rotates a vector by identity to itself', () => {
    const v = { x: 1, y: 2, z: 3 };
    expect(rotate(ID, v)).toEqual(v);
  });
});
