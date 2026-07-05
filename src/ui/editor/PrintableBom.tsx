// Printable BOM view (§5): a shop-ready sheet rendered into a body portal and
// shown only under @media print (see index.css .print-bom). The BomPanel's
// Print button calls window.print(); the editor root hides and this prints on
// its own page. Same computeBom output as the on-screen panel — no drift.
import { createPortal } from 'react-dom';
import { type Bom, computeBom } from '../../bom';
import type { Project } from '../../schema';
import { formatLength, formatMass } from '../units';

const TECHNIQUES: Array<[keyof Bom['techniqueSummary'], string]> = [
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

export function PrintableBom({ doc }: { doc: Project }) {
  const bom = computeBom(doc.mechanisms, doc.materials, doc.bomSettings);
  const units = doc.unitsPreference;

  return createPortal(
    <div className="print-bom" aria-hidden>
      <h1>{doc.name} — Bill of Materials</h1>
      <div>
        Total weight: {formatMass(bom.weights.grandTotalKg, units)}
        {bom.unresolved.count > 0 &&
          ` · PARTIAL: ${bom.unresolved.count} element(s) without engineering data excluded`}
      </div>

      <h2>Cut list</h2>
      <table>
        <thead>
          <tr>
            <th>qty</th>
            <th>material</th>
            <th className="num">cut length</th>
          </tr>
        </thead>
        <tbody>
          {bom.cutList.map((p) => (
            <tr key={`${p.materialId}:${p.kind}:${p.lengthM}`}>
              <td>{p.quantity}×</td>
              <td>
                {p.materialName}
                {p.kind === 'heatWrapConnector' ? ' (wrap connector)' : ''}
              </td>
              <td className="num">{formatLength(p.lengthM, units)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {bom.bendSchedule.length > 0 && (
        <>
          <h2>Bend schedule</h2>
          <table>
            <tbody>
              {bom.bendSchedule.map((b) =>
                b.vertices.map((v, i) => (
                  <tr key={v.nodeId}>
                    <td>
                      {b.elementId.slice(0, 8)} · bend {i + 1}
                    </td>
                    <td className="num">
                      {Math.round((v.angleRad * 180) / Math.PI)}° @ r{' '}
                      {formatLength(v.radiusM, units)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </>
      )}

      <h2>Consumables</h2>
      <table>
        <tbody>
          <tr>
            <td>rope (incl. waste)</td>
            <td className="num">{formatLength(bom.consumables.ropeTotalM, units)}</td>
          </tr>
          <tr>
            <td>elastic</td>
            <td className="num">{formatLength(bom.consumables.elasticTotalM, units)}</td>
          </tr>
          <tr>
            <td>bowden cable</td>
            <td className="num">{formatLength(bom.consumables.bowdenTotalM, units)}</td>
          </tr>
        </tbody>
      </table>

      <h2>Techniques</h2>
      <div>
        {TECHNIQUES.filter(([k]) => bom.techniqueSummary[k] > 0)
          .map(([k, label]) => `${bom.techniqueSummary[k]} ${label}`)
          .join(' · ') || 'none'}
      </div>
    </div>,
    document.body,
  );
}
