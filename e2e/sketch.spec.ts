// Phase 1 smoke, 3D-conversion edition: create a project, land in the
// maximized Side panel via the empty-state, draw a four-bar with three
// chained pipes and two double-click anchors (which materialize ground
// hinges), verify DOF 1 · mechanism, drag the crank tip, and confirm the
// 3D geometry held and stayed in the panel plane.
import { expect, type Page, test } from '@playwright/test';

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface RigLabHook {
  getDoc(): {
    mechanism: {
      nodes: Array<{ id: string; kind: string; position: Vec3 }>;
      elements: Array<{ type: string }>;
    };
  };
  getEditor(): {
    dof: { dof: number; classification: string } | null;
    activePanel: string;
  };
}

declare global {
  interface Window {
    __riglab: RigLabHook;
  }
}

async function mech(page: Page) {
  return page.evaluate(() => window.__riglab.getDoc().mechanism);
}

test('sketch a four-bar in the Side panel, anchor it, drag it — DOF 1 and lengths hold', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByTestId('new-project-name').fill('Sketch Smoke');
  await page.getByTestId('create-project').click();
  // the empty-state lands us in the maximized Side panel with the pipe tool
  await page.getByTestId('empty-start-drawing').click();
  await expect(page.getByTestId('dof-badge')).toBeVisible();

  const canvas = page.getByTestId('sketch-canvas-side');
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
  await drawPipe(250, 420, 250, 340);
  await drawPipe(250, 340, 400, 320);
  await drawPipe(400, 320, 420, 420);

  let m = await mech(page);
  // v7 hinge-by-default: snap-connect materializes an explicit hinge pivot
  // (a bare shared node in 3D would be spherical)
  expect(m.elements.map((e) => e.type)).toEqual(['link', 'link', 'pivot', 'link', 'pivot']);
  expect(m.nodes).toHaveLength(4);
  // drawn in the Side panel at the default work plane
  for (const n of m.nodes) expect(Math.abs(n.position.z)).toBeLessThan(1e-9);

  // double-click the two ground nodes to anchor them: anchoring materializes
  // a GROUND HINGE (axis = panel normal), so the four-bar is the classic
  // DOF 1 planar mechanism instead of coning about spherical anchors
  await page.getByTestId('tool-select').click();
  await page.mouse.dblclick(...at(250, 420));
  await page.mouse.dblclick(...at(420, 420));
  m = await mech(page);
  expect(m.elements.filter((e) => e.type === 'pivot')).toHaveLength(4);
  await expect(page.getByTestId('dof-badge')).toHaveText(/DOF 1 · mechanism/);

  const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const linkIdx = (mm: Awaited<ReturnType<typeof mech>>) =>
    mm.elements.flatMap((e, i) => (e.type === 'link' ? [i] : []));
  const lengthOf = (mm: Awaited<ReturnType<typeof mech>>, i: number): number => {
    const el = mm.elements[i]! as unknown as { nodeA: string; nodeB: string };
    const byId = new Map(mm.nodes.map((n) => [n.id, n.position]));
    return dist(byId.get(el.nodeA)!, byId.get(el.nodeB)!);
  };
  m = await mech(page);
  const before = linkIdx(m).map((i) => lengthOf(m, i));
  const tipBefore = m.nodes[1]!.position;

  // drag the crank tip through an arc
  await page.mouse.move(...at(250, 340));
  await page.mouse.down();
  await page.mouse.move(...at(280, 355), { steps: 4 });
  await page.mouse.move(...at(300, 380), { steps: 4 });
  await page.mouse.up();

  m = await mech(page);
  const after = linkIdx(m).map((i) => lengthOf(m, i));
  const debugState = JSON.stringify({ before, after, nodes: m.nodes });
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(after[i]! - before[i]!), debugState).toBeLessThan(1e-3);
  }
  // the crank tip actually moved a real distance, staying in the panel plane
  const tipAfter = m.nodes[1]!.position;
  expect(dist(tipAfter, tipBefore)).toBeGreaterThan(0.08);
  // the ground hinges keep the sketch strictly in its panel plane
  expect(Math.abs(tipAfter.z)).toBeLessThan(1e-6);
  await expect(page.getByTestId('dof-badge')).toHaveText(/DOF 1 · mechanism/);

  // undo steps: drag → anchor O4 (incl. its ground hinge) → anchor O2 →
  // rocker (link + its moving hinge in one gesture step)
  await page.getByTestId('undo').click(); // un-drag (one step per gesture)
  await page.getByTestId('undo').click(); // un-anchor O4
  m = await mech(page);
  expect(m.nodes.filter((n) => n.kind === 'anchor')).toHaveLength(1);
  expect(m.elements).toHaveLength(6);
  await page.getByTestId('undo').click(); // un-anchor O2
  await page.getByTestId('undo').click(); // remove the rocker + its pivot
  m = await mech(page);
  expect(m.elements).toHaveLength(3);
});
