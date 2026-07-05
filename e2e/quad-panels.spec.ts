// Quad panel controls smoke (PLANFILE-quad-panel-controls): the splitter
// DRAG is a genuine pointer gesture, so it lives here; everything the
// gesture drives (clamping, reflow, persistence, clipboard remap) is
// unit-tested in Vitest. Built app, no page errors.
import { expect, test } from '@playwright/test';

// Window.__riglab is declared in sketch.spec.ts; reach the seam through a
// local cast instead of re-declaring the global type.
interface EditorSnapshot {
  quadSplit: { x: number; y: number };
  panelsVisible: Record<'top' | 'persp' | 'front' | 'side', boolean>;
}

const snapshot = (page: import('@playwright/test').Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __riglab: { getEditor(): EditorSnapshot } }
      ).__riglab.getEditor() as unknown as EditorSnapshot,
  );

test('splitters drag and reset; top-bar toggles reflow the grid', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await page.getByTestId('new-project-name').fill('Panels check');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('quad-panel-side')).toBeVisible();
  // swap in a bundled example (assembly.spec pattern): an empty project
  // shows the onboarding overlay, which covers the splitters
  await page.evaluate(() =>
    (window as unknown as { __riglab: { loadExample(id: string): void } }).__riglab.loadExample(
      'example-seesaw-spine',
    ),
  );
  await expect(page.getByTestId('quad-splitter-v')).toBeVisible();

  // drag the vertical splitter to ~30% of the workspace width
  const splitter = page.getByTestId('quad-splitter-v');
  const box = (await splitter.boundingBox())!;
  const viewport = page.viewportSize()!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(viewport.width * 0.3, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const dragged = await snapshot(page);
  expect(dragged.quadSplit.x).toBeGreaterThan(0.25);
  expect(dragged.quadSplit.x).toBeLessThan(0.35);

  // double-click resets the axis to 50/50 (off-center: the exact middle of
  // the bar is the two-axis center handle, which sits on top)
  await splitter.dblclick({ position: { x: 3, y: 60 } });
  const reset = await snapshot(page);
  expect(reset.quadSplit.x).toBeCloseTo(0.5, 5);

  // hide the perspective panel from the top bar: 3 panels remain (the
  // reflow itself is unit-tested; here we assert the real DOM followed)
  await page.getByTestId('panel-toggle-persp').click();
  await expect(page.getByTestId('quad-panel-persp')).toHaveCount(0);
  for (const id of ['top', 'front', 'side']) {
    await expect(page.getByTestId(`quad-panel-${id}`)).toBeVisible();
  }
  expect((await snapshot(page)).panelsVisible.persp).toBe(false);

  // show it again
  await page.getByTestId('panel-toggle-persp').click();
  await expect(page.getByTestId('quad-panel-persp')).toBeVisible();

  expect(errors).toEqual([]);
});
