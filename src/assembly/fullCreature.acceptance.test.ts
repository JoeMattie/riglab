// Phase 4 acceptance (§11): the full-creature 3D assembly. Drives the bundled
// example through the pure orchestration layer (solve every instanced
// mechanism per pose, compose to world) and asserts the four §11 criteria:
// the assembly composes/renders, walk animates the mirrored legs and the bound
// puppet arm, the CG shifts when the tail mass is edited, and the seesaw
// moment report matches a hand calculation about the hip axis within 2%.
import { describe, expect, it } from 'vitest';
import { buildFullCreatureProject } from '../examples';
import { DEFAULT_WEARER } from '../schema/project';
import { computeSkeleton, REST_POSE } from '../wearer';
import type { JointPose } from '../wearer/skeleton';
import { balanceReport, composeProject, GRAVITY } from './index';

const project = buildFullCreatureProject();

// a mid-stride walk pose (legs antiphase, right arm swung forward)
const WALK: JointPose = {
  ...REST_POSE,
  hipL: 0.45,
  hipR: -0.45,
  kneeL: 0.2,
  kneeR: 0.6,
  shoulderR: 0.5,
  shoulderL: -0.4,
  pelvisRise: 0.01,
};

describe('full-creature 3D assembly composes', () => {
  it('lifts every instance into world space (renders)', () => {
    const c = composeProject(project);
    expect(project.assembly.instances.length).toBeGreaterThan(0);
    for (const inst of project.assembly.instances) {
      const composed = c.instances[inst.id];
      expect(composed, `instance ${inst.id} composed`).toBeDefined();
      expect(Object.keys(composed!.nodeWorld).length).toBeGreaterThan(0);
      for (const p of Object.values(composed!.nodeWorld)) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true);
      }
    }
  });

  it('places the mirrored right leg on the opposite side of the left leg', () => {
    const c = composeProject(project, { pose: REST_POSE });
    const left = c.instances['inst-leg-left']!.nodeWorld;
    const right = c.instances['inst-leg-right']!.nodeWorld;
    // both legs bind the shoe node id `wShoe`; left sits at +z, right at −z
    expect(left.wShoe!.z).toBeGreaterThan(0);
    expect(right.wShoe!.z).toBeLessThan(0);
    // mirror restores world +x, so the two shoes share a forward position
    expect(Math.abs(left.wShoe!.x - right.wShoe!.x)).toBeLessThan(0.05);
  });
});

describe('walk animates bound instances', () => {
  it('swings the mirrored legs in antiphase', () => {
    const rest = composeProject(project, { pose: REST_POSE });
    const walk = composeProject(project, { pose: WALK });
    const dLeftKnee =
      walk.instances['inst-leg-left']!.nodeWorld.wKnee!.x -
      rest.instances['inst-leg-left']!.nodeWorld.wKnee!.x;
    const dRightKnee =
      walk.instances['inst-leg-right']!.nodeWorld.wKnee!.x -
      rest.instances['inst-leg-right']!.nodeWorld.wKnee!.x;
    // both knees move under the clip, and opposite hip flexion drives them apart
    expect(Math.abs(dLeftKnee)).toBeGreaterThan(0.02);
    expect(Math.abs(dRightKnee)).toBeGreaterThan(0.02);
    expect(Math.sign(dLeftKnee)).not.toBe(Math.sign(dRightKnee));
  });

  it('swings the bound puppet arm', () => {
    const rest = composeProject(project, { pose: REST_POSE });
    const walk = composeProject(project, { pose: WALK });
    const restHand = rest.instances['inst-arm']!.nodeWorld.armHand!;
    const walkHand = walk.instances['inst-arm']!.nodeWorld.armHand!;
    const moved = Math.hypot(walkHand.x - restHand.x, walkHand.y - restHand.y);
    expect(moved).toBeGreaterThan(0.02);
  });
});

describe('CG responds to mass edits', () => {
  it('shifts the CG toward the tail when the tail counterweight grows', () => {
    const base = composeProject(project);
    const heavier = structuredClone(project);
    const tail = heavier.assembly.pointMasses.find((m) => m.id === 'tailMass')!;
    tail.massKg += 2;
    const after = composeProject(heavier);
    // tail sits behind the hips (−x); a heavier tail pulls the CG rearward
    expect(after.cg.x).toBeLessThan(base.cg.x);
    expect(after.totalMassKg).toBeCloseTo(base.totalMassKg + 2, 6);
  });
});

describe('seesaw balance report matches a hand calculation (±2%)', () => {
  it('front/back moments about the hip axis agree with hand-summed torques', () => {
    const c = composeProject(project);
    // pivot axis: wearer-left through the hips (x = 0, at hip height), front = +x
    const axisPoint = { x: 0, y: computeSkeleton(DEFAULT_WEARER, REST_POSE).points.pelvis.y, z: 0 };
    const report = balanceReport(c.masses, {
      axisPoint,
      axisDir: { x: 0, y: 0, z: 1 },
      frontDir: { x: 1, y: 0, z: 0 },
    });

    // Independent hand calculation from each mass's known world x.
    let hf = 0;
    let hb = 0;
    for (const m of c.masses) {
      const arm = m.world.x - axisPoint.x;
      const moment = m.massKg * GRAVITY * Math.abs(arm);
      if (arm >= 0) hf += moment;
      else hb += moment;
    }
    expect(hf).toBeGreaterThan(0);
    expect(hb).toBeGreaterThan(0);
    expect(Math.abs(report.frontMomentNm - hf) / hf).toBeLessThan(0.02);
    expect(Math.abs(report.backMomentNm - hb) / hb).toBeLessThan(0.02);
  });
});
