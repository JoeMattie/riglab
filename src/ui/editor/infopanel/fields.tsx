// Small building blocks shared by the info-panel sections (§8.2a): labelled
// rows, a commit-on-blur/Enter numeric field (plus a unit-aware length
// variant), and assignment Selects.
import { useEffect, useRef, useState } from 'react';
import type { JointRealization, UnitsPreference } from '../../../schema';
import { jointRealizationSchema } from '../../../schema';
import { useEditorStore } from '../../../state/editorStore';
import { Input } from '../../components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/select';
import {
  formatLength,
  formatMass,
  lengthFromDisplay,
  lengthToDisplay,
  massFromDisplay,
  massToDisplay,
} from '../../units';

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b px-3 py-2">
      <div className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        {title}
      </div>
      {children}
    </div>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

const fmt = (v: number): string => String(Number(v.toFixed(4)));

/** Numeric input that commits on blur/Enter (one commit = one undo entry,
 * §8.2a); Escape reverts to the current document value. */
export function NumberField({
  value,
  onCommit,
  min,
  testId,
}: {
  value: number;
  onCommit: (v: number) => void;
  min?: number;
  testId?: string;
}) {
  const [text, setText] = useState(() => fmt(value));
  // resync the draft whenever the document value changes
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value && (min === undefined || v >= min)) onCommit(v);
    else setText(fmt(value));
  };
  return (
    <Input
      inputMode="decimal"
      className="h-7 w-24 px-2 text-right md:text-xs"
      value={text}
      data-testid={testId}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setText(fmt(value));
      }}
    />
  );
}

/** Checklist click-to-fix landing zone (§8.2 "opens exactly the needed
 * control"): when the transient focusHint names this control, scroll it into
 * view, ring-highlight it, and clear the hint after a beat. */
export function FocusTarget({
  control,
  children,
}: {
  control: 'material' | 'realization';
  children: React.ReactNode;
}) {
  const hint = useEditorStore((s) => s.focusHint);
  const setFocusHint = useEditorStore((s) => s.setFocusHint);
  const ref = useRef<HTMLDivElement>(null);
  const active = hint?.control === control;
  useEffect(() => {
    if (!active) return;
    ref.current?.scrollIntoView?.({ block: 'center' });
    const t = setTimeout(() => setFocusHint(null), 1600);
    return () => clearTimeout(t);
  }, [active, setFocusHint]);
  return (
    <div
      ref={ref}
      data-testid={`focus-target-${control}`}
      className={active ? 'rounded-md ring-2 ring-ring ring-offset-1' : undefined}
    >
      {children}
    </div>
  );
}

/** NumberField for a length stored in SI metres: displays and edits in the
 * project's preferred unit, commits back in metres. */
export function LengthField({
  valueM,
  onCommitM,
  units,
  minM,
  testId,
}: {
  valueM: number;
  onCommitM: (m: number) => void;
  units: UnitsPreference;
  minM?: number;
  testId?: string;
}) {
  return (
    <NumberField
      value={lengthToDisplay(valueM, units)}
      min={minM === undefined ? undefined : lengthToDisplay(minM, units)}
      testId={testId}
      onCommit={(v) => onCommitM(lengthFromDisplay(v, units))}
    />
  );
}

/** NumberField for a mass stored in SI kilograms: displays and edits in the
 * project's preferred unit, commits back in kilograms. */
export function MassField({
  valueKg,
  onCommitKg,
  units,
  testId,
}: {
  valueKg: number;
  onCommitKg: (kg: number) => void;
  units: UnitsPreference;
  testId?: string;
}) {
  return (
    <NumberField
      value={massToDisplay(valueKg, units)}
      min={0}
      testId={testId}
      onCommit={(v) => onCommitKg(massFromDisplay(v, units))}
    />
  );
}

export interface SelectOption {
  id: string;
  label: string;
}

/** Assignment Select with an explicit "none" entry mapping to undefined. A
 * null `value` renders the placeholder (mixed multi-select values). */
export function AssignSelect({
  value,
  options,
  onChange,
  placeholder,
  testId,
}: {
  value: string | null | undefined;
  options: SelectOption[];
  onChange: (id: string | undefined) => void;
  placeholder: string;
  testId?: string;
}) {
  return (
    <Select
      value={value ?? undefined}
      onValueChange={(v) => onChange(v === 'none' ? undefined : v)}
    >
      <SelectTrigger size="sm" className="h-7 w-full" data-testid={testId}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">— none —</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export const REALIZATION_LABELS: Record<JointRealization, string> = {
  heatWrapPivot: 'heat-wrapped pivot',
  heatWrapRigid: 'heat-wrapped rigid',
  nestedSleeve: 'nested sleeve',
  nestedCoupler: 'nested coupler',
  boltThrough: 'bolt-through',
  fitting: 'tee/elbow/cross fitting',
  conduitBox: 'conduit box',
  ropeLashing: 'rope lashing',
  clickDetachable: 'click/detachable',
};

export const REALIZATION_OPTIONS: SelectOption[] = jointRealizationSchema.options.map((r) => ({
  id: r,
  label: REALIZATION_LABELS[r],
}));

export const degrees = (rad: number): string => `${((rad * 180) / Math.PI).toFixed(1)}°`;
/** Length/mass display in the project's preferred units (§3 conversion at the
 * UI boundary only). Thin re-exports keep call sites terse. */
export const metres = formatLength;
export const kilograms = formatMass;
