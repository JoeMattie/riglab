// Inline SVG icons ported from the hi-fi design file (16×16, 1.7px stroke,
// currentColor) plus the joint-glyph language shared by the canvas, the joint
// popover, and the selection card.
import type { ReactElement } from 'react';
import { T } from './theme';

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const wrap = (children: ReactElement | ReactElement[]): ReactElement => (
  <svg width={16} height={16} viewBox="0 0 16 16" style={{ display: 'block' }} aria-hidden="true">
    {children}
  </svg>
);

export type ToolIconName =
  | 'select'
  | 'pipe'
  | 'polyline'
  | 'freehand'
  | 'rope'
  | 'elastic'
  | 'bowden'
  | 'torsionCable'
  | 'bind';

export function ToolIcon({ name }: { name: ToolIconName }): ReactElement {
  switch (name) {
    case 'select':
      return wrap(<path d="M4 2 L12.5 7.2 L8.6 8.4 L6.6 13 Z" {...stroke} />);
    case 'pipe':
      return wrap(<path d="M3 13 L13 3" {...stroke} />);
    case 'polyline':
      return wrap(<path d="M2 13 L6.5 5.5 L9.8 9.2 L14 3" {...stroke} />);
    case 'freehand':
      return wrap(<path d="M2 11 C4.5 3 8.5 14 14 5" {...stroke} />);
    case 'rope':
      return wrap(<path d="M2 12.5 L14 3.5" {...stroke} strokeDasharray="3 2.6" />);
    case 'elastic':
      return wrap(<path d="M2 8 L4.4 4 L6.9 12 L9.4 4 L11.9 12 L14 8" {...stroke} />);
    case 'bowden':
      return wrap([
        <path key="a" d="M2 5.5 H9.5" {...stroke} strokeDasharray="3.4 2.2" />,
        <path key="b" d="M6.5 10.5 H14" {...stroke} strokeDasharray="3.4 2.2" />,
      ]);
    case 'torsionCable':
      return wrap([
        <path key="a" d="M12.8 4.6 A5.6 5.6 0 1 0 14 8.6" {...stroke} />,
        <path key="b" d="M14 8.6 L15.6 6.6 M14 8.6 L11.6 8.2" {...stroke} />,
      ]);
    case 'bind':
      return wrap([
        <circle key="a" cx={5} cy={8} r={3} fill="none" stroke="currentColor" strokeWidth={1.7} />,
        <circle
          key="b"
          cx={11.5}
          cy={8}
          r={3}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
        />,
        <path key="c" d="M7.6 8 H8.9" {...stroke} />,
      ]);
  }
}

/** Day/night toggle glyph: shows the view you would switch to — a moon in
 * day view, a sun in night view. */
export function ThemeIcon({ night }: { night: boolean }): ReactElement {
  return night
    ? wrap([
        <circle key="a" cx={8} cy={8} r={3.2} {...stroke} />,
        <path
          key="b"
          d="M8 1.6 V3 M8 13 V14.4 M1.6 8 H3 M13 8 H14.4 M3.5 3.5 L4.5 4.5 M11.5 11.5 L12.5 12.5 M12.5 3.5 L11.5 4.5 M4.5 11.5 L3.5 12.5"
          {...stroke}
        />,
      ])
    : wrap(<path d="M13.4 9.6 A5.9 5.9 0 1 1 6.4 2.6 A4.7 4.7 0 0 0 13.4 9.6 Z" {...stroke} />);
}

export type JointGlyphName =
  | 'pivot'
  | 'weld'
  | 'weldPivot'
  | 'slider'
  | 'anchor'
  | 'bound'
  | 'detach';

/** 14×14 joint glyph matching the canvas glyph language: pivot = ring,
 * weld = filled square, weld+pivot = square inside a ring (mid-pipe
 * junction: split halves welded, arrivals pivot), slider = rounded slot,
 * anchor = filled diamond, bound = green ring, detach = gray ✕. */
export function JointGlyph({ name }: { name: JointGlyphName }): ReactElement {
  const svg = (kid: ReactElement) => (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ display: 'block' }} aria-hidden="true">
      {kid}
    </svg>
  );
  switch (name) {
    case 'pivot':
      return svg(<circle cx={7} cy={7} r={4.5} fill={T.panel} stroke="#28d" strokeWidth={2.4} />);
    case 'weld':
      return svg(<rect x={3} y={3} width={8} height={8} fill={T.ink} />);
    case 'weldPivot':
      return svg(
        <>
          <circle cx={7} cy={7} r={5} fill={T.panel} stroke="#28d" strokeWidth={1.9} />
          <rect x={5.1} y={5.1} width={3.8} height={3.8} fill={T.ink} />
        </>,
      );
    case 'slider':
      return svg(
        <rect
          x={1.5}
          y={4.5}
          width={11}
          height={5}
          rx={2.5}
          fill={T.panel}
          stroke="#28d"
          strokeWidth={1.8}
        />,
      );
    case 'anchor':
      return svg(
        <rect x={3.6} y={3.6} width={6.8} height={6.8} fill={T.ink} transform="rotate(45 7 7)" />,
      );
    case 'bound':
      return svg(<circle cx={7} cy={7} r={4.5} fill={T.panel} stroke="#2a2" strokeWidth={2.4} />);
    case 'detach':
      return svg(<path d="M4 4 L10 10 M10 4 L4 10" stroke={T.faint} strokeWidth={1.8} />);
  }
}

/** Small padlock; `open` renders the unlocked shackle. */
export function LockIcon({ color, open = false }: { color: string; open?: boolean }): ReactElement {
  return (
    <svg width={11} height={12} viewBox="0 0 11 12" style={{ display: 'block' }} aria-hidden="true">
      <rect x={1} y={5} width={9} height={6.5} rx={1.5} fill={color} />
      <path
        d={open ? 'M3 5 V3.5 a2.5 2.5 0 0 1 5 0' : 'M3 5 V3.5 a2.5 2.5 0 0 1 5 0 V5'}
        stroke={color}
        strokeWidth={1.6}
        fill="none"
      />
    </svg>
  );
}
