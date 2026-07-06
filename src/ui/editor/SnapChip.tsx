// Top-bar snapping toggles (Joe's request): which snap sources attract while
// drawing and dragging. Grid / Length / Ends / Pipes mirror findSnap's
// sources plus the endpoint-drag length tick; wearer skeleton/anchor points
// always snap (they are attachment targets, not construction aids).
import { type SnapPrefs, useEditorStore } from '../../state/editorStore';
import { T, toggleChipStyle } from './theme';

const TOGGLES: Array<{ key: keyof SnapPrefs; label: string; title: string }> = [
  { key: 'grid', label: 'Grid', title: 'snap to the visible grid' },
  { key: 'ends', label: 'Ends', title: 'snap to pipe ends (drop joins them)' },
  { key: 'pipes', label: 'Pipes', title: 'snap onto pipe bodies (drop splits & pins)' },
];

export function SnapChip() {
  const snapPrefs = useEditorStore((s) => s.snapPrefs);
  const toggleSnapPref = useEditorStore((s) => s.toggleSnapPref);
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
