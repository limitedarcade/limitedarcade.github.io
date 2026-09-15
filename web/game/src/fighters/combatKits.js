import { MATCH, MOVES, PHYSICS } from '../engine/frameData.js';
import { moves as breakerMoves } from './trump/moves.js';
import { moves as striderMoves } from './carney/moves.js';
import { officerMoves } from './officerMoves.js';
import { langMoves } from './langMoves.js';

export const COMBAT_KITS = Object.freeze({
  flincher: Object.freeze({ id: 'flincher', archetype: 'Flincher', maxHealth: MATCH.maxHealth,
    description: 'All windup, barely any follow-through. Limp swats, tiny kicks and panicked retreats. HP + HK briefly covers his face after a slow start; the recovery is wide open.',
    signature: Object.freeze(['powerStrike', 'retreatKick', 'burstStrike']),
    physics: Object.freeze({ ...PHYSICS, walkForward: 1.85, walkBack: 2.05, jumpForwardSpeed: 1.9,
      sprintMultiplier: 1.65, backHopSpeed: 3.1, backHopVelocity: 2.2 }), moves: langMoves }),
  officer: Object.freeze({ id: 'officer', archetype: 'Enforcer', maxHealth: MATCH.maxHealth,
    description: 'Hold the gap and punish the approach. Forward + HP: shuriken. HP + HK: knife, sharing one cooldown. Forward + LK calls the drone.',
    signature: Object.freeze(['lungePunch', 'powerStrike', 'droneSweep']),
    // Forward + LK is free on the universal table and, for a fighter built to
    // give ground, deliberately awkward: you have to step toward the thing you
    // spend the whole round backing away from to call the drone in.
    commands: Object.freeze([
      Object.freeze({ move: 'droneSweep', direction: 'forward', button: 'lk', input: 'Forward + LK',
        note: 'Overwatch. Summons a drone that rakes the whole arena. Blocked standing; eight-second cooldown.' }),
    ]),
    // Slower forward than either other kit and faster back than both: this is a
    // fighter that gives ground on purpose and does not chase.
    physics: Object.freeze({ ...PHYSICS, walkForward: 1.95, walkBack: 2.45, jumpForwardSpeed: 2.2 }),
    moves: officerMoves }),
  standard: Object.freeze({ id: 'standard', archetype: 'All-rounder', maxHealth: MATCH.maxHealth,
    description: 'Universal training loadout.', physics: PHYSICS, moves: MOVES }),
  breaker: Object.freeze({ id: 'breaker', archetype: 'Breaker', maxHealth: MATCH.maxHealth,
    description: 'Close-range clinches and heavy commitments. Make every opening count.',
    signature: Object.freeze(['hammerRush', 'groundBreaker', 'powerStrike']),
    physics: Object.freeze({ ...PHYSICS, walkForward: 2.1, walkBack: 1.55, jumpForwardSpeed: 2.3 }), moves: breakerMoves }),
  strider: Object.freeze({ id: 'strider', archetype: 'Strider', maxHealth: MATCH.maxHealth,
    description: 'Tap LP three times for a short combo on hit. LP, LK, LK ends in an axe kick. LP, LP, HK spends a stock on Polar Reversal. Release between taps; blocks and misses stop the chain.',
    easyChains: Object.freeze({
      lightPunch: Object.freeze({ lp: 'bodyCheck' }),
      bodyCheck: Object.freeze({ lp: 'heavyKick', lk: 'risingKnee', hk: 'spinKick' }),
      lightKick: Object.freeze({ lk: 'heelDrop' }),
    }),
    commands: Object.freeze([
      Object.freeze({ move: 'spinKick', direction: 'forward', button: 'hk', input: 'Forward + HK', note: 'Polar Reversal. Spinning heel strike; costs one stock.' }),
    ]),
    signature: Object.freeze(['meteorKick', 'cyclone', 'retreatKick']),
    physics: Object.freeze({ ...PHYSICS, walkForward: 2.7, walkBack: 2.2, jumpForwardSpeed: 2.85 }), moves: striderMoves }),
});

export const DEFAULT_KIT = Object.freeze({ trump: 'breaker', carney: 'strider', officer_flock: 'officer', lang: 'flincher' });
export function combatKitFor(id, kitId) {
  return COMBAT_KITS[kitId || DEFAULT_KIT[id]] || COMBAT_KITS.standard;
}
