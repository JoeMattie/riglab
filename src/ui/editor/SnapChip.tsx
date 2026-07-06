// Top-bar snapping toggles (Joe's request): which snap sources attract while
// drawing and dragging — Grid / Ends / Pipes mirror findSnap's sources.
// Wearer skeleton/anchor points always snap (attachment targets, not
// construction aids). Shift+G/E/P toggle them from the keyboard.
import { useEffect } from 'react';
import { type SnapPrefs, useEditorStore } from '../../state/editorStore';
import { T, toggleChipStyle } from './theme';

const TOGGLES: Array<{ key: keyof SnapPrefs; label: string; hint: string; title: string }> = [
  { key: 'grid', label: 'Grid', hint: '⇧G', title: 'snap to the visible grid (Shift+G)' },
  {
    key: 'ends',
    label: 'Ends',
    hint: '⇧E',
    title: 'snap to pipe ends — drop joins them (Shift+E)',
  },
  {
    key: 'pipes',
    label: 'Pipes',
    hint: '⇧P',
    title: 'snap onto pipe bodies — drop splits & pins (Shift+P)',
  },
];

/** Shift+key → snap pref. Held on window so it works regardless of focus. */
const BY_KEY: Record<string, keyof SnapPrefs> = { g: 'grid', e: 'ends', p: 'pipes' };

export function SnapChip() {
  const snapPrefs = useEditorStore((s) => s.snapPrefs);
  const toggleSnapPref = useEditorStore((s) => s.toggleSnapPref);

  // Shift+G/E/P toggle the snap sources; skipped while typing and for other
  // modifier chords (⌘/Ctrl/Alt), matching the tool-pill shortcut contract
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      const pref = BY_KEY[e.key.toLowerCase()];
      if (pref) {
        e.preventDefault();
        useEditorStore.getState().toggleSnapPref(pref);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div data-testid="snap-toggles" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          font: `500 10.5px ${T.sans}`,
          letterSpacing: '.07em',
          textTransform: 'uppercase',
          color: T.faint,
          padding: '0 4px',
        }}
      >
        Snap
      </span>
      {TOGGLES.map(({ key, label, title }) => (
        <button
          key={key}
          type="button"
          data-testid={`snap-toggle-${key}`}
          aria-pressed={snapPrefs[key]}
          title={title}
          onClick={() => toggleSnapPref(key)}
          style={toggleChipStyle(snapPrefs[key])}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
