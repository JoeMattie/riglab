// The floating selection card (design handoff §7): docks beside the current
// selection on the canvas. Pipes get the hi-fi rows (length + lock, End A/B
// joint chips, Split/Reverse/Delete); every other element type embeds the
// existing inspector body, and multi-select embeds the bulk surface — so no
// §8.2a capability is lost by removing the docked sketch-face panel.
import { useRef, useState } from 'react';
import { elementNodeIds } from '../../design/elementInfo';
import { elementTypeLabel } from '../../design/resolution';
import type { Mechanism, MechanismElement, Project, Vec2 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import {
  deleteElement,
  reverseLink,
  setLengthLocked,
  splitLinkAtMidpoint,
} from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { lengthToDisplay, lengthUnit } from '../units';
import { JointGlyph, LockIcon } from './icons';
import { useDiagnosticsShim } from './infopanel/diagnosticsShim';
import { ElementInspector } from './infopanel/ElementInspector';
import { MultiInspector } from './infopanel/MultiInspector';
import { jointKindAtNode } from './JointPopover';
import { MENU_SHADOW, T } from './theme';
import { toScreen, type ViewTransform } from './viewTransform';

const WIDTH = 236;

export function SelectionCard({
  doc,
  mech,
  view,
  positions,
  size,
}: {
  doc: Project;
  mech: Mechanism;
  view: ViewTransform;
  positions: Record<string, Vec2>;
  size: { w: number; h: number };
}) {
  const selectedElementIds = useEditorStore((s) => s.selectedElementIds);
  const clearSelection = useEditorStore((s) => s.clearSelection);
  const face = useEditorStore((s) => s.face);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const diagnostics = useDiagnosticsShim();
  // drag-to-move (hi-fi §7: "card is draggable"): a manual offset from the
  // computed dock position, reset whenever the selection changes so a fresh
  // selection docks beside itself again
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; base: { x: number; y: number } } | null>(
    null,
  );
  const selectionKey = selectedElementIds.join('|');
  const prevKeyRef = useRef(selectionKey);
  if (prevKeyRef.current !== selectionKey) {
    prevKeyRef.current = selectionKey;
    if (offset.x !== 0 || offset.y !== 0) setOffset({ x: 0, y: 0 });
  }

  // the design face docks the full inspector on the right; the floating card
  // is the sketch face's contextual replacement for it
  if (face !== 'sketch') return null;

  const selected = selectedElementIds
    .map((id) => mech.elements.find((e) => e.id === id))
    .filter((e): e is MechanismElement => e !== undefined);
  if (selected.length === 0) return null;

  // dock beside the selection: right edge of its bounding box, clamped
  const pts = selected
    .flatMap((el) => elementNodeIds(el, mech))
    .map((id) => positions[id])
    .filter((p): p is Vec2 => !!p)
    .map((p) => toScreen(view, p));
  const maxX = pts.length ? Math.max(...pts.map((p) => p.x)) : size.w / 2;
  const minY = pts.length ? Math.min(...pts.map((p) => p.y)) : size.h / 2;
  // 48px clearance keeps the card off the dimension chips beside the pipe
  const left = Math.max(8, Math.min(maxX + 48 + offset.x, size.w - WIDTH - 8));
  const top = Math.max(8, Math.min(minY - 10 + offset.y, size.h - 260));

  const single = selected.length === 1 ? selected[0]! : null;
  const isPipe = single !== null && (single.type === 'link' || single.type === 'telescope');
  const title = single
    ? `${elementTypeLabel(single.type)[0]!.toUpperCase()}${elementTypeLabel(single.type).slice(1)} · ${single.id.slice(0, 4)}`
    : `${selected.length} elements`;

  return (
    <div
      data-testid="selection-card"
      style={{
        position: 'absolute',
        left,
        top,
        width: WIDTH,
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        boxShadow: MENU_SHADOW,
        zIndex: 20,
        fontFamily: T.sans,
        fontSize: 13.5,
        color: T.text,
      }}
    >
      <div
        title="drag to move the card"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).tagName === 'BUTTON') return;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          dragRef.current = { startX: e.clientX, startY: e.clientY, base: offset };
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          if (!d) return;
          setOffset({ x: d.base.x + e.clientX - d.startX, y: d.base.y + e.clientY - d.startY });
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px 8px',
          borderBottom: `1px solid ${T.hairline}`,
          cursor: 'grab',
        }}
      >
        <span style={{ width: 9, height: 9, borderRadius: 2, background: T.selected }} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
        <button
          type="button"
          data-testid="selection-card-close"
          title="clear selection"
          onClick={clearSelection}
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'none',
            color: T.faint,
            cursor: 'pointer',
            fontSize: 14,
            padding: 0,
          }}
        >
          ✕
        </button>
      </div>

      {isPipe && single && (single.type === 'link' || single.type === 'telescope') ? (
        <PipeRows doc={doc} mech={mech} el={single} positions={positions} />
      ) : (
        <div style={{ maxHeight: 320, overflowY: 'auto', padding: '4px 8px' }}>
          {single ? (
            <ElementInspector
              doc={doc}
              mech={mech}
              el={single}
              face={face}
              diagnostics={diagnostics}
            />
          ) : (
            <MultiInspector doc={doc} mech={mech} els={selected} face={face} />
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 14,
          padding: '8px 12px 10px',
          borderTop: `1px solid ${T.hairline}`,
          fontSize: 12.5,
        }}
      >
        {single?.type === 'link' && (
          <button
            type="button"
            data-testid="selection-split"
            onClick={() => updateCurrent((cur) => splitLinkAtMidpoint(cur, mech.id, single.id))}
            style={footerAction(T.accent)}
          >
            Split
          </button>
        )}
        {single &&
          (single.type === 'link' || single.type === 'telescope' || single.type === 'bentLink') && (
            <button
              type="button"
              data-testid="selection-reverse"
              onClick={() => updateCurrent((cur) => reverseLink(cur, mech.id, single.id))}
              style={footerAction(T.accent)}
            >
              Reverse
            </button>
          )}
        <button
          type="button"
          data-testid="selection-delete"
          onClick={() => {
            // one updateCurrent = one undo entry for the whole selection
            updateCurrent((cur) =>
              selected.reduce((d, el) => deleteElement(d, mech.id, el.id), cur),
            );
            clearSelection();
          }}
          style={{ ...footerAction(T.danger), marginLeft: 'auto' }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

const footerAction = (color: string): React.CSSProperties => ({
  border: 'none',
  background: 'none',
  color,
  cursor: 'pointer',
  padding: 0,
  fontSize: 12.5,
  fontFamily: T.sans,
});

/** Hi-fi pipe rows: Length (+lock) and the End A/B joint chips. */
function PipeRows({
  doc,
  mech,
  el,
  positions,
}: {
  doc: Project;
  mech: Mechanism;
  el: Extract<MechanismElement, { type: 'link' | 'telescope' }>;
  positions: Record<string, Vec2>;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const units = doc.unitsPreference;
  const a = positions[el.nodeA];
  const b = positions[el.nodeB];
  const lengthM = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
  const locked = el.lengthLocked === true;

  const endChip = (nodeId: string, testId: string) => {
    const kind = jointKindAtNode(mech, nodeId);
    return (
      <button
        type="button"
        data-testid={testId}
        title="change joint type"
        onClick={() => setOpenPopover({ kind: 'joint', nodeId })}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          border: `1px solid ${T.border}`,
          background: '#fff',
          borderRadius: 6,
          padding: '2px 8px',
          font: `400 12.5px ${T.sans}`,
          cursor: 'pointer',
        }}
      >
        {kind !== 'end' && <JointGlyph name={kind === 'anchor' ? 'anchor' : kind} />}
        {kind === 'end' ? 'free end' : kind} ▾
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: T.muted }}>Length</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            data-testid="card-length"
            style={{
              font: `500 12.5px ${T.mono}`,
              background: locked ? T.accent : '#f4f4f5',
              color: locked ? '#fff' : T.text,
              borderRadius: 6,
              padding: '2px 8px',
            }}
          >
            {Number(lengthToDisplay(lengthM, units).toFixed(units === 'imperial' ? 1 : 3))}{' '}
            {lengthUnit(units)}
          </span>
          <button
            type="button"
            data-testid="card-length-lock"
            title={locked ? 'unlock length' : 'lock length'}
            onClick={() => updateCurrent((cur) => setLengthLocked(cur, mech.id, el.id, !locked))}
            style={{
              border: 'none',
              background: locked ? T.accent : 'none',
              borderRadius: 5,
              cursor: 'pointer',
              padding: locked ? '3px 4px' : 2,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <LockIcon color={locked ? '#fff' : T.faint} open={!locked} />
          </button>
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: T.muted }}>End A</span>
        {endChip(el.nodeA, 'card-end-a')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: T.muted }}>End B</span>
        {endChip(el.nodeB, 'card-end-b')}
      </div>
    </div>
  );
}
