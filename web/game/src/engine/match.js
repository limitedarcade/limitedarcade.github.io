import { REEL } from './reelTimeline.js';
// The match: two fighters, the round clock, hit resolution, and the KO window.
//
// Deterministic and renderer-free. `step(inputA, inputB)` advances exactly one
// 60 Hz frame and appends to `events`, which the renderer drains for effects,
// the HUD reads for numbers, and the tests read for assertions. Nothing in here
// reads a clock or a canvas, so a whole round can be simulated in a unit test.

import {
  MOVES, STAGE_AXE, STAGE_AXE_ZONE, STAGE_RING, MATCH, PHYSICS, BODY, moveOf, worldBox, boxesOverlap, inStageAxeZone, inStageRingZone,
} from './frameData.js';
import { Fighter } from './fighter.js';
import { fatalitiesFor, FATALITY_REGISTRY, FINISHER_SCRIPTS, FinisherCommandBuffer, BRUTALITY } from './fatalities.js';
import { StageHazards } from './stageHazards.js';
import { BEAM, beamPhase, contactAt, muzzleAt, segmentHitsBox, createStrike } from './overwatch.js';
import { OVERWATCH_BEAM } from '../fighters/officerMoves.js';
import { COLD_CUT_ICE_ARMS } from '../render/coldCutIce.js';

// Phases are mutually exclusive and drive both input gating and the HUD.
export const PHASE = Object.freeze({
  INTRO: 'intro',
  FIGHT: 'fight',
  ROUND_END: 'roundEnd',
  FINISHER_WINDOW: 'finisherWindow',
  FINISHER: 'finisher',
  MATCH_END: 'matchEnd',
});

const COUNTER_MULTIPLIER = 1.25;
const GROUND_DAMAGE_SCALE = 0.45;

// Health a hit may remove. Exhibitions set `healthFloor` on the opponent of a
// fighter who must not win, so that opponent can be beaten down but never KO'd.
export function lethalHealth(fighter) { return Math.max(0, fighter.health - (fighter.healthFloor || 0)); }

export class Match {
  constructor({ left, right, roundsToWin = MATCH.roundsToWin, stageId = 'lake-america', hazards = false } = {}) {
    this.fighters = [
      new Fighter({ id: left?.id || 'p1', side: 0, label: left?.label || 'P1', combatKit: left?.combatKit }),
      new Fighter({ id: right?.id || 'p2', side: 1, label: right?.label || 'P2', combatKit: right?.combatKit }),
    ];
    this.stageId = stageId;
    this.hazards = new StageHazards({ stageId, enabled: hazards });
    this.finishCommands = new FinisherCommandBuffer();
    // A single-round match is the same rules with a shorter series, so the
    // count lives here rather than as a second code path.
    this.roundsToWin = Math.max(1, roundsToWin);
    this.maxRounds = this.roundsToWin * 2 - 1;
    this.events = [];
    this.round = 0;
    this.winner = null;
    this.startRound();
  }

  get left() { return this.fighters[0]; }
  get right() { return this.fighters[1]; }

  startRound() {
    this.projectiles = [];
    this.strike = null;
    this.nextProjectileId = 0;
    this.axeUsed = false;
    this.ringUsed = false;
    this.round += 1;
    this.phase = PHASE.INTRO;
    this.phaseFrame = 0;
    this.timer = MATCH.timerTicks;
    this.timerFrames = 0;
    this.hitStop = 0;
    this.roundWinner = null;
    this.roundReason = null;
    this.flawless = false;
    this.fatality = false;
    this.brutality = false;
    this.friendship = false;
    this.finisher = null;
    this.pendingBrutality = null;
    this.hazards.reset();
    this.finishCommands.reset();
    this.pendingFinisher = false;
    this.fighters[0].resetRound(-PHYSICS.startSeparation / 2);
    this.fighters[1].resetRound(PHYSICS.startSeparation / 2);
    this.events.push({ type: 'roundStart', round: this.round });
  }

