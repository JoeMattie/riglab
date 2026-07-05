// Quad-workspace browser smoke, 3D-conversion edition: the quad IS the app.
// Load the full-creature compound example, confirm all four panels mount
// (three editable ortho sketch canvases + the WebGL perspective panel), the
// analysis sidebar reports a plausible creature mass, and the pipe-model
// render toggle produces pipes plus joint bodies — with no page errors.
// Composition/solve correctness is covered by the pure acceptance suites;
// this guards the r3f + quad wiring end-to-end in the built app.
import { expect, test } from '@playwright/test';

// A second e2e spec must not re-declare the global Window.__riglab type (it is
// declared in sketch.spec.ts); reach the seam through a local cast instead.
interface QuadHook {
  loadExample(id: string): void;
  getEditor(): { activePanel: string; quadMaximized: string | null };
  getAssemblyStats(): {
    render: string;
    nodeCount: number;
    elementCount: number;
    groupCount: number;
    totalMassKg: number;
    primCount: number;
    pipeCount: number;
    fittingCount: number;
  } | null;
}

test('quad workspace renders the full creature with live mass and pipe model', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  // reach the editor (the __riglab seams mount there), then swap in the example
  await page.getByTestId('new-project-name').fill('Quad check');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('project-name-input')).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { __riglab: QuadHook }).__riglab.loadExample('example-full-creature'),
  );

  // all four panels mount; the three ortho panels each host a full editor
  for (const id of ['top', 'persp', 'front', 'side']) {
    await expect(page.getByTestId(`quad-panel-${id}`)).toBeVisible();
  }
  for (const p of ['top', 'front', 'side']) {
    await expect(page.getByTestId(`sketch-canvas-${p}`)).toBeVisible();
  }
  // WebGL canvas mounted in the perspective panel
  await expect(page.getByTestId('quad-panel-persp').locator('canvas')).toBeVisible();

  // the compound document is one mechanism with groups
  const stats = await page.evaluate(() =>
    (window as unknown as { __riglab: QuadHook }).__riglab.getAssemblyStats(),
  );
  expect(stats).not.toBeNull();
  expect(stats!.nodeCount).toBeGreaterThan(50);
  expect(stats!.groupCount).toBeGreaterThanOrEqual(8);
  // plausible wearable-creature mass
  expect(stats!.totalMassKg).toBeGreaterThan(1);
  expect(stats!.totalMassKg).toBeLessThan(30);

  // analysis sidebar shows the mass + seesaw balance readouts
  await expect(page.getByTestId('analysis-sidebar')).toBeVisible();
  await expect(page.getByText(/kg$/).first()).toBeVisible();
  await expect(page.getByText(/N·m/).first()).toBeVisible();

  // pipe-model toggle: switch render and confirm pipes plus joint bodies
  await page.getByTestId('render-pipe').click();
  const pipeStats = await page.evaluate(() =>
    (window as unknown as { __riglab: QuadHook }).__riglab.getAssemblyStats(),
  );
  expect(pipeStats!.render).toBe('pipe');
  expect(pipeStats!.pipeCount).toBeGreaterThan(0);
  // joint bodies (fittings/bands/sleeves/blobs) beyond the bare pipe runs
  expect(pipeStats!.primCount).toBeGreaterThan(pipeStats!.pipeCount);

  // double-click a panel header maximizes it; again restores the grid
  await page.getByRole('button', { name: 'Perspective', exact: true }).dblclick();
  await expect(page.getByTestId('quad-panel-top')).toHaveCount(0);
  await page.getByRole('button', { name: 'Perspective', exact: true }).dblclick();
  await expect(page.getByTestId('quad-panel-top')).toBeVisible();

  expect(errors).toEqual([]);
});
