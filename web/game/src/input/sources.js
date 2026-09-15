import { CHORDS } from '../engine/moveList.js';
import { MOVES } from '../engine/frameData.js';
// Keyboard, gamepad and touch, all reduced to the same nine flags.
//
// Every source ORs into one struct per side, so a player can hold left on a
// stick and press a punch on the screen and the sim sees one coherent frame.
// The macro buttons (RB/RT and the on-screen GRAB/THROW) work by pressing both
// halves on the same frame, which is exactly what the command resolver already
// understands -- no second path into the game.

import { emptyInput, BUTTONS } from '../engine/commands.js';

// A 2x2 punch/kick grid on the home row, block under the thumb.
//   U I      punches
//   J K      kicks
export const KEYBOARD_P1 = Object.freeze({
  a: 'left', d: 'right', w: 'up', s: 'down',
  u: 'lp', i: 'hp', j: 'lk', k: 'hk',
  ' ': 'block', l: 'block',
});

export const KEYBOARD_P2 = Object.freeze({
  arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down',
  numpad4: 'lp', numpad5: 'hp', numpad1: 'lk', numpad2: 'hk',
  numpad0: 'block',
});

// Standard Gamepad mapping. Face buttons form the same 2x2 grid as the keys:
// west/north are the punches, south/east the kicks.
//
// On an Xbox pad in Standard Gamepad layout that is X/Y for the punches and
// A/B for the kicks, LB/LT for block, and RB/RT for the two macros.
const PAD_BUTTONS = Object.freeze({
  2: 'lp', 3: 'hp', 0: 'lk', 1: 'hk',
  4: 'block',
  12: 'up', 13: 'down', 14: 'left', 15: 'right',
  9: 'start',
});
const PAD_MACROS = Object.freeze({ 5: ['lp', 'hp'] });

// The triggers are analog, and `pressed` on an analog button is a browser
// judgement call, not a fact: Chrome latches it near 0.5, Firefox reports the
// value and leaves `pressed` false for most of the travel, and a worn Xbox
// trigger with a resting value of 0.08 can sit `touched` forever. Reading the
// value against our own threshold is the only way LT and RT behave the same
// everywhere -- and it was the reason the throw macro felt dead on RT.
const PAD_TRIGGERS = Object.freeze({ 6: ['block'], 7: ['lk', 'hk'] });
const TRIGGER_THRESHOLD = 0.45;

function triggerHeld(button) {
  if (!button) return false;
  return button.pressed || (button.value || 0) > TRIGGER_THRESHOLD;
}

// The d-pad as a hat axis: one axis stepping through eight directions plus a
// rest value outside [-1, 1]. Only consulted when the pad actually has a
// spare axis, so a normal Xbox pad never enters this path.
function readHat(pad, out) {
  const hat = pad.axes[9];
  if (typeof hat !== 'number' || hat < -1.001 || hat > 1.001) return;
  const eighth = Math.round(((hat + 1) / 2) * 7);
  if ([7, 0, 1].includes(eighth)) out.up = true;
  if ([1, 2, 3].includes(eighth)) out.right = true;
  if ([3, 4, 5].includes(eighth)) out.down = true;
  if ([5, 6, 7].includes(eighth)) out.left = true;
}

// Which physical pad a side is holding.
//
// Gamepad indices are not stable and not dense: a pad that sleeps and wakes
// comes back at a new index, a wireless adapter can put the first controller at
// index 3, and a disconnect leaves a null hole in the array. Binding side 0 to
// index 0 at construction meant a controller connected after the page loaded
// was simply never read -- the single most common way this went wrong.
//
// So sides claim pads by *order of appearance* among the pads that are actually
// connected right now, and a pad that vanishes hands its slot to the next one.
export function connectedPads(source = navigator) {
  const pads = source.getGamepads?.() || [];
  return Array.from(pads).filter(pad => pad && pad.connected !== false);
}

// Radial, not per-axis. A per-axis deadzone makes a stick held diagonally at
// (0.30, 0.30) register as neutral while (0.36, 0) walks -- so a diagonal
// jump-in needs a harder push than a straight one, which is exactly the input
// a fighting game cannot afford to lose.
const STICK_DEADZONE = 0.34;
const AXIS_THRESHOLD = 0.5;

export class PlayerInput {
  constructor({ keymap = null, padIndex = null, navigator: nav = null } = {}) {
    this.keymap = keymap;
    this.padIndex = padIndex;
    // Injectable so the pad handling can be tested without a browser.
    this.navigator = nav;
    this.keys = new Set();
    this.touch = new Set();
    this.state = emptyInput();
  }

  onKeyDown(key, code) {
    const button = this.lookup(key, code);
    if (button) this.keys.add(button);
    return Boolean(button);
  }

  onKeyUp(key, code) {
    const button = this.lookup(key, code);
    if (button) this.keys.delete(button);
    return Boolean(button);
  }

  lookup(key, code) {
    if (!this.keymap) return null;
    const lower = String(key || '').toLowerCase();
    return this.keymap[lower] || this.keymap[String(code || '').toLowerCase()] || null;
  }

