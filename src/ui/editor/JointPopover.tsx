// The joint popover (design handoff §6 + storyboard 1f): opened by clicking
// any node — rows re-realize the joint via docOps. The same component is the
// snap-connect menu when a drawn pipe end lands on existing geometry
// (pendingConnect): Pivot is the default, Enter accepts it, Esc cancels.
// Replaces ConnectMenu.tsx.
import { useEffect, useRef } from 'react';
import type { JointRealization, Mechanism, Vec2 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { assignRealization, detachNode, setNodeJoint } from '../../state/docOps';
import { useEditorStore } from '../../state/editorStore';
import { JointGlyph, type JointGlyphName } from './icons';
import { REALIZATION_OPTIONS } from './infopanel/fields';
import { captionStyle, menuStyle, rowStyle, T } from './theme';
import { toScreen, type ViewTransform } from './viewTransform';

const CONNECT_LABELS: Record<string, string> = {
  pivot: 'Pivot',
  weld: 'Weld',
  slider: 'Slider',
  detach: 'Detach',
};

interface Size {
  w: number;
  h: number;
}

const WIDTH = 178;

function clampedPos(anchor: Vec2, size: Size): { left: number; top: number } {
  return {
    left: Math.max(8, Math.min(anchor.x, size.w - WIDTH - 8)),
    top: Math.max(8, Math.min(anchor.y, size.h - 200)),
  };
}

/** Roving arrow-key focus across the option buttons (storyboard 1f·1). */
function onMenuKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length];
  next?.focus();
}

export function JointPopover({
  mech,
  view,
  positions,
  size,
}: {
  mech: Mechanism;
  view: ViewTransform;
  positions: Record<string, Vec2>;
  size: Size;
}) {
  const pending = useEditorStore((s) => s.pendingConnect);
  const openPopover = useEditorStore((s) => s.openPopover);
  const face = useEditorStore((s) => s.face);

  if (pending) return <ConnectMenu size={size} />;
  if (openPopover?.kind !== 'joint') return null;
  const node = mech.nodes.find((n) => n.id === openPopover.nodeId);
  if (!node) return null;
  const p = toScreen(view, positions[node.id] ?? node.position);
  const anchor = { x: p.x - 33, y: p.y + 20 };
  // design face: a node with an explicit joint element gets the realization
  // picker (the engineering question at that point); the sketch face — and
  // joint-less nodes — get the joint-type menu
  const joint = mech.elements.find(
    (e) => (e.type === 'pivot' || e.type === 'slider') && e.nodeId === node.id,
  );
  if (face === 'design' && joint && (joint.type === 'pivot' || joint.type === 'slider')) {
    return <RealizationMenu mech={mech} joint={joint} anchor={anchor} size={size} />;
  }
  return <JointMenu mech={mech} nodeId={node.id} anchor={anchor} size={size} />;
}

/** Design-face variant: the joint's physical realization (heat-wrap, fitting,
 * bolt-through, …) instead of joint types. Assigning re-derives maturity. */
function RealizationMenu({
  mech,
  joint,
  anchor,
  size,
}: {
  mech: Mechanism;
  joint: Extract<Mechanism['elements'][number], { type: 'pivot' | 'slider' }>;
  anchor: Vec2;
  size: Size;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  const choose = (realization: JointRealization | undefined) => {
    setOpenPopover(null);
    updateCurrent((cur) => assignRealization(cur, mech.id, [joint.id], realization));
  };

  const pos = clampedPos(anchor, size);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard roving-focus container, not an interactive control
    <div
      ref={ref}
      data-testid="realization-popover"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpenPopover(null);
        onMenuKeyDown(e);
      }}
      style={{ ...menuStyle, position: 'absolute', ...pos, width: 196, zIndex: 30 }}
    >
      <div style={{ ...captionStyle, padding: '4px 8px 6px' }}>
        Realization · {joint.type} {joint.id.slice(0, 4)}
      </div>
      {REALIZATION_OPTIONS.map((opt) => (
        <button
          type="button"
          key={opt.id}
          data-testid={`realization-${opt.id}`}
          onClick={() => choose(opt.id as JointRealization)}
          style={rowStyle(joint.realization === opt.id)}
        >
          {opt.label}
          {joint.realization === opt.id && <span style={{ marginLeft: 'auto' }}>✓</span>}
        </button>
      ))}
      <div style={{ borderTop: `1px solid ${T.hairline}`, margin: '5px 4px' }} />
      <button
        type="button"
        data-testid="realization-clear"
        onClick={() => choose(undefined)}
        style={{ ...rowStyle(joint.realization === undefined), color: T.muted }}
      >
        unset (sketch)
        {joint.realization === undefined && <span style={{ marginLeft: 'auto' }}>✓</span>}
      </button>
    </div>
  );
}

