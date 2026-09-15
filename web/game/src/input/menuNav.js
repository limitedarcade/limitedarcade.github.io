import { connectedPads } from './sources.js';

// Gamepad navigation for the menus.
//
// The fight reads the pad directly every sim tick; the menus are plain DOM
// buttons, selects and sliders that only ever expected a mouse or the Tab key.
// This bridges the two: while a screen or dialog is up, the pad's d-pad/stick
// moves DOM focus, South activates, East goes back, and the shoulders page
// through the tab strips. Nothing here runs during a match -- `isActive` is
// false whenever the fight owns the pad.

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Standard Gamepad button indices. Directions are ORed with the left stick.
const PAD = { south: 0, east: 1, l1: 4, r1: 5, up: 12, down: 13, left: 14, right: 15 };
const STICK_DEADZONE = 0.5;
const REPEAT_DELAY = 360; // ms a direction must be held before it repeats
const REPEAT_RATE = 120; // ms between repeats after that

// Tab strips the shoulder buttons should page through, most specific first.
const TAB_ROWS = ['.selection-steps', '.move-tabs', '.move-fighter-select', '[role="tablist"]'];

export class MenuNavigator {
  constructor({ isActive, onBack, navigator: nav = null }) {
    this.isActive = isActive;
    this.onBack = onBack;
    this.navigator = nav;
    this.prev = {};
    this.heldSince = {};
    this.repeatedAt = {};
    this.marked = null;
  }

  pads() { return connectedPads(this.navigator || navigator); }

  scope() {
    const dialogs = document.querySelectorAll('dialog[open]');
    if (dialogs.length) return dialogs[dialogs.length - 1];
    return document.querySelector('.screen.active');
  }

