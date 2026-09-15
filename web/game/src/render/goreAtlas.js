// What a body comes apart into, as data.
//
// Nothing here knows about Three.js or about any particular model. A region is
// named by the *bones* its geometry hangs from, matched by pattern, because the
// roster does not agree on a skeleton: the authored fighters use the project rig
// from fighterRig.mjs (`upperArmL`, `forearmL`, `upLegR`) and imported models
// arrive on whatever their source used -- Gib is a Source biped, so its bones
// are `ValveBiped.Bip01_L_ForeArm`. Matching on a pattern means a new model is
// dismemberable on arrival instead of after someone hand-writes a bone map.
//
// `chain` is what leaves the body. `stump` is the bone the wound is left on, so
// the bleed, the meat plug, and the hanging strands have somewhere to sit
// that survives animation.

// Both naming conventions for one joint, in one place.
const BONE = Object.freeze({
  head: /(^|[._]|mixamorig)(head1?|bip01_head)([._]|$)/i,
  neck: /(^|[._]|mixamorig)(neck1?|bip01_neck)([._]|$)/i,
  chest: /(^|[._]|mixamorig)(chest|spine[24]|bip01_spine[24])([._]|$)/i,
  spine: /(^|[._]|mixamorig)(spine1?|bip01_spine1?)([._]|$)/i,
  hips: /(^|[._]|mixamorig)(hips|pelvis|bip01_pelvis)([._]|$)/i,
  upperArmL: /(^|[._]|mixamorig)(upperarml|l_upperarm|leftarm)([._]|$)/i,
  upperArmR: /(^|[._]|mixamorig)(upperarmr|r_upperarm|rightarm)([._]|$)/i,
  forearmL: /(^|[._]|mixamorig)(forearml|l_forearm|leftforearm)([._]|$)/i,
  forearmR: /(^|[._]|mixamorig)(forearmr|r_forearm|rightforearm)([._]|$)/i,
  handL: /(^|[._]|mixamorig)(handl|l_hand|lefthand|l_finger)/i,
  handR: /(^|[._]|mixamorig)(handr|r_hand|righthand|r_finger)/i,
  upLegL: /(^|[._]|mixamorig)(uplegl|l_thigh|leftupleg)([._]|$)/i,
  upLegR: /(^|[._]|mixamorig)(uplegr|r_thigh|rightupleg)([._]|$)/i,
  legL: /(^|[._]|mixamorig)(legl|l_calf|leftleg)([._]|$)/i,
  legR: /(^|[._]|mixamorig)(legr|r_calf|rightleg)([._]|$)/i,
  footL: /(^|[._]|mixamorig)(footl|l_foot|leftfoot|l_toe)/i,
  footR: /(^|[._]|mixamorig)(footr|r_foot|rightfoot|r_toe)/i,
});

