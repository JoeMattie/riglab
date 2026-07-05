// Single-selection inspector (§8.2a): identity, geometry, behavior
// parameters, connections in both faces; materials, realizations, mass,
// nesting status, force readout, and unresolved items in the design face.
import { validateTelescopePair } from '../../../bom';
import {
  boundChannelNames,
  connectedElements,
  elementGeometry,
  elementMassKg,
  elementNodeIds,
} from '../../../design/elementInfo';
import { elementResolutionItems, elementTypeLabel } from '../../../design/resolution';
import type {
  JointRealization,
  MaterialsDb,
  Mechanism,
  MechanismElement,
  Project,
  UnitsPreference,
} from '../../../schema';
import type { SolveDiagnostics } from '../../../solver';
import { useAppStore } from '../../../state/appStore';
import {
  assignCordageMaterial,
  assignEndRealization,
  assignPipeMaterial,
  assignRealization,
  assignTelescopeMaterial,
  patchElement,
  setLinkLength,
} from '../../../state/docOps';
import { type Face, useEditorStore } from '../../../state/editorStore';
import { Badge } from '../../components/badge';
import { Button } from '../../components/button';
import { Checkbox } from '../../components/checkbox';
import { lengthUnit } from '../../units';
import { formatForce } from '../forces';
import {
  AssignSelect,
  degrees,
  FocusTarget,
  kilograms,
  LengthField,
  metres,
  NumberField,
  REALIZATION_OPTIONS,
  Row,
  Section,
  type SelectOption,
} from './fields';

const pipeOptions = (materials: MaterialsDb): SelectOption[] =>
  materials.pipes.map((p) => ({ id: p.id, label: p.name }));

const cordageOptions = (materials: MaterialsDb, kind: 'rope' | 'elastic' | 'bowdenCable') =>
  materials.cordage.filter((c) => c.kind === kind).map((c) => ({ id: c.id, label: c.name }));

