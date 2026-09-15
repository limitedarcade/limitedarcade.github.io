// Which announcer line a moment has earned.
//
// The voice pack ships 27 lines and the fight only ever asked for twelve. The
// other fifteen were not missing takes -- they were moments nobody had wired a
// trigger to. This watches the same `snapshot()` the HUD reads and decides.
//
// Two rules keep it from becoming noise. Every call has a *priority*, and a
// louder call is the only thing allowed to interrupt a quieter one that is
// still speaking. Every once-per-round call is *latched*, so a fighter who
// hovers on the edge of danger is told once, not every frame the bar wobbles.
//
// Nothing here touches audio directly beyond `audio.voice(cue)`, and nothing
// reads state the HUD cannot -- so a line can never spoil information a player
// does not already have on screen.

import { MATCH } from '../engine/frameData.js';

// Combo milestones, highest first: the first threshold a combo crosses wins,
// and each one fires at most once per combo. `label` is the HUD banner; the
// cue is the spoken line.
export const COMBO_TIERS = Object.freeze([
  Object.freeze({ hits: 10, cue: 'decimation', label: 'DECIMATION' }),
  Object.freeze({ hits: 8, cue: 'ferocity', label: 'FEROCITY' }),
  Object.freeze({ hits: 6, cue: 'savagery', label: 'SAVAGERY' }),
  Object.freeze({ hits: 4, cue: 'vicious', label: 'BRUTAL' }),
]);

export function comboTier(hits) {
  return COMBO_TIERS.find((tier) => hits >= tier.hits) || null;
}

// Health fraction below which a fighter is "in danger" -- the same 0.25 the
// HUD plate uses, so the taunt and the flashing bar always agree.
const DANGER = 0.25;

const PRIORITY = Object.freeze({ flavour: 1, combo: 2, moment: 3, decisive: 4 });

export class Announcer {
  constructor({ audio }) {
    this.audio = audio;
    this.humanSides = [];
    this.reset();
  }

  reset(humanSides = this.humanSides) {
    this.humanSides = humanSides;
    this.quiet = 0;
    this.priority = 0;
    this.latch = new Set();
    this.comboTierSeen = [0, 0];
  }

  // Called once per simulated frame so cooldowns run on sim time, not wall
  // time -- a paused game must not quietly clear its own cooldowns.
  tick() {
    if (this.quiet > 0 && --this.quiet === 0) this.priority = 0;
  }

  say(cue, priority = PRIORITY.flavour, cooldown = 100) {
    if (this.quiet > 0 && priority <= this.priority) return false;
    this.audio.voice(cue);
    this.quiet = cooldown;
    this.priority = priority;
    return true;
  }

  // Fires `cue` at most once for the given key. Round-scoped keys carry the
  // round number so the same call can happen again next round.
  once(key, cue, priority, cooldown) {
    if (this.latch.has(key)) return false;
    this.latch.add(key);
    return this.say(cue, priority, cooldown);
  }

  // ---- triggers -----------------------------------------------------------

  event(event, snapshot) {
    if (event.type === 'hit') {
      const tier = comboTier(event.combo);
      if (tier && tier.hits > this.comboTierSeen[event.defender]) {
        this.comboTierSeen[event.defender] = tier.hits;
        this.say(tier.cue, PRIORITY.combo, 110);
      }
      // The two-stock burst is the biggest single button in the game and had
      // no vocal weight behind it at all.
      if (event.move === 'burstStrike') this.say('apocalypse', PRIORITY.moment, 130);
      return;
    }
    if (event.type === 'roundStart') {
      this.comboTierSeen = [0, 0];
      return;
    }
    if (event.type === 'roundEnd') {
      this.comboTierSeen = [0, 0];
      // A flawless round is the one result the reel already recognises and the
      // announcer never acknowledged.
      if (snapshot.flawless) this.once(`flawless:${snapshot.round}`, 'pathetic', PRIORITY.decisive, 150);
      else if (event.reason === 'timeout') this.once(`timeout:${snapshot.round}`, 'suddenDeath', PRIORITY.moment, 140);
      return;
    }
    if (event.type === 'finisherWindow') {
      this.say('execution', PRIORITY.decisive, 150);
      return;
    }
    if (event.type === 'matchEnd') {
      // "Game over" belongs to a human losing, not to the CPU losing. When no
      // human is playing, the neutral victor call already covers it.
      const humanLost = snapshot.winner !== null && this.humanSides?.includes(snapshot.winner === 0 ? 1 : 0);
      if (humanLost) this.say('gameOver', PRIORITY.decisive, 200);
    }
  }

  // Watchers that no event announces: crossing into danger, and filling the
  // gauge. Both are latched per round so they read as a moment, not a meter.
  update(snapshot) {
    if (snapshot.phase !== 'fight') return;
    for (const view of snapshot.fighters) {
      if (view.healthPct <= DANGER && view.healthPct > 0)
        this.once(`danger:${snapshot.round}:${view.side}`, 'fearIsWeakness', PRIORITY.flavour, 120);
      if (view.stocks >= MATCH.meterMax)
        this.once(`maxed:${snapshot.round}:${view.side}`, 'rageFuel', PRIORITY.flavour, 120);
    }
  }

  // The finisher window closing unused deserves the disappointment take.
  finisherExpired(snapshot) {
    this.once(`expired:${snapshot.round}`, 'disappointing', PRIORITY.moment, 150);
  }
}