/** Snap-connect variant: choices come from the pending draw; Pivot default. */
function ConnectMenu({ size }: { size: Size }) {
  const pending = useEditorStore((s) => s.pendingConnect)!;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
  }, []);

  const pos = clampedPos({ x: pending.screen.x + 10, y: pending.screen.y - 10 }, size);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard roving-focus container, not an interactive control
    <div
      ref={ref}
      data-testid="connect-menu"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) pending.choose('pivot');
        if (e.key === 'Escape') pending.cancel();
        onMenuKeyDown(e);
      }}
      style={{ ...menuStyle, position: 'absolute', ...pos, width: WIDTH, zIndex: 30 }}
    >
      <div style={{ ...captionStyle, padding: '4px 8px 6px' }}>Connect end</div>
      {pending.options.map((o, i) => (
        <button
          type="button"
          key={o}
          data-testid={`connect-${o}`}
          onClick={() => pending.choose(o)}
          style={rowStyle(i === 0)}
        >
          <span style={{ display: 'grid', placeItems: 'center', width: 18 }}>
            <JointGlyph name={o as JointGlyphName} />
          </span>
          {CONNECT_LABELS[o]}
          {i === 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#7ba4d6' }}>⏎</span>}
        </button>
      ))}
    </div>
  );
}

type JointChoice = 'pivot' | 'weld' | 'slider' | 'anchor' | 'detach';

/** Joint-change variant: current type checked; rows that cannot apply to
 * this node are disabled rather than hidden, keeping the menu stable. */
function JointMenu({
  mech,
  nodeId,
  anchor,
  size,
}: {
  mech: Mechanism;
  nodeId: string;
  anchor: Vec2;
  size: Size;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const setOpenPopover = useEditorStore((s) => s.setOpenPopover);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);

  const members = memberCountAtNode(mech, nodeId);
  const kind = jointKindAtNode(mech, nodeId);
  const current: JointChoice = kind === 'end' ? 'pivot' : kind;

  const choose = (kind: JointChoice) => {
    setOpenPopover(null);
    if (kind === 'slider') return; // shown only as the current state
    if (kind === 'detach') {
      updateCurrent((cur) => detachNode(cur, mech.id, nodeId));
      useEditorStore.getState().clearSelection();
      return;
    }
    updateCurrent((cur) => setNodeJoint(cur, mech.id, nodeId, kind));
  };

  const rows: Array<{ kind: JointChoice; glyph: JointGlyphName; disabled: boolean }> = [
    { kind: 'pivot', glyph: 'pivot', disabled: members < 2 && current !== 'anchor' },
    { kind: 'weld', glyph: 'weld', disabled: members < 2 },
    { kind: 'slider', glyph: 'slider', disabled: current !== 'slider' },
    { kind: 'anchor', glyph: 'anchor', disabled: false },
    { kind: 'detach', glyph: 'detach', disabled: members < 2 },
  ];
  const labels: Record<JointChoice, string> = {
    pivot: 'Pivot',
    weld: 'Weld',
    slider: 'Slider',
    anchor: 'Anchor',
    detach: 'Detach',
  };

  const pos = clampedPos(anchor, size);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard roving-focus container, not an interactive control
    <div
      ref={ref}
      data-testid="joint-popover"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setOpenPopover(null);
        onMenuKeyDown(e);
      }}
      style={{ ...menuStyle, position: 'absolute', ...pos, width: WIDTH, zIndex: 30 }}
    >
      <div style={{ ...captionStyle, padding: '4px 8px 6px' }}>
        Joint · node {nodeId.slice(0, 4)}
      </div>
      {rows.map((r) => (
        <button
          type="button"
          key={r.kind}
          data-testid={`joint-${r.kind}`}
          disabled={r.disabled}
          onClick={() => choose(r.kind)}
          style={{
            ...rowStyle(current === r.kind),
            ...(r.disabled ? { opacity: 0.4, cursor: 'default' } : {}),
          }}
        >
          <span style={{ display: 'grid', placeItems: 'center', width: 18 }}>
            <JointGlyph name={r.glyph} />
          </span>
          {labels[r.kind]}
          {current === r.kind && <span style={{ marginLeft: 'auto' }}>✓</span>}
        </button>
      ))}
    </div>
  );
}

function memberCountAtNode(mech: Mechanism, nodeId: string): number {
  let members = 0;
  for (const el of mech.elements) {
    if (el.type === 'link' || el.type === 'telescope') {
      if (el.nodeA === nodeId || el.nodeB === nodeId) members++;
    } else if (el.type === 'bentLink' && el.nodeIds.includes(nodeId)) members++;
  }
  return members;
}

/** The joint kind rendered at a node — shared with the selection card's
 * End A/B chips and the canvas glyphs' popover checkmark. */
export function jointKindAtNode(mech: Mechanism, nodeId: string): JointChoice | 'end' {
  const node = mech.nodes.find((n) => n.id === nodeId);
  if (!node) return 'end';
  if (node.kind === 'anchor') return 'anchor';
  if (mech.elements.some((e) => e.type === 'slider' && e.nodeId === nodeId)) return 'slider';
  const pivot = mech.elements.find((e) => e.type === 'pivot' && e.nodeId === nodeId);
  if (pivot && pivot.type === 'pivot' && pivot.welds.length > 0) return 'weld';
  return pivot || memberCountAtNode(mech, nodeId) >= 2 ? 'pivot' : 'end';
}
