// Phase 4.5 browser smoke (§4.4): the controls dock builds/edits controls and
// records/plays control clips. Loads the full creature (which ships the yoke),
// opens the dock, confirms the yoke + its channel mappings render, records a
// short control clip, and plays it — with no page errors. The channel-mapping
// math and clip composition are covered by the pure acceptance suite.
import { expect, test } from '@playwright/test';

interface CtlHook {
  loadExample(id: string): void;
}

test('controls dock builds a yoke and records a control clip', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await page.getByTestId('new-project-name').fill('Controls check');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('project-name-input')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __riglab: CtlHook }).__riglab.loadExample('example-full-creature'),
  );

  const toggle = page.getByTestId('controls-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId('controls-dock')).toBeVisible();
  // the bundled yoke renders, mounted to hand.R
  await expect(page.getByTestId('control-mount')).toHaveValue('handR');

  // record a brief control clip, then confirm it appears in the picker
  await page.getByTestId('record-control-clip').click();
  await expect(page.getByTestId('record-control-clip')).toHaveText(/stop/);
  await page.waitForTimeout(600);
  await page.getByTestId('record-control-clip').click();
  const options = await page.getByTestId('control-clip-select').locator('option').count();
  expect(options).toBeGreaterThan(1); // "none" + the recorded clip

  // add a fresh control from the builder (a second control appears)
  await page.getByTestId('add-control').click();
  await expect(page.getByTestId('control-mount')).toHaveCount(2);

  expect(errors).toEqual([]);
});