  step(inputs) {
    this.events.length = 0;

    // Freeze motion and combat clocks while still reading press/release edges.
    // OR-ing held flags across the freeze lost repeat taps and invented chords.
    if (this.phase === PHASE.FIGHT && this.hitStop > 0) {
      for (const f of this.fighters) f.captureStoppedInput(inputs[f.side] || {});
      this.hitStop -= 1; return this.events;
    }

    this.phaseFrame += 1;
    const gate = this.inputGate();
    if (this.phase === PHASE.FINISHER_WINDOW && this.roundWinner !== null) {
      const winner = this.fighters[this.roundWinner];
      this.finishCommands.step(inputs[winner.side], winner.facing);
      const command = this.finishCommands.match(fatalitiesFor(winner.id, this.stageId), Math.abs(this.left.x - this.right.x));
      if (command?.finisher) { this.startFinisher(command.finisher, winner.side); return this.events; }
      if (command?.rejected) this.events.push({ type: 'finisherRange', side: winner.side,
        finisherId: command.rejected.id, range: command.rejected.range, distance: command.distance });
    }

    for (const fighter of this.fighters) {
      if (this.phase === PHASE.ROUND_END && this.phaseFrame <= REEL.koEnd) continue;
      const previousMove = fighter.move, previousFrame = fighter.moveFrame, previousState = fighter.state;
      const other = this.opponentOf(fighter);
      fighter.step({
        input: this.phase === PHASE.FINISHER_WINDOW && FATALITY_REGISTRY[fighter.id]
          ? this.finisherMovementInput(inputs[fighter.side]) : inputs[fighter.side] || {},
        allowInput: gate.allowInput[fighter.side],
        allowFinisher: gate.allowFinisher[fighter.side],
        opponentX: other.x,
        events: this.events,
      });
      if (fighter.state === 'attack' && (previousState !== 'attack' || previousMove !== fighter.move || fighter.moveFrame < previousFrame))
        this.events.push({ type: 'attack', side: fighter.side, move: fighter.move, x: fighter.x,
          moveData: fighter.moveOf() });
      if (fighter.state === 'landing' && previousState !== 'landing') this.events.push({ type: 'land', side: fighter.side, x: fighter.x });
    }

    this.faceOff();
    this.separate();
    if (this.phase === PHASE.FIGHT) { this.stepWeapons(); this.stepStrike(); }
    // A drone already in the air finishes its rake into the round-end freeze
    // rather than vanishing mid-beam, but it cannot start a new one.
    else if (this.strike) this.stepStrike();
    if (this.phase === PHASE.FIGHT || this.phase === PHASE.FINISHER_WINDOW) this.resolveHits();
    this.hazards.step(this);
    this.decayCombos();
    this.advancePhase();
    return this.events;
  }

  opponentOf(fighter) { return this.fighters[fighter.side === 0 ? 1 : 0]; }

  inputGate() {
    const allowInput = [false, false];
    const allowFinisher = [false, false];
    if (this.phase === PHASE.FIGHT) { allowInput[0] = true; allowInput[1] = true; }
    if (this.phase === PHASE.FINISHER_WINDOW && this.roundWinner !== null) {
      allowInput[this.roundWinner] = true;
      allowFinisher[this.roundWinner] = !FATALITY_REGISTRY[this.fighters[this.roundWinner].id];
    }
    return { allowInput, allowFinisher };
  }

  finisherMovementInput(raw = {}) {
    // The winner can position while entering the secret. Final command buttons
    // cannot accidentally punch the already defeated opponent out of the reel.
    return { left: raw.left, right: raw.right, down: raw.down, block: raw.block };
  }

  // Fighters turn to face each other, but not mid-move: flipping during an
  // active hitbox would swing the box through the opponent and hit backwards.
  faceOff() {
    const [a, b] = this.fighters;
    const want = Math.sign(b.x - a.x) || 1;
    for (const [f, dir] of [[a, want], [b, -want]]) {
      if (f.state === 'attack' || f.airborne || f.isHelpless()) continue;
      f.facing = dir;
    }
  }