// Organs are props, not regions: they are spilled BY a severance rather than
// being one. `count` is how many spawn, `chain` marks the ropey ones that are
// simulated as a hanging strand rather than a tumbling lump.
// `span` is the prop's longest axis IN METRES, against a fighter a little
// under two of them tall. It is the single source of truth for organ scale:
// the build tool normalises each imported mesh to it, and the procedural
// fallback generates to it, so a real heart and a generated one are the same
// size. Authoring these by eye instead produced organs the size of a torso.
//
// `wet` drives colour and how much a piece bleeds while it is in the air.
// `strand` marks the ropey ones, stretched along one axis. `pulse` keeps a
// heart beating for a few seconds after it lands.
export const ORGANS = Object.freeze({
  // ---- from organs.glb: real organs, authored as props ---------------------
  brain: Object.freeze({ id: 'brain', span: 0.170, mass: 0.6, wet: 0.85 }),
  eyeball: Object.freeze({ id: 'eyeball', span: 0.030, mass: 0.2, wet: 0.6 }),
  heart: Object.freeze({ id: 'heart', span: 0.135, mass: 0.5, wet: 1.0, pulse: true }),
  intestine: Object.freeze({ id: 'intestine', span: 0.780, mass: 0.9, wet: 1.0, strand: true }),
  guts: Object.freeze({ id: 'guts', span: 0.560, mass: 1.1, wet: 1.0, strand: true }),
  ribcage: Object.freeze({ id: 'ribcage', span: 0.300, mass: 1.4, wet: 0.5 }),
  spineChunk: Object.freeze({ id: 'spineChunk', span: 0.340, mass: 0.8, wet: 0.7 }),
  neckTie: Object.freeze({ id: 'neckTie', span: 0.160, mass: 0.4, wet: 1.0 }),
  stomachPlug: Object.freeze({ id: 'stomachPlug', span: 0.200, mass: 0.7, wet: 1.0 }),

  // ---- salvaged from gib2.glb: the pieces that come OFF --------------------
  // Every `_Inverse` mesh in that file is the removed chunk rather than the
  // wound left behind, which makes them the one genuinely reusable thing in a
  // library that has no body in it.
  skullCap: Object.freeze({ id: 'skullCap', span: 0.150, mass: 0.5, wet: 0.55 }),
  jawPiece: Object.freeze({ id: 'jawPiece', span: 0.130, mass: 0.35, wet: 0.8 }),
  eyeMeat: Object.freeze({ id: 'eyeMeat', span: 0.070, mass: 0.2, wet: 1.0 }),
  armChunk: Object.freeze({ id: 'armChunk', span: 0.230, mass: 0.9, wet: 0.9 }),
  legChunk: Object.freeze({ id: 'legChunk', span: 0.280, mass: 1.3, wet: 0.9 }),
  ribsTorn: Object.freeze({ id: 'ribsTorn', span: 0.320, mass: 1.2, wet: 0.6 }),
});

// Where each prop's geometry comes from. Read by tools/build-gore-props.mjs
// only -- the runtime loads the baked result and never sees these files.
//
// The node names in both sources are `Object_N`, so the MATERIAL name is the
// only surviving record of which part a mesh is. `pick` chooses among meshes
// that share one material, largest first.
export const PROP_SOURCES = Object.freeze([
  { id: 'brain', file: 'organs.glb', material: 'Male_SC_Brain_Diff', span: 0.170 },
  { id: 'eyeball', file: 'organs.glb', material: 'Male_Xray_GN_Eyeball_Diff', span: 0.030, pick: 1 },
  { id: 'heart', file: 'organs.glb', material: 'Male_SC_Heart_Diff', span: 0.135 },
  { id: 'intestine', file: 'organs.glb', material: 'Male_GN_Intestines_Diff', span: 0.780 },
  { id: 'guts', file: 'organs.glb', material: 'Male_ER_FatalityGuts_Diff', span: 0.560 },
  { id: 'ribcage', file: 'organs.glb', material: 'Male_KJ_Ribs_Diff', span: 0.300 },
  { id: 'spineChunk', file: 'organs.glb', material: 'Male_KE_Spine_Diff', span: 0.340 },
  { id: 'neckTie', file: 'organs.glb', material: 'Female_CINE_ColumbianNeckTie_Diff', span: 0.160 },
  { id: 'stomachPlug', file: 'organs.glb', material: 'Male_GO_Stomach_Hole_Inverse_Diff', span: 0.200 },
  { id: 'ribsTorn', file: 'organs.glb', material: 'Male_JX_Ribs_Diff', span: 0.320 },
  { id: 'skullCap', file: 'gib2.glb', material: 'Male_KT_Head_Cut_Eyeline_Inverse_Diff', span: 0.150 },
  { id: 'jawPiece', file: 'gib2.glb', material: 'Male_KT_Head_Cut_Jawline_Inverse_Diff', span: 0.130 },
  { id: 'eyeMeat', file: 'gib2.glb', material: 'Male_RA_EyeMeat_Diff', span: 0.070 },
  { id: 'armChunk', file: 'gib2.glb', material: 'Male_GO_Arm_Ripoff_Diff', span: 0.230 },
  { id: 'legChunk', file: 'gib2.glb', material: 'Male_GO_Leg_Ripoff_Inverse_Diff', span: 0.280 },
]);