  setTouch(button, down) {
    if (down) this.touch.add(button); else this.touch.delete(button);
  }

  clearHeld() {
    this.keys.clear();
    this.touch.clear();
  }

  // `padIndex` is a *slot* -- first connected pad, second connected pad -- not
  // a raw Gamepad index, so it survives reconnects and late arrivals.
  pad() {
    if (this.padIndex === null || this.padIndex === undefined) return null;
    return connectedPads(this.navigator || navigator)[this.padIndex] || null;
  }

  get connected() { return Boolean(this.pad()); }

  poll() {
    const out = this.state;
    for (const b of BUTTONS) out[b] = false;
    for (const b of this.keys) out[b] = true;
    for (const b of this.touch) out[b] = true;

    const pad = this.pad();
    if (pad) {
      for (const [index, button] of Object.entries(PAD_BUTTONS)) {
        if (pad.buttons[index]?.pressed) out[button] = true;
      }
      for (const [index, pair] of Object.entries(PAD_MACROS)) {
        if (pad.buttons[index]?.pressed) for (const b of pair) out[b] = true;
      }
      for (const [index, pair] of Object.entries(PAD_TRIGGERS)) {
        if (triggerHeld(pad.buttons[index])) for (const b of pair) out[b] = true;
      }
      // Left stick, with a radial deadzone so diagonals cost the same push as
      // cardinals. Normalising past the deadzone also means the threshold is
      // about direction rather than about how far the stick happens to travel.
      const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
      const magnitude = Math.hypot(ax, ay);
      if (magnitude > STICK_DEADZONE) {
        const scale = 1 / magnitude;
        if (ax * scale < -AXIS_THRESHOLD) out.left = true;
        if (ax * scale > AXIS_THRESHOLD) out.right = true;
        if (ay * scale < -AXIS_THRESHOLD) out.up = true;
        if (ay * scale > AXIS_THRESHOLD) out.down = true;
      }
      // Some Windows drivers present the d-pad as a hat axis rather than as
      // buttons 12-15. Reading both costs nothing and is the difference between
      // a working d-pad and a dead one on those setups.
      readHat(pad, out);
    }

    // Opposite directions cancel rather than fighting over the same frame. Up
    // and down need this as much as left and right do, because the stick and
    // the d-pad are ORed together and a player resting a thumb on both would
    // otherwise crouch and jump on the same frame.
    if (out.left && out.right) { out.left = false; out.right = false; }
    if (out.up && out.down) { out.up = false; out.down = false; }
    return out;
  }
}

// The on-screen pad. A draggable stick on the left (so jump and crouch are one
// thumb) and a labelled button cluster on the right, including the two macro
// buttons that would otherwise need two thumbs on one hand.
export class TouchControls {
  constructor(container, player, { onPause } = {}) {
    this.player = player;
    this.onPause = onPause;
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.pointers = new Map();
    this.heldActions = new Set();

    this.stick = document.createElement('div');
    this.stick.className = 'touch-stick';
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.stick.append(this.knob);

    this.cluster = document.createElement('div');
    this.cluster.className = 'touch-cluster';
    this.buttons = new Map();
    const layout = [
      ['lp', 'LP', 'light'], ['hp', 'HP', 'heavy'], ['grab', 'GRAB', 'macro'],
      ['lk', 'LK', 'light'], ['hk', 'HK', 'heavy'], ['throw', 'THROW', 'macro'],
    ];
    for (const [id, label, kind] of layout) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `touch-button touch-${kind}`;
      button.dataset.button = id;
      button.textContent = label;
      button.setAttribute('aria-label', label);
      this.cluster.append(button);
      this.buttons.set(id, button);
    }

    this.block = document.createElement('button');
    this.block.type = 'button';
    this.block.className = 'touch-button touch-block';
    this.block.dataset.button = 'block';
    this.block.textContent = 'BLOCK';
    this.block.setAttribute('aria-label', 'Block');

    // The big button under the finisher window: on touch this is the only way
    // to input FINISH HIM, so it commits the move (block + HP) rather than
    // opening a menu. The reference list moved to the small `?` beside it.
    this.finisher = document.createElement('button');
    this.finisher.type = 'button';
    this.finisher.className = 'touch-button touch-finisher';
    this.finisher.dataset.button = 'finisher';
    this.finisher.textContent = 'FINISH';
    this.finisher.setAttribute('aria-label', 'Perform finisher');

    this.finisherHelp = document.createElement('button');
    this.finisherHelp.type = 'button';
    this.finisherHelp.className = 'touch-button touch-finisher-help';
    this.finisherHelp.textContent = '?';
    this.finisherHelp.setAttribute('aria-label', 'Show finisher commands');
    this.finisherHelp.addEventListener('pointerdown', (event) => { event.preventDefault(); this.onSecrets?.(); });

