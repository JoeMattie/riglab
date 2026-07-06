// On-canvas dimension chips (design handoff §5 + storyboard 1e): every
// selected pipe gets an editable length chip (click = type, drag = scrub,
// lock = pin); locked pipes always show their solid blue chip; hovering any
// pipe shows a faint length tag. HTML overlay positioned via the same view
// transform as the Konva stage.
import { useRef } from 'react';
import type { Mechanism, Project, Vec2 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { setLengthLocked, setLinkLength } from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { lengthFromDisplay, lengthToDisplay, lengthUnit } from '../units';
import { LockIcon } from './icons';
import { CHIP_SHADOW, LOCKED_CHIP_SHADOW, T } from './theme';
import { toScreen, type ViewTransform } from './viewTransform';

export interface EndpointDragReadout {
  lengthM: number;
  snapped: boolean;
}

interface ChipPipe {
  id: string;
  a: Vec2;
  b: Vec2;
  lengthM: number;
  locked: boolean;
  selected: boolean;
  hovered: boolean;
}

const fmt = (m: number, units: Project['unitsPreference']): string =>
  String(Number(lengthToDisplay(m, units).toFixed(units === 'imperial' ? 1 : 3)));

/** Chip anchor: pipe midpoint pushed 22px along the screen-space normal that
 * points upward, so the chip sits beside the pipe, not on it. */
function chipAnchor(view: ViewTransform, a: Vec2, b: Vec2): { x: number; y: number } {
  const sa = toScreen(view, a);
  const sb = toScreen(view, b);
  const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
  const dx = sb.x - sa.x;
  const dy = sb.y - sa.y;
  const len = Math.hypot(dx, dy) || 1;
  let nx = -dy / len;
  let ny = dx / len;
  // prefer up; for vertical pipes prefer left — the selection card docks on
  // the selection's right, and the chip must not sit under it
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: mid.x + nx * 22, y: mid.y + ny * 22 };
}

export function DimensionChips({
  doc,
  mech,
  view,
  positions,
  lengths,
  hoveredElementId,
  endpointDrag,
  dragging = false,
}: {
  doc: Project;
  mech: Mechanism;
  view: ViewTransform;
  /** node positions PROJECTED into this panel's plane (chip anchoring) */
  positions: Record<string, Vec2>;
  /** true 3D segment length between two node ids (document space) — the
   * panel projection foreshortens, so chips must not measure on screen */
  lengths: { of(nodeA: string, nodeB: string): number };
  hoveredElementId: string | null;
  endpointDrag: ({ elementId: string } & EndpointDragReadout) | null;
  /** any canvas drag in progress: chips become click-through so the Konva
   * stage keeps receiving pointer events under them */
  dragging?: boolean;
}) {
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const units = doc.unitsPreference;

  // the editable length pill is a single-pipe control: a multi-selection
  // hides it (and the unlock button on locked chips) so a group selection
  // isn't buried under chips — locked pipes keep their passive locked chip,
  // hover tags stay display-only
  const soloId = selectedElementIds.length === 1 ? selectedElementIds[0] : null;

  const pipes: ChipPipe[] = [];
  for (const el of mech.elements) {
    if (el.type !== 'link' && el.type !== 'telescope') continue;
    const selected = el.id === soloId;
    const locked = el.lengthLocked === true;
    const hovered = hoveredElementId === el.id;
    if (!selected && !locked && !hovered && endpointDrag?.elementId !== el.id) continue;
    const a = positions[el.nodeA];
    const b = positions[el.nodeB];
    if (!a || !b) continue;
    pipes.push({
      id: el.id,
      a,
      b,
      lengthM: lengths.of(el.nodeA, el.nodeB),
      locked,
      selected,
      hovered,
    });
  }

  return (
    <>
      {pipes.map((p) => (
        <PipeChip
          key={p.id}
          pipe={p}
          units={units}
          anchor={chipAnchor(view, p.a, p.b)}
          drag={endpointDrag?.elementId === p.id ? endpointDrag : null}
          inert={dragging}
        />
      ))}
    </>
  );
}

