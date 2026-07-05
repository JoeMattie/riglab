import { describe, expect, it } from 'vitest';
import type { Vec2, Vec3 } from '../../schema';
import {
  PANEL_FRAME,
  panelDepthOf,
  panelToWorld,
  projectPositions,
  projectToPanel,
} from './panelProject';

const PANELS = ['top', 'front', 'side'] as const;

describe('projectToPanel', () => {
  it('side panel is the world x-y plane; top panel is x-z', () => {
    const w = { x: 1, y: 2, z: 3 };
    expect(projectToPanel(w, PANEL_FRAME.side)).toEqual({ x: 1, y: 2 });
    expect(projectToPanel(w, PANEL_FRAME.top)).toEqual({ x: 1, y: 3 });
    // front panel: screen-right is −z, screen-up is y
    expect(projectToPanel(w, PANEL_FRAME.front)).toEqual({ x: -3, y: 2 });
  });
});

describe('panelToWorld / panelDepthOf', () => {
  it('round-trips panel → world → panel at any depth, in every panel', () => {
    const p: Vec2 = { x: 0.37, y: -1.21 };
    for (const id of PANELS) {
      const f = PANEL_FRAME[id];
      for (const depth of [0, 0.25, -0.6]) {
        const w = panelToWorld(p, f, depth);
        const back = projectToPanel(w, f);
        expect(back.x).toBeCloseTo(p.x, 12);
        expect(back.y).toBeCloseTo(p.y, 12);
        expect(panelDepthOf(w, f)).toBeCloseTo(depth, 12);
      }
    }
  });

  it('round-trips world → panel + depth → world exactly', () => {
    const w: Vec3 = { x: 0.4, y: 1.3, z: -0.2 };
    for (const id of PANELS) {
      const f = PANEL_FRAME[id];
      const back = panelToWorld(projectToPanel(w, f), f, panelDepthOf(w, f));
      expect(back.x).toBeCloseTo(w.x, 12);
      expect(back.y).toBeCloseTo(w.y, 12);
      expect(back.z).toBeCloseTo(w.z, 12);
    }
  });

  it('depth 0 lands on the panel plane through the origin', () => {
    for (const id of PANELS) {
      const f = PANEL_FRAME[id];
      const w = panelToWorld({ x: 0.5, y: 0.5 }, f, 0);
      expect(panelDepthOf(w, f)).toBeCloseTo(0, 12);
    }
  });

  it('snapped-node depth adoption: lifting at another node’s depth connects exactly', () => {
    // a node drawn in the side panel at wearer-left offset z = 0.3
    const node: Vec3 = { x: 0.1, y: 1.0, z: 0.3 };
    const f = PANEL_FRAME.side;
    const adopted = panelDepthOf(node, f); // 0.3
    const placed = panelToWorld(projectToPanel(node, f), f, adopted);
    expect(placed).toEqual(node);
  });
});

describe('projectPositions', () => {
  it('projects every entry of a positions record', () => {
    const positions: Record<string, Vec3> = {
      a: { x: 1, y: 2, z: 3 },
      b: { x: -1, y: 0, z: 0.5 },
    };
    const out = projectPositions(positions, PANEL_FRAME.front);
    expect(out.a).toEqual({ x: -3, y: 2 });
    expect(out.b).toEqual({ x: -0.5, y: 0 });
  });
});
