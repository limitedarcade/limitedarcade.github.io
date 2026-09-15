import { directionalFor, directionalMove } from './moveList.js';
// One fighter's simulation state, advanced at a fixed 60 Hz.
//
// This file knows nothing about Three.js, the DOM, or wall-clock time. It takes
// a frame of button flags and produces the next frame of state, which is what
// makes the CPU and a human interchangeable: `ai.js` returns the same struct a
// keyboard does, and neither can reach anything the other cannot.
//
// Hit *resolution* lives in match.js, because it needs both fighters. What
// lives here is everything a fighter can decide on its own.

import { MOVES, PHYSICS, BODY, MATCH, moveOf } from './frameData.js';
import { CommandResolver, moveForAttack, emptyInput, cloneInput } from './commands.js';
import { combatKitFor } from '../fighters/combatKits.js';
import { DirectionTapBuffer } from './movementInput.js';

// States that accept a new action this frame. Everything else is committed.
const ACTIONABLE = new Set(['idle', 'walkF', 'walkB', 'sprint', 'crouch', 'blockStand', 'blockCrouch']);
// States where the fighter is helpless: no block, no counter-hit distinction.
const HELPLESS = new Set(['hitStun', 'knockdown', 'downed', 'getUp', 'juggle', 'grabbed', 'dizzy', 'finished']);

export class Fighter {
  constructor({ id, side, label, combatKit }) {
    this.id = id;
    this.side = side;                 // 0 = left at round start, 1 = right
    this.label = label || id;
    this.kit = combatKitFor(id, combatKit);
    this.moves = this.kit.moves;
    this.physics = this.kit.physics;
    this.maxHealth = this.kit.maxHealth;
    this.commands = new CommandResolver();
    this.directionTaps = new DirectionTapBuffer(PHYSICS.doubleTapFrames);
    this.input = emptyInput();
    this.resetRound(side === 0 ? -PHYSICS.startSeparation / 2 : PHYSICS.startSeparation / 2);
    this.meter = 0;
    this.roundsWon = 0;
  }

  resetRound(x) {
    this.cooldowns = {};
    this.stageAxeMove = false;
    this.stageRingMove = false;
    this.x = x;
    this.y = 0;
    this.vy = 0;
    this.jumpVX = 0;
    this.juggleHits = 0;
    this.juggleGravity = PHYSICS.gravity;
    this.recovery = null;
    this.recoveryDirection = 0;
    this.stunFrames = 0;
    this.facing = x <= 0 ? 1 : -1;
    this.health = this.maxHealth;
    this.state = 'intro';
    this.stateFrame = 0;
    this.move = null;
    this.moveFrame = 0;
    this.moveHasHit = false;
    this.moveLanded = false;
    this.bufferedAction = null;
    this.stoppedCommand = null;
    this.crouching = false;
    this.airborne = false;
    this.hitStop = 0;
    this.comboCount = 0;
    this.comboDamage = 0;
    this.comboPeak = 0;
    this.comboIdle = 0;
    this.blockedLast = false;
    this.pushX = 0;
    this.grabHeld = 0;
    this.commands.reset();
    this.directionTaps.reset();
    this.input = emptyInput();
  }

  get airborneNow() { return this.y > 0.001; }
  get topY() {
    if (this.airborne) return BODY.airTop;
    if (this.isDowned() || (this.state === 'getUp' && this.recovery !== 'stand' && this.stateFrame < this.stunFrames * 0.65)) return 0.58;
    return this.crouching ? BODY.crouchTop : BODY.standTop;
  }

  hurtBox() {
    return {
      xMin: this.x - BODY.halfWidth, xMax: this.x + BODY.halfWidth,
      yMin: this.y, yMax: this.y + this.topY,
    };
  }

  isActionable() { return ACTIONABLE.has(this.state); }
  isHelpless() { return HELPLESS.has(this.state); }
  isDowned() { return !this.airborne && (this.state === 'knockdown' || this.state === 'downed'); }
  get recoveryReady() { return this.state === 'downed'; }
  isStrikeInvulnerable() {
    return (this.state === 'knockdown' && this.stateFrame < PHYSICS.knockdownProtectionFrames)
      || (this.state === 'getUp' && this.stateFrame < PHYSICS.wakeInvulnerableFrames);
  }

  // Blocking is a stance the defender is already in when the hit lands -- there
  // is no reaction window and no block button pressed "in time". Holding back
  // also blocks, so a player who never finds the block button still defends.
  blockStance() {
    if (!this.airborne && this.state === 'attack') {
      const move = this.moveOf();
      if (move.guardWindow && this.moveFrame >= move.guardWindow[0] && this.moveFrame < move.guardWindow[1]) {
        return move.guardStance || 'stand';
      }
    }
    if (this.airborne || !ACTIONABLE.has(this.state)) return null;
    const holdingBack = this.facing > 0 ? this.input.left : this.input.right;
    if (!this.input.block && !holdingBack) return null;
    return this.input.down ? 'crouch' : 'stand';
  }

