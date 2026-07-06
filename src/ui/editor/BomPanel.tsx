// BOM view (§6.2, v7): cut list, bend schedules (incl. the out-of-plane
// twist° column), fittings, technique summary, consumables, weight rollup
// (per group + per subsystem tag), optional cost — over the whole compound
// mechanism. Not hard-gated on the checklist: it renders
// what is resolvable with a prominent "partial" banner counting what was
// excluded (play-first, §2 — decision logged in DECISIONS.md).
import { useMemo } from 'react';
import { type Bom, bomToCsv, computeBom } from '../../bom';
import { useAppStore } from '../../state/appStore';
import { useEditorStore } from '../../state/editorStore';
import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { formatLength, formatMass } from '../units';
import { Row, Section } from './infopanel/fields';
import { PrintableBom } from './PrintableBom';

function downloadText(text: string, filename: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const degreesOf = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(1)}°`;

const TECHNIQUE_LABELS: Array<[keyof Bom['techniqueSummary'], string]> = [
  ['heatWrapPivot', 'heat-formed pivots'],
  ['heatWrapRigid', 'heat-formed rigid joints'],
  ['bends', 'heat bends'],
  ['nestedSleeve', 'nested sleeves'],
  ['nestedCoupler', 'nested couplers'],
  ['telescopes', 'telescoping joints'],
  ['boltThrough', 'bolt-throughs'],
  ['fitting', 'glued fittings'],
  ['conduitBox', 'conduit boxes'],
  ['ropeLashing', 'rope lashings'],
  ['clickDetachable', 'click/detachable joints'],
];

export function BomPanel() {
  const doc = useAppStore((s) => s.current);
  const setRightTab = useEditorStore((s) => s.setRightTab);

  const bom = useMemo(() => (doc ? computeBom(doc) : null), [doc]);
  if (!doc || !bom) return null;

  const units = doc.unitsPreference;
  const groupName = (id: string) => bom.weights.groupNames[id] ?? id;
  const techniques = TECHNIQUE_LABELS.filter(([k]) => bom.techniqueSummary[k] > 0);

  return (
    <div data-testid="bom-panel" className="flex flex-col text-sm">
      {bom.unresolved.count > 0 && (
        <button
          type="button"
          data-testid="bom-partial-banner"
          className="cursor-pointer border-amber-300 border-b bg-amber-50 px-3 py-2 text-left text-amber-900 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-100"
          title="open the checklist"
          onClick={() => setRightTab('checklist')}
        >
          Partial BOM — {bom.unresolved.count} element{bom.unresolved.count > 1 ? 's' : ''} without
          engineering data excluded. Open the checklist →
        </button>
      )}

      {bom.warnings.length > 0 && (
        <Section title="Warnings">
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-destructive">
            {bom.warnings.map((w) => (
              <li key={`${w.kind}:${w.elementId ?? w.message}`} data-testid="bom-warning">
                ⚠ {w.message}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Cut list">
        {bom.cutList.length === 0 && (
          <div className="text-muted-foreground">no engineered pipes yet</div>
        )}
        {bom.cutList.length > 0 && (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-0.5 pr-2 font-normal">qty</th>
                <th className="py-0.5 pr-2 font-normal">material</th>
                <th className="py-0.5 text-right font-normal">cut length</th>
              </tr>
            </thead>
            <tbody>
              {bom.cutList.map((p) => (
                <tr
                  key={`${p.materialId}:${p.kind}:${p.lengthM}`}
                  data-testid="cut-part"
                  title={p.kind === 'heatWrapConnector' ? 'heat-wrap connector piece' : undefined}
                >
                  <td className="py-0.5 pr-2 tabular-nums">{p.quantity}×</td>
                  <td className="max-w-40 truncate py-0.5 pr-2">
                    {p.materialName}
                    {p.kind === 'heatWrapConnector' ? ' (wrap connector)' : ''}
                  </td>
                  <td className="py-0.5 text-right tabular-nums">
                    {formatLength(p.lengthM, units)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Shopping list">
        {bom.shoppingList.pipes.length === 0 &&
          bom.shoppingList.fittings.length === 0 &&
          bom.shoppingList.hardware.length === 0 &&
          bom.shoppingList.cordage.length === 0 && (
            <div className="text-muted-foreground">nothing to buy yet</div>
          )}
        {bom.shoppingList.pipes.map((p) => (
          <Row key={p.materialId} label={p.materialName}>
            <span
              data-testid="shopping-pipe"
              title={`${p.cutCount} cuts totalling ${formatLength(p.totalCutM, units)}, ${formatLength(p.leftoverM, units)} spare`}
            >
              {p.sticksToBuy}× {formatLength(p.stockLengthM, units)} stick
            </span>
          </Row>
        ))}
        {bom.shoppingList.fittings.map((f) => (
          <Row key={f.id} label={f.label}>
            <span data-testid="shopping-fitting">{f.quantity}×</span>
          </Row>
        ))}
        {bom.shoppingList.hardware.map((h) => (
          <Row key={h.id} label={h.label}>
            <span data-testid="shopping-hardware">{h.quantity}×</span>
          </Row>
        ))}
        {bom.shoppingList.cordage.map((c) => (
          <Row key={c.id} label={c.label}>
            <span data-testid="shopping-cordage">{formatLength(c.lengthM, units)}</span>
          </Row>
        ))}
      </Section>

      {bom.bendSchedule.length > 0 && (
        <Section title="Bend schedule">
          {bom.bendSchedule.map((b) => (
            <div key={b.elementId} className="mb-1" data-testid="bend-entry">
              <div className="font-mono text-muted-foreground text-xs">
                {b.elementId.slice(0, 8)}
              </div>
              {b.vertices.map((v, i) => (
                <Row key={v.nodeId} label={`bend ${i + 1}`}>
                  <span data-testid="bend-angles">
                    {degreesOf(v.angleRad)} · twist {degreesOf(v.dihedralRad)} @ r{' '}
                    {formatLength(v.radiusM, units)}
                  </span>
                </Row>
              ))}
            </div>
          ))}
        </Section>
      )}

      {bom.fittings.length > 0 && (
        <Section title="Fittings">
          {bom.fittings.map((f) => (
            <Row
              key={`${f.type}:${f.sizingSystem}:${f.nominalSize}`}
              label={`${f.type} ${f.nominalSize}" ${f.sizingSystem}`}
            >
              <span data-testid="fitting-count" className={f.resolved ? '' : 'text-destructive'}>
                {f.quantity}× {f.resolved ? formatMass(f.totalMassKg, units) : '(not in DB)'}
              </span>
            </Row>
          ))}
        </Section>
      )}

      {techniques.length > 0 && (
        <Section title="Technique summary">
          {techniques.map(([k, label]) => (
            <Row key={k} label={label}>
              {bom.techniqueSummary[k]}
            </Row>
          ))}
        </Section>
      )}

      <Section title="Consumables">
        <Row label="rope (incl. waste)">{formatLength(bom.consumables.ropeTotalM, units)}</Row>
        <Row label="elastic">{formatLength(bom.consumables.elasticTotalM, units)}</Row>
        <Row label="bowden cable">{formatLength(bom.consumables.bowdenTotalM, units)}</Row>
      </Section>

      <Section title="Weight">
        {Object.entries(bom.weights.perGroupKg).map(([id, kg]) => (
          <Row key={id} label={groupName(id)}>
            {formatMass(kg, units)}
          </Row>
        ))}
        {Object.entries(bom.weights.perSubsystemTagKg)
          .filter(([tag, kg]) => tag !== '' || kg > 0)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([tag, kg]) => (
            <Row key={`tag:${tag}`} label={`tag: ${tag === '' ? '(untagged)' : tag}`}>
              {formatMass(kg, units)}
            </Row>
          ))}
        <Row label="grand total">
          <span className="font-semibold" data-testid="bom-total-weight">
            {formatMass(bom.weights.grandTotalKg, units)}
          </span>
        </Row>
      </Section>

      {bom.cost.totalCost !== undefined && (
        <Section title="Cost">
          <Row label="total">
            <Badge variant="secondary" data-testid="bom-total-cost">
              {bom.cost.totalCost.toFixed(2)}
            </Badge>
          </Row>
        </Section>
      )}

      <div className="flex gap-2 p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          data-testid="export-bom-csv"
          onClick={() =>
            downloadText(
              bomToCsv(bom),
              `${
                doc.name
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/^-+|-+$/g, '') || 'project'
              }-bom.csv`,
              'text/csv',
            )
          }
        >
          Export CSV
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="flex-1"
          data-testid="print-bom"
          onClick={() => window.print()}
        >
          Print
        </Button>
      </div>

      {/* body-portalled shop sheet, shown only under @media print */}
      <PrintableBom doc={doc} />
    </div>
  );
}
