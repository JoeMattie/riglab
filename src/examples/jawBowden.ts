// Bundled example: "jaw + Bowden" (planfile §9 item 4). Head-local elevation.
// The jaw is a welded main-bar + heel-spur body pinned at an anchored pivot
// with angle limits (0 = closed, −0.7 rad = fully open). An OPENING elastic
// pulls the heel spur toward the skull crest; the Bowden cable from the
// driven trigger node pulls the heel toward a casing end below it, CLOSING
// the jaw — squeeze harder, bite harder. The trigger channel's lock toggle
// is the set-screw analogue from the original build (§4.2).
import type { Mechanism, MechanismElement, Vec2 } from '../schema';
import {
  BOWDEN_CABLE,
  BUNGEE_6,
  dist,
  PIPE_075,
  PIPE_CLS200_075,
  PIPE_CTS_050,
  PIPE_CTS_075,
} from './shared';

/** jaw pivot height above the ground plane — mechanism space is the wearer's
 * world frame (planfile §7), so the head geometry sits at head height and the
 * open jaw swings clear of the floor (slice C). */
export const JAW_PIVOT_Y = 1.5;

const P: Record<string, Vec2> = {
  skullBack: { x: -0.12, y: JAW_PIVOT_Y },
  jawPivot: { x: 0, y: JAW_PIVOT_Y },
  crest: { x: 0.02, y: JAW_PIVOT_Y + 0.16 },
  casingJaw: { x: -0.1, y: JAW_PIVOT_Y - 0.09 },
  jawTip: { x: 0.24, y: JAW_PIVOT_Y },
  jawHeel: { x: -0.065, y: JAW_PIVOT_Y + 0.03 },
  triggerBase: { x: -0.32, y: JAW_PIVOT_Y - 0.36 },
  trigger: { x: -0.32, y: JAW_PIVOT_Y - 0.22 },
  casingTrigger: { x: -0.32, y: JAW_PIVOT_Y - 0.3 },
};

/** lenB at the fully-open angle limit (heel rotated −0.7 rad about the
 * pivot): the cable's rest lengths are sized so the jaw is free to open all
 * the way when the trigger is released. */
function openHeelDistance(): number {
  const a = -0.7;
  const piv = P.jawPivot!;
  const rel = { x: P.jawHeel!.x - piv.x, y: P.jawHeel!.y - piv.y };
  const heel = {
    x: piv.x + Math.cos(a) * rel.x - Math.sin(a) * rel.y,
    y: piv.y + Math.sin(a) * rel.x + Math.cos(a) * rel.y,
  };
  return dist(heel, P.casingJaw!);
}

export function buildJawBowdenMechanism(): Mechanism {
  const elements: MechanismElement[] = [
    {
      id: 'skullBar',
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'head',
      nodeA: 'skullBack',
      nodeB: 'jawPivot',
      pipeMaterialId: PIPE_075,
      endRealizationA: 'fitting',
      endRealizationB: 'boltThrough',
      pointMasses: [],
    },
    {
      id: 'jawMain',
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      nodeA: 'jawPivot',
      nodeB: 'jawTip',
      pipeMaterialId: PIPE_CTS_050,
      endRealizationA: 'boltThrough',
      endRealizationB: 'heatWrapRigid',
      pointMasses: [],
    },
    {
      id: 'jawHeelSpur',
      type: 'link',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      nodeA: 'jawPivot',
      nodeB: 'jawHeel',
      pipeMaterialId: PIPE_CTS_050,
      endRealizationA: 'boltThrough',
      endRealizationB: 'boltThrough',
      pointMasses: [],
    },
    // the trigger slides on the grip pipe: a sliding telescope, so the driven
    // node can travel along the rail instead of fighting a rigid link
    {
      id: 'zTriggerBar',
      type: 'telescope',
      maturity: 'engineered',
      subsystemTag: 'trigger',
      nodeA: 'triggerBase',
      nodeB: 'trigger',
      minLengthM: 0.1,
      maxLengthM: 0.22,
      lengthM: 0.14,
      sliding: true,
      outerPipeMaterialId: PIPE_CLS200_075,
      innerPipeMaterialId: PIPE_CTS_075,
      pointMasses: [],
    },
    {
      id: 'jawPivotPin',
      type: 'pivot',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      nodeId: 'jawPivot',
      memberIds: ['skullBar', 'jawMain', 'jawHeelSpur'],
      welds: [['jawMain', 'jawHeelSpur']],
      angleLimit: { memberA: 'skullBar', memberB: 'jawMain', minRad: -0.7, maxRad: 0 },
      realization: 'boltThrough',
    },
    // opening elastic: heel spur pulled toward the crest ⇒ tip drops open
    {
      id: 'openElastic',
      type: 'elastic',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      nodeA: 'crest',
      nodeB: 'jawHeel',
      restLengthM: 0.1,
      stiffnessNPerM: 150,
      tensionOnly: true,
      cordageMaterialId: BUNGEE_6,
    },
    // brake-cable jaw drive: both casing ends fixed, routing-independent
    {
      id: 'biteCable',
      type: 'bowden',
      maturity: 'engineered',
      subsystemTag: 'jaw',
      a1: 'casingTrigger',
      a2: 'trigger',
      b1: 'casingJaw',
      b2: 'jawHeel',
      restLengthAM: dist(P.casingTrigger!, P.trigger!),
      restLengthBM: openHeelDistance(),
      cordageMaterialId: BOWDEN_CABLE,
    },
  ];

  return {
    id: 'jaw-bowden',
    name: 'Jaw + Bowden',
    viewOrientation: 'side-left',
    gravityOn: true,
    nodes: [
      { id: 'skullBack', kind: 'anchor', position: P.skullBack! },
      { id: 'jawPivot', kind: 'anchor', position: P.jawPivot! },
      { id: 'crest', kind: 'anchor', position: P.crest! },
      { id: 'casingJaw', kind: 'anchor', position: P.casingJaw! },
      { id: 'triggerBase', kind: 'anchor', position: P.triggerBase! },
      { id: 'casingTrigger', kind: 'anchor', position: P.casingTrigger! },
      { id: 'jawTip', kind: 'free', position: P.jawTip! },
      { id: 'jawHeel', kind: 'free', position: P.jawHeel! },
      { id: 'trigger', kind: 'driven', position: P.trigger!, channelId: 'chJawTrigger' },
    ],
    elements,
    pointMasses: [],
    skeletonBindings: [],
    anchorBindings: [],
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
    namedStates: [],
  };
}
