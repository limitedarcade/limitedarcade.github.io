import { CpuController } from '../engine/ai.js';
import { PHASE } from '../engine/match.js';
import { resultDuration } from '../engine/stageOutcomes.js';
import { REEL } from '../engine/reelTimeline.js';
import { fatalityOf } from '../engine/fatalities.js';
import { MOVEMENT_LESSONS, practiceMoves } from './practice.js';

export const ATTRACT_IDLE_MS = 30000;

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

// Menu / demo exhibitions are straight CPU vs CPU fights. Carney is featured so
// every round ends in Cold Cut — no move-showcase reel between matches.
export class AttractDirector {
  constructor() { this.pairIndex = 0; this.frame = 0; this.featuredSide = -1; this.cpus = null; this.label = ''; }
  begin(match) {
    this.frame = 0;
    this.featuredSide = match.fighters.findIndex(f => f.id === 'carney');
    for (const f of match.fighters) f.cannotWin = DEMO_CANNOT_WIN.includes(f.id)
      || (this.featuredSide >= 0 && f.side !== this.featuredSide);
    for (const f of match.fighters) f.healthFloor = match.opponentOf(f).cannotWin ? 1 : 0;
    this.cpus = [0, 1].map(side => new CpuController({ side, difficulty: 'hard', seed: 3109 + this.pairIndex * 991 + side }));
    match.timer = 25;
    this.label = 'Exhibition · CPU vs CPU';
  }
  input(side, match) {
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
    if (match.phase === PHASE.FINISHER_WINDOW && match.roundWinner === this.featuredSide) {
      match.hitStop = 0;
      const cpu = this.cpus[this.featuredSide];
      if (cpu.finisherPlan?.entry.id !== 'carney-cold-cut')
        cpu.finisherPlan = { entry: fatalityOf('carney-cold-cut'), frame: 0, ready: false };
      // Let the CPU walk into command range even after a long-distance KO.
      match.phaseFrame = Math.min(match.phaseFrame, 160);
    }
  }
  afterStep(match) { this.frame++; }
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
