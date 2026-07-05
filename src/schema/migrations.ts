import { type Project, projectSchema, SCHEMA_VERSION } from './project';

/** Migration from version N to N+1. Operates on plain JSON — never import
 * app code here; old documents must migrate forever. */
export type Migration = (doc: Record<string, unknown>) => Record<string, unknown>;

/** keyed by the version the migration upgrades FROM; every SCHEMA_VERSION
 * bump adds an entry (enforced by tests). */
export const migrations: Record<number, Migration> = {
  // v1 → v2: mechanisms gained skeletonBindings (empty for old docs);
  // project gained wearer mannequin params (defaults).
  1: (doc) => ({
    ...doc,
    mechanisms: Array.isArray(doc.mechanisms)
      ? (doc.mechanisms as Array<Record<string, unknown>>).map((m) => ({
          ...m,
          skeletonBindings: [],
        }))
      : doc.mechanisms,
    wearer: { heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 },
  }),
  // v2 → v3: project gained bomSettings (§6.2); old docs get the defaults.
  2: (doc) => ({
    ...doc,
    bomSettings: { heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 },
  }),
  // v3 → v4: link/telescope gained OPTIONAL lengthLocked (absent = unlocked),
  // so v3 documents are already valid v4 documents — stamp only.
  3: (doc) => doc,
};

export class MigrationError extends Error {}

/** Run the migration chain from `from` (exclusive of `to`). Exported so the
 * chaining/stamping/missing-step behavior stays testable while the real
 * registry is still empty (version 1 is the first release). */
export function applyMigrations(
  doc: Record<string, unknown>,
  from: number,
  to: number,
  registry: Record<number, Migration>,
): Record<string, unknown> {
  let out = doc;
  for (let v = from; v < to; v++) {
    const step = registry[v];
    if (!step) throw new MigrationError(`no migration from schemaVersion ${v}`);
    out = { ...step(out), schemaVersion: v + 1 };
  }
  return out;
}

/** Upgrade an arbitrary parsed JSON document to the current schema and
 * validate it. Accepts documents written by any released schema version. */
export function migrateToLatest(
  raw: unknown,
  registry: Record<number, Migration> = migrations,
): Project {
  if (typeof raw !== 'object' || raw === null) {
    throw new MigrationError('project file is not an object');
  }
  let doc = raw as Record<string, unknown>;
  const version = doc.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new MigrationError(`invalid schemaVersion: ${String(version)}`);
  }
  if (version > SCHEMA_VERSION) {
    throw new MigrationError(
      `project was written by a newer app (schemaVersion ${version} > ${SCHEMA_VERSION})`,
    );
  }
  doc = applyMigrations(doc, version, SCHEMA_VERSION, registry);
  const parsed = projectSchema.safeParse(doc);
  if (!parsed.success) {
    throw new MigrationError(`project failed validation: ${parsed.error.message}`);
  }
  return parsed.data;
}
