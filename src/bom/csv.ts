// Hand-rolled CSV export (DECISIONS.md: export-only, ~20 lines, RFC 4180
// quoting). Covers cut list + fittings + consumables + weights (§6.2).
import type { Bom } from './bom';

/** RFC 4180: a field containing a comma, double-quote, CR or LF is wrapped in
 * double-quotes with embedded quotes doubled. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(fields: Array<string | number>): string {
  return fields.map(csvField).join(',');
}

/** Serialize a BOM to a CSV string (CRLF line endings, RFC 4180 style). */
export function bomToCsv(bom: Bom): string {
  const lines: string[] = [];

  lines.push('Cut list');
  lines.push(row(['Material', 'Size', 'System', 'Kind', 'Length (m)', 'Quantity']));
  for (const p of bom.cutList) {
    lines.push(row([p.materialName, p.nominalSize, p.sizingSystem, p.kind, p.lengthM, p.quantity]));
  }
  lines.push('');

  lines.push('Fittings');
  lines.push(row(['Type', 'Size', 'System', 'Quantity', 'Mass (kg)']));
  for (const f of bom.fittings) {
    lines.push(row([f.type, f.nominalSize, f.sizingSystem, f.quantity, f.totalMassKg]));
  }
  lines.push('');

  lines.push('Consumables');
  lines.push(row(['Item', 'Length (m)']));
  lines.push(row(['Rope (incl. waste)', bom.consumables.ropeTotalM]));
  lines.push(row(['Elastic', bom.consumables.elasticTotalM]));
  lines.push(row(['Bowden cable', bom.consumables.bowdenTotalM]));
  lines.push('');

  lines.push('Weights');
  lines.push(row(['Scope', 'Mass (kg)']));
  lines.push(row(['Pipes', bom.weights.breakdown.pipesKg]));
  lines.push(row(['Fittings', bom.weights.breakdown.fittingsKg]));
  lines.push(row(['Cordage', bom.weights.breakdown.cordageKg]));
  lines.push(row(['Point masses', bom.weights.breakdown.pointMassesKg]));
  lines.push(row(['Hardware', bom.weights.breakdown.hardwareKg]));
  for (const [tag, kg] of Object.entries(bom.weights.perSubsystemTagKg).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(row([`Tag: ${tag === '' ? '(untagged)' : tag}`, kg]));
  }
  lines.push(row(['Grand total', bom.weights.grandTotalKg]));

  return lines.join('\r\n');
}