  separate() {
    const [a, b] = this.fighters;
    const gap = Math.abs(b.x - a.x);
    if (gap >= PHYSICS.minSeparation) return;
    // Airborne fighters pass through each other so a jump-in can cross up.
    if (a.airborne || b.airborne) return;
    const push = (PHYSICS.minSeparation - gap) / 2;
    const dir = Math.sign(b.x - a.x) || 1;
    a.x -= push * dir;
    b.x += push * dir;
    a.x = Math.max(PHYSICS.arenaMin, Math.min(PHYSICS.arenaMax, a.x));
    b.x = Math.max(PHYSICS.arenaMin, Math.min(PHYSICS.arenaMax, b.x));
  }

  canContact(defender, move) {
    if (defender.state === 'finished') return false;
    if (move.id === 'finisher') return true;
    if (move.hit.level === 'throw')
      return !defender.airborne && !defender.isDowned() && defender.state !== 'getUp';
    if (defender.isStrikeInvulnerable()) return false;
    if (defender.isDowned()) return Boolean(move.hit.groundHit);
    if (defender.airborne)
      return move.hit.juggle !== false && defender.juggleHits < PHYSICS.maxJuggleHits;
    return true;
  }

  resolveHits() {
    const contacts = [];
    for (const attacker of this.fighters) {
      if (attacker.state !== 'attack' || attacker.moveHasHit) continue;
      const move = attacker.moveOf();
      if (move.projectile || move.overwatch || attacker.stageAxeMove || attacker.stageRingMove) continue;
      const f = attacker.moveFrame;
      if (f < move.startup || f >= move.startup + move.active) continue;

      const defender = this.opponentOf(attacker);
      if (!this.canContact(defender, move)) continue;

      const box = worldBox(move.hit.box, attacker.x, attacker.y, attacker.facing);
      const hurt = defender.hurtBox();
      if (!boxesOverlap(box, hurt)) continue;

      attacker.moveHasHit = true;
      contacts.push({ attacker, defender, move, box, hurt, stance: defender.blockStance(),
        counter: defender.state === 'attack' && defender.moveFrame < defender.moveOf().startup });
    }
    // Resolve simultaneous active hitboxes from the same pre-contact frame.
    for (const c of contacts) this.applyContact(c.attacker, c.defender, c.move, c.box, c.hurt, c);
  }

