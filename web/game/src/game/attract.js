import { CpuController } from '../engine/ai.js';
import { PHASE } from '../engine/match.js';
import { resultDuration } from '../engine/stageOutcomes.js';
import { REEL } from '../engine/reelTimeline.js';
import { fatalityOf, FINISHER_SCRIPTS } from '../engine/fatalities.js';
import { MOVEMENT_LESSONS, practiceMoves } from './practice.js';
import { STAGE_AXE_ZONE, STAGE_RING_ZONE } from '../engine/frameData.js';

export const ATTRACT_IDLE_MS = 30000;
// Replay seeds include the pickup opening and its changed combat spacing.
const DEMO_COMBO_SEEDS = Object.freeze([5, 6, 1, 10, 20, 1]);

// Exhibitions never hand these fighters a win: their opponents cannot be KO'd,
// and a timeout goes against them.
export const DEMO_CANNOT_WIN = Object.freeze(['trump']);

// Activity is measured only while the menu owns focus. Dialogs and hidden tabs
// restart the countdown, so closing Options never drops straight into a demo.
export class AttractIdle {
  constructor(delay = ATTRACT_IDLE_MS) { this.delay = delay; this.elapsed = 0; }
  reset() { this.elapsed = 0; }
  advance(ms, eligible) {
    if (!eligible) { this.reset(); return false; }
    this.elapsed += Math.max(0, Math.min(ms, 250));
    return this.elapsed >= this.delay;
  }
  get seconds() { return Math.max(0, Math.ceil((this.delay - this.elapsed) / 1000)); }
}

export function demoPair(roster, stages, index) {
  const arenas = stages.filter(stage => !stage.comingSoon);
  const carney = roster.find(fighter => fighter.id === 'carney');
  const opponents = roster.filter(fighter => fighter.id !== 'carney');
  if (!carney || !opponents.length || !arenas.length) return null;
  const opponent = opponents[index % opponents.length];
  const carneyOnRight = Math.floor(index / opponents.length) % 2 === 0;
  return { fighters: carneyOnRight ? [opponent.id, carney.id] : [carney.id, opponent.id],
    stage: arenas[index % arenas.length].id };
}

// Kept for practice / move-list tooling. Attract mode no longer plays this reel.
export function showcaseDeck(fighter, stage) {
  const moves = practiceMoves(fighter, stage);
  const groups = ['Specials', 'Supers', 'Fundamentals', 'Finishers', 'Basics'].map(group => moves.filter(m => m.group === group));
  if (DEMO_CANNOT_WIN.includes(fighter.id)) groups[3].length = 0;
  groups[2].push(...MOVEMENT_LESSONS, { id: 'lesson-block', name: 'Guard and counterplay', group: 'Fundamentals' },
    { id: 'lesson-jump', name: 'Jump and crouch', group: 'Fundamentals' });
  const deck = [];
  for (let i = 0; groups.some(group => group[i]); i++) for (const group of groups) if (group[i]) deck.push(group[i]);
  return deck;
}