  candidates(scope) {
    return [...scope.querySelectorAll(FOCUSABLE)].filter((el) => {
      if (el.closest('[hidden]')) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) return false;
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && style.display !== 'none';
    });
  }

  setMark(el) {
    if (this.marked === el) return;
    this.marked?.classList.remove('gamepad-focus');
    el?.classList.add('gamepad-focus');
    this.marked = el || null;
  }

  focus(el) {
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.setMark(el);
  }

  // The element the pad is currently driving: whatever the document says has
  // focus, as long as it is a real target inside the active scope.
  focused(scope) {
    const active = document.activeElement;
    if (active && active !== document.body && scope.contains(active) && this.candidates(scope).includes(active)) {
      this.setMark(active);
      return active;
    }
    return null;
  }

  directions(pads) {
    const dir = { up: false, down: false, left: false, right: false };
    for (const pad of pads) {
      for (const name of ['up', 'down', 'left', 'right']) if (pad.buttons[PAD[name]]?.pressed) dir[name] = true;
      const ax = pad.axes[0] || 0;
      const ay = pad.axes[1] || 0;
      if (ay < -STICK_DEADZONE) dir.up = true;
      if (ay > STICK_DEADZONE) dir.down = true;
      if (ax < -STICK_DEADZONE) dir.left = true;
      if (ax > STICK_DEADZONE) dir.right = true;
    }
    if (dir.up && dir.down) { dir.up = false; dir.down = false; }
    if (dir.left && dir.right) { dir.left = false; dir.right = false; }
    return dir;
  }

  buttons(pads) {
    const out = {};
    for (const name of ['south', 'east', 'l1', 'r1']) out[name] = pads.some((p) => p.buttons[PAD[name]]?.pressed);
    return out;
  }

  poll(now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    const pads = this.pads();
    if (!pads.length || !this.isActive()) {
      this.prev = {};
      this.heldSince = {};
      this.setMark(null);
      return;
    }
    const scope = this.scope();
    if (!scope) { this.prev = {}; return; }

    const dir = this.directions(pads);
    const btn = this.buttons(pads);

    let current = this.focused(scope);
    if (!current) {
      // First contact with a fresh screen: claim focus, consume the press.
      this.focus(this.candidates(scope)[0]);
      this.prev = { ...dir, ...btn };
      return;
    }

    for (const d of ['up', 'down', 'left', 'right']) {
      if (!dir[d]) { this.heldSince[d] = 0; continue; }
      const since = this.heldSince[d] || 0;
      let fire = false;
      if (!since) { fire = true; this.heldSince[d] = now; this.repeatedAt[d] = now; }
      else if (now - since > REPEAT_DELAY && now - (this.repeatedAt[d] || 0) > REPEAT_RATE) { fire = true; this.repeatedAt[d] = now; }
      if (!fire) continue;
      if ((d === 'left' || d === 'right') && this.adjust(current, d === 'right' ? 1 : -1)) continue;
      this.move(scope, current, d);
      current = this.focused(scope) || current;
    }

    if (btn.south && !this.prev.south) this.activate(current);
    if (btn.east && !this.prev.east) this.back(scope);
    if (btn.r1 && !this.prev.r1) this.page(scope, 1);
    if (btn.l1 && !this.prev.l1) this.page(scope, -1);

    this.prev = { ...dir, ...btn };
  }

  // Spatial focus move: among the candidates that lie in the pressed
  // direction, take the nearest, weighting sideways drift so a press down
  // does not skip to a far column. Falls back to document order at the edges.
  move(scope, current, d) {
    const here = current.getBoundingClientRect();
    const cx = here.left + here.width / 2;
    const cy = here.top + here.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of this.candidates(scope)) {
      if (el === current) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx;
      const dy = r.top + r.height / 2 - cy;
      let along;
      let across;
      if (d === 'up') { if (dy > -4) continue; along = -dy; across = Math.abs(dx); }
      else if (d === 'down') { if (dy < 4) continue; along = dy; across = Math.abs(dx); }
      else if (d === 'left') { if (dx > -4) continue; along = -dx; across = Math.abs(dy); }
      else { if (dx < 4) continue; along = dx; across = Math.abs(dy); }
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) {
      const list = this.candidates(scope);
      const i = list.indexOf(current);
      if (i >= 0 && list.length > 1) {
        const step = d === 'down' || d === 'right' ? 1 : -1;
        best = list[(i + step + list.length) % list.length];
      }
    }
    this.focus(best);
  }

  // Left/right on a select or slider changes its value in place -- native
  // dropdowns cannot be opened from script, and this is how a pad expects
  // them to work anyway.
  adjust(el, delta) {
    if (el.tagName === 'SELECT') {
      if (!el.options.length) return false;
      el.selectedIndex = (el.selectedIndex + delta + el.options.length) % el.options.length;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el.tagName === 'INPUT' && el.type === 'range') {
      const step = Number(el.step) || 1;
      const min = el.min === '' ? -Infinity : Number(el.min);
      const max = el.max === '' ? Infinity : Number(el.max);
      const next = Math.min(max, Math.max(min, Number(el.value) + delta * step));
      if (next === Number(el.value)) return true;
      el.value = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }

  activate(el) {
    if (!el) return;
    if (el.tagName === 'SELECT') return; // handled by left/right
    if (el.tagName === 'INPUT') {
      if (el.type === 'checkbox' || el.type === 'radio') {
        el.checked = el.type === 'checkbox' ? !el.checked : true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return;
      }
      if (el.type === 'range') return;
    }
    el.click();
  }

  back(scope) {
    if (scope.tagName === 'DIALOG') {
      const closer = scope.querySelector('.dialog-close, [data-close]');
      if (closer) closer.click();
      else scope.close();
      return;
    }
    this.onBack?.(scope);
  }

  page(scope, delta) {
    for (const selector of TAB_ROWS) {
      const row = scope.querySelector(selector);
      if (!row) continue;
      const items = [...row.querySelectorAll('button')].filter((b) => !b.disabled);
      if (items.length < 2) continue;
      let i = items.findIndex((b) => b.getAttribute('aria-current') === 'true' || b.getAttribute('aria-pressed') === 'true');
      if (i < 0) i = items.indexOf(document.activeElement);
      if (i < 0) i = 0;
      items[(i + delta + items.length) % items.length].click();
      return;
    }
  }
}
