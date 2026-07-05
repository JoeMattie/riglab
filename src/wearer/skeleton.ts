// Parametric mannequin (§7): segment lengths from standard anthropometry
// fractions of height (Drillis & Contini — approximate, user-editable via
// project.wearer). World frame: y up, x forward (wearer faces +x), z to the
// wearer's left. Poses are sagittal (rotations about z), which covers the
// walk / arm-swing / lean clip library; out-of-plane poses are future work.
import type { SkeletonPoint, Vec3, WearerAnchor, WearerParams } from '../schema';

export interface JointPose {
  /** hip flexion from straight-down, forward positive (rad) */
  hipL: number;
  hipR: number;
  /** knee flexion, ≥ 0 bends the shank backward (rad) */
  kneeL: number;
  kneeR: number;
  /** shoulder flexion from straight-down, forward positive (rad) */
  shoulderL: number;
  shoulderR: number;
  /** elbow flexion, ≥ 0 bends the forearm forward (rad) */
  elbowL: number;
  elbowR: number;
  /** torso lean about the hips, forward positive (rad) */
  lean: number;
  /** vertical pelvis offset (m) — walk bob */
  pelvisRise: number;
}

export const REST_POSE: JointPose = {
  hipL: 0,
  hipR: 0,
  kneeL: 0,
  kneeR: 0,
  shoulderL: 0,
  shoulderR: 0,
  elbowL: 0,
  elbowR: 0,
  lean: 0,
  pelvisRise: 0,
};

/** Anthropometry as fractions of height (approximate; §12: reasonable
 * values surfaced as editable, not silently trusted). */
const F = {
  hipHeight: 0.53,
  shoulderHeight: 0.818,
  headCenter: 0.936,
  headRadius: 0.064,
  thigh: 0.245,
  calf: 0.246,
  ankleHeight: 0.039,
  upperArm: 0.186,
  forearmToWrist: 0.146,
};

export interface SkeletonFrame {
  points: Record<SkeletonPoint, Vec3>;
  anchors: Record<WearerAnchor, Vec3>;
}

const dir = (theta: number): { x: number; y: number } => ({
  x: Math.sin(theta),
  y: -Math.cos(theta),
});

export function computeSkeleton(params: WearerParams, pose: JointPose): SkeletonFrame {
  const H = params.heightM;
  const hipY = F.hipHeight * H + pose.pelvisRise;
  const pelvis: Vec3 = { x: 0, y: hipY, z: 0 };

  // torso leans about the pelvis
  const torsoLen = (F.shoulderHeight - F.hipHeight) * H;
  const up = { x: Math.sin(pose.lean), y: Math.cos(pose.lean) };
  const shoulderCenter: Vec3 = {
    x: pelvis.x + up.x * torsoLen,
    y: pelvis.y + up.y * torsoLen,
    z: 0,
  };
  const headCenter: Vec3 = {
    x: pelvis.x + up.x * (F.headCenter - F.hipHeight) * H,
    y: pelvis.y + up.y * (F.headCenter - F.hipHeight) * H,
    z: 0,
  };

  const leg = (side: 1 | -1, hipAngle: number, kneeFlex: number) => {
    const hip: Vec3 = { x: pelvis.x, y: pelvis.y, z: (side * params.hipWidthM) / 2 };
    const dThigh = dir(hipAngle);
    const knee: Vec3 = {
      x: hip.x + dThigh.x * F.thigh * H,
      y: hip.y + dThigh.y * F.thigh * H,
      z: hip.z,
    };
    const dCalf = dir(hipAngle - kneeFlex);
    const ankle: Vec3 = {
      x: knee.x + dCalf.x * F.calf * H,
      y: knee.y + dCalf.y * F.calf * H,
      z: hip.z,
    };
    // flat-foot approximation: ground point slightly ahead of the ankle
    const shoe: Vec3 = { x: ankle.x + 0.1, y: ankle.y - F.ankleHeight * H, z: hip.z };
    return { hip, knee, ankle, shoe };
  };

  const arm = (side: 1 | -1, shoulderAngle: number, elbowFlex: number) => {
    const shoulder: Vec3 = {
      x: shoulderCenter.x,
      y: shoulderCenter.y,
      z: (side * params.shoulderWidthM) / 2,
    };
    const dUpper = dir(pose.lean + shoulderAngle);
    const elbow: Vec3 = {
      x: shoulder.x + dUpper.x * F.upperArm * H,
      y: shoulder.y + dUpper.y * F.upperArm * H,
      z: shoulder.z,
    };
    const dFore = dir(pose.lean + shoulderAngle + elbowFlex);
    const hand: Vec3 = {
      x: elbow.x + dFore.x * F.forearmToWrist * H,
      y: elbow.y + dFore.y * F.forearmToWrist * H,
      z: shoulder.z,
    };
    return { shoulder, elbow, hand };
  };

  // z: +left. side L = +1, R = −1.
  const legL = leg(1, pose.hipL, pose.kneeL);
  const legR = leg(-1, pose.hipR, pose.kneeR);
  const armL = arm(1, pose.shoulderL, pose.elbowL);
  const armR = arm(-1, pose.shoulderR, pose.elbowR);

  const points: Record<SkeletonPoint, Vec3> = {
    head: headCenter,
    spineTop: shoulderCenter,
    pelvis,
    shoulderL: armL.shoulder,
    shoulderR: armR.shoulder,
    elbowL: armL.elbow,
    elbowR: armR.elbow,
    handL: armL.hand,
    handR: armR.hand,
    hipL: legL.hip,
    hipR: legR.hip,
    kneeL: legL.knee,
    kneeR: legR.knee,
    ankleL: legL.ankle,
    ankleR: legR.ankle,
    shoeL: legL.shoe,
    shoeR: legR.shoe,
  };

  // structural anchors: pack-frame-relative, around the hips/shoulders
  const beltZ = params.hipWidthM / 2 + 0.02;
  const rectZ = params.hipWidthM / 2 + 0.03;
  const anchors: Record<WearerAnchor, Vec3> = {
    shoulderL: armL.shoulder,
    shoulderR: armR.shoulder,
    spineTop: shoulderCenter,
    beltL: { x: 0, y: hipY, z: beltZ },
    beltR: { x: 0, y: hipY, z: -beltZ },
    beltBack: { x: -0.1, y: hipY, z: 0 },
    hipRectFrontL: { x: 0.12, y: hipY, z: rectZ },
    hipRectFrontR: { x: 0.12, y: hipY, z: -rectZ },
    hipRectBackL: { x: -0.14, y: hipY, z: rectZ },
    hipRectBackR: { x: -0.14, y: hipY, z: -rectZ },
    thighL: mid(legL.hip, legL.knee),
    thighR: mid(legR.hip, legR.knee),
    calfL: mid(legL.knee, legL.ankle),
    calfR: mid(legR.knee, legR.ankle),
    shoeL: legL.shoe,
    shoeR: legR.shoe,
    handL: armL.hand,
    handR: armR.hand,
  };

  return { points, anchors };
}

function mid(a: Vec3, b: Vec3): Vec3 {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

export function headRadiusM(params: WearerParams): number {
  return F.headRadius * params.heightM;
}