  addMeter(units) {
    this.meter = Math.min(MATCH.meterMax * MATCH.meterUnitsPerStock, this.meter + units);
  }

  get meterStocks() { return Math.floor(this.meter / MATCH.meterUnitsPerStock); }
  moveOf(id = this.move) {
    const move = moveOf(id, this);
    return (this.stageAxeMove || this.stageRingMove) && id === 'grab' ? { ...move, startup: 24, active: 1, recovery: 35, cancelInto: [] } : move;
  }

  // Which move a press becomes, once the kit's own directional commands are in
  // the table. A kit-specific command that resolves to a move this fighter does
  // not own falls back to the ordinary button, so the shared tables can never
  // hand anyone a move id their move list cannot answer.
  buttonMove(attack, input) {
    const directional = directionalMove(attack, input, this.facing, directionalFor(this.kit));
    if (directional && this.moves[directional]) return directional;
    return moveForAttack(attack, { crouching: this.crouching, airborne: false });
  }

  startMove(id) {
    const definition = this.moveOf(id);
    const group = definition.cooldownGroup || id;
    if (this.cooldowns[group] > 0) return false;
    const cost = (this.moveOf(id).cost || 0) * MATCH.meterUnitsPerStock;
    if (this.meter < cost) return false;
    this.meter -= cost;
    if (definition.cooldown) this.cooldowns[group] = definition.cooldown;
    this.move = id;
    this.stageAxeMove = false;
    this.stageRingMove = false;
    this.moveFrame = 0;
    this.moveHasHit = false;
    this.moveLanded = false;
    this.bufferedAction = null;
    this.state = 'attack';
    this.stateFrame = 0;
    this.directionTaps.reset();
    return true;
  }

  // A committed reaction, called by match.js when a hit resolves.
  enterHitStun(frames, knockdown) {
    this.bufferedAction = null;
    // External effects may hurt someone on the floor but must not stand them up.
    if (this.isDowned()) return;
    if (this.airborne) { this.enterJuggle({ velocity: Math.max(this.vy, PHYSICS.jugglePop), push: this.jumpVX || 0 }); return; }
    this.move = null;
    this.state = knockdown ? 'knockdown' : 'hitStun';
    this.stateFrame = 0;
    this.stunFrames = knockdown ? PHYSICS.knockdownFrames : frames;
    this.crouching = false;
    this.recovery = null;
    this.directionTaps.reset();
  }

  enterJuggle({ velocity = PHYSICS.juggleLaunch, push = 0, fresh = false } = {}) {
    this.bufferedAction = null; this.stoppedCommand = null;
    this.juggleHits = (fresh ? 0 : this.juggleHits) + 1;
    this.juggleGravity = PHYSICS.gravity * (1 + PHYSICS.juggleGravityStep * (this.juggleHits - 1));
    this.move = null;
    this.state = 'juggle'; this.stateFrame = 0;
    this.crouching = false; this.airborne = true;
    this.y = Math.max(0.08, this.y); this.vy = velocity; this.jumpVX = push; this.pushX = 0;
    this.recovery = null;
    this.commands.pending = null; this.directionTaps.reset();
  }

  beginRecovery(ctx) {
    const input = this.input;
    if (input.down) return;
    const horizontal = Number(input.right) - Number(input.left);
    if (!input.up && !input.block && !horizontal) return;
    const facing = Math.sign(ctx.opponentX - this.x) || this.facing;
    this.facing = facing;
    this.recovery = input.up || input.block ? 'stand' : horizontal === facing ? 'forward' : 'back';
    this.recoveryDirection = this.recovery === 'stand' ? 0 : horizontal;
    this.stunFrames = this.recovery === 'stand' ? PHYSICS.getUpFrames : PHYSICS.rollFrames;
    this.state = 'getUp'; this.stateFrame = 0;
    this.pushX = 0; this.commands.pending = null; this.directionTaps.reset();
    ctx.events.push({ type: 'recovery', side: this.side, recovery: this.recovery, x: this.x });
  }

  enterBlockStun(frames) {
    this.bufferedAction = null; this.stoppedCommand = null;
    this.state = 'blockStun';
    this.stateFrame = 0;
    this.stunFrames = frames;
  }

  enterGrabbed(frames) {
    this.move = null;
    this.state = 'grabbed';
    this.stateFrame = 0;
    this.stunFrames = frames;
  }

