import { describe, expect, it } from 'vitest';
import { defaultPlacement } from '../../assembly';
import { PANEL_FRAME, panelForOrientation, projectToLocal, projectToPanel } from './panelProject';

describe('panelForOrientation', () => {
  it('routes each orientation to its editing panel', () => {
    expect(panelForOrientation('top')).toBe('top');
    expect(panelForOrientation('side-left')).toBe('side');
    expect(panelForOrientation('side-right')).toBe('side');
    expect(panelForOrientation('front')).toBe('front');
    expect(panelForOrientation('back')).toBe('front');
    expect(panelForOrientation('free')).toBe('front');
  });
});

describe('projectToPanel', () => {
  it('side panel is the world x-y plane; top panel is x-z', () => {
    const w = { x: 1, y: 2, z: 3 };
    expect(projectToPanel(w, PANEL_FRAME.side)).toEqual({ x: 1, y: 2 });
    expect(projectToPanel(w, PANEL_FRAME.top)).toEqual({ x: 1, y: 3 });
    // front panel: screen-right is −z, screen-up is y
    expect(projectToPanel(w, PANEL_FRAME.front)).toEqual({ x: -3, y: 2 });
  });
});

describe('projectToLocal', () => {
  it('inverts the default side-left placement lift', () => {
    const { position, quaternion } = defaultPlacement('side-left');
    // local (0.4, 1.1) lifted: world = position + 0.4·x̂ + 1.1·ŷ
    const world = { x: position.x + 0.4, y: position.y + 1.1, z: position.z };
    const local = projectToLocal(world, position, quaternion, false);
    expect(local.x).toBeCloseTo(0.4, 10);
    expect(local.y).toBeCloseTo(1.1, 10);
  });

  it('inverts the top placement lift and honors mirror', () => {
    const { position, quaternion } = defaultPlacement('top');
    // top frame: local +x → world +x, local +y → world +z
    const world = { x: position.x + 0.2, y: position.y, z: position.z + 0.7 };
    expect(projectToLocal(world, position, quaternion, false).x).toBeCloseTo(0.2, 10);
    expect(projectToLocal(world, position, quaternion, false).y).toBeCloseTo(0.7, 10);
    expect(projectToLocal(world, position, quaternion, true).x).toBeCloseTo(-0.2, 10);
  });
});
