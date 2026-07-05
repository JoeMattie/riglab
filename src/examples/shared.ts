// Shared scaffolding for the bundled §9 example projects. Each example file
// exports a mechanism builder (used standalone AND composed into the full-
// creature example) plus a project builder wrapping it in the standard
// project shell. Geometry helpers keep rope/elastic rest lengths derived from
// the drawn node positions so the JSON artifacts can never drift from the
// coordinates.

import type { Assembly, Mechanism, Project, Vec2 } from '../schema';
import {
  DEFAULT_BOM_SETTINGS,
  DEFAULT_WEARER,
  emptyAssembly,
  SCHEMA_VERSION,
  seedMaterialsDb,
} from '../schema';

export function exampleProject(
  id: string,
  name: string,
  mechanisms: Mechanism[],
  assembly: Assembly = emptyAssembly(),
): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    name,
    unitsPreference: 'imperial',
    materials: seedMaterialsDb(),
    mechanisms,
    assembly,
    wearer: { ...DEFAULT_WEARER },
    wearerAnchorOverrides: {},
    bomSettings: { ...DEFAULT_BOM_SETTINGS },
  };
}

/** Distance between two drawn points, rounded to 0.1 mm so rope/elastic rest
 * lengths in the JSON artifacts stay stable across float formatting. */
export function dist(a: Vec2, b: Vec2): number {
  return Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 1e4) / 1e4;
}

// Common material ids from the seed DB (§6.1).
export const PIPE_050 = 'pipe-nps-sch40-050';
export const PIPE_075 = 'pipe-nps-sch40-075';
export const PIPE_CLS200_075 = 'pipe-nps-cls200-075';
export const PIPE_CTS_050 = 'pipe-cts-cpvc-050';
export const PIPE_CTS_075 = 'pipe-cts-cpvc-075';
export const CORD = 'cord-paracord550';
export const BUNGEE_6 = 'cord-bungee6';
export const BUNGEE_8 = 'cord-bungee8';
export const BOWDEN_CABLE = 'cord-bowden';
