import { extendMoves } from './extendMoves.js';

// ENFORCER is an invented arcade loadout, not an assessment of its avatar.
//
// The design problem this kit answers: Flock owns the only two projectiles in
// the game, and they share a 100-frame cooldown. That cooldown is the whole
// character. Everything here is built to answer one question -- what is Flock
// doing for the hundred frames after a throw -- and the answer is: buying the
// distance back.
//
// So the normals are long, slow and shove hard, and almost every confirm ends
// with the opponent further away than they started. Flock does not want to be
// in the clinch and is deliberately bad there: the close-range specials are the
// weakest in the game per stock. Against a fighter who has closed the gap, the
// kit is losing; the skill is not letting that happen twice.
//
// The pair against the roster:
//   BREAKER wants one clinch and ends the round with it. Flock beats it by
//   never granting the first one, and loses the moment it does.
//   STRIDER closes faster than the cooldown recovers. Flock beats it by
//   spending shield and sweep on the approach rather than on the exchange.
// Overwatch's own contact values. The summon itself never touches anyone --
// `overwatch` tells the solver to skip its hitbox entirely -- so the numbers
// that matter live on the beam, and the match applies them when the sweep
// actually crosses somebody. Overhead, because the thing is firing from above:
// this is the one move in the kit that punishes a fighter who has decided to
// sit in crouch guard waiting out the ranged cooldown.
export const OVERWATCH_BEAM = Object.freeze({
  id: 'droneSweep', name: 'Overwatch', clip: 'heavyPunch', weapon: 'laser',
  startup: 0, active: 1, recovery: 0,
  cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
  hit: Object.freeze({
    level: 'overhead', damage: 124, chip: 22, hitStun: 30, blockStun: 20,
    box: Object.freeze([0, 0, 0, 0]), push: Object.freeze([0, 0.95]),
    knockdown: true, hitStop: 11, meter: 22, bloodScale: 1.7,
    launch: 0, juggle: true, groundHit: false,
  }),
});

