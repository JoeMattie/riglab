// Mass inventory + CG over the global 3D solve (PLANFILE-3d-conversion.md,
// "Dissolution + downstream"). Port of the mass-rollup half of the former
// src/assembly/compose.ts: with one compound mechanism there is no lifting —
// solved positions ARE world positions. Pure and framework-free: inputs are
// the Project (plain schema data), a solved position record, and a plain
// wearer-anchor position record — no solver import, no UI or engine types.
import { elementLinearDensities } from '../design/densities';
import { add, scale } from '../geometry/math3';
import type { Project, Vec2, Vec3, WearerAnchor } from '../schema';

export type MassSource = 'pointMass' | 'foamPlate' | 'link';

export interface WorldMass {
  id: string;
  name: string;
  massKg: number;
  world: Vec3;
  source: MassSource;
}

export interface MassInventory {
  masses: WorldMass[];
  totalMassKg: number;
  /** center of gravity; {0,0,0} when the rig is massless */
  cg: Vec3;
}

export interface MassInventoryOptions {
  /** include engineered-pipe self-weight (segment length × material linear
   * density at the segment midpoint) so the CG reflects the PVC, not only
   * bolt-on masses; defaults on (§5.4). Set false to weigh only explicit
   * point/foam masses. */
  includePipeMass?: boolean;
}

/** World positions the inventory reads: solved node positions keyed by node
 * id, plus wearer anchor positions (from the posed skeleton) keyed by anchor
 * name. Masses whose target dangles (unknown node/anchor) are dropped, same
 * as the old compose layer. */
export function massInventory(
  project: Project,
  positions: Record<string, Vec3>,
  wearerAnchors: Partial<Record<WearerAnchor, Vec3>>,
  opts: MassInventoryOptions = {},
): MassInventory {
  const masses: WorldMass[] = [];
  const mech = project.mechanism;

  // Distributed pipe masses: each drawn segment contributes density × length
  // at its midpoint, using the same linear densities the equilibrium solver
  // and BOM use (src/design/densities.ts; telescopes get the effective
  // density reproducing their BOM member masses).
  if (opts.includePipeMass !== false) {
    const densities = elementLinearDensities(mech, project.materials);
    const seg = (elId: string, i: number, a: Vec3, b: Vec3, kgPerM: number, name?: string) => {
      const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (len <= 0) return;
      masses.push({
        id: `${elId}:seg:${i}`,
        name: name ?? mech.name,
        massKg: kgPerM * len,
        world: scale(add(a, b), 0.5),
        source: 'link',
      });
    };
    for (const el of mech.elements) {
      const d = densities[el.id];
      if (d == null) continue;
      if (el.type === 'link' || el.type === 'telescope') {
        const a = positions[el.nodeA];
        const b = positions[el.nodeB];
        if (a && b) seg(el.id, 0, a, b, d, el.subsystemTag);
      } else if (el.type === 'bentLink') {
        for (let i = 1; i < el.nodeIds.length; i++) {
          const a = positions[el.nodeIds[i - 1]!];
          const b = positions[el.nodeIds[i]!];
          if (a && b) seg(el.id, i - 1, a, b, d, el.subsystemTag);
        }
      }
    }
  }

  const resolveAttach = (attach: Project['pointMasses'][number]['attach']): Vec3 | null =>
    attach.kind === 'node'
      ? (positions[attach.nodeId] ?? null)
      : (wearerAnchors[attach.anchor] ?? null);

  // Explicit project-level point masses.
  for (const pm of project.pointMasses) {
    const world = resolveAttach(pm.attach);
    if (!world || pm.massKg <= 0) continue;
    masses.push({ id: pm.id, name: pm.name, massKg: pm.massKg, world, source: 'pointMass' });
  }

  // Foam plates: mass = area × sheet areal density, located at the attach point.
  for (const fp of project.foamPlates) {
    const world = resolveAttach(fp.attach);
    if (!world) continue;
    const area = fp.areaM2 ?? (fp.polygon ? polygonAreaM2(fp.polygon) : 0);
    const density = fp.sheetMaterialId
      ? (project.materials.sheets.find((s) => s.id === fp.sheetMaterialId)?.arealDensityKgPerM2 ??
        0)
      : 0;
    const massKg = area * density;
    if (massKg <= 0) continue;
    masses.push({ id: fp.id, name: fp.name, massKg, world, source: 'foamPlate' });
  }

  let totalMassKg = 0;
  let acc: Vec3 = { x: 0, y: 0, z: 0 };
  for (const m of masses) {
    totalMassKg += m.massKg;
    acc = add(acc, scale(m.world, m.massKg));
  }
  const cg = totalMassKg > 0 ? scale(acc, 1 / totalMassKg) : { x: 0, y: 0, z: 0 };

  return { masses, totalMassKg, cg };
}

/** Shoelace area of a simple polygon (plate-local 2D coordinates). */
export function polygonAreaM2(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}
