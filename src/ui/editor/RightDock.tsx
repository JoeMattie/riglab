// The right-side dock. Sketch face: just the info panel (§8.1 keeps
// engineering hidden). Design face: inspector + resolution checklist docked
// alongside (§8.2), with the materials panel (incl. nesting matrix, §6.1)
// and the BOM view (§6.2) as sibling tabs.
import { type RightTab, useEditorStore } from '../../state/editorStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/tabs';
import { ChecklistPanel } from './ChecklistPanel';
import { InfoPanel } from './infopanel/InfoPanel';
import { MaterialsPanel } from './MaterialsPanel';

const TABS: Array<{ id: RightTab; label: string }> = [
  { id: 'inspector', label: 'Inspector' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'materials', label: 'Materials' },
];

export function RightDock() {
  const face = useEditorStore((s) => s.face);
  const rightTab = useEditorStore((s) => s.rightTab);
  const setRightTab = useEditorStore((s) => s.setRightTab);

  if (face === 'sketch') return <InfoPanel />;

  return (
    <div
      className="flex w-96 shrink-0 flex-col border-l bg-background text-sm"
      data-testid="right-dock"
    >
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
          <InfoPanel embedded />
        </TabsContent>
        <TabsContent value="checklist" className="min-h-0 flex-1 overflow-y-auto">
          <ChecklistPanel />
        </TabsContent>
        <TabsContent value="materials" className="min-h-0 flex-1 overflow-y-auto">
          <MaterialsPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
