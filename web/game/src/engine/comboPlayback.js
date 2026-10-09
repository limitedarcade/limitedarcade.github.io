import { emptyInput } from './commands.js';

function inputFor(keys, actor) {
  const input = emptyInput();
  for (const key of keys) {
    if (key === 'forward') input[actor.facing > 0 ? 'right' : 'left'] = true;
    else if (key === 'back') input[actor.facing > 0 ? 'left' : 'right'] = true;
    else if (key in input) input[key] = true;
  }
  return input;
}

function validContact(step, event) {
  if (event.move !== step.expectedMove) return false;
  if (step.contact === 'launch') return event.launched === true;
  if (step.contact === 'air') return event.juggle === true && event.launched !== true && event.grounded !== true;
  return event.juggle !== true && event.grounded !== true;
}

export class ComboPlayback {
  constructor({ route, actorSide = 0, kitId = null } = {}) {
    if (!route) throw new Error('ComboPlayback requires a route');
    this.route = route;
    this.actorSide = actorSide;
    this.kitId = kitId;
    this.reset();
  }

  reset() {
    this.stepIndex = 0;
    this.state = 'press';
    this.reason = null;
    this.expectedAttackId = null;
    this.expectedComboId = null;
    this.combatTicks = 0;
    this.inputTicks = 0;
    this.transitionTicks = 0;
    this.preflightComplete = false;
  }

  abort(reason) {
    if (this.state === 'finished' || this.state === 'aborted') return;
    this.state = 'aborted';
    this.reason = reason;
  }

  get done() { return this.state === 'finished' || this.state === 'aborted'; }

  transition() {
    const kitTiming = this.route.timingByKit[this.kitId]
      || this.route.timingByKit[Object.keys(this.route.timingByKit)[0]];
    return kitTiming.transitions[this.stepIndex - 1];
  }

  poll(snapshot) {
    this.inputTicks += 1;
    if (this.done) return emptyInput();
    if (!snapshot || snapshot.phase !== 'fight') {
      this.abort('phase-change');
      return emptyInput();
    }
    const actor = snapshot.fighters?.[this.actorSide];
    const defender = snapshot.fighters?.[1 - this.actorSide];
    if (!actor || !defender || actor.health <= 0 || defender.health <= 0) {
      this.abort('unavailable');
      return emptyInput();
    }
    if (!this.preflightComplete) {
      this.preflightComplete = true;
      if (actor.stocks < this.route.setup.stocks) {
        this.abort('resource');
        return emptyInput();
      }
    }

    const frozen = snapshot.hitStop > 0;
    if (!frozen) {
      this.combatTicks += 1;
      if (this.state === 'wait-for-contact' || this.state === 'wait-for-recovery') this.transitionTicks += 1;
    }

    if (this.state === 'wait-for-recovery') {
      const transition = this.transition();
      if (transition && this.transitionTicks > transition.timeout) this.abort('timeout');
      else if (actor.state === 'idle' || ['walkF', 'walkB', 'crouch', 'blockStand', 'blockCrouch'].includes(actor.state)) {
        if (this.route.kind === 'juggle' && !defender.airborne) this.abort('dropped-juggle');
        else this.state = 'press';
      }
    } else if (this.state === 'wait-for-contact') {
      const transition = this.stepIndex > 0 ? this.transition() : null;
      const timeout = transition?.timeout || 72;
      if (this.transitionTicks > timeout) this.abort('timeout');
    }

    if (this.state === 'press') {
      const output = inputFor(this.route.steps[this.stepIndex].keys, actor);
      this.state = 'release';
      return output;
    }
    if (this.state === 'release') {
      // Release is an input-sampling action and must happen even in hitstop.
      this.state = 'wait-for-contact';
      this.transitionTicks = 0;
      return emptyInput();
    }
    return emptyInput();
  }

  observe(events, snapshot) {
    if (this.done) return;
    if (snapshot?.phase && snapshot.phase !== 'fight') { this.abort('phase-change'); return; }
    const step = this.route.steps[this.stepIndex];
    for (const event of events || []) {
      if (event.type === 'roundEnd' || event.type === 'matchEnd') { this.abort('phase-change'); return; }
      if (event.type === 'meterRequired' && event.side === this.actorSide) { this.abort('resource'); return; }
      if (event.type === 'hit' && event.defender === this.actorSide) { this.abort('interruption'); return; }
      if (event.type === 'attack' && event.side === this.actorSide) {
        if (event.move !== step.expectedMove) { this.abort('different-move'); return; }
        this.expectedAttackId = event.attackId;
      }
      if (event.attacker !== this.actorSide) continue;
      if (event.type === 'block' && (!this.expectedAttackId || event.attackId === this.expectedAttackId)) {
        this.abort('blocked'); return;
      }
      if (event.type !== 'hit') continue;
      if (event.attackId !== this.expectedAttackId || !validContact(step, event)) {
        this.abort(event.move === step.expectedMove ? 'wrong-contact' : 'different-move'); return;
      }
      if (this.expectedComboId !== null && event.comboId !== this.expectedComboId) {
        this.abort('combo-gap'); return;
      }
      if (this.expectedComboId === null) this.expectedComboId = event.comboId;
      this.stepIndex += 1;
      this.expectedAttackId = null;
      this.transitionTicks = 0;
      if (this.stepIndex >= this.route.steps.length) {
        this.state = 'finished';
        return;
      }
      this.state = this.transition().gate === 'recovery' ? 'wait-for-recovery' : 'press';
      return;
    }
  }
}
