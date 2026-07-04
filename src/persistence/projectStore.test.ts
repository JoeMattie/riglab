import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureProject } from '../schema/fixtures';
import { MigrationError } from '../schema';
import { createAutosaver } from './autosave';
import { REVISION_LIMIT, RigLabDb } from './db';
import { ProjectStore } from './projectStore';

let counter = 0;
function freshStore(name?: string): { store: ProjectStore; dbName: string } {
  const dbName = name ?? `test-db-${++counter}`;
  return { store: new ProjectStore(new RigLabDb(dbName)), dbName };
}

describe('ProjectStore', () => {
  it('creates two projects, lists them newest-first, reopens them', async () => {
    const { store, dbName } = freshStore();
    const a = await store.createProject('Alpha');
    await new Promise((r) => setTimeout(r, 5));
    const b = await store.createProject('Beta');

    const list = await store.listProjects();
    expect(list.map((p) => p.name)).toEqual(['Beta', 'Alpha']);

    // simulate an app reload: a brand-new connection to the same database
    store.close();
    const reopened = new ProjectStore(new RigLabDb(dbName));
    const list2 = await reopened.listProjects();
    expect(list2.map((p) => p.name)).toEqual(['Beta', 'Alpha']);
    expect(await reopened.loadProject(a.id)).toEqual(a);
    expect(await reopened.loadProject(b.id)).toEqual(b);
    reopened.close();
  });

  it('persists a full-fat document losslessly', async () => {
    const { store } = freshStore();
    const doc = { ...fixtureProject(), id: crypto.randomUUID() };
    await store.saveProject(doc);
    expect(await store.loadProject(doc.id)).toEqual(doc);
    store.close();
  });

  it(`keeps a rolling history of at most ${REVISION_LIMIT} revisions`, async () => {
    const { store } = freshStore();
    const doc = await store.createProject('Rev');
    for (let i = 0; i < REVISION_LIMIT + 7; i++) {
      await store.saveProject({ ...doc, name: `Rev ${i}` });
    }
    const revs = await store.listRevisions(doc.id);
    expect(revs.length).toBe(REVISION_LIMIT);
    // newest revision must be the last save
    const newest = await store.loadRevision(revs[revs.length - 1]!.revId);
    expect(newest?.name).toBe(`Rev ${REVISION_LIMIT + 6}`);
    store.close();
  });

  it('rename persists and bumps the summary', async () => {
    const { store } = freshStore();
    const doc = await store.createProject('Before');
    await store.renameProject(doc.id, 'After');
    expect((await store.loadProject(doc.id))?.name).toBe('After');
    expect((await store.listProjects())[0]?.name).toBe('After');
    store.close();
  });

  it('deleteProject removes the project and its revisions', async () => {
    const { store } = freshStore();
    const doc = await store.createProject('Doomed');
    await store.saveProject({ ...doc, name: 'Doomed 2' });
    await store.deleteProject(doc.id);
    expect(await store.loadProject(doc.id)).toBeUndefined();
    expect(await store.listRevisions(doc.id)).toEqual([]);
    store.close();
  });

  it('refuses to load a corrupt row', async () => {
    const dbName = `test-db-corrupt-${++counter}`;
    const db = new RigLabDb(dbName);
    await db.projects.put({
      id: 'bad',
      name: 'bad',
      updatedAt: Date.now(),
      doc: { schemaVersion: 1, nonsense: true } as never,
    });
    const store = new ProjectStore(db);
    await expect(store.loadProject('bad')).rejects.toThrow(MigrationError);
    store.close();
  });
});

describe('autosave debounce', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces rapid schedules into one save of the latest doc', async () => {
    vi.useFakeTimers();
    const saved: string[] = [];
    const saver = createAutosaver(async (doc) => {
      saved.push(doc.name);
    }, 1000);
    const doc = fixtureProject();
    saver.schedule({ ...doc, name: 'v1' });
    await vi.advanceTimersByTimeAsync(400);
    saver.schedule({ ...doc, name: 'v2' });
    await vi.advanceTimersByTimeAsync(400);
    saver.schedule({ ...doc, name: 'v3' });
    expect(saver.isDirty()).toBe(true);
    await vi.advanceTimersByTimeAsync(1100);
    expect(saved).toEqual(['v3']);
    expect(saver.isDirty()).toBe(false);
  });

  it('flush saves a pending doc immediately', async () => {
    vi.useFakeTimers();
    const saved: string[] = [];
    const saver = createAutosaver(async (doc) => {
      saved.push(doc.name);
    }, 1000);
    saver.schedule({ ...fixtureProject(), name: 'pending' });
    await saver.flush();
    expect(saved).toEqual(['pending']);
  });

  it('cancel drops a pending save', async () => {
    vi.useFakeTimers();
    const saved: string[] = [];
    const saver = createAutosaver(async (doc) => {
      saved.push(doc.name);
    }, 1000);
    saver.schedule({ ...fixtureProject(), name: 'dropped' });
    saver.cancel();
    await vi.advanceTimersByTimeAsync(2000);
    expect(saved).toEqual([]);
    expect(saver.isDirty()).toBe(false);
  });
});
