import { COMBAT_CLIPS } from './combatClips.mjs';
import { MOVES, totalFrames, TICK } from '../../game/src/engine/frameData.js';

// Move-specific contact poses on the canonical IK rig, timed to active frames.
const changes = {
  bodyCheck: { hips: { d: [['x', 14], ['y', -10]], dt: [0, 0, 0.02] }, chest: { d: [['x', 14]] }, da: { L: [-0.06, -0.1, -0.04], R: [0.06, -0.12, 0.05] } },
  heelDrop: { hips: { d: [['x', -8]], dt: [0, 0.014, 0] }, upLegR: { d: [['x', -78]] }, legR: { d: [['x', 8]] }, footR: { d: [['x', 10]] } },
  risingKnee: { hips: { d: [['x', -5]] }, upLegL: { d: [['x', -78]] }, legL: { d: [['x', 105]] }, footL: { d: [['x', -20]] }, da: { L: [0.06, 0.09, -0.08], R: [-0.03, 0.1, 0] } },
  powerStrike: { chest: { d: [['y', 23], ['x', 8]] }, da: { L: [-0.06, -0.02, -0.18], R: [0.24, -0.13, 0.29] } },
  hammerRush: { chest: { d: [['x', 12], ['y', 12]] }, da: { L: [0.06, 0.05, 0.12], R: [0.2, -0.12, 0.26] } },
  meteorKick: { hips: { d: [['y', 18], ['x', -10]] }, upLegR: { d: [['x', -82]] }, legR: { d: [['x', 9]] }, footR: { d: [['x', 8]] } },
  cyclone: { hips: { d: [['x', 10], ['y', -38]], dt: [0, -0.075, 0.006] }, upLegR: { d: [['x', -26], ['z', -46]] } },
  groundBreaker: { chest: { d: [['x', 28]] }, da: { L: [0.1, -0.28, 0.15], R: [0.15, -0.28, 0.22] } },
  burstStrike: { hips: { d: [['y', 15]], dt: [0, 0.014, 0.024] }, chest: { d: [['y', 10]] }, da: { L: [-0.08, -0.06, 0.26], R: [0.21, -0.08, 0.33] } },
  uppercut: { hips: { d: [['y', 22]], dt: [0, 0.012, 0.01] }, chest: { d: [['y', 12], ['x', -10]] }, da: { L: [-0.02, 0, -0.1], R: [0.2, 0.27, 0.22] } },
  lungePunch: { hips: { d: [['y', 26]], dt: [0, 0.006, 0.018] }, chest: { d: [['y', 20], ['x', 10]] }, da: { L: [-0.02, 0, -0.14], R: [0.24, -0.02, 0.32] } },
  retreatKick: { hips: { d: [['x', -14]], dt: [0, 0.005, -0.018] }, upLegL: { d: [['x', -58]] }, legL: { d: [['x', 12]] } },
};
export const SPECIAL_CLIPS = Object.entries(changes).map(([id, contact]) => {
  const move = MOVES[id], keys = COMBAT_CLIPS.find(c => c.name === move.clip).keys;
  const peak = { ...structuredClone(keys[2][1]), ...structuredClone(contact) };
  return { name: id, loop: false, keys: [
    [0, structuredClone(keys[0][1])], [move.startup * TICK * 0.45, structuredClone(keys[1][1])],
    [move.startup * TICK, peak], [(move.startup + move.active) * TICK, structuredClone(peak)],
    [(totalFrames(move) - move.recovery * 0.35) * TICK, structuredClone(keys.at(-2)[1])],
    [totalFrames(move) * TICK, {}],
  ] };
});
