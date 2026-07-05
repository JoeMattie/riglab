// Bundled example: "body frame (suspended)" (PLANFILE-3d-raptor-samples.md
// example 8). The closed torso box frame from the reference build's sketch:
// six rails joined into one rigid ring by fully-welded corner pivots, a prow
// pipe pair meeting BELOW the rail plane (so the frame is not a planar
// figure), and a genuinely non-planar bent-pipe hoop over the back — its
// bend schedule must report nonzero dihedral ("twist") angles, which no v6
// planar document could produce. The frame is one rigid body with no
// internal joints; the mechanism content is its 3D suspension: pretensioned
// shoulder bungees carry the weight, four near-taut hip-rectangle straps
// stabilize sway (rope-as-limit), and one "nose tuck" channel cinches the
// prow tip down against the bungees through a sliding-telescope grip.
//
// All suspension anchors carry anchorBindings to their wearer anchors, so
// the whole hang rides the wearer through pose and clip playback.
import type { AnchorBinding, MechanismElement, Project, Vec3 } from '../schema';
import {
  BUNGEE_8,
  CORD,
  dist,
  exampleProject,
  groupOf,
  type MechParts,
  PIPE_050,
  PIPE_075,
  PIPE_CLS200_075,
  PIPE_CTS_075,
  partsMechanism,
  v3,
} from './shared';

// Frame nodes (all free; the corner welds make them one rigid body) plus the
// wearer-side suspension anchors at the DEFAULT_WEARER rest positions
// (1.75 m: shoulders y 0.818·H = 1.4315, z ±0.23; hip rect y 0.53·H = 0.9275,
// x 0.12/−0.14, z ±0.21 — see wearer/skeleton.ts).
const P: Record<string, Vec3> = {
  cornerFL: v3(0.42, 1.0, 0.27),
  cornerFR: v3(0.42, 1.0, -0.27),
  cornerBL: v3(-0.38, 1.0, 0.27),
  cornerBR: v3(-0.38, 1.0, -0.27),
  midL: v3(0.02, 1.0, 0.27),
  midR: v3(0.02, 1.0, -0.27),
  nose: v3(0.72, 0.82, 0),
  hoopL: v3(-0.02, 1.45, 0.14),
  hoopApex: v3(-0.1, 1.56, 0),
  hoopR: v3(-0.02, 1.45, -0.14),
  shoulderAnchL: v3(0, 1.4315, 0.23),
  shoulderAnchR: v3(0, 1.4315, -0.23),
  hipAnchFL: v3(0.12, 0.9275, 0.21),
  hipAnchFR: v3(0.12, 0.9275, -0.21),
  hipAnchBL: v3(-0.14, 0.9275, 0.21),
  hipAnchBR: v3(-0.14, 0.9275, -0.21),
  cinchBase: v3(0.72, 0.45, 0),
  cinchPull: v3(0.72, 0.6, 0),
};

/** Shoulder bungees are cut short of the drawn hang so their pretension
 * carries the frame weight (planfile: rest ≈ 0.85 × drawn distance). */
const BUNGEE_REST_FACTOR = 0.85;
/** Hip straps get 5 mm of slack: near-taut sway stabilizers, not load path.
 * (Started at the planfile's 1 cm; the straps run obliquely, so 1 cm of slack
 * let the over-lifted back corners ride ~4.7 cm high — right at the 5 cm
 * settle budget. Halving the slack halves the ride.) */
const STRAP_SLACK_M = 0.005;
/** Per-bungee stiffness. With ~0.09 m of pretension stretch on each of the
 * four bungees this slightly over-lifts the ~2.5 kg frame, so the hip straps
 * come taut and pin the hang within a few cm of the drawn pose. */
const BUNGEE_STIFFNESS_N_PER_M = 120;

const round4 = (x: number): number => Math.round(x * 1e4) / 1e4;

function rail(
  id: string,
  nodeA: string,
  nodeB: string,
  materialId: string,
): Extract<MechanismElement, { type: 'link' }> {
  return {
    id,
    type: 'link',
    maturity: 'engineered',
    subsystemTag: 'frame',
    nodeA,
    nodeB,
    pipeMaterialId: materialId,
    endRealizationA: 'fitting',
    endRealizationB: 'fitting',
    pointMasses: [],
  };
}

/** Fully-welded corner: every member pair welded, so the meeting members are
 * one rigid junction (a spherical pivot with all pairs welded carries no
 * residual rotation — the "lashed corners" of the sketch). */
function weldedCorner(
  id: string,
  nodeId: string,
  memberIds: string[],
  realization: Extract<MechanismElement, { type: 'pivot' }>['realization'],
): Extract<MechanismElement, { type: 'pivot' }> {
  const welds: [string, string][] = [];
  for (let i = 0; i < memberIds.length; i++) {
    for (let j = i + 1; j < memberIds.length; j++) {
      welds.push([memberIds[i]!, memberIds[j]!]);
    }
  }
  return {
    id,
    type: 'pivot',
    maturity: 'engineered',
    subsystemTag: 'frame',
    nodeId,
    joint: { kind: 'spherical' },
    memberIds,
    welds,
    realization,
  };
}