  enterDizzy() {
    this.move = null;
    this.state = 'dizzy';
    this.stateFrame = 0;
    this.stunFrames = PHYSICS.dizzyFrames;
  }

  // ctx: { input, allowInput, allowFinisher, opponentX, events }
  captureStoppedInput(raw) {
    const command = this.commands.step(raw);
    if (command.attack || command.macro) this.stoppedCommand = command;
  }

  step(ctx) {
    const events = ctx.events;
    this.input = cloneInput(ctx.input);
    const fresh = this.commands.step(ctx.input);
    const { attack, macro } = (fresh.attack || fresh.macro) ? fresh : this.stoppedCommand || fresh;
    this.stoppedCommand = null;
    if (this.bufferedAction && --this.bufferedAction.frames <= 0) this.bufferedAction = null;
    // One pending command, six simulation frames. Store the intended move now:
    // releasing a direction before recovery must not change the queued attack.
    if (ctx.allowInput && this.state === 'attack' && (attack || (macro && macro !== 'finisher'))) {
      this.bufferedAction = { attack, macro, frames: 6,
        move: macro || this.buttonMove(attack, this.input),
        neutral: !this.input.left && !this.input.right && !this.input.down && !this.input.up && !this.input.block };
    }
    const burst = this.directionTaps.step(this.input, this.facing,
      ctx.allowInput && !this.airborne && this.isActionable() && !this.commands.pending
      && !['lp', 'hp', 'lk', 'hk'].some(button => this.input[button]));
    this.stateFrame += 1;

    if (!ctx.allowInput) {
      this.bufferedAction = null;
      // Intro, round-end and cinematic phases: physics still settles the body
      // so nobody is left floating, but nothing new can be started.
      this.applyPhysics();
      return;
    }
    for (const key of Object.keys(this.cooldowns)) this.cooldowns[key] = Math.max(0, this.cooldowns[key] - 1);

    switch (this.state) {
      case 'intro':
        this.state = 'idle';
        break;

      case 'attack': {
        const move = this.moveOf();
        this.moveFrame += 1;
        if (move.travel && this.moveFrame <= move.startup + move.active) this.x += move.travel * this.facing / 60;
        const total = move.startup + move.active + move.recovery;
        // Confirm actual damage, not merely box contact: blocked strikes do
        // not grant the assisted chain or erase their punishable recovery.
        if (this.moveLanded && move.cancelInto.length) {
          const [from, to] = move.cancelWindow;
          if (this.moveFrame >= from && this.moveFrame <= to) {
            const next = this.pickCancel(move, attack, macro);
            if (next && this.startMove(next)) break;
          }
        }
        if (this.moveFrame >= total) {
          this.move = null;
          this.state = this.airborneNow ? 'jump' : 'idle';
          this.stateFrame = 0;
          const queued = this.bufferedAction;
          this.bufferedAction = null;
          if (queued && !this.airborneNow) this.startMove(queued.move);
        }
        break;
      }

      case 'grabbing': {
        this.grabHeld += 1;
        // Both kicks during the hold converts the grab into the throw. That
        // conversion is the whole point of having two separate grapple buttons.
        if (macro === 'throw') {
          this.startMove('throw');
          this.grabHeld = 0;
          events.push({ type: 'grabConvert', side: this.side });
          break;
        }
        if (this.grabHeld >= this.moves.grab.grabHold) {
          this.grabHeld = 0;
          this.state = 'idle';
          this.stateFrame = 0;
          events.push({ type: 'grabRelease', side: this.side });
        }
        break;
      }

      case 'hitStun':
      case 'blockStun':
      case 'grabbed':
        if (this.stateFrame >= this.stunFrames) { this.state = 'idle'; this.stateFrame = 0; }
        break;

      case 'knockdown':
        if (!this.airborne && this.stateFrame >= this.stunFrames) {
          this.state = 'downed'; this.stateFrame = 0;
          this.beginRecovery(ctx);
        }
        break;

      case 'downed':
        this.beginRecovery(ctx);
        break;

      case 'getUp':
        this.x += this.recoveryDirection * PHYSICS.rollDistance / PHYSICS.rollFrames;
        if (this.stateFrame >= this.stunFrames) {
          this.state = this.input.block ? (this.input.down ? 'blockCrouch' : 'blockStand') : 'idle';
          this.crouching = Boolean(this.input.block && this.input.down);
          this.stateFrame = 0; this.recovery = null; this.recoveryDirection = 0;
          this.commands.pending = null; this.directionTaps.reset();
        }
        break;

      case 'juggle':
      case 'backHop':
        break;

      case 'dizzy':
      case 'finished':
      case 'victory':
      case 'defeat':
        break;

      case 'landing':
        if (this.stateFrame >= PHYSICS.landRecovery) { this.state = 'idle'; this.stateFrame = 0; }
        break;

      case 'jump':
        if (attack || macro === 'grab') this.startMove('jumpAttack');
        break;

      default:
        this.handleGround(ctx, attack, macro, burst);
        break;
    }

    this.applyPhysics();
  }