    const combos = document.createElement('button'); combos.type = 'button';
    combos.className = 'touch-button touch-combos'; combos.textContent = 'CHORDS'; combos.setAttribute('aria-expanded', 'false');
    this.combosButton = combos;
    // A chord that spends meter is only listed as usable once the gauge can
    // pay for it; `setMeterStocks` flips the `locked` class each frame.
    this.specialCost = new Map();
    this.tray = document.createElement('div'); this.tray.className = 'touch-chord-tray hidden';
    for (const chord of CHORDS) {
      const move = MOVES[chord.move];
      const b = document.createElement('button'); b.type = 'button'; b.className = 'touch-button';
      b.textContent = move.name; b.dataset.button = chord.move;
      if (move.cost) {
        b.classList.add('touch-special', 'locked');
        b.dataset.cost = '◆'.repeat(move.cost);
        this.specialCost.set(chord.move, move.cost);
      }
      this.tray.append(b); this.buttons.set(`chord-${chord.move}`, b);
    }
    combos.addEventListener('click', () => { const hidden = this.tray.classList.toggle('hidden'); combos.setAttribute('aria-expanded', String(!hidden)); });
    this.root.append(this.stick, this.block, this.cluster, this.finisher, this.finisherHelp, combos, this.tray);
    container.append(this.root);
    this.bind();
  }

  setFinisherAvailable(available) {
    this.root.classList.toggle('finisher-ready', available);
    if (!available) { this.press('finisher', false); this.finisher.classList.remove('down'); }
  }

  setAxeReady(ready) {
    this.buttons.get('grab')?.classList.toggle('axe-ready', Boolean(ready));
  }

  // Live meter stocks for the side this pad drives. Locks the specials the
  // gauge cannot afford and hints on the CHORDS button when one comes online.
  setMeterStocks(stocks) {
    if (stocks === this._stocks) return;
    this._stocks = stocks;
    let anyReady = false;
    for (const [move, cost] of this.specialCost) {
      const affordable = stocks >= cost;
      anyReady = anyReady || affordable;
      this.buttons.get(`chord-${move}`)?.classList.toggle('locked', !affordable);
    }
    this.combosButton.classList.toggle('special-ready', anyReady);
  }

  press(id, down) {
    if (down) this.heldActions.add(id); else this.heldActions.delete(id);
    const held = new Set();
    for (const action of this.heldActions) {
      const buttons = action === 'finisher' ? ['block', 'hp'] : CHORDS.find(c => c.move === action)?.buttons || [action];
      for (const button of buttons) held.add(button);
    }
    for (const button of ['lp', 'hp', 'lk', 'hk', 'block']) this.player.setTouch(button, held.has(button));
  }

  bind() {
    // Mobile browsers can treat a held control as selectable text or a link-like
    // target even with touch-action disabled. Keep those browser gestures out of
    // the game pad while leaving menus and the rest of the page unaffected.
    for (const type of ['contextmenu', 'selectstart', 'dragstart']) {
      this.root.addEventListener(type, (event) => event.preventDefault());
    }

    const all = [...this.buttons.values(), this.block, this.finisher];
    for (const button of all) {
      const id = button.dataset.button;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        if (button.classList.contains('locked')) return;
        if (id === 'finisher' && !this.root.classList.contains('finisher-ready')) return;
        button.setPointerCapture?.(event.pointerId);
        button.classList.add('down');
        this.press(id, true);
      });
      const release = () => { button.classList.remove('down'); this.press(id, false); };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
    }

    const setStick = (dx, dy) => {
      const radius = this.stick.clientWidth / 2 || 60;
      const nx = Math.max(-1, Math.min(1, dx / (radius * 0.75)));
      const ny = Math.max(-1, Math.min(1, dy / (radius * 0.75)));
      this.knob.style.transform = `translate(${nx * radius * 0.42}px, ${ny * radius * 0.42}px)`;
      this.player.setTouch('left', nx < -0.34);
      this.player.setTouch('right', nx > 0.34);
      this.player.setTouch('up', ny < -0.42);
      this.player.setTouch('down', ny > 0.42);
    };

    this.stick.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      if (this.stickPointer != null) return;
      this.stickPointer = event.pointerId;
      this.stick.setPointerCapture?.(event.pointerId);
      const rect = this.stick.getBoundingClientRect();
      this.stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      setStick(event.clientX - this.stickOrigin.x, event.clientY - this.stickOrigin.y);
    });
    this.stick.addEventListener('pointermove', (event) => {
      if (!this.stickOrigin || event.pointerId !== this.stickPointer) return;
      setStick(event.clientX - this.stickOrigin.x, event.clientY - this.stickOrigin.y);
    });
    const releaseStick = (event) => {
      if (event.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.stickOrigin = null;
      this.knob.style.transform = 'translate(0,0)';
      for (const b of ['left', 'right', 'up', 'down']) this.player.setTouch(b, false);
    };
    this.stick.addEventListener('pointerup', releaseStick);
    this.stick.addEventListener('pointercancel', releaseStick);
    this.stick.addEventListener('lostpointercapture', releaseStick);
  }

  setVisible(visible) {
    this.root.classList.toggle('hidden', !visible);
    if (!visible) {
      this.heldActions.clear(); this.player.touch.clear(); this.tray.classList.add('hidden');
      this.stickPointer = null; this.stickOrigin = null; this.knob.style.transform = 'translate(0,0)';
      for (const button of this.root.querySelectorAll('.down')) button.classList.remove('down');
    }
  }
}
