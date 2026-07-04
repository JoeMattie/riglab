import { describe, expect, it } from 'vitest';
import type { JointRealization, MechanismElement } from '../schema';
import { type Bom, computeBom } from './bom';
import { bomToCsv } from './csv';
import { BOM_SETTINGS, mech, node, testMaterials } from './testHelpers';

const MATS = testMaterials();

function sampleBom(): Bom {
  const nodes = [node('A', 0, 0), node('B', 1, 0)];
  const els: MechanismElement[] = [
    {
      id: 'L',
      type: 'link',
      maturity: 'engineered',
      nodeA: 'A',
      nodeB: 'B',
      pipeMaterialId: 'PA',
      endRealizationA: 'fitting' as JointRealization,
      endRealizationB: 'boltThrough' as JointRealization,
      pointMasses: [],
    },
    {
      id: 'r',
      type: 'rope',
      maturity: 'sketch',
      path: ['A', 'B'],
      lengthM: 2,
      cordageMaterialId: 'rope',
    },
  ];
  return computeBom([mech(els, nodes)], MATS, BOM_SETTINGS);
}

describe('bomToCsv', () => {
  it('emits the four sections with headers', () => {
    const csv = bomToCsv(sampleBom());
    expect(csv).toContain('Cut list');
    expect(csv).toContain('Fittings');
    expect(csv).toContain('Consumables');
    expect(csv).toContain('Weights');
    // uses CRLF line endings (RFC 4180)
    expect(csv.includes('\r\n')).toBe(true);
  });

  it('includes the cut-list rows and the rope consumable', () => {
    const csv = bomToCsv(sampleBom());
    const lines = csv.split('\r\n');
    // a pipe row for PA with quantity 1
    expect(lines.some((l) => l.startsWith('Pipe A,'))).toBe(true);
    // rope total = 2 × 1.2 waste
    expect(lines.some((l) => l.includes('Rope (incl. waste),2.4'))).toBe(true);
  });

  it('RFC 4180-quotes fields containing comma, quote, or newline', () => {
    const nodes = [node('A', 0, 0), node('B', 1, 0)];
    const nasty = {
      ...MATS,
      pipes: MATS.pipes.map((p) => (p.id === 'PA' ? { ...p, name: 'Pipe "A", 3/4"\nspecial' } : p)),
    };
    const bom = computeBom(
      [
        mech(
          [
            {
              id: 'L',
              type: 'link',
              maturity: 'engineered',
              nodeA: 'A',
              nodeB: 'B',
              pipeMaterialId: 'PA',
              pointMasses: [],
            },
          ],
          nodes,
        ),
      ],
      nasty,
      BOM_SETTINGS,
    );
    const csv = bomToCsv(bom);
    // embedded quotes doubled, whole field wrapped
    expect(csv).toContain('"Pipe ""A"", 3/4""\nspecial"');
  });

  it('round-trips through a naive RFC 4180 parser for the cut-list section', () => {
    const csv = bomToCsv(sampleBom());
    // the header row parses into exactly six columns
    const headerLine = csv.split('\r\n')[1]!;
    expect(parseCsvRow(headerLine)).toEqual([
      'Material',
      'Size',
      'System',
      'Kind',
      'Length (m)',
      'Quantity',
    ]);
  });
});

/** Minimal RFC 4180 single-row parser for the test. */
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