// A region severs only once its own threshold is crossed AND a hit lands on it,
// so the body comes apart in the order it was actually beaten -- an opponent
// who only ever headhunts takes the head off, not a leg.
//
// `threshold` is remaining health fraction. `lethal` regions end the fighter if
// taken, which is why the head and the torso sit below the KO line: they can
// only ever be the last thing that happens.
export const REGIONS = Object.freeze([
  Object.freeze({
    id: 'leftArm', label: 'Left Arm', threshold: 0.55, lethal: false,
    chain: [BONE.forearmL, BONE.handL], stump: BONE.upperArmL,
    aim: 'arm', mass: 1.0, spurt: 1.5, organs: ['armChunk'],
  }),
  Object.freeze({
    id: 'rightArm', label: 'Right Arm', threshold: 0.55, lethal: false,
    chain: [BONE.forearmR, BONE.handR], stump: BONE.upperArmR,
    aim: 'arm', mass: 1.0, spurt: 1.5, organs: ['armChunk'],
  }),
  Object.freeze({
    id: 'leftLeg', label: 'Left Leg', threshold: 0.32, lethal: false,
    chain: [BONE.legL, BONE.footL], stump: BONE.upLegL,
    aim: 'low', mass: 1.6, spurt: 1.9, organs: ['legChunk'],
  }),
  Object.freeze({
    id: 'rightLeg', label: 'Right Leg', threshold: 0.32, lethal: false,
    chain: [BONE.legR, BONE.footR], stump: BONE.upLegR,
    aim: 'low', mass: 1.6, spurt: 1.9, organs: ['legChunk'],
  }),
  // The jaw goes before the skull does. A non-lethal head wound that still
  // reads from the back row is what makes the last exchange of a round land.
  Object.freeze({
    id: 'jaw', label: 'Jaw', threshold: 0.42, lethal: false,
    chain: [/(^|[._])(jaw|tongue)/i], stump: BONE.head,
    aim: 'high', mass: 0.3, spurt: 2.2, organs: ['jawPiece', 'eyeball', 'eyeMeat'],
  }),
  Object.freeze({
    id: 'head', label: 'Head', threshold: 0.0, lethal: true,
    chain: [BONE.head, BONE.neck], stump: BONE.chest,
    aim: 'high', mass: 1.2, spurt: 3.4, organs: ['brain', 'skullCap', 'eyeball', 'eyeball', 'neckTie'],
  }),
  Object.freeze({
    id: 'torso', label: 'Torso', threshold: 0.0, lethal: true,
    chain: [BONE.hips, BONE.upLegL, BONE.upLegR, BONE.legL, BONE.legR, BONE.footL, BONE.footR],
    stump: BONE.spine, aim: 'mid', mass: 2.4, spurt: 4.0,
    organs: ['intestine', 'guts', 'heart', 'ribcage', 'ribsTorn', 'spineChunk', 'stomachPlug'],
  }),
]);

export const REGION_BY_ID = Object.freeze(Object.fromEntries(REGIONS.map(r => [r.id, r])));

// Where on the body a hit landed, from the height the solver already reports.
// Heights are fractions of the fighter's standing height, so a crouching hit at
// 0.9 m is a head shot on a crouching fighter and a body shot on a standing one
// only because the solver already accounted for the stance.
export function regionsForHeight(fraction) {
  if (fraction > 0.82) return ['head', 'jaw'];
  if (fraction > 0.52) return ['torso', 'leftArm', 'rightArm'];
  return ['leftLeg', 'rightLeg', 'torso'];
}

export { BONE };