  applyContact(attacker, defender, move, box, hurt, defence) {
    // Recheck after earlier contacts: two projectiles in the same frame must
    // still respect the juggle limit and a newly grounded victim's protection.
    if (!this.canContact(defender, move)) return;
    const hit = move.hit;
    const grounded = defender.isDowned();
    const airborne = defender.airborne;
    const previousJuggleHits = defender.juggleHits;
    const point = {
      x: (Math.max(box.xMin, hurt.xMin) + Math.min(box.xMax, hurt.xMax)) / 2,
      y: (Math.max(box.yMin, hurt.yMin) + Math.min(box.yMax, hurt.yMax)) / 2,
    };

    const stance = defence.stance;
    const blocked = hit.level !== 'throw' && stance !== null && (
      hit.level === 'mid'
      || (hit.level === 'low' && stance === 'crouch')
      || (hit.level === 'overhead' && stance === 'stand')
    );

    const dir = attacker.facing;
    if (blocked) {
      const chip = Math.min(lethalHealth(defender), hit.chip);
      defender.health -= chip;
      defender.enterBlockStun(hit.blockStun);
      defender.pushX = dir * hit.push[1] * 0.7;
      attacker.pushX = -dir * hit.push[0] * 0.5;
      attacker.addMeter(hit.meter * 0.35);
      defender.addMeter(hit.meter * 0.55);
      this.hitStop = Math.max(this.hitStop, Math.round(hit.hitStop * 0.6));
      this.events.push({
        type: 'block', move: move.id, moveData: move,
        weapon: move.projectile?.kind || move.weapon, attacker: attacker.side, defender: defender.side,
        x: point.x, y: point.y, damage: chip, level: hit.level, facing: dir,
        bloodScale: hit.bloodScale, ko: defender.health <= 0,
      });
      return;
    }

    // Counter-hit: caught during another move's startup. Rewarding the read is
    // what stops both fighters from mashing buttons at point-blank range.
    const counter = defence.counter;
    if (attacker.state === 'attack' && attacker.move === move.id) attacker.moveLanded = true;
    const scale = Math.max(0.35, 1 - 0.11 * defender.comboCount);
    const positionScale = grounded ? GROUND_DAMAGE_SCALE
      : airborne ? Math.max(0.5, 1 - 0.12 * previousJuggleHits) : 1;
    const raw = hit.damage * scale * positionScale * (counter ? COUNTER_MULTIPLIER : 1);
    const damage = Math.min(lethalHealth(defender), Math.round(raw));
    defender.health -= damage;
    defender.comboCount += 1;
    defender.comboIdle = 0;
    defender.comboDamage += damage;
    defender.comboPeak = Math.max(defender.comboPeak, defender.comboCount);

    if (move.id === 'grab' && move.grabHold > 0) {
      attacker.state = 'grabbing';
      attacker.stateFrame = 0;
      attacker.grabHeld = 0;
      defender.enterGrabbed(move.grabHold + 6);
    } else if (move.id === 'finisher') {
      this.fatality = true;
      defender.health = 0;
      defender.move = null;
      defender.state = 'finished';
      defender.stateFrame = 0;
    } else if (grounded) {
      // Floor pressure costs health, not the victim's choice to recover. Do
      // not restart knockdown, erase a buffered recovery, or relaunch them.
      defender.pushX = dir * Math.min(0.08, hit.push[1] * 0.2);
      attacker.pushX = -dir * hit.push[0] * 0.5;
    } else if (airborne || hit.launch > 0) {
      const velocity = airborne
        ? Math.max(2.3, PHYSICS.jugglePop * (1 - 0.14 * previousJuggleHits))
        : hit.launch;
      defender.enterJuggle({ velocity, fresh: !airborne || previousJuggleHits === 0,
        push: dir * Math.min(1.5, hit.push[1] * 3) });
      // Keep a launched opponent close enough for a deliberate follow-up.
      attacker.pushX = -dir * hit.push[0] * 0.25;
    } else {
      defender.enterHitStun(hit.hitStun, hit.knockdown);
      defender.pushX = dir * hit.push[1];
      attacker.pushX = -dir * hit.push[0];
    }

    attacker.addMeter(hit.meter);
    defender.addMeter(hit.meter * 0.7);
    this.hitStop = Math.max(this.hitStop, hit.hitStop + (counter ? 3 : 0));

    this.events.push({
      type: move.id === 'finisher' ? 'finisher' : 'hit',
      move: move.id, moveData: move, attacker: attacker.side, defender: defender.side,
      weapon: move.projectile?.kind || move.weapon || null,
      x: point.x, y: point.y, damage, level: hit.level, counter,
      bloodScale: hit.bloodScale * (counter ? 1.3 : 1),
      ko: defender.health <= 0,
      knockdown: hit.knockdown, launched: !grounded && !airborne && hit.launch > 0,
      juggle: !grounded && (airborne || hit.launch > 0), grounded,
      juggleHits: defender.juggleHits, combo: defender.comboCount, facing: dir,
      comboDamage: defender.comboDamage, moveName: move.name, attackerId: attacker.id,
    });

    if (defender.health <= 0 && move.id === 'uppercut' && move.brutality !== false && defender.comboCount >= 3
      && attacker.roundsWon + 1 >= this.roundsToWin && this.phase === PHASE.FIGHT)
      this.pendingBrutality = { side: attacker.side };

    if (defender.health <= 0 && defender.state !== 'finished') {
      this.events.push({ type: 'ko', loser: defender.side, x: point.x, y: point.y });
    }
  }

  // Airborne hits remain one combo until landing. Choosing to lie on the floor
  // must not keep its count or damage scaling alive indefinitely.
  decayCombos() {
    for (const f of this.fighters) {
      if (!f.comboCount) continue;
      if (f.isDowned() || f.state === 'landing' || f.state === 'getUp') {
        this.endCombo(f);
      } else if (f.isActionable() || f.state === 'idle') {
        f.comboIdle = (f.comboIdle || 0) + 1;
        if (f.comboIdle > 6) this.endCombo(f);
      } else f.comboIdle = 0;
    }
  }

  endCombo(fighter) {
    if (fighter.comboCount >= 2) this.events.push({ type: 'comboEnd', attacker: 1 - fighter.side,
      defender: fighter.side, combo: fighter.comboCount, damage: fighter.comboDamage });
    fighter.comboCount = 0; fighter.comboIdle = 0; fighter.comboDamage = 0;
  }

