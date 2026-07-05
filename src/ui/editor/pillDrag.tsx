// Drag-to-move for the floating chrome (extends wireframe 1c's "drag to
// move" tool pill to every pill/chip): a shared transient-offset hook plus
// the grip-dots handle. The offset is session-transient by design — pills
// snap back to their docks on reload, exactly like the tool pill and the
// selection card before this.
import { useRef, useState } from 'react';
import { T } from './theme';

export interface PillDrag {
  offset: { x: number; y: number };
  /** pointer handlers to spread onto the grip element */
  handleProps: {
    onPointerDown(e: React.PointerEvent<Element>): void;
    onPointerMove(e: React.PointerEvent<Element>): void;
    onPointerUp(): void;
  };
}

export function usePillDrag(): PillDrag {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; base: { x: number; y: number } } | null>(
    null,
  );
  return {
    offset,
    handleProps: {
      onPointerDown(e) {
        (
          e.currentTarget as Element & { setPointerCapture?: (id: number) => void }
        ).setPointerCapture?.(e.pointerId);
        dragRef.current = { startX: e.clientX, startY: e.clientY, base: offset };
      },
      onPointerMove(e) {
        const d = dragRef.current;
        if (!d) return;
        setOffset({ x: d.base.x + e.clientX - d.startX, y: d.base.y + e.clientY - d.startY });
      },
      onPointerUp() {
        dragRef.current = null;
      },
    },
  };
}

/** The grip-dots drag handle. `vertical` renders a 5×20 column (for the left
 * edge of a horizontal pill); default is the 20×5 row the tool pill uses. */
export function GripHandle({
  testid,
  drag,
  vertical = false,
}: {
  testid: string;
  drag: PillDrag;
  vertical?: boolean;
}) {
  const long = [1, 7, 13, 19];
  const short = [4, 10, 16];
  return (
    <span
      data-testid={testid}
      title="drag to move"
      {...drag.handleProps}
      style={{
        display: 'grid',
        placeItems: 'center',
        alignSelf: 'stretch',
        padding: vertical ? '0 3px' : '1px 0 3px',
        cursor: 'grab',
        color: T.ghost,
        touchAction: 'none',
      }}
    >
      {vertical ? (
        <svg width={5} height={20} viewBox="0 0 5 20" aria-hidden="true">
          {long.map((y) => (
            <circle key={y} cx={1.5} cy={y} r={1.2} fill="currentColor" />
          ))}
          {short.map((y) => (
            <circle key={y} cx={4} cy={y} r={1.2} fill="currentColor" />
          ))}
        </svg>
      ) : (
        <svg width={20} height={5} viewBox="0 0 20 5" aria-hidden="true">
          {long.map((x) => (
            <circle key={x} cx={x} cy={1.5} r={1.2} fill="currentColor" />
          ))}
          {short.map((x) => (
            <circle key={x} cx={x} cy={4} r={1.2} fill="currentColor" />
          ))}
        </svg>
      )}
    </span>
  );
}
