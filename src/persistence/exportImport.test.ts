import { describe, expect, it } from 'vitest';
import { fixtureProject } from '../schema/fixtures';
import { createEmptyProject } from '../schema';
import { exportProjectJson, importProjectJson, suggestedFileName } from './exportImport';

describe('JSON export/import', () => {
  it('round-trips a full-fat project identically', () => {
    const doc = fixtureProject();
    expect(importProjectJson(exportProjectJson(doc))).toEqual(doc);
  });

  it('round-trips an empty project identically', () => {
    const doc = createEmptyProject('e1', 'Empty');
    expect(importProjectJson(exportProjectJson(doc))).toEqual(doc);
  });

  it('re-exporting an import is byte-identical (canonical form)', () => {
    const once = exportProjectJson(fixtureProject());
    const twice = exportProjectJson(importProjectJson(once));
    expect(twice).toBe(once);
  });

  it('rejects non-JSON and invalid documents with useful errors', () => {
    expect(() => importProjectJson('not json at all')).toThrow(/not a JSON file/);
    expect(() => importProjectJson('{"schemaVersion":99}')).toThrow(/newer app/);
    expect(() => importProjectJson('{"schemaVersion":1}')).toThrow(/failed validation/);
  });

  it('suggests a safe file name', () => {
    const doc = { ...fixtureProject(), name: 'My Big Bird!! (v2)' };
    expect(suggestedFileName(doc)).toBe('my-big-bird-v2.riglab.json');
  });
});
