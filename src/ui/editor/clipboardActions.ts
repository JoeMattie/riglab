// Copy/paste wiring shared by the EditorShell keyboard shortcuts (⌘/Ctrl
// C/V) and the ActionsChip buttons (PLANFILE-quad-panel-controls C). The
// pure snapshot/remap math lives in src/state/clipboard.ts; this module only
// moves data between the stores.
import type { Vec3 } from '../../schema';
import { useAppStore } from '../../state/appStore';
import { copyPayload, pastePayload } from '../../state/clipboard';
import { type QuadPanelId, useEditorStore } from '../../state/editorStore';
import { PANEL_FRAME } from '../quad/panelProject';

/** Paste lands ~10 cm down-right IN THE ACTIVE PANEL'S PLANE, so the copy is
 * visibly offset where the user is working (the perspective panel falls back
 * to the side frame). */
export function pasteOffset(activePanel: QuadPanelId): Vec3 {
  const f = PANEL_FRAME[activePanel === 'persp' ? 'side' : activePanel];
  return {
    x: 0.1 * (f.xAxis.x - f.yAxis.x),
    y: 0.1 * (f.xAxis.y - f.yAxis.y),
    z: 0.1 * (f.xAxis.z - f.yAxis.z),
  };
}

/** Copy the current selection to the clipboard. Returns true when something
 * copyable was captured (so callers only preventDefault a real copy). */
export function copySelection(): boolean {
  const doc = useAppStore.getState().current;
  const ed = useEditorStore.getState();
  if (!doc || ed.selectedElementIds.length === 0) return false;
  const payload = copyPayload(doc, ed.selectedElementIds);
  if (!payload) return false;
  ed.setClipboard(payload);
  return true;
}

/** Paste the clipboard offset in the active panel's plane and select the
 * pasted set. One updateCurrent call → one undo step. Returns the new ids. */
export function pasteClipboard(): string[] {
  const app = useAppStore.getState();
  const ed = useEditorStore.getState();
  if (!app.current || !ed.clipboard) return [];
  const payload = ed.clipboard;
  let newIds: string[] = [];
  app.updateCurrent((d) => {
    const r = pastePayload(d, payload, pasteOffset(ed.activePanel));
    newIds = r.newElementIds;
    return r.doc;
  });
  if (newIds.length > 0) ed.setSelection(newIds);
  return newIds;
}
