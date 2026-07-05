import { describe, expect, it } from 'vitest';
import {
  fixtureProject,
  fixtureProjectV1,
  fixtureProjectV2,
  fixtureProjectV3,
  fixtureProjectV4,
  fixtureProjectV5,
} from './fixtures';
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

describe('v1 → latest migration chain', () => {
  it('upgrades a Phase 0 document through every step: skeletonBindings, wearer, bomSettings', () => {
    const migrated = migrateToLatest(fixtureProjectV1());
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.mechanisms[0]!.skeletonBindings).toEqual([]);
    expect(migrated.mechanisms[0]!.anchorBindings).toEqual([]);
    expect(migrated.wearer).toEqual({ heightM: 1.75, shoulderWidthM: 0.46, hipWidthM: 0.36 });
    expect(migrated.bomSettings).toEqual({ heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 });
    // nothing else was touched
    expect(migrated.mechanisms[0]!.elements).toEqual(fixtureProject().mechanisms[0]!.elements);
  });
});

describe('v2 → v3 migration', () => {
  it('adds default bomSettings to a v2 document, leaving the rest intact', () => {
    const migrated = migrateToLatest(fixtureProjectV2());
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.bomSettings).toEqual({ heatWrapAllowanceFactor: 1.5, ropeWasteFactor: 1.2 });
    expect(migrated.mechanisms[0]!.skeletonBindings).toEqual(
      fixtureProject().mechanisms[0]!.skeletonBindings,
    );
    expect(migrated.wearer).toEqual(fixtureProject().wearer);
  });
});

describe('v3 → v4 migration', () => {
  it('re-stamps a v3 document unchanged (lengthLocked is optional)', () => {
    const migrated = migrateToLatest(fixtureProjectV3());
    expect(migrated).toEqual(fixtureProject());
  });
});

describe('v4 → v5 migration', () => {
  it('adds empty controls + controlClips arrays (§4.4)', () => {
    const v4 = fixtureProjectV4();
    expect(v4.controls).toBeUndefined();
    const migrated = migrateToLatest(v4);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.controls).toEqual([]);
    expect(migrated.controlClips).toEqual([]);
    expect(migrated).toEqual(fixtureProject());
  });
});

describe('v5 → v6 migration', () => {
  it('adds an empty anchorBindings array to each mechanism', () => {
    const v5 = fixtureProjectV5();
    expect((v5.mechanisms as Array<Record<string, unknown>>)[0]!.anchorBindings).toBeUndefined();
    const migrated = migrateToLatest(v5);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.mechanisms[0]!.anchorBindings).toEqual([]);
    // everything else survives intact
    expect(migrated.mechanisms[0]!.skeletonBindings).toEqual(
      fixtureProject().mechanisms[0]!.skeletonBindings,
    );
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
