// The design window: inspector + resolution checklist (§8.2), with the
// materials panel (incl. nesting matrix, §6.1) and the BOM view (§6.2) as
// sibling tabs. Since Joe's rework it is a draggable, centered floating
// WINDOW opened by the top-bar Design button — not a right-hand dock behind
// a sketch/design mode switch. The `face` lens still flips to 'design'
// while it is open (design-only inspector controls key off it); closing
// returns to 'sketch'.
import { type RightTab, useEditorStore } from '../../state/editorStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/tabs';
import { BomPanel } from './BomPanel';
import { ChecklistPanel } from './ChecklistPanel';
import { InfoPanel } from './infopanel/InfoPanel';
import { MaterialsPanel } from './MaterialsPanel';
import { GripHandle, usePillDrag } from './pillDrag';
import { panelStyle, T } from './theme';

const TABS: Array<{ id: RightTab; label: string }> = [
  { id: 'inspector', label: 'Inspector' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'materials', label: 'Materials' },
  { id: 'bom', label: 'BOM' },
];

/** The floating design window: horizontally centered, wider than the old
 * dock, draggable by its grip, closed by ✕ (face returns to sketch). */
export function DesignWindow() {
  const setFace = useEditorStore((s) => s.setFace);
  const drag = usePillDrag();

  return (
    <div
      data-testid="design-window"
      style={{
        ...panelStyle,
        position: 'absolute',
        left: '50%',
        top: 56,
        bottom: 84,
        width: 620,
        maxWidth: 'calc(100vw - 24px)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 30,
        transform: `translate(calc(-50% + ${drag.offset.x}px), ${drag.offset.y}px)`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px 0',
        }}
      >
        <GripHandle testid="design-window-handle" drag={drag} />
        <span
          style={{
            font: `500 11px ${T.sans}`,
            letterSpacing: '.07em',
            textTransform: 'uppercase',
            color: T.muted,
          }}
        >
          Design
        </span>
        <button
          type="button"
          data-testid="design-window-close"
          title="close"
          onClick={() => setFace('sketch')}
          style={{
            marginLeft: 'auto',
            border: 'none',
            background: 'none',
            color: T.faint,
            cursor: 'pointer',
            fontSize: 14,
            padding: 0,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
      <RightDock />
    </div>
  );
}

export function RightDock() {
  const rightTab = useEditorStore((s) => s.rightTab);
  const setRightTab = useEditorStore((s) => s.setRightTab);

  return (
    <div className="flex min-h-0 w-full flex-col bg-background text-sm" data-testid="right-dock">
      <Tabs
        value={rightTab}
        onValueChange={(v) => setRightTab(v as RightTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        {/* inline column count: Tailwind can't see dynamic class names */}
        <TabsList
          className="m-1 grid w-auto"
          style={{ gridTemplateColumns: `repeat(${TABS.length}, 1fr)` }}
        >
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} data-testid={`right-tab-${t.id}`}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="inspector" className="min-h-0 flex-1 overflow-y-auto">
          <InfoPanel />
        </TabsContent>
        <TabsContent value="checklist" className="min-h-0 flex-1 overflow-y-auto">
          <ChecklistPanel />
        </TabsContent>
        <TabsContent value="materials" className="min-h-0 flex-1 overflow-y-auto">
          <MaterialsPanel />
        </TabsContent>
        <TabsContent value="bom" className="min-h-0 flex-1 overflow-y-auto">
          <BomPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
