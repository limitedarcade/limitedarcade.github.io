import { chordMove } from './moveList.js';

// Raw held-button flags in, committed commands out.
//
// Grab is both punches and throw is both kicks, so a punch cannot be committed
// on the frame it is pressed: the partner button may still be on its way. The
// resolver holds a single attack for `macroWindow` frames before committing it,
// so all fingers in a two-, three-, or four-button chord can arrive before it
// commits. Three simulation frames give a short finger-roll tolerance.

export const BUTTONS = Object.freeze(['left', 'right', 'up', 'down', 'lp', 'hp', 'lk', 'hk', 'block', 'start']);

export const ATTACK_BUTTONS = Object.freeze(['lp', 'hp', 'lk', 'hk']);

export const ATTACK_PARTNER = Object.freeze({ lp: 'hp', hp: 'lp', lk: 'hk', hk: 'lk' });
export const ATTACK_MACRO = Object.freeze({ lp: 'grab', hp: 'grab', lk: 'throw', hk: 'throw' });

export function emptyInput() {
  const out = {};
  for (const b of BUTTONS) out[b] = false;
  return out;
}

export function cloneInput(src) {
  const out = {};
  for (const b of BUTTONS) out[b] = Boolean(src?.[b]);
  return out;
}

export class CommandResolver {
  constructor({ macroWindow = 3 } = {}) {
    this.macroWindow = macroWindow;
    this.reset();
  }
  reset() { this.previous = emptyInput(); this.pending = null; }
  step(raw) {
    const now = cloneInput(raw), edges = {};
    for (const b of BUTTONS) edges[b] = now[b] && !this.previous[b];
    this.previous = now;
    if (now.block && (edges.hp || (edges.block && now.hp))) {
      this.pending = null;
      return { attack: null, macro: 'finisher', edges };
    }
    const pressed = ATTACK_BUTTONS.filter(b => edges[b]);
    if (pressed.length) {
      if (!this.pending) this.pending = { buttons: new Set(), age: 0 };
      for (const b of ATTACK_BUTTONS) if (now[b]) this.pending.buttons.add(b);
      for (const b of pressed) this.pending.buttons.add(b);
    }
    // Wait for the complete chord. Resolving a pair immediately would swallow
    // three/four-button chords when fingers land on adjacent polling frames.
    if (this.pending && ++this.pending.age > this.macroWindow) {
      const buttons = [...this.pending.buttons];
      this.pending = null;
      return { attack: buttons.length === 1 ? buttons[0] : null, macro: chordMove(buttons), edges };
    }
    return { attack: null, macro: null, edges };
  }
}

// Which move a button becomes depends on the stance, not on the button. This is
// the only place that mapping lives, so adding a stance means editing one table.
export function moveForAttack(button, { crouching, airborne }) {
  if (airborne) return 'jumpAttack';
  if (crouching) {
    if (button === 'lp' || button === 'hp') return 'crouchPunch';
    return 'crouchKick';
  }
  return { lp: 'lightPunch', hp: 'heavyPunch', lk: 'lightKick', hk: 'heavyKick' }[button] || null;
}
