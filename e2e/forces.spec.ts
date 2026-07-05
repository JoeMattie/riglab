// Phase 2 forces UI plumbing, 3D-conversion edition: draw two pipes in the
// Side panel, route a rope between them, toggle equilibrium, add + lock an
// input channel, then inject an equilibrium readout to confirm the
// force-overlay plumbing renders. Physical numbers are NOT asserted here —
// the solver-math acceptance tests live in src/solver/acceptance/.
import { expect, type Page, test } from '@playwright/test';

// A second e2e spec must not re-declare the global Window.__riglab type (the
// sketch spec already augments it, with a different shape), so read the hook
// through a local cast instead.
interface RigLabHook {
  getDoc(): {
    mechanism: { elements: Array<{ id: string; type: string }> };
  };
  setEquilibrium(readout: {
    status: string;
    elementForces: Record<string, number>;
    requiredInputs: Record<string, number>;
    ropesRequiringCompression: string[];
  }): void;
}

async function mech(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __riglab: RigLabHook }).__riglab.getDoc().mechanism,
  );
}

test('draw a rope, toggle equilibrium, lock an input, render force plumbing', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-project-name').fill('Forces Smoke');
  await page.getByTestId('create-project').click();
  // the empty-state lands us in the maximized Side panel with the pipe tool
  await page.getByTestId('empty-start-drawing').click();

  const canvas = page.getByTestId('sketch-canvas-side');
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y];

  // two upright pipes to give the rope real endpoints
  const drawPipe = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(...at(x1, y1));
    await page.mouse.down();
    await page.mouse.move(...at((x1 + x2) / 2, (y1 + y2) / 2), { steps: 3 });
    await page.mouse.move(...at(x2, y2), { steps: 3 });
    await page.mouse.up();
  };
  await drawPipe(250, 420, 250, 320);
  await drawPipe(430, 420, 430, 320);

  // route a rope from the first pipe's top to the second's top
  await page.getByTestId('tool-rope').click();
  await page.mouse.click(...at(250, 320));
  await page.mouse.dblclick(...at(430, 320));

  let m = await mech(page);
  const rope = m.elements.find((e) => e.type === 'rope');
  expect(rope, 'a rope element was created').toBeTruthy();

  // draw an elastic between the two bottoms too (click-drag tool)
  await page.getByTestId('tool-elastic').click();
  await page.mouse.move(...at(250, 420));
  await page.mouse.down();
  await page.mouse.move(...at(430, 420), { steps: 4 });
  await page.mouse.up();
  m = await mech(page);
  expect(m.elements.some((e) => e.type === 'elastic')).toBe(true);

  // equilibrium ("forces") chip → solver status appears in the transport pill
  await page.getByTestId('equilibrium-toggle').click();
  await expect(page.getByTestId('solver-status')).toBeVisible();

  // input channels live in the transport pill's inputs popover: add a channel
  // and lock it — the slider freezes
  await page.getByTestId('inputs-toggle').click();
  await page.getByTestId('add-input').click();
  await expect(page.getByTestId('input-channel')).toHaveCount(1);
  await page.getByTestId('input-lock').click();
  await expect(page.getByTestId('input-slider')).toBeDisabled();

  // inject an equilibrium readout to drive the overlay plumbing (data path)
  const ropeId = rope!.id;
  await page.evaluate((id) => {
    const hook = (window as unknown as { __riglab: RigLabHook }).__riglab;
    hook.setEquilibrium({
      status: 'converged',
      elementForces: { [id]: 12.5 },
      requiredInputs: { 'input 1': 3.2 },
      ropesRequiringCompression: [id],
    });
  }, ropeId);

  await expect(page.getByTestId('solver-status')).toContainText('converged');
  await expect(page.getByTestId('required-input')).toContainText('needs');
  await expect(page.getByTestId('compression-warning')).toContainText('compression');
});
