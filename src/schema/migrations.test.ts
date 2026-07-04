import { describe, expect, it } from 'vitest';
import { fixtureProject, fixtureProjectV1 } from './fixtures';
import {
  applyMigrations,
  type Migration,
  MigrationError,
  migrateToLatest,
  migrations,
} from './migrations';
import { SCHEMA_VERSION } from './project';

describe('migration registry', () => {
  it('has a migration for every version between 1 and current', () => {
    for (let v = 1; v < SCHEMA_VERSION; v++) {
      expect(migrations[v], `missing migration from v${v}`).toBeTypeOf('function');
    }
  });
});

describe('applyMigrations pipeline (synthetic registry)', () => {
  const registry: Record<number, Migration> = {
    5: (doc) => ({ ...doc, addedInV6: true }),
    6: (doc) => ({ ...doc, addedInV7: 'yes' }),
  };

  it('chains migrations and stamps intermediate versions', () => {
    const out = applyMigrations({ schemaVersion: 5, name: 'x' }, 5, 7, registry);
    expect(out).toEqual({ schemaVersion: 7, name: 'x', addedInV6: true, addedInV7: 'yes' });
  });

  it('throws a MigrationError when a step is missing', () => {
    expect(() => applyMigrations({ schemaVersion: 4 }, 4, 7, registry)).toThrow(MigrationError);
  });
});

describe('v1 → v2 migration', () => {
  it('upgrades a Phase 0 document: empty skeletonBindings, default wearer', () => {
    const migrated = migrateToLatest(fixtureProjectV1());
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.mechanisms[0]!.skeletonBindings).toEqual([]);
    expect(migrated.wearer).toEqual({ heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 });
    // nothing else was touched
    expect(migrated.mechanisms[0]!.elements).toEqual(fixtureProject().mechanisms[0]!.elements);
  });
});

describe('migrateToLatest', () => {
  it('passes a current-version document through validation', () => {
    const p = fixtureProject();
    expect(migrateToLatest(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });

  it('rejects documents from a newer app', () => {
    expect(() => migrateToLatest({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(/newer app/);
  });

  it('rejects a missing or invalid schemaVersion', () => {
    expect(() => migrateToLatest({})).toThrow(MigrationError);
    expect(() => migrateToLatest({ schemaVersion: 0 })).toThrow(MigrationError);
    expect(() => migrateToLatest({ schemaVersion: 'one' })).toThrow(MigrationError);
    expect(() => migrateToLatest(null)).toThrow(MigrationError);
  });

  it('rejects a structurally invalid document with a useful error', () => {
    expect(() => migrateToLatest({ schemaVersion: SCHEMA_VERSION, name: '' })).toThrow(
      /failed validation/,
    );
  });
});