function bungee(id: string, nodeA: string, nodeB: string): MechanismElement {
  return {
    id,
    type: 'elastic',
    maturity: 'engineered',
    subsystemTag: 'suspension',
    nodeA,
    nodeB,
    restLengthM: round4(BUNGEE_REST_FACTOR * dist(P[nodeA]!, P[nodeB]!)),
    stiffnessNPerM: BUNGEE_STIFFNESS_N_PER_M,
    tensionOnly: true,
    cordageMaterialId: BUNGEE_8,
  };
}

function strap(id: string, nodeA: string, nodeB: string): MechanismElement {
  return {
    id,
    type: 'rope',
    maturity: 'engineered',
    subsystemTag: 'suspension',
    path: [nodeA, nodeB],
    lengthM: round4(dist(P[nodeA]!, P[nodeB]!) + STRAP_SLACK_M),
    cordageMaterialId: CORD,
  };
}

export function buildBodyFrameParts(prefix = ''): MechParts {
  const n = (id: string) => prefix + id;

  const frameElements: MechanismElement[] = [
    // rail ring — front/back rails plus side rails split at the midpoints
    rail(n('railFront'), n('cornerFL'), n('cornerFR'), PIPE_075),
    rail(n('railBack'), n('cornerBL'), n('cornerBR'), PIPE_075),
    rail(n('sideFrontL'), n('cornerFL'), n('midL'), PIPE_075),
    rail(n('sideBackL'), n('midL'), n('cornerBL'), PIPE_075),
    rail(n('sideFrontR'), n('cornerFR'), n('midR'), PIPE_075),
    rail(n('sideBackR'), n('midR'), n('cornerBR'), PIPE_075),
    // prow — meets below the rail plane, lashed at the tip
    {
      ...rail(n('prowL'), n('cornerFL'), n('nose'), PIPE_050),
      endRealizationB: 'ropeLashing',
    },
    {
      ...rail(n('prowR'), n('cornerFR'), n('nose'), PIPE_050),
      endRealizationB: 'ropeLashing',
    },
    // over-the-back spine hoop: one heat-bent pipe through three NON-planar
    // interior vertices — the bend schedule carries nonzero dihedrals
    {
      id: n('spineHoop'),
      type: 'bentLink',
      maturity: 'engineered',
      subsystemTag: 'frame',
      nodeIds: [n('midL'), n('hoopL'), n('hoopApex'), n('hoopR'), n('midR')],
      filletRadiiM: [0.1, 0.15, 0.1],
      pipeMaterialId: PIPE_050,
      endRealizationA: 'fitting',
      endRealizationB: 'fitting',
      pointMasses: [],
    },
    // welded junctions: elbow corners are fittings, the prow tip is the
    // sketch's blue rope lashing
    weldedCorner(
      n('jointFL'),
      n('cornerFL'),
      [n('railFront'), n('sideFrontL'), n('prowL')],
      'fitting',
    ),
    weldedCorner(
      n('jointFR'),
      n('cornerFR'),
      [n('railFront'), n('sideFrontR'), n('prowR')],
      'fitting',
    ),
    weldedCorner(n('jointBL'), n('cornerBL'), [n('railBack'), n('sideBackL')], 'fitting'),
    weldedCorner(n('jointBR'), n('cornerBR'), [n('railBack'), n('sideBackR')], 'fitting'),
    weldedCorner(
      n('jointMidL'),
      n('midL'),
      [n('sideFrontL'), n('sideBackL'), n('spineHoop')],
      'fitting',
    ),
    weldedCorner(
      n('jointMidR'),
      n('midR'),
      [n('sideFrontR'), n('sideBackR'), n('spineHoop')],
      'fitting',
    ),
    weldedCorner(n('jointNose'), n('nose'), [n('prowL'), n('prowR')], 'ropeLashing'),
  ];

  const suspensionElements: MechanismElement[] = [
    bungee(n('bungeeFL'), n('shoulderAnchL'), n('cornerFL')),
    bungee(n('bungeeBL'), n('shoulderAnchL'), n('cornerBL')),
    bungee(n('bungeeFR'), n('shoulderAnchR'), n('cornerFR')),
    bungee(n('bungeeBR'), n('shoulderAnchR'), n('cornerBR')),
    strap(n('strapFL'), n('hipAnchFL'), n('cornerFL')),
    strap(n('strapFR'), n('hipAnchFR'), n('cornerFR')),
    strap(n('strapBL'), n('hipAnchBL'), n('cornerBL')),
    strap(n('strapBR'), n('hipAnchBR'), n('cornerBR')),
  ];

  const tuckElements: MechanismElement[] = [
    // the grip slides on a handle pipe below the prow (sliding telescope
    // rail); its driven node's displacement channel slides along the rail
    // axis (+y), so negative values pull the grip — and the nose — down
    {
      id: n('cinchRail'),
      type: 'telescope',
      maturity: 'engineered',
      subsystemTag: 'tuck',
      nodeA: n('cinchBase'),
      nodeB: n('cinchPull'),
      minLengthM: 0.04,
      maxLengthM: 0.3,
      lengthM: 0.15,
      sliding: true,
      outerPipeMaterialId: PIPE_CLS200_075,
      innerPipeMaterialId: PIPE_CTS_075,
      pointMasses: [],
    },
    {
      id: n('tuckRope'),
      type: 'rope',
      maturity: 'engineered',
      subsystemTag: 'tuck',
      path: [n('nose'), n('cinchPull')],
      lengthM: round4(dist(P.nose!, P.cinchPull!) + 0.002),
      cordageMaterialId: CORD,
    },
  ];

  return {
    nodes: [
      { id: n('cornerFL'), kind: 'free', position: P.cornerFL! },
      { id: n('cornerFR'), kind: 'free', position: P.cornerFR! },
      { id: n('cornerBL'), kind: 'free', position: P.cornerBL! },
      { id: n('cornerBR'), kind: 'free', position: P.cornerBR! },
      { id: n('midL'), kind: 'free', position: P.midL! },
      { id: n('midR'), kind: 'free', position: P.midR! },
      { id: n('nose'), kind: 'free', position: P.nose! },
      { id: n('hoopL'), kind: 'free', position: P.hoopL! },
      { id: n('hoopApex'), kind: 'free', position: P.hoopApex! },
      { id: n('hoopR'), kind: 'free', position: P.hoopR! },
      { id: n('shoulderAnchL'), kind: 'anchor', position: P.shoulderAnchL! },
      { id: n('shoulderAnchR'), kind: 'anchor', position: P.shoulderAnchR! },
      { id: n('hipAnchFL'), kind: 'anchor', position: P.hipAnchFL! },
      { id: n('hipAnchFR'), kind: 'anchor', position: P.hipAnchFR! },
      { id: n('hipAnchBL'), kind: 'anchor', position: P.hipAnchBL! },
      { id: n('hipAnchBR'), kind: 'anchor', position: P.hipAnchBR! },
      { id: n('cinchBase'), kind: 'anchor', position: P.cinchBase! },
      { id: n('cinchPull'), kind: 'driven', position: P.cinchPull!, channelId: 'chNoseTuck' },
    ],
    elements: [...frameElements, ...suspensionElements, ...tuckElements],
    pointMasses: [{ id: n('noseMass'), name: 'nose block', massKg: 0.5, nodeId: n('nose') }],
    skeletonBindings: [],
    inputs: [
      {
        id: 'chNoseTuck',
        name: 'nose tuck',
        kind: 'displacement',
        min: -0.1,
        max: 0.02,
        value: 0,
        locked: false,
      },
    ],
  };
}

