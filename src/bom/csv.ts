// Hand-rolled CSV export (DECISIONS.md: export-only, ~20 lines, RFC 4180
// quoting). Covers cut list + bend schedule + fittings + consumables +
// shopping list + weights (§6.2).
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

/** Radians → degrees, rounded to 0.1° — a shop-usable bender setting. */
function deg(rad: number): number {
  return Math.round(((rad * 180) / Math.PI) * 10) / 10;
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

  // twist° = bend-plane rotation relative to the previous bend (0 for the
  // first bend of each part; see geometry/pipe.ts bendDihedralsRad).
  lines.push('Bend schedule');
  lines.push(row(['Element', 'Bend', 'Node', 'angle°', 'twist°', 'Radius (m)']));
  for (const b of bom.bendSchedule) {
    b.vertices.forEach((v, i) => {
      lines.push(
        row([b.elementId, i + 1, v.nodeId, deg(v.angleRad), deg(v.dihedralRad), v.radiusM]),
      );
    });
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

  lines.push('Shopping list');
  lines.push(row(['Kind', 'Item', 'Quantity', 'Length (m)']));
  for (const p of bom.shoppingList.pipes) {
    lines.push(
      row(['pipe stock', `${p.materialName} (${p.stockLengthM} m stick)`, p.sticksToBuy, '']),
    );
  }
  for (const f of bom.shoppingList.fittings) {
    lines.push(row(['fitting', f.label, f.quantity, '']));
  }
  for (const h of bom.shoppingList.hardware) {
    lines.push(row(['hardware', h.label, h.quantity, '']));
  }
  for (const c of bom.shoppingList.cordage) {
    lines.push(row(['cordage', c.label, '', c.lengthM]));
  }
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
  for (const [gid, kg] of Object.entries(bom.weights.perGroupKg).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    lines.push(row([`Group: ${bom.weights.groupNames[gid] ?? gid}`, kg]));
  }
  lines.push(row(['Grand total', bom.weights.grandTotalKg]));

  return lines.join('\r\n');
}
