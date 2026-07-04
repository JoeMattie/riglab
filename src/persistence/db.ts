import Dexie, { type EntityTable } from 'dexie';
import type { Project } from '../schema';

/** Rolling revision history kept per project (§3: "e.g., last 20 saves"). */
export const REVISION_LIMIT = 20;

export interface ProjectRow {
  id: string;
  name: string;
  updatedAt: number;
  doc: Project;
}

export interface RevisionRow {
  revId: number;
  projectId: string;
  savedAt: number;
  doc: Project;
}

export class RigLabDb extends Dexie {
  projects!: EntityTable<ProjectRow, 'id'>;
  revisions!: EntityTable<RevisionRow, 'revId'>;

  constructor(name = 'pvc-rig-lab') {
    super(name);
    this.version(1).stores({
      projects: 'id, updatedAt',
      revisions: '++revId, projectId, savedAt',
    });
  }
}
