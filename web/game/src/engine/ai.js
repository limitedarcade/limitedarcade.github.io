// The CPU controller.
//
// It returns the same button struct a keyboard does and reads the same
// `snapshot()` the HUD does, so it has no private channel into the match: it
// cannot see a move before its startup frames have visibly begun, and it has to
// press both punches on one frame to get a grab exactly like a player does.
//
// Difficulty is not "the CPU cheats more". It is reaction latency, how often a
// read is taken, and how willing it is to commit -- so a harder CPU loses to
// the same things, just less often.

import { emptyInput } from './commands.js';
import { moveOf, MATCH } from './frameData.js';
import { CHORDS, DIRECTIONAL, directionalFor } from './moveList.js';
import { combatKitFor } from '../fighters/combatKits.js';
import { FATALITY_REGISTRY, fatalitiesFor } from './fatalities.js';

export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({
    label: 'Rookie', reactionFrames: 22, decisionFrames: 26,
    blockChance: 0.34, antiAirChance: 0.18, punishChance: 0.14,
    aggression: 0.34, grabChance: 0.16, jumpChance: 0.14, heavyBias: 0.25,
    specialChance: 0.10, mixupChance: 0.16,
  }),
  normal: Object.freeze({
    label: 'Contender', reactionFrames: 12, decisionFrames: 18,
    blockChance: 0.62, antiAirChance: 0.45, punishChance: 0.40,
    aggression: 0.55, grabChance: 0.28, jumpChance: 0.22, heavyBias: 0.4,
    specialChance: 0.30, mixupChance: 0.36,
  }),
  hard: Object.freeze({
    label: 'Headliner', reactionFrames: 6, decisionFrames: 12,
    blockChance: 0.86, antiAirChance: 0.72, punishChance: 0.72,
    aggression: 0.74, grabChance: 0.34, jumpChance: 0.28, heavyBias: 0.55,
    specialChance: 0.48, mixupChance: 0.54,
  }),
});

// The knobs worth turning while watching a match, described as data so the
// debug studio builds its panel from this list rather than keeping a second
// copy of it: a tunable added here is immediately on screen. `unit` absent
// means the value reads as a percentage.
export const TUNABLES = Object.freeze([
  { key: 'aggression', label: 'Aggression', hint: 'How often close range becomes an attack rather than a guard.' },
  { key: 'jumpChance', label: 'Jump-ins', hint: 'Chance a decision at range becomes a jump instead of a walk.' },
  { key: 'grabChance', label: 'Grapples', hint: 'Chance close range becomes a grab or a throw.' },
  { key: 'mixupChance', label: 'Mix-ups', hint: 'How often an attack is a chord or crouch normal, not a plain button.' },
  { key: 'specialChance', label: 'Specials', hint: 'Willingness to spend meter stocks.' },
  { key: 'heavyBias', label: 'Heavy bias', hint: 'Heavy over light when both would reach.' },
  { key: 'blockChance', label: 'Blocking', hint: 'Chance a seen attack is guarded rather than traded with.' },
  { key: 'antiAirChance', label: 'Anti-air', hint: 'Chance a jump-in is met with the uppercut.' },
  { key: 'punishChance', label: 'Whiff punish', hint: 'Chance an opponent stuck in recovery is punished.' },
  { key: 'reactionFrames', label: 'Reaction', min: 1, max: 30, step: 1, unit: 'f', hint: 'Frames an attack must be visible before the CPU may react to it.' },
  { key: 'decisionFrames', label: 'Decision', min: 4, max: 40, step: 1, unit: 'f', hint: 'Frames a chosen intent is committed to before rethinking.' },
].map(t => Object.freeze({ min: 0, max: 1, step: 0.02, unit: null, ...t })));

// Reach thresholds derived from frameData boxes plus the defender's half-width,
// so retuning a hitbox retunes the CPU's spacing instead of desyncing from it.
const RANGE = Object.freeze({ grab: 1.10, light: 1.28, heavy: 1.70, approach: 2.6 });

