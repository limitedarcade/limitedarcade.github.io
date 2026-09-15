import { MOVES } from '../engine/frameData.js';
import { extendMoves } from './extendMoves.js';

// Every button participates in the gag, including inherited commands/supers.
const names = {
  lightPunch: 'Wet Noodle', heavyPunch: 'All Windup', lightKick: 'Toe Apology',
  heavyKick: 'Pulled Something', crouchPunch: 'Please Stop', crouchKick: 'Ankle Nuisance',
  jumpAttack: 'Air Flail', grab: 'Personal Space', throw: 'You Go First',
  bodyCheck: 'Accidental Bump', heelDrop: 'Heel Hesitation', risingKnee: 'Knee Maybe',
  powerStrike: 'Panic Block', hammerRush: 'Strategic Withdrawal', meteorKick: 'Participation Kick',
  cyclone: 'Emergency Duck', groundBreaker: 'Cover And Cower', burstStrike: 'Maximum Minimum Effort',
  uppercut: 'Half A Hand Up', lungePunch: 'Second Thoughts', retreatKick: 'Backpedal Blunder',
  finisher: 'Last Little Slap',
};
const overrides = Object.fromEntries(Object.entries(MOVES).map(([id, base]) => [id, {
  name: names[id], clip: `lang_${id}`,
  description: 'A nervous windup, a limp little hit, and far too long spent finding his balance again.',
  brutality: false,
  startup: Math.max(9, base.startup + 5), active: 3, recovery: Math.max(22, base.recovery + 5),
  travel: 0, cancelInto: [], cancelWindow: [0, 0],
  grabHold: 0, grabTickDamage: 0,
  hit: { damage: id === 'burstStrike' ? 28 : id === 'finisher' ? 16 : Math.max(4, Math.min(22, Math.round(base.hit.damage * 0.18))),
    level: ['low', 'overhead'].includes(base.hit.level) ? base.hit.level : 'mid',
    box: [0.18, id.includes('Kick') ? 0.76 : 0.69, base.hit.box[2], Math.min(1.85, base.hit.box[3])],
    hitStun: 9, blockStun: 5, chip: 0, hitStop: 2, meter: 10, bloodScale: 0.12,
    knockdown: false, launch: 0, juggle: false, groundHit: false, push: [0.02, 0.06] },
}]));
// These are actual defensive attempts: a brief late guard or a short retreat.
// Zero active frames means no invisible strike while his hands cover his face.
for (const id of ['powerStrike', 'groundBreaker', 'cyclone']) {
  Object.assign(overrides[id], { startup: 14, active: 0, recovery: 30,
    description: 'Flinch first, cover up late. A brief guard after the windup; startup and recovery are wide open. Deals no damage.',
    guardWindow: Object.freeze([14, 23]), guardStance: id === 'cyclone' ? 'crouch' : 'stand',
    hit: { ...overrides[id].hit, damage: 0 } });
}
for (const id of ['hammerRush', 'retreatKick', 'lungePunch']) {
  Object.assign(overrides[id], { travel: -1.15, startup: 16, active: 0, recovery: 29,
    description: 'Stumble a short distance backward, then wobble in place. No hit, no invulnerability; a long attack can still catch him.',
    hit: { ...overrides[id].hit, damage: 0 } });
}
export const langMoves = extendMoves(overrides);
