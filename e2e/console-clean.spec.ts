// Console-cleanliness smoke (dev-console Playwright project): load every
// bundled example and walk the surfaces a user touches — marquee multi-select
// in an ortho panel, both editor faces, all four design-dock tabs, clip
// playback — asserting the browser console stays free of errors. Runs against
// the DEV server because React render diagnostics (duplicate keys, invalid
// props, setState-in-render) are stripped from production builds; the regression
// that motivated this spec was a duplicate-key warning from shared joint nodes
// in the selected-pipe endpoint handles. Feature behavior stays in the built-app
// specs and Vitest — this spec only guards "nothing renders dirty".
import { expect, test } from '@playwright/test';

// sketch.spec.ts owns the global Window.__riglab declaration; reach the seam
// through a local cast instead (same pattern as assembly.spec.ts)
interface ConsoleHook {
  loadExample(id: string): void;
  getEditor(): { selectedElementIds: string[] };
}

const EXAMPLE_IDS = [
  'example-seesaw-spine',
  'example-neck-truss',
  'example-steer-mirror',
  'example-jaw-bowden',
  'example-leg-exoskeleton',
  'example-tail',
  'example-full-creature',
];

test('every bundled example renders and survives a UI sweep with a clean console', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e)}`));
  // fail fast with the offending example in the message
  const expectClean = (context: string) =>
    expect(errors, `console errors after ${context}:\n${errors.join('\n---\n')}`).toEqual([]);

  await page.goto('/');
  await page.getByTestId('new-project-name').fill('Console sweep');
  await page.getByTestId('create-project').click();
  await expect(page.getByTestId('project-name-input')).toBeVisible();

  for (const id of EXAMPLE_IDS) {
    await page.evaluate(
      (exId) => (window as unknown as { __riglab: ConsoleHook }).__riglab.loadExample(exId),
      id,
    );
    for (const p of ['top', 'front', 'side']) {
      await expect(page.getByTestId(`sketch-canvas-${p}`)).toBeVisible();
    }
    await expect(page.getByTestId('quad-panel-persp').locator('canvas')).toBeVisible();

    // marquee multi-select across the top panel — selected pipes sharing
    // joint nodes must not render duplicate-key endpoint handles
    const box = await page.getByTestId('quad-panel-top').boundingBox();
    if (!box) throw new Error('quad-panel-top has no bounding box');
    await page.mouse.move(box.x + 8, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8, { steps: 8 });
    await page.mouse.up();
    await expectClean(`${id}: marquee select`);

    // the design WINDOW hosts the tabbed inspector/checklist/materials/BOM —
    // render each tab against this example (with the marquee selection live)
    await page.getByTestId('face-design').click();
    for (const tab of ['inspector', 'checklist', 'materials', 'bom']) {
      await page.getByTestId(`right-tab-${tab}`).click();
    }
    await expectClean(`${id}: design-window tabs`);
    await page.getByTestId('design-window-close').click();
    await page.keyboard.press('Escape');
  }

  // the marquee scenario is only a regression guard if it really multi-selects;
  // prove it on the leg exoskeleton, whose linkage sits inside the default view
  await page.evaluate(() =>
    (window as unknown as { __riglab: ConsoleHook }).__riglab.loadExample(
      'example-leg-exoskeleton',
    ),
  );
  const box = await page.getByTestId('quad-panel-top').boundingBox();
  if (!box) throw new Error('quad-panel-top has no bounding box');
  await page.mouse.move(box.x + 8, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 8, box.y + box.height - 8, { steps: 8 });
  await page.mouse.up();
  const selected = await page.evaluate(
    () => (window as unknown as { __riglab: ConsoleHook }).__riglab.getEditor().selectedElementIds,
  );
  expect(selected.length).toBeGreaterThan(1);

  // clip playback re-renders every panel per frame — a per-frame warning
  // would flood the console here
  await page.keyboard.press('Escape');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press(' ');
  await page.waitForTimeout(1500);
  await page.keyboard.press(' ');
  await expectClean('playback');
});
