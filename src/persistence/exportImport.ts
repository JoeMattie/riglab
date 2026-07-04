import { migrateToLatest, type Project, projectSchema } from '../schema';

/** Serialize a project for file export. Validates on the way out so a bug
 * can't write an unloadable file. */
export function exportProjectJson(doc: Project): string {
  return JSON.stringify(projectSchema.parse(doc), null, 2);
}

/** Parse an exported file: JSON → migrate (old versions welcome) → validate. */
export function importProjectJson(text: string): Project {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('not a JSON file');
  }
  return migrateToLatest(raw);
}

export function suggestedFileName(doc: Project): string {
  const slug = doc.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'project'}.riglab.json`;
}
