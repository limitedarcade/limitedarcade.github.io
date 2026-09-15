// Stored preferences are deliberately independent of the renderer and DOM.
// Physical KeyboardEvent codes keep remaps stable across keyboard layouts.
export const OPTION_KEY = 'bfi.options.v1';
export const ACTIONS = Object.freeze([
  ['left', 'Move left'], ['right', 'Move right'], ['up', 'Jump'], ['down', 'Crouch'],
  ['lp', 'Light punch'], ['hp', 'Heavy punch'], ['lk', 'Light kick'], ['hk', 'Heavy kick'], ['block', 'Block'],
]);
export const DEFAULT_BINDINGS = Object.freeze([
  Object.freeze({ left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', lp: 'KeyU', hp: 'KeyI', lk: 'KeyJ', hk: 'KeyK', block: 'Space' }),
  Object.freeze({ left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown', lp: 'Numpad4', hp: 'Numpad5', lk: 'Numpad1', hk: 'Numpad2', block: 'Numpad0' }),
]);
export const DEFAULT_OPTIONS = Object.freeze({ quality: 'auto', motion: 'system', rumble: true, damageNumbers: true, gore: true });
const clone = value => JSON.parse(JSON.stringify(value));
const validCode = code => typeof code === 'string' && /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Left|Right|Up|Down)|Space|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|Minus|Equal)$/.test(code);
const storeForBrowser = () => { try { return globalThis.localStorage; } catch { return null; } };

export function keyLabel(code) {
  return ({ Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '−', Equal: '=' })[code]
    || code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'Num ');
}

export class OptionsStore {
  constructor(storage = storeForBrowser()) {
    this.storage = storage;
    this.listeners = new Set();
    this.settings = { ...DEFAULT_OPTIONS };
    this.bindings = clone(DEFAULT_BINDINGS);
    try {
      const value = JSON.parse(storage?.getItem(OPTION_KEY) || 'null');
      if (value && typeof value === 'object') {
        for (const key of Object.keys(DEFAULT_OPTIONS)) if (this.validSetting(key, value.settings?.[key])) this.settings[key] = value.settings[key];
        // Reject an entire invalid layout instead of silently disabling a move.
        const seen = new Set();
        const maps = value.bindings;
        if (Array.isArray(maps) && maps.length === 2 && maps.every(map => map && ACTIONS.every(([action]) => {
          const code = map[action];
          if (!validCode(code) || seen.has(code)) return false;
          seen.add(code); return true;
        }))) this.bindings = maps.map(map => Object.fromEntries(ACTIONS.map(([action]) => [action, map[action]])));
      }
    } catch { /* A private session or damaged save still has a complete layout. */ }
  }
  validSetting(key, value) {
    if (key === 'quality') return ['auto', 'cinematic', 'performance'].includes(value);
    if (key === 'motion') return ['system', 'reduced', 'full'].includes(value);
    return ['rumble', 'damageNumbers', 'gore'].includes(key) && typeof value === 'boolean';
  }
  save() {
    try { this.storage?.setItem(OPTION_KEY, JSON.stringify({ settings: this.settings, bindings: this.bindings })); } catch { /* Persistence is optional. */ }
    for (const listener of this.listeners) listener(this);
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  set(key, value) {
    if (!this.validSetting(key, value)) return false;
    this.settings[key] = value; this.save(); return true;
  }
  bind(side, action, code) {
    if (![0, 1].includes(side) || !ACTIONS.some(([id]) => id === action) || !validCode(code))
      return { ok: false, message: 'Use a letter, number, arrow, Space, or punctuation key. Escape cancels.' };
    for (let s = 0; s < 2; s++) for (const [id, used] of Object.entries(this.bindings[s])) {
      if (used === code && (s !== side || id !== action))
        return { ok: false, message: `${keyLabel(code)} is already Player ${s + 1} ${ACTIONS.find(([a]) => a === id)[1].toLowerCase()}. Choose a free key first.` };
    }
    this.bindings[side][action] = code; this.save(); return { ok: true };
  }
  resetBindings() { this.bindings = clone(DEFAULT_BINDINGS); this.save(); }
  keymap(side, { single = false } = {}) {
    const maps = single ? this.bindings : [this.bindings[side] || this.bindings[0]];
    return Object.fromEntries(maps.flatMap(map => Object.entries(map).map(([action, code]) => [code.toLowerCase(), action])));
  }
  reducedMotion(system = false) { return this.settings.motion === 'reduced' || this.settings.motion === 'system' && system; }
  qualityValue(lowPower = false) { return this.settings.quality === 'performance' || this.settings.quality === 'auto' && lowPower ? 0.5 : 1; }
}