export function buildBodyFrameProject(): Project {
  const parts = buildBodyFrameParts();
  const anchorBindings: AnchorBinding[] = [
    { id: 'abShoulderL', anchor: 'shoulderL', nodeId: 'shoulderAnchL' },
    { id: 'abShoulderR', anchor: 'shoulderR', nodeId: 'shoulderAnchR' },
    { id: 'abHipFL', anchor: 'hipRectFrontL', nodeId: 'hipAnchFL' },
    { id: 'abHipFR', anchor: 'hipRectFrontR', nodeId: 'hipAnchFR' },
    { id: 'abHipBL', anchor: 'hipRectBackL', nodeId: 'hipAnchBL' },
    { id: 'abHipBR', anchor: 'hipRectBackR', nodeId: 'hipAnchBR' },
  ];
  const frameIds = new Set([
    'railFront',
    'railBack',
    'sideFrontL',
    'sideBackL',
    'sideFrontR',
    'sideBackR',
    'prowL',
    'prowR',
    'spineHoop',
    'jointFL',
    'jointFR',
    'jointBL',
    'jointBR',
    'jointMidL',
    'jointMidR',
    'jointNose',
  ]);
  const suspensionIds = new Set([
    'bungeeFL',
    'bungeeBL',
    'bungeeFR',
    'bungeeBR',
    'strapFL',
    'strapFR',
    'strapBL',
    'strapBR',
  ]);
  const byIds = (ids: Set<string>) => parts.elements.filter((e) => ids.has(e.id));
  const tuck = parts.elements.filter((e) => !frameIds.has(e.id) && !suspensionIds.has(e.id));
  return exampleProject(
    'example-body-frame',
    'Example — Raptor body frame',
    {
      ...partsMechanism('body-frame', 'Body frame (suspended)', parts),
      anchorBindings,
    },
    [
      groupOf('grp-frame', 'Frame', byIds(frameIds)),
      groupOf('grp-suspension', 'Suspension', byIds(suspensionIds)),
      groupOf('grp-tuck', 'Tuck control', tuck),
    ],
  );
}