  advancePhase() {
    const [a, b] = this.fighters;

    if (this.phase === PHASE.INTRO) {
      if (this.phaseFrame >= MATCH.introFrames) this.setPhase(PHASE.FIGHT);
      return;
    }

    if (this.phase === PHASE.FIGHT) {
      this.timerFrames += 1;
      if (this.timerFrames >= MATCH.ticksPerCount) {
        this.timerFrames = 0;
        this.timer = Math.max(0, this.timer - 1);
      }
      const dead = this.fighters.filter((f) => f.health <= 0);
      if (dead.length) {
        const loser = dead.length === 2 ? null : dead[0].side;
        this.endRound(loser === null ? null : (loser === 0 ? 1 : 0), dead.length === 2 ? 'double' : 'ko');
        return;
      }
      if (this.timer === 0) {
        const aRatio = a.health / a.maxHealth, bRatio = b.health / b.maxHealth;
        let winner = aRatio === bRatio ? null : (aRatio > bRatio ? 0 : 1);
        if (winner !== null && this.fighters[winner].cannotWin) winner = winner === 0 ? 1 : 0;
        this.endRound(winner, 'timeout');
      }
      return;
    }

    if (this.phase === PHASE.FINISHER_WINDOW) {
      const winner = this.fighters[this.roundWinner];
      if (this.fighters.some((f) => f.state === 'finished')) { this.setPhase(PHASE.FINISHER); return; }
      if (winner.state === 'attack' && winner.move === 'finisher') return;
      if (this.phaseFrame >= MATCH.finisherWindowFrames) this.finishMatch();
      return;
    }

    if (this.phase === PHASE.FINISHER) {
      if (this.finisher) {
        const script = FINISHER_SCRIPTS[this.finisher.script];
        const victim = this.fighters[this.finisher.defender];
        for (const beat of script.beats) if (this.phaseFrame === beat.frame) {
          this.events.push({ ...beat, type: 'finisherBeat', effectType: beat.type, finisherId: this.finisher.id,
            kind: this.finisher.kind, attacker: this.finisher.attacker, defender: victim.side,
            x: victim.x, y: 1.3, facing: this.finisher.facing });
        }
        if (this.phaseFrame === script.impactFrame) {
          victim.state = this.friendship ? 'defeat' : 'finished'; victim.stateFrame = 0;
          this.events.push({ type: 'finisher', finisherId: this.finisher.id, kind: this.finisher.kind,
            attacker: this.finisher.attacker, defender: victim.side, move: 'finisher',
            bloodScale: this.friendship ? 0 : 4, ko: !this.friendship,
            x: victim.x, y: 1.2, facing: this.finisher.facing, name: this.finisher.name });
        }
        if (this.phaseFrame >= script.duration) this.finishMatch();
      } else if (this.phaseFrame >= MATCH.roundEndFrames) this.finishMatch();
      return;
    }

    if (this.phase === PHASE.ROUND_END) {
      if (this.phaseFrame === REEL.koEnd) {
        if (this.pendingBrutality && this.roundWinner !== null) {
          this.startFinisher(BRUTALITY, this.roundWinner); return;
        }
        this.poseWinners();
      }
      if (this.phaseFrame < MATCH.roundEndFrames) return;
      if (this.pendingFinisher) {
        const winner = this.fighters[this.roundWinner];
        this.opponentOf(winner).enterDizzy();
        winner.state = 'idle'; winner.stateFrame = 0; winner.move = null;
        this.setPhase(PHASE.FINISHER_WINDOW);
        this.finishCommands.reset();
        winner.commands.reset();
        this.events.push({ type: 'finisherWindow', winner: this.roundWinner, frames: MATCH.finisherWindowFrames });
      }
      else if (this.matchDecided()) this.finishMatch();
      else this.startRound();
    }
  }

  setPhase(phase) {
    this.phase = phase;
    this.phaseFrame = 0;
  }