function PipeChip({
  pipe,
  units,
  anchor,
  drag,
  inert,
}: {
  pipe: ChipPipe;
  units: Project['unitsPreference'];
  anchor: { x: number; y: number };
  drag: EndpointDragReadout | null;
  inert: boolean;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const beginGesture = useAppStore((s) => s.beginGesture);
  const endGesture = useAppStore((s) => s.endGesture);
  const lengthEdit = useEditorStore((s) => s.lengthEdit);
  const setLengthEdit = useEditorStore((s) => s.setLengthEdit);
  const scrubRef = useRef<{ startX: number; startLenM: number; moved: boolean } | null>(null);

  const unit = lengthUnit(units);
  const base: React.CSSProperties = {
    position: 'absolute',
    left: anchor.x,
    top: anchor.y,
    transform: 'translate(-50%, -50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    // above the selection card — the chip is the primary length control
    zIndex: 25,
    // during any canvas drag the stage must see the pointer, not the chip
    pointerEvents: inert ? 'none' : undefined,
  };

  // live readout while an endpoint handle is being dragged (storyboard 1e·2)
  if (drag) {
    return (
      <div style={{ ...base, pointerEvents: 'none' }} data-testid="length-readout">
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: T.panel,
            color: T.selectedText,
            border: `1.5px solid ${T.selected}`,
            borderRadius: 14,
            padding: '4px 12px',
            font: `500 12.5px ${T.mono}`,
            boxShadow: CHIP_SHADOW,
            whiteSpace: 'nowrap',
          }}
        >
          {fmt(drag.lengthM, units)} {unit}
          {drag.snapped ? ' ⌁ snap' : ''}
        </span>
      </div>
    );
  }

  // faint hover tag (storyboard 1e·1) — display only
  if (!pipe.selected && !pipe.locked) {
    return (
      <div style={{ ...base, pointerEvents: 'none' }} data-testid="length-hover-tag">
        <span style={{ font: `500 12px ${T.mono}`, color: T.faint }}>
          {fmt(pipe.lengthM, units)} {unit}
        </span>
      </div>
    );
  }

  const toggleLock = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateCurrent((cur) => setLengthLocked(cur, pipe.id, !pipe.locked));
  };

  // locked: solid blue chip; if the pipe is also selected, the lock button
  // (solid blue) releases it
  if (pipe.locked) {
    return (
      <div style={base} data-testid="length-chip-locked">
        <span
          title="length locked"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: T.accent,
            color: '#fff',
            borderRadius: 14,
            padding: '4px 12px',
            font: `500 12.5px ${T.mono}`,
            boxShadow: LOCKED_CHIP_SHADOW,
            whiteSpace: 'nowrap',
          }}
        >
          <LockIcon color="#fff" />
          {fmt(pipe.lengthM, units)} {unit}
        </span>
        {pipe.selected && (
          <button
            type="button"
            title="unlock length"
            data-testid="length-lock-toggle"
            onClick={toggleLock}
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: T.accent,
              border: 'none',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              boxShadow: LOCKED_CHIP_SHADOW,
              padding: 0,
            }}
          >
            <LockIcon color="#fff" />
          </button>
        )}
      </div>
    );
  }

  const editing = lengthEdit?.elementId === pipe.id;

  const commitDraft = () => {
    const cur = useEditorStore.getState().lengthEdit;
    if (!cur || cur.elementId !== pipe.id) return;
    setLengthEdit(null);
    const v = Number.parseFloat(cur.draft);
    if (!Number.isFinite(v) || v <= 0) return;
    updateCurrent((d) => setLinkLength(d, pipe.id, lengthFromDisplay(v, units)));
  };

  // click = inline edit; horizontal drag = scrub (storyboard 1e·3/4)
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // optional call: jsdom (component tests) has no pointer-capture support
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubRef.current = { startX: e.clientX, startLenM: pipe.lengthM, moved: false };
    beginGesture();
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = scrubRef.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    if (!s.moved && Math.abs(dx) < 3) return;
    s.moved = true;
    // 1 px = 1/16 in (imperial) / 1 mm (metric): fine enough to feel analog,
    // coarse enough to cross whole units in one drag
    const perPx = units === 'imperial' ? 0.0254 / 16 : 0.001;
    const next = Math.max(1e-3, s.startLenM + dx * perPx);
    updateCurrent((d) => setLinkLength(d, pipe.id, next));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const s = scrubRef.current;
    scrubRef.current = null;
    endGesture();
    if (s && !s.moved) {
      e.stopPropagation();
      setLengthEdit({ elementId: pipe.id, draft: fmt(pipe.lengthM, units) });
    }
  };

  return (
    <div style={base} data-testid="length-chip">
      {editing ? (
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: T.panel,
            border: `2px solid ${T.selected}`,
            borderRadius: 14,
            padding: '3px 10px',
            boxShadow: CHIP_SHADOW,
          }}
        >
          <input
            // the chip just became this field on click — focus follows
            ref={(el) => el?.focus()}
            data-testid="length-input"
            value={lengthEdit?.draft ?? ''}
            onChange={(e) => setLengthEdit({ elementId: pipe.id, draft: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitDraft();
              if (e.key === 'Escape') setLengthEdit(null);
            }}
            onBlur={commitDraft}
            style={{
              width: 52,
              border: 'none',
              outline: 'none',
              font: `500 12.5px ${T.mono}`,
              color: T.text,
              background: 'transparent',
              padding: 0,
            }}
          />
          <span style={{ color: T.faint, fontSize: 11.5 }}>{unit} ⏎</span>
        </span>
      ) : (
        <button
          type="button"
          data-testid="length-chip-value"
          title="click to type an exact length · drag to scrub"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: T.panel,
            color: T.selectedText,
            border: `1.5px solid ${T.selected}`,
            borderRadius: 14,
            padding: '4px 12px',
            font: `500 12.5px ${T.mono}`,
            cursor: 'ew-resize',
            boxShadow: CHIP_SHADOW,
            whiteSpace: 'nowrap',
          }}
        >
          {fmt(pipe.lengthM, units)} {unit}
        </button>
      )}
      <button
        type="button"
        title="lock length"
        data-testid="length-lock-toggle"
        onClick={toggleLock}
        style={{
          width: 26,
          height: 26,
          borderRadius: '50%',
          background: T.panel,
          border: `1.5px solid ${T.border}`,
          cursor: 'pointer',
          display: 'grid',
          placeItems: 'center',
          boxShadow: CHIP_SHADOW,
          padding: 0,
        }}
      >
        <LockIcon color={T.muted} open />
      </button>
    </div>
  );
}
