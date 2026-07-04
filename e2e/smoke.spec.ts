// Phase 0 smoke test (the seed that grows toward "create mechanism → drag →
// see BOM" in later phases): project lifecycle against the BUILT app —
// create two projects, survive a reload, autosave a rename, export, delete,
// re-import identically.
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('project lifecycle: create ×2, reload, autosave, export, delete, re-import', async ({
  page,
}) => {
  await page.goto('/');

  // create Alpha (lands in the editor), go back, create Beta
  await page.getByTestId('new-project-name').fill('Alpha');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('project-name-input')).toHaveValue('Alpha');
  await page.getByTestId('back-to-projects').click();
  await page.getByTestId('new-project-name').fill('Beta');
  await page.getByTestId('create-project').click();
  await page.getByTestId('back-to-projects').click();

  // both listed, newest first
  await expect(page.getByTestId('project-name')).toHaveText(['Beta', 'Alpha']);

  // survive a reload (IndexedDB persistence)
  await page.reload();
  await expect(page.getByTestId('project-name')).toHaveText(['Beta', 'Alpha']);

  // open Alpha, rename through the autosave path, watch the indicator settle
  await page.getByTestId('project-row').filter({ hasText: 'Alpha' }).getByTestId('open-project').click();
  await page.getByTestId('project-name-input').fill('Alpha 2');
  await expect(page.getByTestId('save-state')).toHaveText('saving…');
  await expect(page.getByTestId('save-state')).toHaveText('saved', { timeout: 5000 });

  // export the document
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-project').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('alpha-2.riglab.json');
  const path = await download.path();
  const exported = await readFile(path, 'utf8');
  const doc = JSON.parse(exported) as { name: string; schemaVersion: number; id: string };
  expect(doc.name).toBe('Alpha 2');
  expect(doc.schemaVersion).toBe(1);

  // the rename survives a reload (autosave really hit IndexedDB)
  await page.getByTestId('back-to-projects').click();
  await page.reload();
  await expect(page.getByTestId('project-name')).toHaveText(['Alpha 2', 'Beta']);

  // delete Alpha 2, then re-import the exported file — it comes back identical
  page.on('dialog', (d) => void d.accept());
  await page
    .getByTestId('project-row')
    .filter({ hasText: 'Alpha 2' })
    .getByTestId('delete-project')
    .click();
  await expect(page.getByTestId('project-name')).toHaveText(['Beta']);

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('import-project').click();
  const chooser = await fileChooserPromise;
  await chooser.setFiles({ name: 'alpha-2.riglab.json', mimeType: 'application/json', buffer: Buffer.from(exported) });
  await expect(page.getByTestId('project-name')).toHaveText(['Alpha 2', 'Beta']);

  // exported-then-imported document is identical: re-export and compare bytes
  await page
    .getByTestId('project-row')
    .filter({ hasText: 'Alpha 2' })
    .getByTestId('open-project')
    .click();
  const download2Promise = page.waitForEvent('download');
  await page.getByTestId('export-project').click();
  const download2 = await download2Promise;
  const reExported = await readFile(await download2.path(), 'utf8');
  expect(reExported).toBe(exported);
});
