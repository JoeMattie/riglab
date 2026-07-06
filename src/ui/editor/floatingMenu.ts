// Shared placement + drag for the canvas floating menus (joint popover and
// selection card): both portal to document.body at fixed PAGE coordinates so
// they float over the whole window instead of clipping at a panel's
// overflow:hidden edge, both clamp so the ENTIRE menu is on-screen after
// measuring its real size, and both drag by a grip (Joe's request).
import { useLayoutEffect, useRef, useState } from 'react';
import type { Vec2 } from '../../schema';

/** Page-coordinate offset of a hosting panel (null container → 0,0). */
export function pageOrigin(container: HTMLElement | null): Vec2 {
  const r = container?.getBoundingClientRect();
  return { x: r?.left ?? 0, y: r?.top ?? 0 };
}

const MARGIN = 8;

/** Clamp a page-space anchor so a box of (w, h) stays fully in the window. */
export function clampToWindow(anchor: Vec2, w: number, h: number): { left: number; top: number } {
  return {
    left: Math.max(MARGIN, Math.min(anchor.x, window.innerWidth - w - MARGIN)),
    top: Math.max(MARGIN, Math.min(anchor.y, window.innerHeight - h - MARGIN)),
  };
}

/**
 * Measure the mounted menu and clamp its fixed page position so the whole
 * thing is visible — variable-height menus (joint menu, selection card) need
 * the REAL height, not an estimate. Returns the ref to attach and the clamped
 * {left, top}. Re-measures when `anchor`, `drag`, or `deps` change.
 */
export function useOnscreenPosition(
  anchor: Vec2,
  drag: Vec2,
  deps: readonly unknown[] = [],
): { ref: React.RefObject<HTMLDivElement | null>; left: number; top: number } {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() =>
    clampToWindow({ x: anchor.x + drag.x, y: anchor.y + drag.y }, 0, 0),
  );
  useLayoutEffect(() => {
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    setPos(clampToWindow({ x: anchor.x + drag.x, y: anchor.y + drag.y }, w, h));
  }, [anchor.x, anchor.y, drag.x, drag.y, ...deps]);
  return { ref, ...pos };
}

/** Drag-by-grip offset state + pointer handlers for a floating menu header. */
export function useMenuDrag(): {
  offset: Vec2;
  reset(): void;
  handleProps: {
    onPointerDown(e: React.PointerEvent): void;
    onPointerMove(e: React.PointerEvent): void;
    onPointerUp(): void;
  };
} {
  const [offset, setOffset] = useState<Vec2>({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; base: Vec2 } | null>(null);
  return {
    offset,
    reset: () => setOffset({ x: 0, y: 0 }),
    handleProps: {
      onPointerDown(e) {
        (
          e.currentTarget as Element & { setPointerCapture?: (id: number) => void }
        ).setPointerCapture?.(e.pointerId);
        dragRef.current = { x: e.clientX, y: e.clientY, base: offset };
      },
      onPointerMove(e) {
        const d = dragRef.current;
        if (!d) return;
        setOffset({ x: d.base.x + e.clientX - d.x, y: d.base.y + e.clientY - d.y });
      },
      onPointerUp() {
        dragRef.current = null;
      },
    },
  };
}
