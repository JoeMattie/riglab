// Bundled example: "seesaw spine" (planfile §9 item 1). A hip-rect four-point
// rotating attachment; a forward neck boom and aft tail boom built as rope-
// braced trusses (parallel pipe chords + tension rope X-braces); head and
// tail point masses. Formerly a side-left planar mechanism; in v7 the same
// elevation geometry lives natively in the world x-y plane at z = 0 (the
// wearer's sagittal plane). No pivots — the truss is a rigid rope-braced body.
//
// This builder is the authoritative constructor; src/examples/seesaw-spine.json
// is generated from it and is the bundled data artifact (a sync test guards
// that they agree). "raptor" appears in no identifier or string here.
import type { JointRealization, MechanismElement, Project } from '../schema';
import { exampleProject, groupOf, type MechParts, partsMechanism, v3 } from './shared';

const PIPE = 'pipe-nps-sch40-075'; // all structural pipes share one size
const CORD = 'cord-paracord550';

type Pt = { id: string; x: number; y: number; anchor?: boolean };

const NODES: Pt[] = [
  // hip-rect four-point rotating attachment (anchors)
  { id: 'hipBackTop', x: -0.15, y: 1.05, anchor: true },
  { id: 'hipFrontTop', x: 0.15, y: 1.05, anchor: true },
  { id: 'hipBackBot', x: -0.15, y: 0.95, anchor: true },
  { id: 'hipFrontBot', x: 0.15, y: 0.95, anchor: true },
  // truss chord ends
  { id: 'tTail', x: -1.0, y: 1.05 },
  { id: 'bTail', x: -1.0, y: 0.95 },
  { id: 'tNeck', x: 1.0, y: 1.05 },
  { id: 'bNeck', x: 1.0, y: 0.95 },
  // boom tips (point masses)
  { id: 'head', x: 1.6, y: 1.15 },
  { id: 'tail', x: -1.6, y: 1.0 },
];

interface LinkSpec {
  id: string;
  a: string;
  b: string;
  endA: JointRealization;
  endB: JointRealization;
  tag: string;
}

const LINKS: LinkSpec[] = [
  // spine truss — top + bottom chords
  {
    id: 'topTail',
    a: 'tTail',
    b: 'hipBackTop',
    endA: 'fitting',
    endB: 'heatWrapRigid',
    tag: 'spine',
  },
  {
    id: 'topMid',
    a: 'hipBackTop',
    b: 'hipFrontTop',
    endA: 'heatWrapRigid',
    endB: 'heatWrapRigid',
    tag: 'spine',
  },
  {
    id: 'topNeck',
    a: 'hipFrontTop',
    b: 'tNeck',
    endA: 'heatWrapRigid',
    endB: 'fitting',
    tag: 'spine',
  },
  {
    id: 'botTail',
    a: 'bTail',
    b: 'hipBackBot',
    endA: 'fitting',
    endB: 'heatWrapRigid',
    tag: 'spine',
  },
  {
    id: 'botMid',
    a: 'hipBackBot',
    b: 'hipFrontBot',
    endA: 'heatWrapRigid',
    endB: 'heatWrapRigid',
    tag: 'spine',
  },
  {
    id: 'botNeck',
    a: 'hipFrontBot',
    b: 'bNeck',
    endA: 'heatWrapRigid',
    endB: 'fitting',
    tag: 'spine',
  },
  // spine truss — verticals
  {
    id: 'vertTail',
    a: 'tTail',
    b: 'bTail',
    endA: 'heatWrapRigid',
    endB: 'heatWrapRigid',
    tag: 'spine',
  },
  {
    id: 'vertBack',
    a: 'hipBackTop',
    b: 'hipBackBot',
    endA: 'heatWrapRigid',
    endB: 'heatWrapRigid',
    tag: 'spine',
  },
  {
    id: 'vertFront',
    a: 'hipFrontTop',
    b: 'hipFrontBot',
    endA: 'heatWrapRigid',
    endB: 'heatWrapRigid',
    tag: 'spine',
  },
  {
    id: 'vertNeck',
    a: 'tNeck',
    b: 'bNeck',
    endA: 'boltThrough',
    endB: 'boltThrough',
    tag: 'spine',
  },
  // neck boom
  { id: 'neckTop', a: 'tNeck', b: 'head', endA: 'heatWrapRigid', endB: 'boltThrough', tag: 'neck' },
  { id: 'neckBot', a: 'bNeck', b: 'head', endA: 'heatWrapRigid', endB: 'boltThrough', tag: 'neck' },
  // tail boom
  { id: 'tailTop', a: 'tTail', b: 'tail', endA: 'heatWrapRigid', endB: 'boltThrough', tag: 'tail' },
  { id: 'tailBot', a: 'bTail', b: 'tail', endA: 'heatWrapRigid', endB: 'boltThrough', tag: 'tail' },
];

interface RopeSpec {
  id: string;
  path: [string, string];
  lengthM: number;
  tag: string;
}

// tension-only X cross-braces in the outer bays (§1 rope-braced truss)
const ROPES: RopeSpec[] = [
  { id: 'braceTail1', path: ['tTail', 'hipBackBot'], lengthM: 0.856, tag: 'tail' },
  { id: 'braceTail2', path: ['bTail', 'hipBackTop'], lengthM: 0.856, tag: 'tail' },
  { id: 'braceNeck1', path: ['hipFrontTop', 'bNeck'], lengthM: 0.856, tag: 'neck' },
  { id: 'braceNeck2', path: ['hipFrontBot', 'tNeck'], lengthM: 0.856, tag: 'neck' },
];

/** Subsystem contribution, id-prefixable for the full-creature compound. */
export function buildSeesawSpineParts(prefix = ''): MechParts {
  const n = (id: string) => prefix + id;
  const elements: MechanismElement[] = [
    ...LINKS.map(
      (l): MechanismElement => ({
        id: n(l.id),
        type: 'link',
        maturity: 'engineered',
        subsystemTag: l.tag,
        nodeA: n(l.a),
        nodeB: n(l.b),
        pipeMaterialId: PIPE,
        endRealizationA: l.endA,
        endRealizationB: l.endB,
        pointMasses: [],
      }),
    ),
    ...ROPES.map(
      (r): MechanismElement => ({
        id: n(r.id),
        type: 'rope',
        maturity: 'engineered',
        subsystemTag: r.tag,
        path: r.path.map(n),
        lengthM: r.lengthM,
        cordageMaterialId: CORD,
      }),
    ),
  ];

  return {
    nodes: NODES.map((node) => ({
      id: n(node.id),
      kind: node.anchor ? 'anchor' : 'free',
      position: v3(node.x, node.y, 0),
    })),
    elements,
    pointMasses: [
      { id: n('headMass'), name: 'head', massKg: 1.5, nodeId: n('head') },
      { id: n('tailMass'), name: 'tail', massKg: 0.8, nodeId: n('tail') },
    ],
    skeletonBindings: [],
    inputs: [],
  };
}

export function buildSeesawSpineProject(): Project {
  const parts = buildSeesawSpineParts();
  return exampleProject(
    'example-seesaw-spine',
    'Example — seesaw spine',
    partsMechanism('seesaw-spine', 'Seesaw spine', parts),
    [groupOf('grp-spine', 'Seesaw spine', parts.elements)],
  );
}