const officerBase = extendMoves({
  // ---- the ranged pair ----------------------------------------------------
  // Shared cooldown covers both throws; changing weapons cannot bypass it.
  lungePunch: { name: 'Shuriken', clip: 'heavyPunch', startup: 22, active: 1, recovery: 32, travel: 0,
    description: 'Duck under or stand-block. Shares a 100-frame cooldown with the knife; no chip damage.',
    cooldown: 100, cooldownGroup: 'ranged', projectile: { kind: 'shuriken', speed: 7, life: 65, y: 1.4, radius: 0.12 },
    cancelInto: [], hit: { damage: 55, chip: 0, hitStun: 14, blockStun: 8, meter: 6, knockdown: false, bloodScale: 1.1, push: [0, 0.16] } },
  powerStrike: { name: 'Throwing Knife', clip: 'heavyPunch', startup: 28, active: 1, recovery: 36, travel: 0,
    description: 'A committed ranged throw. Duck under or stand-block; shares the shuriken cooldown. No chip damage.',
    cooldown: 100, cooldownGroup: 'ranged', projectile: { kind: 'knife', speed: 8.5, life: 54, y: 1.35, radius: 0.1 },
    cancelInto: [], hit: { damage: 70, chip: 0, hitStun: 17, blockStun: 9, meter: 7, knockdown: false, bloodScale: 1.4, push: [0, 0.2] } },

  // ---- normals: reach and shove, not damage -------------------------------
  // The baton buys range the fist does not. Light punch outreaches every other
  // light in the game and does the least with it, which is the trade that lets
  // Flock hold a space without winning an exchange inside it.
  lightPunch: { name: 'Move Along', startup: 4, recovery: 9,
    cancelInto: ['heavyPunch', 'lightKick', 'heavyKick', 'grab'],
    hit: { damage: 33, hitStun: 15, box: [0.26, 1.18, 1.22, 1.60], push: [0.08, 0.26] } },
  heavyPunch: { name: 'Nightstick', startup: 12, recovery: 22,
    hit: { damage: 104, chip: 9, box: [0.28, 1.52, 1.06, 1.78], push: [0.14, 0.48], bloodScale: 1.5 } },
  lightKick: { name: 'Shin Tap', startup: 5, recovery: 10,
    cancelInto: ['heavyKick', 'heavyPunch', 'throw'],
    hit: { damage: 38, hitStun: 16, box: [0.26, 1.16, 0.62, 1.06] } },
  // The spacing tool. It is the worst heavy in the game on damage and the best
  // on push: a confirmed hit puts the opponent back at throwing distance, which
  // is the only place this kit is winning.
  heavyKick: { name: 'Dispersal Order', startup: 14, recovery: 24,
    hit: { damage: 96, box: [0.28, 1.58, 0.80, 1.48], push: [0.10, 0.78], bloodScale: 1.4 } },
  crouchPunch: { name: 'Knee Check', startup: 5, recovery: 10,
    hit: { damage: 36, box: [0.24, 1.10, 0.55, 0.95] } },
  crouchKick: { name: 'Ankle Sweep', startup: 8, recovery: 17,
    hit: { damage: 62, box: [0.22, 1.46, 0.06, 0.58], push: [0.08, 0.44] } },
  jumpAttack: { name: 'Flying Tackle' },

  // ---- the approach answers -----------------------------------------------
  // Anti-air. Flock's is slower to start than the standard one and reaches
  // further, because it is meant to be thrown at a jump the player saw coming
  // rather than reacted to -- a zoner should be reading approaches, not
  // reflexing them.
  uppercut: { name: 'Warning Shot', startup: 10, recovery: 25,
    hit: { damage: 104, box: [0.15, 1.28, 0.75, 2.62], knockdown: true } },
  // The shield. Almost no damage, enormous shove, and safe enough on block to
  // throw at a fighter who is walking in. This is what gets spent while the
  // ranged cooldown ticks.
  bodyCheck: { name: 'Riot Shield', clip: 'grab', startup: 8, recovery: 16, travel: 1.9,
    description: 'A shoving shield bash. Little damage, but it resets the gap.',
    hit: { damage: 44, hitStun: 18, blockStun: 16, box: [0.18, 1.24, 0.7, 1.6], push: [0.05, 0.92] } },
  // The withdrawal, and the longest one in the game. Flock retreats further
  // than Strider advances, which is the only reason the matchup is playable.
  retreatKick: { name: 'Fall Back', startup: 7, recovery: 15, travel: -2.8,
    hit: { damage: 50, box: [0.24, 1.48, 0.6, 1.2], push: [0.06, 0.5] } },
  heelDrop: { name: 'Baton Overhead', startup: 17, recovery: 25,
    hit: { damage: 100, box: [0.25, 1.50, 1.05, 1.92] } },
  risingKnee: { name: 'Cuff And Stuff', startup: 11, recovery: 23, travel: 0.6,
    hit: { damage: 88, knockdown: true, push: [0.08, 0.55] } },

  // ---- the clinch, deliberately mediocre ----------------------------------
  // A long hold, because an enforcer restraining someone should read as one,
  // and a throw that ends in a push rather than in damage. Flock's grab game is
  // about where the opponent ends up, not about what it takes off them.
  grab: { name: 'Restrain', grabHold: 48, hit: { hitStun: 48 } },
  throw: { name: 'Takedown', startup: 5, recovery: 30,
    hit: { damage: 112, push: [0, 1.35], knockdown: true, bloodScale: 1.6 } },

  // ---- specials: pay for space, not for damage ----------------------------
  // Every one-stock special here does less than the roster average, and each
  // buys something positional instead. Flock's meter is not a damage resource.
  hammerRush: { name: 'No-Knock', clip: 'heavyPunch', startup: 15, recovery: 30, travel: 3.4,
    description: 'A committed shield charge that crosses the screen. Long recovery on a miss.',
    hit: { damage: 152, knockdown: true, push: [0.08, 0.85], bloodScale: 1.8 } },
  meteorKick: { name: 'Curfew', clip: 'heavyKick', startup: 18, recovery: 27,
    description: 'An overhead baton drop. Must be blocked standing.',
    hit: { damage: 168, box: [0.2, 1.56, 0.9, 1.98], bloodScale: 1.85 } },
  cyclone: { name: 'Kettle', startup: 14, recovery: 27, travel: 1.8,
    description: 'A low sweeping cordon. Must be blocked crouching.',
    hit: { damage: 150, box: [0.18, 1.78, 0.08, 0.66], push: [0.06, 0.7] } },
  groundBreaker: { name: 'Lockdown', startup: 20, recovery: 32,
    hit: { damage: 186, chip: 16, knockdown: true, box: [0.2, 1.5, 0.2, 1.72], bloodScale: 1.95 } },
  // Two stocks, and the one move in the kit that is simply about damage. It is
  // the payoff for a round spent refusing to be approached.
  burstStrike: { name: 'Qualified Immunity', startup: 24, recovery: 42,
    description: 'The full sanction. Two stocks, and punishable on a miss.',
    hit: { damage: 296, chip: 26, knockdown: true, box: [0.18, 1.82, 0.4, 1.96], bloodScale: 2.7 } },
});

// ---- the summon -----------------------------------------------------------
// The one move in the kit that is not on the universal list, so it is appended
// rather than overridden. Eight seconds of cooldown against the throws' 1.7,
// and its own cooldown group: spending Overwatch never costs Flock a shuriken,
// and vice versa. It takes no meter, because the gauge is already the thing
// this kit cannot spare -- FINISH HIM wants two banked stocks, and a zoner who
// has to choose between his signature and his fatality simply never throws it.
//
// The summon is twelve frames of pointing at the sky and thirty-four of
// standing there having done it; every threatening frame belongs to the drone,
// which arrives well after Flock is punishable again. That gap is the cost.
export const officerMoves = Object.freeze({
  ...officerBase,
  droneSweep: Object.freeze({
    id: 'droneSweep', name: 'Overwatch', clip: 'heavyPunch', overwatch: true,
    startup: 12, active: 2, recovery: 34, cost: 0,
    cooldown: 480, cooldownGroup: 'overwatch',
    description: 'Calls down a surveillance drone that rakes a laser across the whole arena. '
      + 'There is nowhere to stand: block it standing, or take the knockdown. A fighter already on the floor passes under it.',
    cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
    hit: OVERWATCH_BEAM.hit,
  }),
});
