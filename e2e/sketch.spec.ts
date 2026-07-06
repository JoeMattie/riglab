// Phase 1 smoke, 3D-conversion edition: create a project, land in the
// maximized Side panel via the empty-state, draw a four-bar with three
// chained pipes and two double-click anchors (which materialize ground
// hinges), verify DOF 1 · mechanism, then exercise both drag regimes
// (PLANFILE-multiselect-drag-constraints): constraints OFF (default) frees
// the geometry — node drags change pipe lengths and a pipe-body drag
// translates the whole selection rigidly; constraints ON holds lengths
// through the solver and keeps the sketch in its panel plane.
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
      elements: Array<{ id: string; type: string }>;
    };
  };
  getEditor(): {
    dof: { dof: number; classification: string } | null;
    activePanel: string;
  };
  setSelection(ids: string[]): void;
}

declare global {
  interface Window {
    __riglab: RigLabHook;
  }
}

async function mech(page: Page) {
  return page.evaluate(() => window.__riglab.getDoc().mechanism);
}

test('sketch a four-bar, anchor it, drag it free and constrained — lengths follow the toggle', async ({
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

  // constraints default OFF: dragging the crank tip is a FREE geometry edit —
  // the pipe length follows the pointer instead of holding
  await expect(page.getByTestId('constraints-toggle')).toHaveAttribute('aria-pressed', 'false');
  await page.mouse.move(...at(250, 340));
  await page.mouse.down();
  await page.mouse.move(...at(290, 310), { steps: 4 });
  await page.mouse.move(...at(320, 300), { steps: 4 });
  await page.mouse.up();
  m = await mech(page);
  const freeLengths = linkIdx(m).map((i) => lengthOf(m, i));
  expect(Math.abs(freeLengths[0]! - before[0]!)).toBeGreaterThan(0.05);
  await page.getByTestId('undo').click(); // restore the four-bar

  // multi-select + body drag (constraints still off): with all three pipes
  // selected, dragging one pipe's BODY translates the whole selection
  // rigidly — every node shifts by the same delta, lengths unchanged
  await page.evaluate(() => {
    const d = window.__riglab.getDoc();
    window.__riglab.setSelection(
      d.mechanism.elements.flatMap((e) => (e.type === 'link' ? [e.id] : [])),
    );
  });
  m = await mech(page);
  const nodesBefore = new Map(m.nodes.map((n) => [n.id, n.position]));
  await page.mouse.move(...at(325, 330)); // on the coupler's span
  await page.mouse.down();
  await page.mouse.move(...at(355, 350), { steps: 4 });
  await page.mouse.move(...at(385, 370), { steps: 4 });
  await page.mouse.up();
  m = await mech(page);
  const groupLengths = linkIdx(m).map((i) => lengthOf(m, i));
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(groupLengths[i]! - before[i]!)).toBeLessThan(1e-6);
  }
  const first = m.nodes[0]!;
  const b0 = nodesBefore.get(first.id)!;
  const delta = { x: first.position.x - b0.x, y: first.position.y - b0.y };
  expect(Math.hypot(delta.x, delta.y)).toBeGreaterThan(0.05);
  for (const n of m.nodes) {
    const b = nodesBefore.get(n.id)!;
    expect(Math.abs(n.position.x - b.x - delta.x)).toBeLessThan(1e-6);
    expect(Math.abs(n.position.y - b.y - delta.y)).toBeLessThan(1e-6);
    expect(Math.abs(n.position.z - b.z)).toBeLessThan(1e-6);
  }
  // arrow-key nudge: with the selection still live, one press moves every
  // selected node by exactly one length-snap step (imperial: ½ in)
  const preNudge = new Map((await mech(page)).nodes.map((n) => [n.id, n.position]));
  await page.keyboard.press('ArrowRight');
  m = await mech(page);
  for (const n of m.nodes) {
    const b = preNudge.get(n.id)!;
    expect(Math.abs(dist(n.position, b) - 0.5 * 0.0254)).toBeLessThan(1e-6);
  }
  await page.getByTestId('undo').click(); // un-nudge
  await page.getByTestId('undo').click(); // un-group-drag — four-bar restored

  // constraints ON: drag the crank tip through an arc — lengths hold.
  // Clear the selection first: an endpoint of a SELECTED unlocked pipe
  // drags as a length edit, and this drag must exercise the pose solve.
  await page.evaluate(() => window.__riglab.setSelection([]));
  await page.getByTestId('constraints-toggle').click();
  await expect(page.getByTestId('constraints-toggle')).toHaveAttribute('aria-pressed', 'true');
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
