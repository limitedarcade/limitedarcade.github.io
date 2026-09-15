import { CLIPS as SHARED } from './fighterRig.mjs';
import { langMoves } from '../../game/src/fighters/langMoves.js';

// Broad silhouettes first: hands sag, chin recoils, knees wobble. All deltas
// resolve through Lang's measured IK rig; timing comes from the actual kit.
const sag = {
  chest: { d: [['x', 9]] }, head: { d: [['x', -12], ['z', 7]] },
  handL: { d: [['z', -48]] }, handR: { d: [['z', 48]] },
  da: { L: [0.04, -0.16, 0.01], R: [-0.03, -0.10, 0] },
};
const flinch = {
  hips: { d: [['x', -9]] }, chest: { d: [['x', 17]] },
  head: { d: [['x', -20], ['y', -22]] },
  handL: { d: [['z', -36], ['y', -25]] }, handR: { d: [['z', 36], ['y', 25]] },
  da: { L: [-0.13, 0.19, -0.04], R: [0.12, 0.16, 0.13] },
};
const wobble = {
  ...sag, hips: { d: [['z', 7]], dt: [0.012, -0.012, 0] },
  chest: { d: [['z', -12], ['x', 10]] }, head: { d: [['z', 14], ['x', -9]] },
  da: { L: [0.14, 0.03, -0.03], R: [-0.13, -0.14, 0.04] },
};
const duck = {
  ...flinch, hips: { d: [['x', 16]], dt: [0, -0.055, 0] },
  upLegL: { d: [['x', -35]] }, legL: { d: [['x', 56]] }, footL: { d: [['x', -18]] },
  upLegR: { d: [['x', -32]] }, legR: { d: [['x', 54]] }, footR: { d: [['x', -22]] },
  da: { L: [-0.08, -0.10, 0.10], R: [0.08, -0.12, 0.18] },
};
const swat = side => ({
  ...sag, chest: { d: [['x', -5], ['y', side === 'L' ? -5 : 7]] },
  head: { d: [['x', -15], ['y', 24]] },
  da: { L: [0.01, -0.07, side === 'L' ? 0.20 : -0.02], R: [-0.01, -0.06, side === 'R' ? 0.24 : 0] },
  [`hand${side}`]: { d: [['z', side === 'L' ? -65 : 65]] },
});
const toe = {
  ...flinch, hips: { d: [['x', -8], ['z', -5]] },
  upLegL: { d: [['x', -29]] }, legL: { d: [['x', 10]] }, footL: { d: [['x', 22]] },
  da: { L: [0.19, 0.08, -0.03], R: [-0.13, 0.05, -0.01] },
};
const retreat = {
  ...wobble, head: { d: [['y', 40], ['x', -12]] },
  upLegR: { d: [['x', 25]] }, legR: { d: [['x', 24]] },
  upLegL: { d: [['x', -15]] }, legL: { d: [['x', 18]] },
  da: { L: [0.18, 0.02, -0.08], R: [-0.18, 0.09, -0.10] },
};

const bespoke = Object.values(langMoves).map((move, index) => {
  const start = move.startup / 60, end = (move.startup + move.active + move.recovery) / 60;
  let contact = swat(index % 2 ? 'R' : 'L');
  let windup = { ...flinch, chest: { d: [['y', 17], ['x', -10]] }, da: { L: [0.06, 0.03, -0.12], R: [-0.09, 0.08, -0.14] } };
  if (/Kick|heelDrop|risingKnee/.test(move.id)) contact = toe;
  if (move.id === 'crouchPunch' || move.id === 'crouchKick') {
    windup = duck; contact = { ...duck, da: { L: [-0.04, -0.30, 0.20], R: [0.05, -0.16, 0.03] } };
  }
  if (move.guardWindow) contact = move.guardStance === 'crouch' ? duck : flinch;
  if (move.travel < 0) { windup = flinch; contact = retreat; }
  if (move.id === 'burstStrike') windup = { ...wobble, da: { L: [0.14, 0.21, -0.13], R: [-0.14, 0.22, -0.1] } };
  const release = move.guardWindow ? move.guardWindow[1] / 60 : start + Math.max(3, move.active) / 60;
  return { name: move.clip, loop: false, keys: [
    [0, sag], [start * 0.65, windup], [start, contact], [release, contact],
    [release + (end - release) * 0.48, wobble], [end, sag],
  ] };
});
const replacements = [
  { name: 'idle', loop: true, keys: [[0, sag], [0.45, wobble], [0.75, sag], [1.15, { ...sag, head: { d: [['y', -25], ['z', -9]] } }], [1.6, sag]] },
  { name: 'guard', loop: true, keys: [[0, flinch], [0.16, { ...flinch, head: { d: [['y', -28], ['z', 10]] } }], [0.32, flinch]] },
  { name: 'blockHit', keys: [[0, flinch], [0.1, wobble], [0.28, flinch], [0.5, sag]] },
  { name: 'crouchGuard', loop: true, keys: [[0, duck], [0.35, { ...duck, head: { d: [['y', 25]] } }], [0.7, duck]] },
  { name: 'backHop', keys: [[0, flinch], [0.15, retreat], [0.35, wobble], [0.65, sag]] },
  { name: 'intro', keys: [[0, sag], [0.8, { ...wobble, da: { L: [0.12, 0.24, -0.06], R: [-0.12, 0.24, 0] } }], [1.1, flinch], [1.7, sag]] },
  { name: 'victory', loop: true, keys: [[0, sag], [0.65, { ...wobble, head: { d: [['y', 30], ['z', 12]] } }], [1.4, sag]] },
];
// Even the neutral movement has floppy hands; reactions keep the shared safe
// floor poses. No strong generic attack is reachable through this kit.
const replace = new Map(replacements.map(c => [c.name, c]));
// Legacy clip names are also feeble in the pose board and any fallback path.
for (const clip of bespoke) {
  const alias = clip.name.slice('lang_'.length);
  replace.set(alias, { ...clip, name: alias });
}
replace.set('jab', { ...replace.get('lightPunch'), name: 'jab' });
export const CLIPS = [
  ...SHARED.map(c => replace.get(c.name) || (/^(walkF|walkB|sprint|jump|land)$/.test(c.name)
    ? { ...c, keys: c.keys.map(([t, p]) => [t, { ...p, handL: sag.handL, handR: sag.handR, head: sag.head }]) } : c)),
  ...replacements.filter(c => !SHARED.some(s => s.name === c.name)), ...bespoke,
];