// The finisher's own reach, kept a little short of the true hitbox so the CPU
// walks all the way in rather than stopping at the edge and whiffing.
const FINISHER_RANGE = 1.45;

// How far a thrown weapon is worth throwing from. Short of the full arena so
// the CPU still closes ground rather than turtling at the wall forever.
const PROJECTILE_RANGE = 7.0;

// How a move is *typed* on a pad, derived from the same tables the pause-screen
// command list is built from. Deriving it means a move added to moveList.js is
// immediately available to the CPU instead of silently staying player-only,
// which is exactly how most of the list went unused before.
const INPUT_FOR = new Map();
for (const c of CHORDS) INPUT_FOR.set(c.move, { buttons: Object.freeze([...c.buttons]), dir: null });
for (const d of DIRECTIONAL) INPUT_FOR.set(d.move, { buttons: Object.freeze([d.button]), dir: d.direction });
for (const [button, move] of [['lp', 'lightPunch'], ['hp', 'heavyPunch'], ['lk', 'lightKick'], ['hk', 'heavyKick']]) {
  INPUT_FOR.set(move, { buttons: Object.freeze([button]), dir: null });
}
// Crouch normals share a button with the standing version and are separated by
// stance alone, so they need the direction held, not a different press.
INPUT_FOR.set('crouchPunch', { buttons: Object.freeze(['lp']), dir: 'down' });

// Kit-specific commands are not on the universal tables, so they are resolved
// against the kit in hand. Without this a signature move is unreachable to the
// CPU no matter how many times the planner picks it -- there is no button.
const KIT_INPUTS = new WeakMap();
function inputFor(move, kit) {
  if (!kit?.commands?.length) return INPUT_FOR.get(move);
  let extra = KIT_INPUTS.get(kit);
  if (!extra) {
    extra = new Map((kit?.commands || []).map(c => [c.move, { buttons: Object.freeze([c.button]), dir: c.direction }]));
    KIT_INPUTS.set(kit, extra);
  }
  return extra.get(move) || INPUT_FOR.get(move);
}

// The resolver holds an attack for `macroWindow` frames before committing, and
// the stance/direction is read on the *commit* frame -- so a direction pressed
// only on the frame the button goes down has already been released by the time
// it would matter. Holding for this long covers the window with room to spare.
const HOLD_FRAMES = 9;
const PRESS_FRAMES = 2;

// A jump lasts 2 * jumpVelocity / gravity ~= 39 frames. A jump-in that expires
// after `decisionFrames` gets a new intent picked while the CPU is still in the
// air, which is how the jumping attack all but vanished from matches: the swing
// was scheduled by an intent that no longer existed by the time it mattered.
const JUMP_FRAMES = 42;

// Voluntary recovery starts after the forced fall has finished. Better CPUs
// tend to recover earlier, but every difficulty sometimes waits to vary timing.
const RECOVERY_DELAY = Object.freeze({ easy: [16, 30], normal: [10, 24], hard: [6, 16] });
const DASH_FRAMES = 30;

// Reach each attack needs before it is worth throwing. Travel moves close their
// own distance, so they are allowed to start from further out.
function reachOf(id, kit) {
  const move = moveOf(id, kit);
  // A projectile's hitbox is the spawn point, not the threat: measuring it like
  // a fist made the CPU walk into jab range before throwing, which is how the
  // officer's shuriken and knife never once read as a zoning tool.
  if (move.projectile) return PROJECTILE_RANGE;
  // The drone rakes from the caster's feet to the far wall, so there is no
  // distance at which calling it is out of range -- only distances at which it
  // is a waste. The zoning branch handles that; the reach itself is the arena.
  if (move.overwatch) return PROJECTILE_RANGE;
  return Math.max(RANGE.grab, move.hit.box[1] + Math.max(0, move.travel) * 0.6);
}

