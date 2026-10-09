import { ComboPlayback } from '../engine/comboPlayback.js';

const FAILURE_COPY = Object.freeze({
  blocked: 'Blocked', resource: 'Need route stock', interruption: 'Interrupted',
  'different-move': 'Different move', 'wrong-contact': 'Wrong contact',
  'combo-gap': 'Too late: opponent recovered', 'dropped-juggle': 'Too late: opponent landed',
  timeout: 'Out of range or too late', 'phase-change': 'Attempt ended', unavailable: 'Attempt unavailable',
});

function sameKeys(expected, actual) {
  return expected.length === actual.length && expected.every(key => actual.includes(key));
}

// Pure attempt state. It never mutates a match: Watch delegates button output
// to ComboPlayback, while Try requires both the submitted press and the real
// attack/contact events before a step can be checked off.
export class ComboPracticeSession {
  constructor({ route, actorSide = 0, kitId, mode = 'try' }) {
    this.route = route; this.actorSide = actorSide; this.kitId = kitId; this.mode = mode;
    this.playback = mode === 'watch' ? new ComboPlayback({ route, actorSide, kitId }) : null;
    this.reset();
  }

  reset() {
    this.stepIndex = 0; this.pressedSteps = 0; this.confirmedSteps = 0;
    this.state = 'active'; this.reason = null; this.damage = 0; this.comboId = null;
    this.previousKeys = [];
    this.playback?.reset();
  }

  get done() { return this.state === 'complete' || this.state === 'failed'; }
  get feedback() { return this.state === 'complete' ? `${this.route.name} complete · ${this.damage} damage`
    : this.state === 'failed' ? (FAILURE_COPY[this.reason] || 'Attempt failed') : '';
  }

  poll(snapshot) { return this.playback?.poll(snapshot) || null; }

  input(input) {
    if (this.done || this.mode !== 'try') return;
    const keys = Object.keys(input || {}).filter(key => input[key] && !['start', 'pause'].includes(key));
    if (!keys.length) { this.previousKeys = []; return; }
    if (this.previousKeys.length) return;
    this.previousKeys = keys;
    const step = this.route.steps[this.pressedSteps];
    if (!step || !sameKeys(step.keys, keys)) { this.fail('different-move'); return; }
    this.pressedSteps += 1;
  }

  observe(events, snapshot) {
    if (this.done) return;
    if (this.mode === 'watch') {
      this.playback.observe(events, snapshot);
      if (this.playback.state === 'aborted') this.fail(this.playback.reason);
    }
    for (const event of events || []) {
      if (event.type === 'block' && event.attacker === this.actorSide) { this.fail('blocked'); return; }
      if (event.type === 'meterRequired' && event.side === this.actorSide) { this.fail('resource'); return; }
      if (event.type === 'hit' && event.defender === this.actorSide) { this.fail('interruption'); return; }
      if (event.type === 'comboEnd' && event.attacker === this.actorSide && this.state === 'active') {
        this.fail(event.reason === 'landing' ? 'dropped-juggle' : 'combo-gap'); return;
      }
      if (event.type !== 'comboRouteComplete' || event.side !== this.actorSide || event.routeId !== this.route.id) continue;
      if (this.mode === 'try' && this.pressedSteps < this.route.steps.length) { this.fail('different-move'); return; }
      this.confirmedSteps = this.route.steps.length; this.damage = event.damage; this.comboId = event.comboId;
      this.state = 'complete'; return;
    }
    this.confirmedSteps = Math.max(this.confirmedSteps, Math.min(this.route.steps.length,
      (events || []).filter(e => e.type === 'hit' && e.attacker === this.actorSide).length + this.confirmedSteps));
  }

  fail(reason) { if (!this.done) { this.state = 'failed'; this.reason = reason; } }
}