  pickCancel(move, attack, macro) {
    const queued = this.bufferedAction;
    if (queued) {
      const assisted = queued.neutral && this.kit.easyChains?.[move.id]?.[queued.attack];
      const next = assisted || queued.move;
      return move.cancelInto.includes(next) ? next : null;
    }
    if (macro === 'grab' && move.cancelInto.includes('grab')) return 'grab';
    if (macro === 'throw' && move.cancelInto.includes('throw')) return 'throw';
    if (!attack) return null;
    const next = this.buttonMove(attack, this.input);
    return move.cancelInto.includes(next) ? next : null;
  }

  handleGround(ctx, attack, macro, burst) {
    const input = this.input;

    if (macro === 'finisher') {
      if (ctx.allowFinisher) { this.startMove('finisher'); return; }
      // Outside the window the command is inert rather than eating the input --
      // a mistimed finisher should not also cost you your guard.
    }

    this.crouching = Boolean(input.down) && !this.airborne;

    if (macro && macro !== 'finisher' && this.moves[macro]) {
      if (this.startMove(macro)) return;
      ctx.events.push({ type: 'meterRequired', side: this.side, stocks: this.moves[macro].cost });
    }
    if (attack) { this.startMove(this.buttonMove(attack, input)); return; }

    if (input.up && !this.crouching) {
      const forward = Number(input.right) - Number(input.left);
      this.vy = this.physics.jumpVelocity;
      this.y = 0.0001;
      this.airborne = true;
      this.jumpVX = Math.sign(forward) * this.physics.jumpForwardSpeed * (forward === 0 ? 0 : 1);
      this.state = 'jump';
      this.stateFrame = 0;
      ctx.events.push({ type: 'jump', side: this.side, x: this.x });
      return;
    }

    const stance = this.blockStance();
    if (stance && (input.block || this.crouching)) { this.state = stance === 'crouch' ? 'blockCrouch' : 'blockStand'; return; }
    if (this.crouching) { this.state = 'crouch'; return; }

    const dir = Number(input.right) - Number(input.left);
    if (dir === 0) { this.state = 'idle'; return; }
    const forward = dir === this.facing;
    if (burst === 'backHop' && !forward) {
      this.state = 'backHop'; this.stateFrame = 0;
      this.vy = PHYSICS.backHopVelocity; this.y = 0.0001; this.airborne = true;
      this.jumpVX = -this.facing * PHYSICS.backHopSpeed;
      ctx.events.push({ type: 'backHop', side: this.side, x: this.x });
      return;
    }
    if (forward && (burst === 'sprint' || this.state === 'sprint')) {
      if (this.state !== 'sprint') {
        this.stateFrame = 0; ctx.events.push({ type: 'sprint', side: this.side, x: this.x });
      }
      this.state = 'sprint';
      this.x += dir * this.physics.walkForward * PHYSICS.sprintMultiplier / 60;
      return;
    }
    this.state = forward ? 'walkF' : 'walkB';
    this.x += dir * (forward ? this.physics.walkForward : this.physics.walkBack) * (1 / 60);
  }

  applyPhysics() {
    if (this.airborne) {
      this.vy -= (this.state === 'juggle' ? this.juggleGravity : PHYSICS.gravity) * (1 / 60);
      this.y += this.vy * (1 / 60);
      this.x += (this.jumpVX || 0) * (1 / 60);
      if (this.y <= 0) {
        this.y = 0;
        this.vy = 0;
        this.airborne = false;
        this.jumpVX = 0;
        if (this.state === 'juggle') {
          this.state = 'knockdown'; this.stateFrame = 0; this.stunFrames = PHYSICS.knockdownFrames;
          this.juggleHits = 0; this.juggleGravity = PHYSICS.gravity;
          this.commands.pending = null; this.directionTaps.reset();
        } else if (this.state === 'jump' || this.state === 'attack' || this.state === 'backHop') {
          this.move = null;
          this.state = 'landing';
          this.stateFrame = 0;
        }
      }
    }
    if (this.pushX) {
      this.x += this.pushX;
      this.pushX *= 0.62;
      if (Math.abs(this.pushX) < 0.002) this.pushX = 0;
    }
    this.x = Math.max(PHYSICS.arenaMin, Math.min(PHYSICS.arenaMax, this.x));
  }
}
