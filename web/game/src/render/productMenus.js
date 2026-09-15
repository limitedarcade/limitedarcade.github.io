import { ACTIONS, OptionsStore, keyLabel } from '../game/options.js';
import { ACHIEVEMENTS, PlayerProfile } from '../game/profile.js';
import './productMenus.css';

const make = (tag, className, text) => {
  const el = document.createElement(tag); el.className = className || '';
  if (text !== undefined) el.textContent = text;
  return el;
};
const button = (text, className = '') => { const b = make('button', className, text); b.type = 'button'; return b; };
const section = (title, note) => {
  const el = make('section', 'options-section'); el.append(make('h3', '', title));
  if (note) el.append(make('p', 'options-note', note)); return el;
};

export class ProductMenus {
  constructor({ audio, options = new OptionsStore(), profile = new PlayerProfile(), onOptionsChange = () => {}, getFinishers = () => [] } = {}) {
    Object.assign(this, { audio, options, profile, getFinishers });
    this.pending = null; this.bindingButtons = []; this.audioRows = [];
    this.dialog = this.createDialog('Options', 'MAKE IT YOURS', 'options-dialog');
    const settings = make('div', 'options-columns');
    const sound = section('Sound studio', 'Your mix is saved on this device.');
    if (audio) {
      const mute = make('label', 'options-toggle');
      this.muteInput = make('input'); this.muteInput.type = 'checkbox';
      this.muteInput.onchange = () => audio.set('muted', this.muteInput.checked);
      mute.append(make('span', '', 'Mute'), this.muteInput); sound.append(mute);
    }
    if (audio) for (const [id, label] of [['master', 'Master'], ['music', 'Music'], ['effects', 'Effects'], ['voice', 'Announcer']]) {
      const row = make('label', 'audio-range'); const input = make('input'); input.type = 'range'; input.min = 0; input.max = 1; input.step = 0.05;
      const out = make('output');
      input.oninput = () => { audio.set(id, Number(input.value)); out.textContent = `${Math.round(Number(input.value) * 100)}%`; };
      row.append(make('span', '', label), input, out); sound.append(row); this.audioRows.push({ id, input, out });
    }
    const display = section('Display & feedback', 'Changes apply immediately.');
    this.fields = {};
    for (const [id, label, values] of [
      ['quality', 'Rendering', [['auto', 'Automatic'], ['cinematic', 'Cinematic'], ['performance', 'Performance']]],
      ['motion', 'Motion', [['system', 'Follow device'], ['full', 'Full impact'], ['reduced', 'Reduced motion']]],
    ]) {
      const field = make('label', 'options-field'); field.append(make('span', '', label)); const select = make('select');
      for (const [value, text] of values) { const opt = make('option', '', text); opt.value = value; select.append(opt); }
      select.onchange = () => options.set(id, select.value); field.append(select); display.append(field); this.fields[id] = select;
    }
    for (const [id, label] of [['rumble', 'Gamepad rumble'], ['damageNumbers', 'Damage numbers'], ['gore', 'Gore and dismemberment']]) {
      const field = make('label', 'options-toggle'); const input = make('input'); input.type = 'checkbox'; input.onchange = () => options.set(id, input.checked);
      field.append(make('span', '', label), input); display.append(field); this.fields[id] = input;
    }
    const full = button('Toggle fullscreen', 'menu-secondary-button');
    full.onclick = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
        else this.status.textContent = 'Fullscreen is managed by this browser. Use its display controls.';
      } catch { this.status.textContent = 'This browser could not enter fullscreen. Your display settings are saved.'; }
    };
    display.append(full); settings.append(sound, display); this.dialog.body.append(settings);
    const controls = section('Keyboard controls', 'Select a command, then press a key. Escape cancels. Pause stays on Escape; the debug studio stays on backtick. Both layouts work for a single human player.');
    const keyGrid = make('div', 'binding-grid');
    for (const side of [0, 1]) {
      const group = make('div', 'binding-side'); group.append(make('h4', '', `PLAYER ${side + 1}`));
      for (const [id, label] of ACTIONS) {
        const row = make('div', 'binding-row'); const b = button('', 'keybind-button');
        b.onclick = () => {
          this.cancelBinding(); this.pending = { side, id, b }; b.classList.add('listening'); b.textContent = 'Press a key…';
          this.status.textContent = `Listening for Player ${side + 1} ${label.toLowerCase()}.`;
        };
        b.setAttribute('aria-label', `Remap Player ${side + 1} ${label.toLowerCase()}`);
        row.append(make('span', '', label), b); group.append(row); this.bindingButtons.push({ side, id, b });
      }
      keyGrid.append(group);
    }
    const reset = button('Restore default keys', 'menu-secondary-button'); reset.onclick = () => { this.cancelBinding(); options.resetBindings(); this.status.textContent = 'Default keyboard layouts restored.'; };
    controls.append(keyGrid, reset); this.dialog.body.append(controls);
    this.status = make('p', 'menu-status', 'Options save automatically.'); this.status.setAttribute('role', 'status'); this.dialog.body.append(this.status);
    this.dialog.el.addEventListener('keydown', e => {
      if (!this.pending) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.code === 'Escape' || e.code === 'Tab') { this.cancelBinding(); this.status.textContent = 'Remap cancelled.'; return; }
      if (e.repeat) return;
      const result = options.bind(this.pending.side, this.pending.id, e.code);
      if (result.ok) { const code = e.code; this.cancelBinding(); this.status.textContent = `Bound to ${keyLabel(code)}. Saved.`; }
      else this.status.textContent = result.message;
    }, true);
    this.dialog.el.addEventListener('close', () => this.cancelBinding());
    this.unsubscribeOptions = options.subscribe(() => { this.refreshOptions(); onOptionsChange(options); });
    this.profileDialog = this.createDialog('Your archive', 'LOCAL FIGHTER PROFILE', 'profile-dialog');
    this.profileBody = make('div', 'profile-body'); this.profileDialog.body.append(this.profileBody);
    this.unsubscribeProfile = profile.subscribe(() => { if (this.profileDialog.el.open) this.refreshProfile(); });
    this.refreshOptions();
  }
  createDialog(title, kicker, className) {
    const dialog = make('dialog', `game-dialog product-dialog ${className}`); dialog.setAttribute('aria-label', title);
    const top = make('header', 'dialog-header'); const close = button('×', 'dialog-close'); close.setAttribute('aria-label', 'Close'); close.onclick = () => dialog.close();
    top.append(make('span', '', kicker), close); const body = make('div', 'product-dialog-body'); body.append(make('h2', 'dialog-title', title));
    dialog.append(top, body); dialog.addEventListener('keydown', e => e.stopPropagation()); document.body.append(dialog);
    return { el: dialog, body };
  }
  cancelBinding() {
    if (this.pending) { this.pending.b.classList.remove('listening'); this.pending = null; }
    this.refreshOptions();
  }
  refreshOptions() {
    for (const { side, id, b } of this.bindingButtons) if (this.pending?.b !== b) b.textContent = keyLabel(this.options.bindings[side][id]);
    for (const [id, el] of Object.entries(this.fields)) if (el.type === 'checkbox') el.checked = this.options.settings[id]; else el.value = this.options.settings[id];
    for (const { id, input, out } of this.audioRows) { input.value = this.audio.settings[id]; out.textContent = `${Math.round(this.audio.settings[id] * 100)}%`; }
    if (this.muteInput) this.muteInput.checked = Boolean(this.audio.settings.muted);
    document.documentElement.dataset.motion = this.options.settings.motion;
  }
  showOptions() { this.refreshOptions(); if (!this.dialog.el.open) this.dialog.el.showModal(); }
  showProfile() { this.refreshProfile(); if (!this.profileDialog.el.open) this.profileDialog.el.showModal(); }
  refreshProfile() {
    const data = this.profile.data;
    this.profileBody.replaceChildren();
    this.profileBody.dataset.accent = data.unlocks.includes('after-hours') ? 'midnight' : data.unlocks.includes('clean-slate') ? 'gold' : 'standard';
    const hero = make('div', 'profile-hero'); const badge = make('div', 'profile-emblem', 'BFI'); badge.setAttribute('aria-hidden', 'true');
    const heroCopy = make('div'); heroCopy.append(make('p', 'archive-eyebrow', 'YOUR CORNER OF THE ARCADE'), make('h3', '', data.matches ? 'Back for more' : 'The first bell awaits'), make('p', '', 'A personal record of your matches and discoveries, saved on this device.'));
    hero.append(badge, heroCopy); this.profileBody.append(hero);
    const stats = make('div', 'profile-stats');
    for (const [value, label] of [[data.matches, 'MATCHES'], [data.wins, 'SOLO WINS'], [data.bestCombo, 'BEST COMBO'], [data.discoveries.length, 'DISCOVERIES']]) {
      const stat = make('div'); stat.append(make('strong', '', String(value)), make('span', '', label)); stats.append(stat);
    }
    this.profileBody.append(stats);
    const details = make('p', 'profile-detail-line', `${data.rounds} rounds  ·  ${data.knockouts} knockouts  ·  ${data.flawless} flawless rounds  ·  ${Math.floor(data.playSeconds / 60)} minutes in the arena`);
    this.profileBody.append(details);
    const unlocks = section('Trophy cabinet', 'Earned badges and archive accents. Combat is always unlocked.');
    const grid = make('div', 'achievement-grid');
    for (const achievement of ACHIEVEMENTS) {
      const earned = data.unlocks.includes(achievement.id); const card = make('article', `achievement ${earned ? 'earned' : ''}`);
      card.append(make('span', 'achievement-icon', earned ? '✦' : '◇'), make('h4', '', achievement.title), make('p', '', achievement.note), make('small', '', earned ? `UNLOCKED · ${achievement.reward}` : achievement.reward)); grid.append(card);
    }
    unlocks.append(grid); this.profileBody.append(unlocks);
    const archive = section('Finishers discovered', 'Secret inputs become permanent archive entries when you land them.');
    const entries = this.getFinishers() || [];
    for (const id of data.discoveries) {
      const entry = entries.find(e => e.id === id); const row = make('article', 'discovery-row');
      const command = entry?.command || entry?.sequence;
      row.append(make('strong', '', entry?.name || entry?.label || id.replace(/[-_]/g, ' ')), make('kbd', '', entry?.inputLabel || entry?.input || (Array.isArray(command) && command.length ? command.map(key => ({ forward: 'F', back: 'B', down: '↓', up: '↑' })[key] || key.toUpperCase()).join(' → ') : entry?.requirement || 'DISCOVERED'))); archive.append(row);
    }
    if (!data.discoveries.length) archive.append(make('p', 'archive-empty', 'No discoveries yet. Watch the finishing window and mind your distance.'));
    this.profileBody.append(archive);
  }
  dispose() { this.unsubscribeOptions(); this.unsubscribeProfile(); this.dialog.el.remove(); this.profileDialog.el.remove(); }
}