export function ElementInspector({
  doc,
  mech,
  el,
  face,
  diagnostics,
}: {
  doc: Project;
  mech: Mechanism;
  el: MechanismElement;
  face: Face;
  diagnostics?: SolveDiagnostics;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const select = useEditorStore((s) => s.select);
  const equilibriumOn = useEditorStore((s) => s.equilibriumOn);
  const equilibrium = useEditorStore((s) => s.equilibrium);

  const geom = elementGeometry(el, mech);
  const channels = boundChannelNames(el, mech);
  const connections = connectedElements(el, mech);
  const design = face === 'design';
  const units = doc.unitsPreference;

  const patch = <K extends MechanismElement['type']>(
    type: K,
    p: Partial<Extract<MechanismElement, { type: K }>>,
  ) => updateCurrent((cur) => patchElement(cur, mech.id, el.id, type, p));

  return (
    <div data-testid="element-inspector">
      <Section title="Identity">
        <Row label="type">{elementTypeLabel(el.type)}</Row>
        <Row label="id">
          <span className="font-mono text-xs">{el.id.slice(0, 8)}</span>
        </Row>
        <Row label="maturity">
          <Badge
            variant={el.maturity === 'engineered' ? 'default' : 'secondary'}
            data-testid="maturity-badge"
          >
            {el.maturity}
          </Badge>
        </Row>
      </Section>

      <Section title="Geometry">
        {(el.type === 'link' || el.type === 'telescope') && geom.lengthM !== undefined && (
          <Row label={`length (${lengthUnit(units)})`}>
            <LengthField
              valueM={geom.lengthM}
              minM={1e-3}
              units={units}
              testId="length-field"
              onCommitM={(v) => updateCurrent((cur) => setLinkLength(cur, mech.id, el.id, v))}
            />
          </Row>
        )}
        {el.type === 'bentLink' && (
          <>
            <Row label="developed length">{metres(geom.developedLengthM ?? 0, units)}</Row>
            {geom.vertexAnglesRad?.map((a, i) => (
              <Row key={el.nodeIds[i + 1]} label={`bend ${i + 1}`}>
                {degrees(a)}
              </Row>
            ))}
          </>
        )}
        {(el.type === 'rope' || el.type === 'elastic') && geom.lengthM !== undefined && (
          <Row label="drawn path">{metres(geom.lengthM, units)}</Row>
        )}
        {el.type !== 'bentLink' &&
          elementNodeIds(el, mech)
            .slice(0, 4)
            .map((nodeId, i) => {
              const p = geom.points[i];
              return p ? (
                <Row key={nodeId} label={i === 0 ? 'endpoints' : ''}>
                  <span className="font-mono text-xs">
                    ({Number(p.x.toFixed(3))}, {Number(p.y.toFixed(3))})
                  </span>
                </Row>
              ) : null;
            })}
      </Section>

      <BehaviorSection el={el} patch={patch} units={units} />

      {channels.length > 0 && (
        <Section title="Channels">
          <Row label="bound to">{channels.join(', ')}</Row>
        </Section>
      )}

      {design && (
        <DesignSections
          doc={doc}
          mech={mech}
          el={el}
          diagnostics={diagnostics}
          forceN={
            equilibriumOn &&
            (equilibrium.status === 'converged' || equilibrium.status === 'nonConverged')
              ? equilibrium.elementForces[el.id]
              : undefined
          }
        />
      )}

      {connections.length > 0 && (
        <Section title="Connected to">
          <div className="flex flex-col items-start gap-0.5">
            {connections.map((c) => (
              <button
                key={c.elementId}
                type="button"
                data-testid="connection-link"
                className="cursor-pointer border-none bg-transparent p-0 text-left text-primary text-xs underline-offset-2 hover:underline"
                onClick={() => select(c.elementId)}
              >
                {elementTypeLabel(c.type)}{' '}
                <span className="font-mono">{c.elementId.slice(0, 8)}</span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/** Editable behavior parameters per element type (§8.2a sketch scope). */
function BehaviorSection({
  el,
  patch,
  units,
}: {
  el: MechanismElement;
  patch: <K extends MechanismElement['type']>(
    type: K,
    p: Partial<Extract<MechanismElement, { type: K }>>,
  ) => void;
  units: UnitsPreference;
}) {
  const lu = lengthUnit(units);
  switch (el.type) {
    case 'pivot':
      return (
        <Section title="Joint">
          <Row label="members">{el.memberIds.length}</Row>
          <Row label="welded pairs">{el.welds.length}</Row>
          {el.angleLimit && (
            <>
              <Row label="limit min">
                <NumberField
                  value={(el.angleLimit.minRad * 180) / Math.PI}
                  onCommit={(v) =>
                    patch('pivot', {
                      angleLimit: { ...el.angleLimit!, minRad: (v * Math.PI) / 180 },
                    })
                  }
                />
              </Row>
              <Row label="limit max">
                <NumberField
                  value={(el.angleLimit.maxRad * 180) / Math.PI}
                  onCommit={(v) =>
                    patch('pivot', {
                      angleLimit: { ...el.angleLimit!, maxRad: (v * Math.PI) / 180 },
                    })
                  }
                />
              </Row>
            </>
          )}
          {el.torsionSpring && (
            <>
              <Row label="spring k (N·m/rad)">
                <NumberField
                  value={el.torsionSpring.stiffnessNmPerRad}
                  min={0}
                  onCommit={(v) =>
                    patch('pivot', {
                      torsionSpring: { ...el.torsionSpring!, stiffnessNmPerRad: v },
                    })
                  }
                />
              </Row>
              <Row label="rest angle">
                <NumberField
                  value={(el.torsionSpring.restAngleRad * 180) / Math.PI}
                  onCommit={(v) =>
                    patch('pivot', {
                      torsionSpring: { ...el.torsionSpring!, restAngleRad: (v * Math.PI) / 180 },
                    })
                  }
                />
              </Row>
            </>
          )}
        </Section>
      );
    case 'slider':
      return (
        <Section title="Slider">
          <Row label="travel min (0–1)">
            <NumberField
              value={el.travelMin}
              min={0}
              onCommit={(v) => patch('slider', { travelMin: Math.min(1, v) })}
            />
          </Row>
          <Row label="travel max (0–1)">
            <NumberField
              value={el.travelMax}
              min={0}
              onCommit={(v) => patch('slider', { travelMax: Math.min(1, v) })}
            />
          </Row>
        </Section>
      );
    case 'rope':
      return (
        <Section title="Rope">
          <Row label={`L₀ (${lu})`}>
            <LengthField
              valueM={el.lengthM}
              minM={1e-3}
              units={units}
              testId="rope-l0-field"
              onCommitM={(v) => patch('rope', { lengthM: v })}
            />
          </Row>
          <Row label="eyelets">{Math.max(0, el.path.length - 2)}</Row>
        </Section>
      );
    case 'elastic':
      return (
        <Section title="Elastic">
          <Row label="k (N/m)">
            <NumberField
              value={el.stiffnessNPerM}
              min={1e-6}
              testId="elastic-k-field"
              onCommit={(v) => patch('elastic', { stiffnessNPerM: v })}
            />
          </Row>
          <Row label={`rest length (${lu})`}>
            <LengthField
              valueM={el.restLengthM}
              minM={1e-3}
              units={units}
              onCommitM={(v) => patch('elastic', { restLengthM: v })}
            />
          </Row>
          <Row label="pretension (N)">
            <NumberField
              value={el.pretensionN ?? 0}
              min={0}
              onCommit={(v) => patch('elastic', { pretensionN: v })}
            />
          </Row>
          <Row label="tension-only">
            <Checkbox
              checked={el.tensionOnly}
              onCheckedChange={(c) => patch('elastic', { tensionOnly: c === true })}
            />
          </Row>
        </Section>
      );
    case 'telescope':
      return (
        <Section title="Telescope">
          <Row label={`min length (${lu})`}>
            <LengthField
              valueM={el.minLengthM}
              minM={1e-3}
              units={units}
              onCommitM={(v) => patch('telescope', { minLengthM: v })}
            />
          </Row>
          <Row label={`max length (${lu})`}>
            <LengthField
              valueM={el.maxLengthM}
              minM={1e-3}
              units={units}
              onCommitM={(v) => patch('telescope', { maxLengthM: v })}
            />
          </Row>
          <Row label="sliding joint">
            <Checkbox
              checked={el.sliding}
              onCheckedChange={(c) => patch('telescope', { sliding: c === true })}
            />
          </Row>
        </Section>
      );
    case 'bowden':
      return (
        <Section title="Bowden">
          <Row label={`rest A (${lu})`}>
            <LengthField
              valueM={el.restLengthAM}
              minM={1e-3}
              units={units}
              onCommitM={(v) => patch('bowden', { restLengthAM: v })}
            />
          </Row>
          <Row label={`rest B (${lu})`}>
            <LengthField
              valueM={el.restLengthBM}
              minM={1e-3}
              units={units}
              onCommitM={(v) => patch('bowden', { restLengthBM: v })}
            />
          </Row>
        </Section>
      );
    case 'torsionCable':
      return (
        <Section title="Torsion cable">
          <Row label="ratio">
            <NumberField value={el.ratio} onCommit={(v) => patch('torsionCable', { ratio: v })} />
          </Row>
          <Row label="backlash (deg)">
            <NumberField
              value={(el.backlashRad * 180) / Math.PI}
              min={0}
              onCommit={(v) => patch('torsionCable', { backlashRad: (v * Math.PI) / 180 })}
            />
          </Row>
        </Section>
      );
    default:
      return null;
  }
}

/** Design-face-only sections: materials, realizations, mass, nesting status,
 * force readout, unresolved items (§8.2a design scope). */
function DesignSections({
  doc,
  mech,
  el,
  diagnostics,
  forceN,
}: {
  doc: Project;
  mech: Mechanism;
  el: MechanismElement;
  diagnostics?: SolveDiagnostics;
  forceN?: number;
}) {
  const updateCurrent = useAppStore((s) => s.updateCurrent);
  const materials = doc.materials;
  const items = elementResolutionItems(el, mech, materials, diagnostics);
  const massKg = elementMassKg(el, mech, materials);

  const applyToSimilar =
    (el.type === 'link' || el.type === 'bentLink') && el.pipeMaterialId
      ? mech.elements.filter((e) => e.type === el.type && !e.pipeMaterialId).map((e) => e.id)
      : [];

  return (
    <>
      {(el.type === 'link' || el.type === 'bentLink') && (
        <Section title="Material">
          <FocusTarget control="material">
            <AssignSelect
              value={el.pipeMaterialId}
              options={pipeOptions(materials)}
              placeholder="assign a pipe…"
              testId="material-select"
              onChange={(id) =>
                updateCurrent((cur) => assignPipeMaterial(cur, mech.id, [el.id], id))
              }
            />
          </FocusTarget>
          {applyToSimilar.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 h-6 w-full text-xs"
              data-testid="apply-to-similar"
              onClick={() =>
                updateCurrent((cur) =>
                  assignPipeMaterial(cur, mech.id, applyToSimilar, el.pipeMaterialId),
                )
              }
            >
              Apply to {applyToSimilar.length} unassigned {elementTypeLabel(el.type)}
              {applyToSimilar.length > 1 ? 's' : ''}
            </Button>
          )}
        </Section>
      )}

      {el.type === 'telescope' && (
        <Section title="Materials (outer / inner)">
          <FocusTarget control="material">
            <div className="flex flex-col gap-1">
              <AssignSelect
                value={el.outerPipeMaterialId}
                options={pipeOptions(materials)}
                placeholder="outer pipe…"
                testId="material-select-outer"
                onChange={(id) =>
                  updateCurrent((cur) => assignTelescopeMaterial(cur, mech.id, el.id, 'outer', id))
                }
              />
              <AssignSelect
                value={el.innerPipeMaterialId}
                options={pipeOptions(materials)}
                placeholder="inner pipe…"
                testId="material-select-inner"
                onChange={(id) =>
                  updateCurrent((cur) => assignTelescopeMaterial(cur, mech.id, el.id, 'inner', id))
                }
              />
              <NestingBadge el={el} materials={materials} />
            </div>
          </FocusTarget>
        </Section>
      )}

      {(el.type === 'rope' || el.type === 'elastic' || el.type === 'bowden') && (
        <Section title="Material">
          <FocusTarget control="material">
            <AssignSelect
              value={el.cordageMaterialId}
              options={cordageOptions(
                materials,
                el.type === 'rope' ? 'rope' : el.type === 'elastic' ? 'elastic' : 'bowdenCable',
              )}
              placeholder="assign cordage…"
              testId="material-select"
              onChange={(id) =>
                updateCurrent((cur) => assignCordageMaterial(cur, mech.id, [el.id], id))
              }
            />
          </FocusTarget>
        </Section>
      )}

      {(el.type === 'pivot' || el.type === 'slider') && (
        <Section title="Realization">
          <FocusTarget control="realization">
            <AssignSelect
              value={el.realization}
              options={REALIZATION_OPTIONS}
              placeholder="choose a realization…"
              testId="realization-select"
              onChange={(r) =>
                updateCurrent((cur) =>
                  assignRealization(cur, mech.id, [el.id], r as JointRealization | undefined),
                )
              }
            />
          </FocusTarget>
        </Section>
      )}

      {(el.type === 'link' || el.type === 'bentLink') && (
        <Section title="End realizations">
          <div className="flex flex-col gap-1">
            <AssignSelect
              value={el.endRealizationA}
              options={REALIZATION_OPTIONS}
              placeholder="end A (butt cut)…"
              testId="end-realization-a"
              onChange={(r) =>
                updateCurrent((cur) =>
                  assignEndRealization(cur, mech.id, el.id, 'A', r as JointRealization | undefined),
                )
              }
            />
            <AssignSelect
              value={el.endRealizationB}
              options={REALIZATION_OPTIONS}
              placeholder="end B (butt cut)…"
              testId="end-realization-b"
              onChange={(r) =>
                updateCurrent((cur) =>
                  assignEndRealization(cur, mech.id, el.id, 'B', r as JointRealization | undefined),
                )
              }
            />
          </div>
        </Section>
      )}

      {(massKg !== undefined || forceN !== undefined) && (
        <Section title="Computed">
          {massKg !== undefined && (
            <Row label="mass">
              <span data-testid="element-mass">{kilograms(massKg, doc.unitsPreference)}</span>
            </Row>
          )}
          {forceN !== undefined && (
            <Row label={el.type === 'torsionCable' ? 'torque' : 'force'}>
              <span data-testid="element-force">
                {el.type === 'torsionCable'
                  ? `${forceN.toFixed(2)} N·m`
                  : formatForce(forceN, doc.unitsPreference)}
              </span>
            </Row>
          )}
        </Section>
      )}

      {items.length > 0 && (
        <Section title="Unresolved">
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {items.map((i) => (
              <li
                key={i.id}
                data-testid="unresolved-item"
                className={i.severity === 'warning' ? 'text-destructive' : 'text-amber-700'}
              >
                {i.label}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

function NestingBadge({
  el,
  materials,
}: {
  el: Extract<MechanismElement, { type: 'telescope' }>;
  materials: MaterialsDb;
}) {
  const outer = materials.pipes.find((p) => p.id === el.outerPipeMaterialId);
  const inner = materials.pipes.find((p) => p.id === el.innerPipeMaterialId);
  if (!outer || !inner) return null;
  const fit = validateTelescopePair(outer, inner);
  return (
    <Badge
      variant={fit.acceptable ? 'default' : 'destructive'}
      data-testid="nesting-badge"
      title={fit.reason}
    >
      {fit.classification} fit · {(fit.clearanceM * 1000).toFixed(2)} mm
    </Badge>
  );
}
