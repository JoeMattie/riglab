// @vitest-environment jsdom
// Night view (day/night toggle): theme application, persistence, the actions
// chip toggle, and day/night palette integrity.
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getNightPref, setNightPref } from '../../persistence/prefs';
import { createEmptyProject } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { useThemeStore } from '../../state/themeStore';
import { ActionsChip } from './ActionsChip';
import { applyTheme, SCENE, scenePalette, T } from './theme';

beforeEach(() => {
  setNightPref(false);
  useThemeStore.setState({ night: false });
  applyTheme('day');
  useAppStore.setState({ current: createEmptyProject('p1', 'test') });
  useEditorStore.setState({ mode: '2d', face: 'sketch' });
});

afterEach(cleanup);

describe('applyTheme', () => {
  it('night sets the .dark class and night variable values; day reverts both', () => {
    const root = document.documentElement;
    applyTheme('night');
    expect(root.classList.contains('dark')).toBe(true);
    const nightBg = root.style.getPropertyValue('--rl-bg');
    applyTheme('day');
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.style.getPropertyValue('--rl-bg')).not.toBe(nightBg);
  });

  it('every T color token resolves to a --rl variable that applyTheme defines', () => {
    applyTheme('day');
    const root = document.documentElement;
    for (const [key, value] of Object.entries(T)) {
      if (key === 'sans' || key === 'mono') continue;
      expect(value).toBe(`var(--rl-${key})`);
      expect(root.style.getPropertyValue(`--rl-${key}`)).not.toBe('');
    }
  });
});

describe('themeStore', () => {
  it('toggleNight flips the flag and persists the preference', () => {
    expect(useThemeStore.getState().night).toBe(false);
    useThemeStore.getState().toggleNight();
    expect(useThemeStore.getState().night).toBe(true);
    expect(getNightPref()).toBe(true);
    useThemeStore.getState().toggleNight();
    expect(useThemeStore.getState().night).toBe(false);
    expect(getNightPref()).toBe(false);
  });
});

describe('scene palettes', () => {
  it('day and night expose the same keys, and scenePalette picks by flag', () => {
    expect(Object.keys(SCENE.night).sort()).toEqual(Object.keys(SCENE.day).sort());
    expect(scenePalette(false)).toBe(SCENE.day);
    expect(scenePalette(true)).toBe(SCENE.night);
  });
});

describe('ActionsChip night toggle', () => {
  it('clicking the toggle switches the store and reflects pressed state', () => {
    render(<ActionsChip />);
    const btn = screen.getByTestId('night-toggle');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      fireEvent.click(btn);
    });
    expect(useThemeStore.getState().night).toBe(true);
    expect(screen.getByTestId('night-toggle').getAttribute('aria-pressed')).toBe('true');
  });
});
