// Phase 4 browser smoke (§11 "full-example assembly renders"): load the
// full-creature example, switch to the 3D Assembly mode, and confirm the WebGL
// viewport mounts and the analysis sidebar reports a plausible creature mass —
// with no page errors. Composition correctness (walk animation, CG shift,
// seesaw moment ±2%) is covered by the pure acceptance suite; this guards the
// r3f wiring end-to-end in the built app.
import { expect, test } from '@playwright/test';

// A second e2e spec must not re-declare the global Window.__riglab type (it is
// declared in sketch.spec.ts); reach the seam through a local cast instead.
interface AssemblyHook {
  loadExample(id: string): void;
  getEditor(): { mode: string };
  getAssemblyStats(): {
    render: string;
    totalMassKg: number;
    placedCount: number;
    unplacedCount: number;
    primCount: number;
    pipeCount: number;
    fittingCount: number;
  } | null;
}

test('3D assembly mode renders the full creature with a live mass readout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  // reach the editor (the __riglab seams mount there), then swap in the example
  await page.getByTestId('new-project-name').fill('Assembly check');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('project-name-input')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __riglab: AssemblyHook }).__riglab.loadExample('example-full-creature'),
  );

  // switch to 3D
  await page.getByTestId('mode-3d').click();
  await expect(page.getByTestId('mode-3d')).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.evaluate(
      () => (window as unknown as { __riglab: AssemblyHook }).__riglab.getEditor().mode,
    ),
  ).resolves.toBe('3d');

  // WebGL canvas mounted + analysis sidebar shows a plausible creature mass
  await expect(page.locator('canvas')).toBeVisible();
  const massText = page.getByText(/kg$/).first();
  await expect(massText).toBeVisible();
  const total = await massText.textContent();
  const kg = Number.parseFloat(total ?? '0');
  expect(kg).toBeGreaterThan(1);
  expect(kg).toBeLessThan(30);

  // seesaw balance readout present
  await expect(page.getByText('Seesaw balance')).toBeVisible();
  await expect(page.getByText(/N·m/).first()).toBeVisible();

  // pipe-model toggle (PLANFILE-quad-workspace slice 3): switch render and
  // confirm the solved model has pipe segments and joint bodies
  await page.getByRole('button', { name: 'Pipe model' }).click();
  const stats = await page.evaluate(() =>
    (window as unknown as { __riglab: AssemblyHook }).__riglab.getAssemblyStats(),
  );
  expect(stats).not.toBeNull();
  expect(stats!.render).toBe('pipe');
  expect(stats!.pipeCount).toBeGreaterThan(0);
  // joint bodies (fittings/bands/sleeves/blobs) beyond the bare pipe runs
  expect(stats!.primCount).toBeGreaterThan(stats!.pipeCount);
  await expect(page.locator('canvas')).toBeVisible();

  expect(errors).toEqual([]);
});