  endRound(winnerSide, reason) {
    this.roundWinner = winnerSide;
    this.roundReason = reason;
    if (winnerSide !== null) this.fighters[winnerSide].roundsWon += 1;
    this.events.push({ type: 'roundEnd', winner: winnerSide, reason, round: this.round });

    const winner = winnerSide === null ? null : this.fighters[winnerSide];
    this.flawless = Boolean(winner && winner.health === winner.maxHealth);
    this.brutality = Boolean(winner && this.pendingBrutality?.side === winnerSide && reason === 'ko');
    if (!this.brutality) this.pendingBrutality = null;
    this.pendingFinisher = Boolean(!this.brutality && this.matchDecided() && winner && reason === 'ko' && winner.meterStocks >= MATCH.finisherStocks);
    this.hitStop = 0;
    // Keep the impact states for the slow-motion and freeze sections of the reel.
    this.setPhase(PHASE.ROUND_END);
  }

  poseWinners() {
    for (const f of this.fighters) {
      f.state = this.roundWinner !== null && f.side === this.roundWinner ? 'victory' : 'defeat';
      f.stateFrame = 0; f.move = null; f.pushX = 0;
    }
  }

  stepWeapons() {
    for (const fighter of this.fighters) {
      if (fighter.state !== 'attack') { fighter.stageAxeMove = false; fighter.stageRingMove = false; continue; }
      // Down + grab at the left prop commits to a single, telegraphed axe toss.
      if (fighter.move === 'grab' && fighter.moveFrame === 0) {
        // One axe on the stage, one throw per round: whoever reaches the prop
        // first spends it for both fighters.
        fighter.stageAxeMove = this.stageId === STAGE_AXE_ZONE.stageId && !this.axeUsed
          && fighter.input.down && inStageAxeZone(fighter.x);
        if (fighter.stageAxeMove) this.axeUsed = true;
        fighter.stageRingMove = this.stageId === STAGE_AXE_ZONE.stageId && !this.ringUsed
          && fighter.input.down && inStageRingZone(fighter.x);
        if (fighter.stageRingMove) this.ringUsed = true;
      }
      const move = fighter.moveOf();
      const prop = fighter.stageAxeMove ? STAGE_AXE : fighter.stageRingMove ? STAGE_RING : null;
      if (fighter.moveFrame !== move.startup || fighter.moveHasHit) continue;
      if (move.overwatch) { fighter.moveHasHit = true; this.summonStrike(fighter, move); continue; }
      const spec = prop ? { kind: prop.weapon, speed: 5.5, life: 100, y: 1.1, radius: 0.24 } : move.projectile;
      if (!spec) continue;
      fighter.moveHasHit = true;
      const attack = prop || move;
      this.projectiles.push({ ...spec, id: ++this.nextProjectileId, owner: fighter.side,
        x: fighter.x + fighter.facing * 0.45, y: fighter.y + spec.y, facing: fighter.facing, move: attack, age: 0 });
    }
    const contacts = [];
    this.projectiles = this.projectiles.filter(p => {
      const previousX = p.x;
      p.x += p.speed * p.facing / 60; p.age++;
      const attacker = this.fighters[p.owner], defender = this.opponentOf(attacker);
      const hurt = defender.hurtBox();
      const box = { xMin: Math.min(previousX, p.x) - p.radius, xMax: Math.max(previousX, p.x) + p.radius,
        yMin: p.y - p.radius, yMax: p.y + p.radius };
      if (defender.health > 0 && this.canContact(defender, p.move) && boxesOverlap(box, hurt)) {
        contacts.push({ p, attacker, defender, box, hurt, stance: defender.blockStance(),
          counter: defender.state === 'attack' && defender.moveFrame < defender.moveOf().startup });
        return false;
      }
      return p.age < p.life && Math.abs(p.x) < PHYSICS.arenaMax + 1;
    });
    for (const c of contacts) {
      const facing = c.attacker.facing;
      c.attacker.facing = c.p.facing;
      this.applyContact(c.attacker, c.defender, c.p.move, c.box, c.hurt, c);
      c.attacker.facing = facing;
    }
  }