// The opening uses ordinary movement and down + grab to show both arena
// pickups. The CPUs take over after the throws; Carney closes with Cold Cut.
export class AttractDirector {
  constructor() { this.pairIndex = 0; this.frame = 0; this.featuredSide = -1; this.cpus = null; this.label = ''; }
  begin(match) {
    this.frame = 0;
    this.propBeat = match.stageId === 'lake-america' ? 'axe-approach' : 'brawl';
    this.propFrame = 0;
    this.propContacts = new Set();
    this.featuredSide = match.fighters.findIndex(f => f.id === 'carney');
    if (this.featuredSide >= 0 && match.stageId === 'lake-america') {
      // Carney takes the cutting weapon; the rival returns the blunt ring.
      // Keep Carney's hands intact for the hockey-stick finale.
      match.fighters[this.featuredSide].x = -1.25;
      match.fighters[1 - this.featuredSide].x = 1.25;
      match.fighters[this.featuredSide].facing = 1;
      match.fighters[1 - this.featuredSide].facing = -1;
    }
    for (const f of match.fighters) f.cannotWin = DEMO_CANNOT_WIN.includes(f.id)
      || (this.featuredSide >= 0 && f.side !== this.featuredSide);
    for (const f of match.fighters) f.healthFloor = match.opponentOf(f).cannotWin ? 1 : 0;
    this.comboFeaturedSide = match.fighters.findIndex(fighter => fighter.id !== 'carney' && fighter.kit.id !== 'flincher');
    if (this.comboFeaturedSide < 0) this.comboFeaturedSide = this.featuredSide;
    this.cpus = [0, 1].map(side => new CpuController({ side,
      difficulty: side === this.comboFeaturedSide ? 'hard' : 'easy',
      seed: side === this.comboFeaturedSide ? DEMO_COMBO_SEEDS[this.pairIndex % DEMO_COMBO_SEEDS.length]
        : 3109 + this.pairIndex * 991 + side,
      comboRoutes: side === this.comboFeaturedSide }));
    for (const [side, cpu] of this.cpus.entries()) {
      // The exhibition keeps pressure on between exchanges. These settings
      // belong to its private controllers, not the playable CPU difficulties.
      cpu.setTuning('aggression', .9);
      cpu.setTuning('decisionFrames', 10);
      const fighter = match.fighters[side];
      if (fighter.kit.id === 'flincher') continue;
      if (side !== this.comboFeaturedSide) continue;
      cpu.preferComboKinds([this.pairIndex < 3 ? 'ground' : 'juggle']);
    }
    match.timer = 30;
    this.label = 'Exhibition · CPU vs CPU';
  }
  input(side, match) {
    if (match.phase === PHASE.FIGHT && this.propBeat !== 'brawl') {
      const fighter = match.fighters[side];
      const axe = this.propBeat.startsWith('axe');
      const axeSide = this.featuredSide >= 0 ? this.featuredSide : 0;
      const actor = axe ? axeSide : 1 - axeSide;
      const target = side === actor ? (axe ? STAGE_AXE_ZONE.x + .55 : STAGE_RING_ZONE.x - .55)
        : axe ? .9 : -.9;
      if (this.propBeat.endsWith('approach')) {
        if (Math.abs(fighter.x - target) > .12) return { [fighter.x < target ? 'right' : 'left']: true };
        // Hold through the chord resolver's input window. No direct move or
        // projectile injection: pickup, windup, flight and contact are real.
        if (side === actor && fighter.isActionable()) return { down: true, lp: true, hp: true };
      } else if (side === actor && fighter.isActionable()) {
        // Follow the throw back toward the fight while it is in flight.
        const nextX = axe ? -.9 : match.fighters[1 - side].x + 1.1;
        if (Math.abs(fighter.x - nextX) > .12) return { [fighter.x < nextX ? 'right' : 'left']: true };
      }
      // A knocked-down receiver gets up before the next beat.
      if (['downed', 'knockdown'].includes(fighter.state)) return { up: true };
      return {};
    }
    return this.cpus[side].poll(match);
  }
  beforeStep(match) {
    if (this.featuredSide < 0) return;
    match.fighters[this.featuredSide].addMeter(9999);
    if (match.phase === PHASE.ROUND_END && match.roundWinner === null) {
      match.roundWinner = this.featuredSide;
      match.fighters[this.featuredSide].roundsWon = match.roundsToWin;
    }
    if (match.phase === PHASE.ROUND_END && match.roundWinner === this.featuredSide) {
      match.brutality = false; match.pendingBrutality = null; match.pendingFinisher = true;
    }
  }
  afterStep(match, events = match.events, snapshot = match.snapshot()) {
    for (const cpu of this.cpus || []) cpu.observe(events, snapshot);
    for (const event of events) if (['hit', 'block'].includes(event.type)
      && ['stageAxe', 'stageRing'].includes(event.move)) this.propContacts.add(event.move);
    if (match.phase === PHASE.FIGHT && this.propBeat !== 'brawl') {
      this.propFrame++;
      const axe = this.propBeat.startsWith('axe');
      const used = axe ? match.axeUsed : match.ringUsed;
      const actor = axe ? Math.max(0, this.featuredSide) : 1 - Math.max(0, this.featuredSide);
      const landed = this.propContacts.has(axe ? 'stageAxe' : 'stageRing');
      const missed = this.propFrame > 32 && match.projectiles.length === 0 && match.fighters[actor].isActionable();
      if (used && this.propBeat.endsWith('approach')) {
        this.propBeat = axe ? 'axe-flight' : 'ring-flight'; this.propFrame = 0;
      } else if ((this.propBeat.endsWith('flight') && (landed || missed)) || this.propFrame > 480) {
        this.propBeat = axe ? 'ring-approach' : 'brawl'; this.propFrame = 0;
      }
    }
    if (this.featuredSide >= 0 && [PHASE.ROUND_END, PHASE.FINISHER_WINDOW].includes(match.phase)) {
      if (match.roundWinner === null) match.roundWinner = this.featuredSide;
      if (match.roundWinner === this.featuredSide) {
        // Continue the winning contact in the same tick: no victory pose,
        // FINISH IT window, or idle wait for a CPU to type the command.
        const winner = match.fighters[this.featuredSide];
        winner.roundsWon = Math.max(winner.roundsWon, match.roundsToWin);
        match.pendingBrutality = null;
        match.startFinisher(fatalityOf('carney-cold-cut'), this.featuredSide);
        // Open on the stick windup instead of the cinematic's guard hold.
        match.phaseFrame = FINISHER_SCRIPTS[match.finisher.script].shots
          .find(shot => shot.attacker.clip === 'confidenceWindup')?.frame || 0;
      }
    }
    this.frame++;
  }
  ready(match) {
    if (match.phase === PHASE.MATCH_END) return match.phaseFrame >= resultDuration(match.snapshot(), REEL.resultFrames);
    // Stay in the fight / finisher until Cold Cut and the result plate finish.
    return false;
  }
  next(match) {
    this.pairIndex++;
    return false;
  }
}
