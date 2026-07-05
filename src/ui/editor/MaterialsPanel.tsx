// Editable materials DB (§6.1) + the derived nesting-compatibility matrix.
// Every edit is one updateCurrent call (one undo entry, commit-on-blur).
// Rows still carrying seed values show the "approximate — edit me" badge
// (§12); editing a number clears it (materialsOps rule). The matrix is
// recomputed live from OD/ID, never stored.
import type { NestingClass } from '../../bom';
import { nestingMatrix } from '../../bom';
import type { FittingType, PipeSizingSystem } from '../../schema';
import { fittingTypeSchema, pipeSizingSystemSchema } from '../../schema';
import { useAppStore } from '../../state/appStore';
import {
  addMaterialRow,
  deleteMaterialRow,
  type MaterialCategory,
  materialReferenceCount,
  setGenericPipeDensity,
  updateBomSettings,
  updateMaterialRow,
} from '../../state/materialsOps';
import { Badge } from '../components/badge';
import { Button } from '../components/button';
import { Input } from '../components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select';
import { lengthUnit, massUnit } from '../units';
import { LengthField, MassField, NumberField, Section } from './infopanel/fields';

/** Text input that commits on blur/Enter (mirrors NumberField's contract). */
function TextField({
  value,
  onCommit,
  testId,
}: {
  value: string;
  onCommit: (v: string) => void;
  testId?: string;
}) {
  return (
    <Input
      className="h-7 px-2 md:text-xs"
      defaultValue={value}
      key={value}
      data-testid={testId}
      onBlur={(e) => e.target.value !== value && onCommit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function EnumSelect<T extends string>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className="h-7 w-full" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5 text-muted-foreground text-xs">
      {label}
      {children}
    </label>
  );
}

function RowChrome({
  approximate,
  references,
  onDelete,
  children,
  testId,
}: {
  approximate: boolean;
  references: number;
  onDelete: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div className="mb-1.5 rounded-md border p-2" data-testid={testId}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {approximate && (
            <Badge
              variant="outline"
              className="text-amber-700"
              title="seed value — verify against purchased stock and enter the measured number"
              data-testid="material-approx-badge"
            >
              approx — edit me
            </Badge>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1 text-muted-foreground"
            disabled={references > 0}
            title={
              references > 0
                ? `in use by ${references} element${references > 1 ? 's' : ''}`
                : 'delete'
            }
            data-testid="material-delete"
            onClick={onDelete}
          >
            ✕
          </Button>
        </div>
      </div>
    </div>
  );
}

const FIT_STYLE: Record<NestingClass, string> = {
  press: 'bg-violet-200 text-violet-900 dark:bg-violet-900 dark:text-violet-100',
  snug: 'bg-sky-200 text-sky-900 dark:bg-sky-900 dark:text-sky-100',
  slip: 'bg-green-200 text-green-900 dark:bg-green-900 dark:text-green-100',
  sloppy: 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
};

export function MaterialsPanel() {
  const doc = useAppStore((s) => s.current);
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  if (!doc) return null;

  const units = doc.unitsPreference;
  const lu = lengthUnit(units);
  const mu = massUnit(units);
  const db = doc.materials;

  const patch = <C extends MaterialCategory>(
    category: C,
    rowId: string,
    p: Parameters<typeof updateMaterialRow<C>>[3],
  ) => updateCurrent((cur) => updateMaterialRow(cur, category, rowId, p));
  const add = (category: MaterialCategory) =>
    updateCurrent((cur) => addMaterialRow(cur, category).doc);
  const remove = (category: MaterialCategory, rowId: string) =>
    updateCurrent((cur) => deleteMaterialRow(cur, category, rowId));

  const pairs = nestingMatrix(db.pipes);
  const fitOf = (outerId: string, innerId: string) =>
    pairs.find((p) => p.outerId === outerId && p.innerId === innerId);

  return (
    <div data-testid="materials-panel" className="flex flex-col text-sm">
      <Section title="Pipes">
        {db.pipes.map((p) => (
          <RowChrome
            key={p.id}
            testId="pipe-row"
            approximate={p.approximate}
            references={materialReferenceCount(doc, p.id)}
            onDelete={() => remove('pipes', p.id)}
          >
            <TextField value={p.name} onCommit={(v) => patch('pipes', p.id, { name: v })} />
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              <Labeled label="system">
                <EnumSelect<PipeSizingSystem>
                  value={p.sizingSystem}
                  options={pipeSizingSystemSchema.options}
                  onChange={(v) => patch('pipes', p.id, { sizingSystem: v })}
                />
              </Labeled>
              <Labeled label="size">
                <TextField
                  value={p.nominalSize}
                  onCommit={(v) => patch('pipes', p.id, { nominalSize: v })}
                />
              </Labeled>
              <Labeled label="kg/m">
                <NumberField
                  value={p.linearDensityKgPerM}
                  min={0}
                  testId="pipe-density"
                  onCommit={(v) => patch('pipes', p.id, { linearDensityKgPerM: v })}
                />
              </Labeled>
              <Labeled label={`OD (${lu})`}>
                <LengthField
                  valueM={p.outerDiameterM}
                  minM={1e-4}
                  units={units}
                  testId="pipe-od"
                  onCommitM={(v) => patch('pipes', p.id, { outerDiameterM: v })}
                />
              </Labeled>
              <Labeled label={`ID (${lu})`}>
                <LengthField
                  valueM={p.innerDiameterM}
                  minM={1e-4}
                  units={units}
                  testId="pipe-id"
                  onCommitM={(v) => patch('pipes', p.id, { innerDiameterM: v })}
                />
              </Labeled>
            </div>
          </RowChrome>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="add-pipe"
          onClick={() => add('pipes')}
        >
          + pipe
        </Button>
      </Section>

      <Section title="Nesting matrix (outer ↓ / inner →)">
        <div className="overflow-x-auto">
          <table className="border-collapse text-xs" data-testid="nesting-matrix">
            <thead>
              <tr>
                <th className="p-1" />
                {db.pipes.map((inner) => (
                  <th
                    key={inner.id}
                    className="max-w-14 truncate p-1 font-normal"
                    title={inner.name}
                  >
                    {inner.nominalSize} {inner.sizingSystem}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {db.pipes.map((outer) => (
                <tr key={outer.id}>
                  <th className="max-w-24 truncate p-1 text-left font-normal" title={outer.name}>
                    {outer.name}
                  </th>
                  {db.pipes.map((inner) => {
                    if (inner.id === outer.id)
                      return (
                        <td key={inner.id} className="p-1 text-center text-muted-foreground">
                          —
                        </td>
                      );
                    const fit = fitOf(outer.id, inner.id)!;
                    return (
                      <td key={inner.id} className="p-0.5">
                        <span
                          className={`block rounded px-1 py-0.5 text-center ${FIT_STYLE[fit.classification]}`}
                          data-testid={`nesting-cell-${outer.id}-${inner.id}`}
                          data-fit={fit.classification}
                          title={`${outer.name} over ${inner.name}: ${(fit.clearanceM * 1000).toFixed(2)} mm clearance`}
                        >
                          {fit.classification}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Fittings">
        {db.fittings.map((f) => (
          <RowChrome
            key={f.id}
            testId="fitting-row"
            approximate={f.approximate}
            references={0}
            onDelete={() => remove('fittings', f.id)}
          >
            <div className="grid grid-cols-3 gap-1.5">
              <Labeled label="type">
                <EnumSelect<FittingType>
                  value={f.type}
                  options={fittingTypeSchema.options}
                  onChange={(v) => patch('fittings', f.id, { type: v })}
                />
              </Labeled>
              <Labeled label="system">
                <EnumSelect<PipeSizingSystem>
                  value={f.sizingSystem}
                  options={pipeSizingSystemSchema.options}
                  onChange={(v) => patch('fittings', f.id, { sizingSystem: v })}
                />
              </Labeled>
              <Labeled label="size">
                <TextField
                  value={f.nominalSize}
                  onCommit={(v) => patch('fittings', f.id, { nominalSize: v })}
                />
              </Labeled>
              <Labeled label={`mass (${mu})`}>
                <MassField
                  valueKg={f.massKg}
                  units={units}
                  onCommitKg={(v) => patch('fittings', f.id, { massKg: v })}
                />
              </Labeled>
              <Labeled label={`socket (${lu})`}>
                <LengthField
                  valueM={f.socketDepthM}
                  minM={0}
                  units={units}
                  onCommitM={(v) => patch('fittings', f.id, { socketDepthM: v })}
                />
              </Labeled>
            </div>
          </RowChrome>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="add-fitting"
          onClick={() => add('fittings')}
        >
          + fitting
        </Button>
      </Section>

      <Section title="Cordage">
        {db.cordage.map((c) => (
          <RowChrome
            key={c.id}
            testId="cordage-row"
            approximate={c.approximate}
            references={materialReferenceCount(doc, c.id)}
            onDelete={() => remove('cordage', c.id)}
          >
            <TextField value={c.name} onCommit={(v) => patch('cordage', c.id, { name: v })} />
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              <Labeled label="kind">
                <EnumSelect<'rope' | 'elastic' | 'bowdenCable'>
                  value={c.kind}
                  options={['rope', 'elastic', 'bowdenCable'] as const}
                  onChange={(v) => patch('cordage', c.id, { kind: v })}
                />
              </Labeled>
              <Labeled label="kg/m">
                <NumberField
                  value={c.linearDensityKgPerM}
                  min={0}
                  onCommit={(v) => patch('cordage', c.id, { linearDensityKgPerM: v })}
                />
              </Labeled>
              {c.kind === 'elastic' && (
                <Labeled label="k (N/m)">
                  <NumberField
                    value={c.defaultStiffnessNPerM ?? 0}
                    min={0}
                    onCommit={(v) => patch('cordage', c.id, { defaultStiffnessNPerM: v })}
                  />
                </Labeled>
              )}
            </div>
          </RowChrome>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="add-cordage"
          onClick={() => add('cordage')}
        >
          + cordage
        </Button>
      </Section>

      <Section title="Sheets (foam)">
        {db.sheets.map((s) => (
          <RowChrome
            key={s.id}
            testId="sheet-row"
            approximate={s.approximate}
            references={0}
            onDelete={() => remove('sheets', s.id)}
          >
            <TextField value={s.name} onCommit={(v) => patch('sheets', s.id, { name: v })} />
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              <Labeled label="kg/m²">
                <NumberField
                  value={s.arealDensityKgPerM2}
                  min={0}
                  onCommit={(v) => patch('sheets', s.id, { arealDensityKgPerM2: v })}
                />
              </Labeled>
            </div>
          </RowChrome>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="add-sheet"
          onClick={() => add('sheets')}
        >
          + sheet
        </Button>
      </Section>

      <Section title="Hardware">
        {db.hardware.map((h) => (
          <RowChrome
            key={h.id}
            testId="hardware-row"
            approximate={h.approximate}
            references={0}
            onDelete={() => remove('hardware', h.id)}
          >
            <TextField value={h.name} onCommit={(v) => patch('hardware', h.id, { name: v })} />
            <div className="mt-1 grid grid-cols-3 gap-1.5">
              <Labeled label={`mass (${mu})`}>
                <MassField
                  valueKg={h.massKg}
                  units={units}
                  onCommitKg={(v) => patch('hardware', h.id, { massKg: v })}
                />
              </Labeled>
            </div>
          </RowChrome>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="add-hardware"
          onClick={() => add('hardware')}
        >
          + hardware
        </Button>
      </Section>

      <Section title="Defaults">
        <div className="grid grid-cols-2 gap-1.5">
          <Labeled label="generic pipe kg/m (sketch links)">
            <NumberField
              value={db.genericPipeLinearDensityKgPerM}
              min={0}
              testId="generic-density"
              onCommit={(v) => updateCurrent((cur) => setGenericPipeDensity(cur, v))}
            />
          </Labeled>
          <Labeled label="heat-wrap allowance × partner OD">
            <NumberField
              value={doc.bomSettings.heatWrapAllowanceFactor}
              min={0}
              testId="bom-heatwrap"
              onCommit={(v) =>
                updateCurrent((cur) => updateBomSettings(cur, { heatWrapAllowanceFactor: v }))
              }
            />
          </Labeled>
          <Labeled label="rope waste factor">
            <NumberField
              value={doc.bomSettings.ropeWasteFactor}
              min={1}
              testId="bom-waste"
              onCommit={(v) =>
                updateCurrent((cur) => updateBomSettings(cur, { ropeWasteFactor: v }))
              }
            />
          </Labeled>
        </div>
      </Section>
    </div>
  );
}