  // Overwatch. One drone in the air at a time -- the cooldown already
  // guarantees that for a single caster, and a mirror match should not be able
  // to stack two rakes into an inescapable cross.
  summonStrike(fighter, move) {
    if (this.strike) return;
    this.strike = createStrike({ owner: fighter.side, x: fighter.x, facing: fighter.facing,
      arenaMax: PHYSICS.arenaMax, move: OVERWATCH_BEAM });
    this.events.push({ type: 'droneSummon', side: fighter.side, x: fighter.x,
      facing: fighter.facing, move: move.id });
  }

  stepStrike() {
    const strike = this.strike;
    if (!strike) return;
    const previous = beamPhase(strike.age).phase;
    strike.age += 1;
    const { phase, t } = beamPhase(strike.age);
    if (phase !== previous) {
      // The renderer wants the transitions, not the frame count: it lights the
      // lens on `lock` and cracks the beam on `fire` without re-deriving the
      // timeline the solver already walked.
      const contact = contactAt(strike, phase === 'fire' ? 0 : 1);
      this.events.push({ type: 'droneBeat', beat: phase, side: strike.owner,
        x: contact, y: 0, facing: strike.facing });
    }
    if (strike.age >= BEAM.total) { this.strike = null; return; }
    if (phase !== 'fire' || strike.hasHit) return;

    const attacker = this.fighters[strike.owner], defender = this.opponentOf(attacker);
    if (defender.health <= 0 || !this.canContact(defender, strike.move)) return;
    const contact = contactAt(strike, t);
    const muzzle = muzzleAt(strike, contact);
    const hurt = defender.hurtBox();
    if (!segmentHitsBox(muzzle.x, muzzle.y, contact, 0, hurt, BEAM.thickness)) return;

    strike.hasHit = true;
    // The beam is a line; the contact point the effects layer wants is where it
    // crosses the victim, so report the victim's own centre height on it.
    const y = Math.max(hurt.yMin, Math.min(hurt.yMax, (hurt.yMin + hurt.yMax) / 2));
    const x = contact + strike.facing * (y / BEAM.slope);
    const box = { xMin: x - BEAM.thickness, xMax: x + BEAM.thickness,
      yMin: y - BEAM.thickness, yMax: y + BEAM.thickness };
    const facing = attacker.facing;
    attacker.facing = strike.facing;
    this.applyContact(attacker, defender, strike.move, box, hurt, {
      stance: defender.blockStance(),
      counter: defender.state === 'attack' && defender.moveFrame < defender.moveOf().startup,
    });
    attacker.facing = facing;
  }

  startFinisher(definition, attackerSide) {
    const attacker = this.fighters[attackerSide], defender = this.opponentOf(attacker);
    this.finisher = { ...definition, attacker: attackerSide, defender: defender.side,
      originX: (attacker.x + defender.x) / 2, facing: attacker.facing };
    if (COLD_CUT_ICE_ARMS && definition.id === 'carney-cold-cut' && ['officer_flock', 'trump'].includes(defender.id))
      this.finisher.script = 'cold-cut-flock';
    this.fatality = definition.kind === 'fatality' || definition.kind === 'stage';
    this.friendship = definition.kind === 'friendship';
    this.brutality = definition.kind === 'brutality';
    this.pendingFinisher = false;
    this.hitStop = 0;
    attacker.state = 'attack'; attacker.move = 'finisher'; attacker.moveFrame = 0;
    attacker.stateFrame = 0; attacker.pushX = 0; attacker.y = 0; attacker.airborne = false;
    defender.enterDizzy(); defender.pushX = 0; defender.y = 0; defender.airborne = false;
    this.setPhase(PHASE.FINISHER);
    this.events.push({ type: 'finisherStart', finisher: this.finisher, finisherId: definition.id,
      kind: definition.kind, attacker: attackerSide, defender: defender.side });
  }

  matchDecided() {
    return this.fighters.some((f) => f.roundsWon >= this.roundsToWin)
      || this.round >= this.maxRounds;
  }

  finishMatch() {
    const [a, b] = this.fighters;
    this.winner = a.roundsWon === b.roundsWon ? null : (a.roundsWon > b.roundsWon ? 0 : 1);
    if (this.winner !== null) {
      this.fighters[this.winner].state = 'victory';
      this.opponentOf(this.fighters[this.winner]).state =
        this.opponentOf(this.fighters[this.winner]).state === 'finished' ? 'finished' : 'defeat';
    }
    this.setPhase(PHASE.MATCH_END);
    this.events.push({ type: 'matchEnd', winner: this.winner });
  }

