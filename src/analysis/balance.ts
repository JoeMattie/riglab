// Seesaw balance report (§5.4), ported near-verbatim from the dissolved
// src/assembly/compose.ts: per-side moment about a chosen horizontal pivot
// axis under gravity, with a counterweight suggestion. Pure plain-data in/out.
import { dot, normalize, sub } from '../geometry/math3';
import type { Vec3 } from '../schema';
import type { WorldMass } from './masses';

export const GRAVITY = 9.80665;

export interface BalanceQuery {
  /** a point on the pivot axis */
  axisPoint: Vec3;
  /** horizontal pivot-axis direction (e.g. wearer-left +z) */
  axisDir: Vec3;
  /** horizontal "front" direction, perpendicular to the axis (default world +x) */
  frontDir?: Vec3;
  /** where a balancing counterweight would be placed (for the suggestion) */
  counterweightPoint?: Vec3;
}

export interface BalanceReport {
  /** Σ m·g·arm for masses on the front side (N·m) */
  frontMomentNm: number;
  /** Σ m·g·arm for masses on the back side (N·m, positive magnitude) */
  backMomentNm: number;
  /** front − back; positive tips forward */
  netMomentNm: number;
  imbalanceNm: number;
  heavySide: 'front' | 'back' | 'balanced';
  /** counterweight mass at counterweightPoint that zeroes the imbalance */
  suggestedCounterweightKg?: number;
}

/** Seesaw report (§5.4): per-side moment about a chosen horizontal pivot axis
 * under gravity. Only the horizontal lever arm (projection on frontDir) counts;
 * vertical offsets contribute nothing to a moment about a horizontal axis. */
export function balanceReport(masses: WorldMass[], q: BalanceQuery): BalanceReport {
  const front = normalize(q.frontDir ?? { x: 1, y: 0, z: 0 });
  let frontMomentNm = 0;
  let backMomentNm = 0;
  for (const m of masses) {
    const arm = dot(sub(m.world, q.axisPoint), front);
    const moment = m.massKg * GRAVITY * Math.abs(arm);
    if (arm >= 0) frontMomentNm += moment;
    else backMomentNm += moment;
  }
  const netMomentNm = frontMomentNm - backMomentNm;
  const imbalanceNm = Math.abs(netMomentNm);
  const heavySide = imbalanceNm < 1e-9 ? 'balanced' : netMomentNm > 0 ? 'front' : 'back';

  let suggestedCounterweightKg: number | undefined;
  if (q.counterweightPoint && imbalanceNm > 1e-9) {
    const arm = dot(sub(q.counterweightPoint, q.axisPoint), front);
    // counterweight must sit on the light side to oppose the tip
    const onHeavySide = (arm >= 0 && heavySide === 'front') || (arm < 0 && heavySide === 'back');
    if (!onHeavySide && Math.abs(arm) > 1e-6) {
      suggestedCounterweightKg = imbalanceNm / (GRAVITY * Math.abs(arm));
    }
  }

  return {
    frontMomentNm,
    backMomentNm,
    netMomentNm,
    imbalanceNm,
    heavySide,
    suggestedCounterweightKg,
  };
}
