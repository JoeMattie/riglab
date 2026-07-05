// Phase 1 smoke: the seed smoke grows (§3) — create a project, draw a
// four-bar with three chained pipes and two double-click anchors, verify
// DOF 1 · mechanism, drag the crank tip, and confirm geometry held.
import { expect, type Page, test } from '@playwright/test';

interface RigLabHook {
  getDoc(): {
    mechanisms: Array<{
      id: string;
      nodes: Array<{ kind: string; position: { x: number; y: number } }>;
      elements: Array<{ type: string }>;
    }>;
  };
  getEditor(): {
    activeMechanismId: string | null;
    dof: { dof: number; classification: string } | null;
  };
}

declare global {
  interface Window {
    __riglab: RigLabHook;
  }
}

async function activeMech(page: Page) {
  return page.evaluate(() => {
    const id = window.__riglab.getEditor().activeMechanismId;
    return window.__riglab.getDoc().mechanisms.find((m) => m.id === id)!;
  });
}

test('sketch a four-bar, anchor it, drag it — DOF 1 and lengths hold', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-project-name').fill('Sketch Smoke');
  await page.getByTestId('create-project').click();
  // the mechanism switcher lives in the project chip's menu (overhaul chrome)
  await page.getByTestId('mechanism-menu-button').click();
  await page.getByTestId('add-mechanism').click();
  await page.getByTestId('view-side-left').click();
  await expect(page.getByTestId('dof-badge')).toBeVisible();

  const canvas = page.getByTestId('sketch-canvas');
  const box = (await canvas.boundingBox())!;
  const at = (x: number, y: number): [number, number] => [box.x + x, box.y + y];
  const drawPipe = async (x1: number, y1: number, x2: number, y2: number) => {
    await page.mouse.move(...at(x1, y1));
    await page.mouse.down();
    await page.mouse.move(...at((x1 + x2) / 2, (y1 + y2) / 2), { steps: 3 });
    await page.mouse.move(...at(x2, y2), { steps: 3 });
    await page.mouse.up();
  };

  // three chained pipes: crank, coupler, rocker
  await page.getByTestId('tool-pipe').click();
  await drawPipe(250, 420, 250, 340);
  await drawPipe(250, 340, 400, 320);
  await drawPipe(400, 320, 420, 420);

  let mech = await activeMech(page);
  expect(mech.elements.map((e) => e.type)).toEqual(['link', 'link', 'link']);
  expect(mech.nodes).toHaveLength(4);

  // double-click the two ground nodes to anchor them → DOF 1 four-bar
  await page.getByTestId('tool-select').click();
  await page.mouse.dblclick(...at(250, 420));
  await page.mouse.dblclick(...at(420, 420));
  await expect(page.getByTestId('dof-badge')).toHaveText(/DOF 1 · mechanism/);

  mech = await activeMech(page);
  const lengthOf = (m: typeof mech, i: number): number => {
    const el = m.elements[i]! as unknown as { nodeA: string; nodeB: string };
    const byId = new Map(
      (m.nodes as Array<{ id?: string; kind: string; position: { x: number; y: number } }>).map(
        (n) => [(n as { id: string }).id, n.position],
      ),
    );
    const a = byId.get(el.nodeA)!;
    const b = byId.get(el.nodeB)!;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const before = [0, 1, 2].map((i) => lengthOf(mech, i));
  const tipBefore = mech.nodes[1]!.position;

  // drag the crank tip through an arc
  await page.mouse.move(...at(250, 340));
  await page.mouse.down();
  await page.mouse.move(...at(280, 355), { steps: 4 });
  await page.mouse.move(...at(300, 380), { steps: 4 });
  await page.mouse.up();

  mech = await activeMech(page);
  const after = [0, 1, 2].map((i) => lengthOf(mech, i));
  const debugState = JSON.stringify({ before, after, nodes: mech.nodes });
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(after[i]! - before[i]!), debugState).toBeLessThan(1e-3);
  }
  // and the crank tip actually moved a real distance
  const tipAfter = mech.nodes[1]!.position;
  expect(Math.hypot(tipAfter.x - tipBefore.x, tipAfter.y - tipBefore.y)).toBeGreaterThan(0.08);
  await expect(page.getByTestId('dof-badge')).toHaveText(/DOF 1 · mechanism/);

  // undo steps: drag → anchor O4 → anchor O2 → rocker
  await page.getByTestId('undo').click(); // un-drag (one step per gesture)
  await page.getByTestId('undo').click(); // un-anchor O4
  mech = await activeMech(page);
  expect(mech.nodes.filter((n) => n.kind === 'anchor')).toHaveLength(1);
  expect(mech.elements).toHaveLength(3);
  await page.getByTestId('undo').click(); // un-anchor O2
  await page.getByTestId('undo').click(); // remove the rocker
  mech = await activeMech(page);
  expect(mech.elements).toHaveLength(2);
});
