// Bundled example: "jaw + Bowden" (planfile §9 item 4). Head-local elevation
// geometry, native in the world x-y plane at z = 0. The jaw is a welded
// main-bar + heel-spur body pinned at an anchored pivot — a hinge about the
// sagittal normal — with angle limits (0 = closed, −0.7 rad = fully open).
// An OPENING elastic pulls the heel spur toward the skull crest; the Bowden
// cable from the driven trigger node pulls the heel toward a casing end
// below it, CLOSING the jaw — squeeze harder, bite harder. The trigger
// channel's lock toggle is the set-screw analogue from the original build
// (§4.2).
import type { MechanismElement, Vec3 } from '../schema';
import {
  BOWDEN_CABLE,
  BUNGEE_6,
  dist,
  HINGE_SAGITTAL,
  type MechParts,
  PIPE_075,
  PIPE_CLS200_075,
  PIPE_CTS_050,
  PIPE_CTS_075,
  v3,
} from './shared';

/** jaw pivot height above the ground plane — the document is the wearer's
 * world frame, so the head geometry sits at head height and the open jaw
 * swings clear of the floor (free nodes stay at y ≥ 0). */
export const JAW_PIVOT_Y = 1.5;

const P: Record<string, Vec3> = {
  skullBack: v3(-0.12, JAW_PIVOT_Y, 0),
  jawPivot: v3(0, JAW_PIVOT_Y, 0),
  crest: v3(0.02, JAW_PIVOT_Y + 0.16, 0),
  casingJaw: v3(-0.1, JAW_PIVOT_Y - 0.09, 0),
  jawTip: v3(0.24, JAW_PIVOT_Y, 0),
  jawHeel: v3(-0.065, JAW_PIVOT_Y + 0.03, 0),
  triggerBase: v3(-0.32, JAW_PIVOT_Y - 0.36, 0),
  trigger: v3(-0.32, JAW_PIVOT_Y - 0.22, 0),
  casingTrigger: v3(-0.32, JAW_PIVOT_Y - 0.3, 0),
};

/** lenB at the fully-open angle limit (heel rotated −0.7 rad about the pivot
 * in the jaw's sagittal plane): the cable's rest lengths are sized so the
 * jaw is free to open all the way when the trigger is released. */
export function openHeelDistance(): number {
  const a = -0.7;
  const piv = P.jawPivot!;
  const rel = { x: P.jawHeel!.x - piv.x, y: P.jawHeel!.y - piv.y };
  const heel = v3(
    piv.x + Math.cos(a) * rel.x - Math.sin(a) * rel.y,
    piv.y + Math.sin(a) * rel.x + Math.cos(a) * rel.y,
    0,
  );
  return dist(heel, P.casingJaw!);
}

export function buildJawBowdenParts(prefix = ''): MechParts {
  const n = (id: string) => prefix + id;
  const elements: MechanismElement[] = [
    {
      id: n('skullBar'),
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'head',
      nodeA: n('skullBack'),
      nodeB: n('jawPivot'),
      pipeMaterialId: PIPE_075,
      endRealizationA: 'fitting',
      endRealizationB: 'boltThrough',
      pointMasses: [],
    },
    {
      id: n('jawMain'),
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      nodeA: n('jawPivot'),
      nodeB: n('jawTip'),
      pipeMaterialId: PIPE_CTS_050,
      endRealizationA: 'boltThrough',
      endRealizationB: 'heatWrapRigid',
      pointMasses: [],
    },
    {
      id: n('jawHeelSpur'),
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      nodeA: n('jawPivot'),
      nodeB: n('jawHeel'),
      pipeMaterialId: PIPE_CTS_050,
      endRealizationA: 'boltThrough',
      endRealizationB: 'boltThrough',
      pointMasses: [],
    },
    // the trigger slides on the grip pipe: a sliding telescope, so the driven
    // node can travel along the rail instead of fighting a rigid link
    {
      id: n('zTriggerBar'),
      type: 'telescope',
      maturity: 'engineered',
      subsystemTag: 'trigger',
      nodeA: n('triggerBase'),
      nodeB: n('trigger'),
      minLengthM: 0.1,
      maxLengthM: 0.22,
      lengthM: 0.14,
      sliding: true,
      outerPipeMaterialId: PIPE_CLS200_075,
      innerPipeMaterialId: PIPE_CTS_075,
      pointMasses: [],
    },
    {
      id: n('jawPivotPin'),
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      nodeId: n('jawPivot'),
      joint: { kind: 'hinge', axis: HINGE_SAGITTAL },
      memberIds: [n('skullBar'), n('jawMain'), n('jawHeelSpur')],
      welds: [[n('jawMain'), n('jawHeelSpur')]],
      angleLimit: { memberA: n('skullBar'), memberB: n('jawMain'), minRad: -0.7, maxRad: 0 },
      realization: 'boltThrough',
    },
    // opening elastic: heel spur pulled toward the crest ⇒ tip drops open
    {
      id: n('openElastic'),
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      nodeA: n('crest'),
      nodeB: n('jawHeel'),
      slackLengthM: 0.1,
      stiffnessNPerM: 150,
      cordageMaterialId: BUNGEE_6,
    },
    // brake-cable jaw drive: both casing ends fixed, routing-independent
    {
      id: n('biteCable'),
      type: 'bowden',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      a1: n('casingTrigger'),
      a2: n('trigger'),
      b1: n('casingJaw'),
      b2: n('jawHeel'),
      restLengthAM: dist(P.casingTrigger!, P.trigger!),
      restLengthBM: openHeelDistance(),
      cordageMaterialId: BOWDEN_CABLE,
    },
  ];

  return {
    nodes: [
      { id: n('skullBack'), kind: 'anchor', position: P.skullBack! },
      { id: n('jawPivot'), kind: 'anchor', position: P.jawPivot! },
      { id: n('crest'), kind: 'anchor', position: P.crest! },
      { id: n('casingJaw'), kind: 'anchor', position: P.casingJaw! },
      { id: n('triggerBase'), kind: 'anchor', position: P.triggerBase! },
      { id: n('casingTrigger'), kind: 'anchor', position: P.casingTrigger! },
      { id: n('jawTip'), kind: 'free', position: P.jawTip! },
      { id: n('jawHeel'), kind: 'free', position: P.jawHeel! },
      { id: n('trigger'), kind: 'driven', position: P.trigger!, channelId: 'chJawTrigger' },
    ],
    elements,
    pointMasses: [],
    skeletonBindings: [],
    inputs: [
      {
        id: 'chJawTrigger',
        name: 'jaw trigger',
        // max stops just short of the geometric closed point (0.0447) so the
        // cable never fights the closed angle limit
        kind: 'displacement',
        min: 0,
        max: 0.038,
        value: 0,
        locked: false,
      },
    ],
  };
}