// A move the CPU is actually allowed to throw right now: the meter is banked
// for it and its cooldown group is clear. Filtering here rather than at each
// call site means a kit that adds a cost or a cooldown constrains the CPU
// without ai.js having to learn about it. `bank` locks out every metered move
// regardless of balance, which is how "save the gauge for the finisher" stays
// honest -- otherwise a cost-1 mix-up drains the stocks the KO needs.
function usable(id, kit, me, bank = false) {
  const move = moveOf(id, kit);
  const cost = move.cost || 0;
  if (cost > me.stocks) return false;
  if (bank && cost > 0) return false;
  const group = move.cooldownGroup || id;
  const remaining = me.cooldowns?.[group] ?? (group === 'ranged' ? me.rangedCooldown : 0);
  if (move.cooldown && remaining > 0) return false;
  return true;
}

// Every attack the kit can express, so coverage is measured against the kit in
// hand instead of against the universal list a fighter may have overridden.
function repertoireOf(kit) {
  let list = REPERTOIRE.get(kit);
  if (!list) {
    // grab and throw are driven by their own intents, which walk in first.
    const ids = [...INPUT_FOR.keys(), ...(kit.commands || []).map(c => c.move)];
    list = Object.freeze([...new Set(ids)]
      .filter(id => kit.moves[id] && id !== 'grab' && id !== 'throw'));
    REPERTOIRE.set(kit, list);
  }
  return list;
}
const REPERTOIRE = new WeakMap();