  // The beam as the renderer needs it: resolved world geometry rather than the
  // age the solver keeps, so the drone, the muzzle and the floor contact all
  // come from one place and cannot drift apart by a frame.
  strikeView() {
    const strike = this.strike;
    if (!strike) return null;
    const { phase, t } = beamPhase(strike.age);
    const contact = contactAt(strike, phase === 'deploy' || phase === 'lock' ? 0 : phase === 'fire' ? t : 1);
    const muzzle = muzzleAt(strike, contact);
    return { owner: strike.owner, facing: strike.facing, phase, t, age: strike.age,
      spent: strike.hasHit, contactX: contact, muzzleX: muzzle.x, muzzleY: muzzle.y };
  }

  // Sides that could throw the Lake America axe this frame: in range, on the
  // ground, and free to start a grab. The HUD filters this list to humans.
  axePromptSides() {
    if (this.phase !== PHASE.FIGHT || this.stageId !== STAGE_AXE_ZONE.stageId || this.axeUsed) return [];
    return this.fighters.filter(f => f.isActionable() && !f.airborneNow && inStageAxeZone(f.x)).map(f => f.side);
  }

  ringPromptSides() {
    if (this.phase !== PHASE.FIGHT || this.stageId !== STAGE_AXE_ZONE.stageId || this.ringUsed) return [];
    return this.fighters.filter(f => f.isActionable() && !f.airborneNow && inStageRingZone(f.x)).map(f => f.side);
  }

  // A flat snapshot for the HUD, the CPU, and the browser-agent tools. Keeping
  // one reader shape means the AI cannot see anything a player cannot.
  snapshot() {
    const [a, b] = this.fighters;
    const view = (f) => ({
      id: f.id, label: f.label, side: f.side,
      health: f.health, maxHealth: f.maxHealth, healthPct: f.health / f.maxHealth,
      combatKit: f.kit.id, archetype: f.kit.archetype,
      meter: f.meter, stocks: f.meterStocks, meterPct: f.meter / (MATCH.meterMax * MATCH.meterUnitsPerStock),
      roundsWon: f.roundsWon, state: f.state, stateFrame: f.stateFrame, move: f.move, moveFrame: f.moveFrame,
      moveData: f.move ? f.moveOf() : null,
      x: f.x, y: f.y, facing: f.facing, crouching: f.crouching, airborne: f.airborne,
      comboCount: f.comboCount, comboDamage: f.comboDamage, comboPeak: f.comboPeak,
      juggleHits: f.juggleHits, juggleGravity: f.juggleGravity,
      recovery: f.recovery, recoveryReady: f.recoveryReady, stunFrames: f.stunFrames,
      rangedCooldown: f.cooldowns.ranged || 0,
      // Every group, not just the throws: a kit that invents a cooldown should
      // constrain the CPU without the AI having to learn the group's name.
      cooldowns: { ...f.cooldowns },
    });
    return {
      phase: this.phase, phaseFrame: this.phaseFrame, round: this.round, hitStop: this.hitStop,
      timer: this.timer, winner: this.winner, roundWinner: this.roundWinner,
      roundReason: this.roundReason, flawless: this.flawless, fatality: this.fatality, roundsToWin: this.roundsToWin,
      brutality: this.brutality, friendship: this.friendship, finisher: this.finisher, stageId: this.stageId,
      hazard: this.hazards.snapshot(this.phase), hazardsEnabled: this.hazards.enabled,
      distance: Math.abs(b.x - a.x),
      projectiles: this.phase === PHASE.FIGHT ? this.projectiles.map(({ move, ...p }) => p) : [],
      strike: this.strikeView(),
      axeUsed: this.axeUsed,
      ringUsed: this.ringUsed,
      ringPrompt: this.ringPromptSides(),
      axePrompt: this.axePromptSides(),
      fighters: [view(a), view(b)],
    };
  }
}

export { MATCH, PHYSICS, BODY };