// Small deterministic PRNG so a seeded match replays identically in tests.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class CpuController {
  constructor({ side, difficulty = 'normal', seed = 1337 } = {}) {
    this.side = side;
    this.overrides = {};
    this.setDifficulty(difficulty);
    this.random = mulberry32(seed + side * 977);
    this.intent = { kind: 'wait' };
    this.intentFrames = 0;
    this.cooldown = 0;
    this.threatSeen = 0;
    this.pressFrames = 0;
    this.grabFrames = 0;
    this.lastY = 0;
    this.recoveryPlan = null;
    // How long since each move was last thrown, in decisions. A move that has
    // been sitting unused gains weight, so the whole kit shows up over a round
    // instead of the same three answers to the same three situations.
    this.lastUsed = new Map();
    this.decisions = 0;
  }

  setDifficulty(name) {
    this.difficultyName = DIFFICULTIES[name] ? name : 'normal';
    this.applyTuning();
  }

  // A difficulty is the starting point, not the final word: overrides set from
  // the debug studio sit on top of it and survive a difficulty change, so a
  // knob turned mid-session is not silently reverted by the next round start.
  applyTuning() {
    this.params = Object.freeze({ ...DIFFICULTIES[this.difficultyName], ...this.overrides });
  }

  // `null` clears one knob back to the preset; `resetTuning()` clears them all.
  setTuning(key, value) {
    if (value === null || value === undefined) delete this.overrides[key];
    else this.overrides[key] = value;
    this.applyTuning();
  }

  resetTuning() { this.overrides = {}; this.applyTuning(); }

  // `match` is the Match instance; only `snapshot()` is read from it.
  poll(match) {
    const snap = match.snapshot();
    const me = snap.fighters[this.side];
    const foe = snap.fighters[this.side === 0 ? 1 : 0];
    const input = emptyInput();
    // The match consumes no input during hitstop. Keep each planned press on
    // its simulation frame, especially the release between dash taps.
    if (snap.hitStop > 0) return input;
    const toward = me.facing === -1 ? 'left' : me.facing === 1 ? 'right' : foe.x > me.x ? 'right' : 'left';
    const away = toward === 'right' ? 'left' : 'right';
    const p = this.params;
    this.kit = combatKitFor(me.id, me.combatKit);
    const foeKit = combatKitFor(foe.id, foe.combatKit);

    // Whether the gauge is being saved for the round-ending finisher rather
    // than spent on specials. Recomputed every frame so both the reactive
    // whiff-punish below and the deliberate layer read the same answer.
    this.banking = this.shouldBank(me, foe, snap);

    const distance = snap.distance;

    if (snap.phase === 'finisherWindow' && snap.roundWinner === this.side) {
      if (FATALITY_REGISTRY[me.id]) return this.driveFinisher(input, snap, me, toward, away);
      // Deliberately unhurried: the CPU takes a beat before the finisher so the
      // window reads as a moment rather than an instant execution. It still has
      // to walk into range like a player does -- the KO rarely leaves it there.
      this.pressFrames += 1;
      if (this.pressFrames > 45) {
        if (distance > FINISHER_RANGE) input[toward] = true;
        else { input.block = true; input.hp = true; }
      }
      return input;
    }
    this.pressFrames = 0;
    this.finisherPlan = null;
    if (snap.phase !== 'fight') { this.recoveryPlan = null; return input; }
    if (me.state === 'downed') return this.driveRecovery(input, me, toward, away);
    this.recoveryPlan = null;
    if (me.state === 'hitStun' || me.state === 'knockdown' || me.state === 'grabbed'
      || me.state === 'getUp' || me.state === 'dizzy' || me.state === 'juggle' || me.state === 'backHop') {
      // A fall or committed hop invalidates the old attack/approach plan. In
      // particular, the airborne attack branch must never fight a juggle.
      this.setIntent('wait', 0);
      return input;
    }

    // Holding a clinch. Both kicks converts it into the throw, and letting the
    // hold tick first is worth real damage -- so the CPU squeezes for a beat
    // and then throws, instead of dropping every grab on the timeout.
    if (me.state === 'grabbing') {
      this.grabFrames += 1;
      if (this.grabFrames > 24 && this.grabFrames <= 28) { input.lk = true; input.hk = true; }
      return input;
    }
    this.grabFrames = 0;

    // One tick off the current intent, up front, so every branch below can ask
    // "am I still committed?" by reading the same counter.
    if (this.cooldown > 0) this.cooldown -= 1;
    const committed = this.cooldown > 0 && ['attack', 'sprint', 'backHop'].includes(this.intent.kind);

    // Airborne, whatever intent got the CPU up there: if the opponent is under
    // the arc and the CPU has not swung yet, swing. Ground intents cannot run
    // in the air anyway, so the alternative is drifting over them doing nothing.
    if (me.airborne) {
      if (me.state !== 'attack' && distance < RANGE.heavy + 0.6 && me.y < 1.25 && me.y <= this.lastY) input.hk = true;
      else if (distance > RANGE.light) input[toward] = true;
      this.lastY = me.y;
      return input;
    }
    this.lastY = me.y;

    // ---- reactive layer: runs every frame, gated by reaction latency --------
    // A threat is only "seen" once it has been visible for reactionFrames, so a
    // 4-frame light genuinely beats a slow CPU's guard.
    const foeAttacking = foe.state === 'attack';
    if (foeAttacking) this.threatSeen += 1; else this.threatSeen = 0;

    // Anti-air is the uppercut, not a bare heavy punch: it is the move whose
    // box actually reaches jump height, and committing to it is why a jump-in
    // against a reading CPU is a real gamble.
    if (foe.airborne && distance < RANGE.heavy && !committed && this.roll() < p.antiAirChance) {
      this.setAttack('uppercut');
      return this.driveIntent(input, toward, away, distance);
    }

    if (!committed && this.threatSeen >= p.reactionFrames && distance < RANGE.heavy + 0.3) {
      const move = foe.move ? moveOf(foe.move, foeKit) : null;
      const level = move?.hit.level;
      if (this.roll() < p.blockChance) {
        input[away] = true;
        input.block = true;
        // Crouch under lows, stand up for overheads. Guessing the stance wrong
        // is the price of the read, so the CPU only gets it right when the move
        // has been on screen long enough to identify.
        if (level === 'low') input.down = true;
        return input;
      }
    }

    // Whiff punish: the opponent is in recovery and cannot block yet. This is
    // the one moment a slow, committal move is free, so it is where the heavy
    // punishers come out rather than another jab.
    if (!committed && foeAttacking && foe.moveFrame > moveOf(foe.move, foeKit).startup + moveOf(foe.move, foeKit).active
      && distance < RANGE.light && this.roll() < p.punishChance) {
      const big = !this.banking && me.stocks >= 2 && this.roll() < p.specialChance;
      this.setAttack(big ? this.pickSpecial(me, false, false)
        : this.choose(['uppercut', 'powerStrike', 'heavyPunch', 'risingKnee'], me, 'uppercut'));
      return this.driveIntent(input, toward, away, distance);
    }

    // ---- deliberate layer: a new intent every decisionFrames ---------------
    if (this.cooldown <= 0) this.chooseIntent(distance, me, foe);

    return this.driveIntent(input, toward, away, distance);
  }

  roll() { return this.random(); }

  // Two banked stocks are what opens the FINISH HIM window, and that window
  // only exists on the round that decides the match. So off match point the
  // gauge is just resource -- spend it -- and the old "stop spending when the
  // opponent is nearly dead" rule is all that applies. On match point the CPU
  // starts hoarding as soon as a finish is a realistic outcome: a stock already
  // in hand, or the opponent past a third of their bar. Without this the KO
  // almost always lands with the gauge half-spent and the window never opens.
  shouldBank(me, foe, snap) {
    if (foe.healthPct < 0.3) return true;
    const matchPoint = me.roundsWon >= snap.roundsToWin - 1;
    if (matchPoint) return me.stocks >= 1 || foe.healthPct < 0.7;
    // Not yet on match point: specials are free to spend, but once ahead on
    // rounds the CPU keeps one stock banked so the deciding round opens with a
    // head start toward the two the finisher needs -- one round rarely builds
    // the gauge from empty.
    return me.roundsWon > foe.roundsWon && me.stocks <= 1;
  }

  driveRecovery(input, me, toward, away) {
    if (!me.recoveryReady) return input;
    if (!this.recoveryPlan) {
      const [min, max] = RECOVERY_DELAY[this.difficultyName];
      const wait = min + Math.floor(this.roll() * (max - min + 1));
      const choice = this.roll();
      this.recoveryPlan = { wait, age: 0, kind: choice < 0.4 ? 'stand' : choice < 0.8 ? 'back' : 'forward' };
      this.setIntent('wait', 0);
    }
    const plan = this.recoveryPlan;
    if (plan.age++ < plan.wait) return input;
    if (plan.kind === 'stand') input.block = true;
    else input[plan.kind === 'forward' ? toward : away] = true;
    return input;
  }

  driveFinisher(input, snapshot, me, toward, away) {
    if (snapshot.phaseFrame < 40) return input;
    if (!this.finisherPlan) {
      const entries = fatalitiesFor(me.id, snapshot.stageId);
      const roll = this.roll();
      const entry = roll < 0.08 ? entries.at(-1) : roll < 0.26 ? entries.at(-2)
        : entries[Math.floor(this.roll() * 2)];
      this.finisherPlan = { entry, frame: 0, ready: false };
    }
    const plan = this.finisherPlan;
    const { min, max } = plan.entry.range;
    const target = plan.entry.kind === 'friendship' ? snapshot.distance : (min + max) / 2;
    if (!plan.ready) {
      if (snapshot.distance > target + 0.08) { input[toward] = true; return input; }
      if (snapshot.distance < target - 0.08) { input[away] = true; return input; }
      plan.ready = true;
      // A neutral frame separates positioning from the first command edge.
      return input;
    }
    const tokenIndex = Math.floor(plan.frame / 6), token = plan.entry.command[tokenIndex];
    if (token && plan.frame % 6 < 2) input[token === 'forward' ? toward : token === 'back' ? away : token] = true;
    plan.frame += 1;
    // A changed position can invalidate a command, but the CPU has to re-enter
    // it normally, with new edges, rather than invoking a private match method.
    if (plan.frame > plan.entry.command.length * 6 + 14) this.finisherPlan = null;
    return input;
  }

  // Latch an attack for long enough that the resolver sees the whole chord and
  // the stance is still held when the command commits.
  setAttack(move) {
    this.intent = { kind: 'attack', move, ...inputFor(move, this.kit) };
    this.lastUsed.set(move, this.decisions);
    this.intentFrames = Math.max(this.params.decisionFrames, HOLD_FRAMES + 2);
    this.cooldown = this.intentFrames;
    this.fired = false;
    this.firedAt = 0;
  }

  setIntent(kind, frames = this.params.decisionFrames) {
    this.intent = { kind };
    this.intentFrames = frames;
    this.cooldown = this.intentFrames;
    this.fired = false;
    this.firedAt = 0;
  }

  // Pick from a shortlist: drop what the meter and cooldowns forbid, then
  // favour whatever has gone longest without being used. `staleWeight` is how
  // hard coverage pulls against the situational pick -- enough to rotate the
  // list, not enough to make the CPU throw the wrong move for the range.
  choose(candidates, me, fallback = 'heavyPunch') {
    const viable = candidates.filter(id => this.kit.moves[id] && usable(id, this.kit, me, this.banking));
    if (!viable.length) return usable(fallback, this.kit, me, this.banking) ? fallback : 'lightPunch';
    if (viable.length === 1) return viable[0];
    let best = viable[0], bestScore = -Infinity;
    for (const id of viable) {
      const stale = this.decisions - (this.lastUsed.get(id) ?? -60);
      const score = this.roll() + Math.min(stale, 240) / 240 * 0.85;
      if (score > bestScore) { bestScore = score; best = id; }
    }
    return best;
  }

  // The whole kit, ranked by neglect. Used when the situation does not demand a
  // specific answer, which is most decisions in a round.
  freshest(me, within) {
    return this.choose(repertoireOf(this.kit).filter(id => reachOf(id, this.kit) >= within), me);
  }

  // Meter is not a trophy. The stock is spent on whatever beats the guard that
  // is actually on screen, which is why the low, the overhead and the burst all
  // show up in a match instead of only ever the raw damage one.
  pickSpecial(me, guardStand, guardCrouch) {
    if (me.stocks >= 2 && this.roll() < 0.45) return this.choose(['burstStrike'], me, 'hammerRush');
    if (guardCrouch) return this.choose(['meteorKick', 'heelDrop'], me, 'hammerRush');
    if (guardStand) return this.choose(['cyclone', 'crouchKick'], me, 'hammerRush');
    return this.choose(['hammerRush', 'groundBreaker', 'burstStrike'], me, 'hammerRush');
  }

  // The free chords and crouch normals. Same idea as the specials, one tier
  // down: answer the stance, and otherwise vary the poke so the CPU is not a
  // metronome of heavy punches.
  pickMixup(distance, me, guardStand, guardCrouch) {
    // Overheads beat a crouching guard, lows beat a standing one. Within the
    // right answer the least-used option wins, which is what keeps the second
    // overhead in the kit from being decoration.
    if (guardCrouch) return this.choose(['heelDrop', 'risingKnee', 'meteorKick'], me);
    if (guardStand) return this.choose(['crouchKick', 'bodyCheck', 'cyclone'], me);
    if (distance > RANGE.light) return this.choose(['lungePunch', 'powerStrike', 'bodyCheck'], me);
    return this.choose(['crouchKick', 'crouchPunch', 'heelDrop', 'risingKnee',
      'bodyCheck', 'powerStrike', 'lungePunch'], me);
  }

  // Anything in the kit that leaves the fighter's hands. Kits that have none
  // -- most of them -- simply never take the zoning branch.
  projectiles(me) {
    return repertoireOf(this.kit)
      .filter(id => this.kit.moves[id].projectile && usable(id, this.kit, me));
  }

  // Summons are zoning too, but on a different clock: an eight-second cooldown
  // is not something to throw at the first gap that opens. The CPU calls the
  // drone only from far enough out that the rake covers ground the opponent has
  // to walk back through, which is where the move is actually worth its wait.
  summons(me) {
    return repertoireOf(this.kit)
      .filter(id => this.kit.moves[id].overwatch && usable(id, this.kit, me));
  }

  chooseIntent(distance, me, foe) {
    const p = this.params;
    const r = this.roll();
    this.decisions += 1;

    // Zoning. A kit that throws things has a reason to hold the gap rather than
    // close it, and the cooldown is what stops that becoming a wall of steel:
    // once it is spent the CPU drops back into the approach ladder below.
    if (distance > RANGE.heavy && !foe.airborne) {
      const called = distance > RANGE.approach ? this.summons(me) : [];
      if (called.length && this.roll() < 0.5 + p.aggression * 0.3) {
        this.setAttack(called[0]);
        return;
      }
      const thrown = this.projectiles(me);
      if (thrown.length && this.roll() < 0.55 + p.aggression * 0.3) {
        this.setAttack(this.choose(thrown, me, thrown[0]));
        return;
      }
    }

    if (distance > RANGE.approach) {
      if (r < p.jumpChance) this.setIntent('jumpIn', JUMP_FRAMES);
      else if (this.roll() < 0.5) this.setIntent('sprint', DASH_FRAMES);
      else this.setIntent('approach');
      return;
    }
    if (distance > RANGE.heavy) {
      // Mid range is a jump-in range too, not just a walking one -- from here
      // the arc actually lands on the opponent instead of in front of them.
      if (r < p.jumpChance * 0.8) { this.setIntent('jumpIn', JUMP_FRAMES); return; }
      // Mid range is where the lunge earns its recovery: it is the only ground
      // move that closes this gap and hits at the end of it.
      if (this.roll() < p.aggression * 0.15) {
        this.setAttack(this.choose(['lungePunch', 'hammerRush', 'cyclone', 'bodyCheck'], me, 'lungePunch'));
        return;
      }
      this.setIntent(this.roll() < p.aggression ? 'approach' : 'block');
      return;
    }

    // Close range. The opponent's stance is the only read the CPU takes, and it
    // is a public one -- a standing guard is open to lows, a crouching guard to
    // overheads, and a patient guard to a grab.
    const guardStand = foe.state === 'blockStand' || foe.state === 'blockStun';
    const guardCrouch = foe.state === 'blockCrouch';
    const guarding = guardStand || guardCrouch;

    // Spending is gated on banking. A single stock is mostly held back, because
    // both the burst and the round-ending finisher want a gauge that has been
    // saved rather than dumped on the first special that came to hand -- and
    // with the opponent nearly out the gauge stops being spendable at all,
    // because two banked stocks are what buys the FINISH HIM window.
    const banking = this.banking;
    if (!banking && me.stocks >= 1 && r < p.specialChance && (me.stocks >= 2 || this.roll() < 0.25)) {
      this.setAttack(this.pickSpecial(me, guardStand, guardCrouch));
      return;
    }
    // Blocking opponents give up nothing to strikes, so the grab exists to open
    // them. That is the one read the CPU is allowed to make on stance.
    if (guarding && distance < RANGE.approach && this.roll() < 0.42) {
      this.setIntent(this.roll() < 0.5 ? 'grab' : 'throw');
      return;
    }
    if (guarding && this.roll() < 0.72) { this.setAttack(this.pickMixup(distance, me, guardStand, guardCrouch)); return; }
    // Grappling gets its own roll rather than the leftovers of the ladder
    // above: sharing one number meant the grab could only ever fire inside the
    // slice the specials had not already claimed, which is most of it. The
    // walk-in is part of the intent, so it does not need to already be in
    // clinch range to decide on one.
    if (distance < RANGE.light && this.roll() < p.grabChance) {
      this.setIntent(this.roll() < 0.7 ? 'grab' : 'throw');
      return;
    }
    if (r < p.aggression) {
      if (this.roll() < p.mixupChance) { this.setAttack(this.pickMixup(distance, me, false, false)); return; }
      const heavy = this.roll() < p.heavyBias;
      const kick = this.roll() < 0.45;
      if (distance <= RANGE.light) {
        this.setAttack(heavy ? (kick ? 'heavyKick' : 'heavyPunch') : (kick ? 'lightKick' : 'lightPunch'));
      } else {
        this.setAttack(kick ? 'heavyKick' : 'heavyPunch');
      }
      return;
    }
    if (r < p.aggression + 0.2) { this.setIntent('crouchBlock'); return; }
    // Backing off is a move too: the retreating kick covers the withdrawal.
    if (this.roll() < 0.18) { this.setAttack(this.choose(['retreatKick'], me, 'retreatKick')); return; }
    // Nothing on screen demands a particular answer, so this is where the rest
    // of the kit gets its turn: whatever has gone longest unthrown and still
    // reaches from here.
    if (this.roll() < 0.22) { this.setAttack(this.freshest(me, distance)); return; }
    if (this.roll() < 0.5) this.setIntent('block');
    else this.setIntent(this.roll() < 0.4 ? 'backHop' : 'retreat');
  }

  driveIntent(input, toward, away, distance) {
    const age = this.intentFrames - this.cooldown;
    switch (this.intent.kind) {
      case 'approach':
        input[toward] = true;
        break;
      case 'retreat':
        input[away] = true;
        break;
      case 'sprint':
      case 'backHop': {
        // An explicit pad sequence: release, tap, release, tap-and-hold.
        // Ordinary walking intents keep their direction held across decisions;
        // they do not manufacture a double tap each time the CPU reconsiders.
        const forward = this.intent.kind === 'sprint';
        if (forward && distance <= RANGE.heavy) {
          input.block = true;
          this.setIntent('wait', 0);
        } else if (age === 1 || age >= 4) input[forward ? toward : away] = true;
        break;
      }
      case 'block':
        input[away] = true;
        input.block = true;
        break;
      case 'crouchBlock':
        input.down = true;
        input.block = true;
        break;
      case 'jumpIn':
        // Press up only on the first frames of the intent, then swing near the
        // apex; holding up would re-jump the instant it lands.
        if (age < 3) { input.up = true; input[toward] = true; }
        else if (age > 14) input.hk = true;
        else input[toward] = true;
        break;
      case 'attack': {
        // Walk in until the move can actually reach, then commit. The press is
        // a couple of frames; the direction is held far longer, because the
        // resolver reads stance on the frame the command commits, not the frame
        // the button went down.
        const { buttons, dir, move } = this.intent;
        if (!this.fired && distance > reachOf(move, this.kit)) { input[toward] = true; break; }
        if (!this.fired) { this.fired = true; this.firedAt = age; }
        const since = age - this.firedAt;
        if (since < PRESS_FRAMES) for (const b of buttons) input[b] = true;
        if (since < HOLD_FRAMES) {
          if (dir === 'down') input.down = true;
          else if (dir === 'forward') input[toward] = true;
          else if (dir === 'back') input[away] = true;
        }
        break;
      }
      case 'grab':
      case 'throw': {
        if (!this.fired && distance > RANGE.grab) { input[toward] = true; break; }
        if (!this.fired) { this.fired = true; this.firedAt = age; }
        if (age - this.firedAt < PRESS_FRAMES) {
          if (this.intent.kind === 'grab') { input.lp = true; input.hp = true; }
          else { input.lk = true; input.hk = true; }
        }
        break;
      }
      default:
        break;
    }
    return input;
  }
}

export { MATCH };
