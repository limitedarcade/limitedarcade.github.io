import './productMenus.css';
import { assignFighter } from './fighterPick.js';

const make = (tag, className, text) => {
  const el = document.createElement(tag); el.className = className || '';
  if (text !== undefined) el.textContent = text;
  return el;
};
const button = (label, className = '') => { const el = make('button', className, label); el.type = 'button'; return el; };
const arcadeFrame = (compact = false) => {
  const frame = make('div', compact ? 'arcade-frame compact' : 'arcade-frame');
  frame.setAttribute('aria-hidden', 'true');
  for (const corner of ['tl', 'tr', 'bl', 'br']) frame.append(make('span', `preview-corner preview-corner-${corner}`));
  if (!compact) for (const edge of ['top', 'right', 'bottom', 'left']) frame.append(make('span', `preview-edge preview-edge-${edge}`));
  return frame;
};

export { assignFighter } from './fighterPick.js';

// Configuration is shared with the match launcher. The original setup form is
// retained, hidden, so external tools and older callers still find its IDs.
export class SelectionScreen {
  constructor({ container, config, roster, stages = [], difficulties = {}, onFight, onChange = () => {}, onPreview = () => {}, onOptions = () => {}, onProfile = () => {}, onBack = () => {} }) {
    Object.assign(this, { container, config, roster, stages, onFight, onChange, onPreview });
    if (config.fighters[0] === config.fighters[1]) {
      const other = roster.find(f => f.id !== config.fighters[0]);
      if (other) config.fighters[1] = other.id;
    }
    if (stages.find(s => s.id === config.stage)?.comingSoon) {
      config.stage = stages.find(s => !s.comingSoon)?.id || config.stage;
    }
    this.side = 0; this.step = 'fighters'; this.confirmed = [false, false]; this.portraits = new Map(); this.busy = false; this.hoverId = null;
    for (const old of container.children) { old.hidden = true; old.classList.add('legacy-setup'); }
    this.root = make('div', 'selection-shell');
    const header = make('header', 'selection-header');
    const identity = make('div'); identity.append(make('p', 'archive-eyebrow', 'BATTLE FOR INDEPENDENCE'), make('h2', 'selection-title', 'Choose your fighter'));
    this.heading = identity.querySelector('h2');
    const utility = make('div', 'selection-utility');
    const back = button('Back', 'menu-text-button'); back.onclick = () => { if (!this.back()) onBack(); }; utility.append(back);
    const archive = button('Profile', 'menu-text-button'); archive.onclick = onProfile;
    const options = button('Options', 'menu-text-button'); options.onclick = onOptions;
    utility.append(archive, options); header.append(identity, utility);
    this.steps = make('nav', 'selection-steps'); this.steps.setAttribute('aria-label', 'Match setup');
    this.fighterStep = button('01  FIGHTERS'); this.stageStep = button('02  ARENA');
    this.fighterStep.onclick = () => this.setStep('fighters'); this.stageStep.onclick = () => this.setStep('stages');
    this.steps.append(this.fighterStep, this.stageStep);

    this.fighterBody = make('div', 'selection-fighters');
    const preview = make('div', 'selection-preview'); this.preview = preview;
    const cabinet = make('div', 'preview-cabinet'); cabinet.setAttribute('aria-hidden', 'true');
    for (const corner of ['tl', 'tr', 'bl', 'br']) cabinet.append(make('span', `preview-corner preview-corner-${corner}`));
    for (const edge of ['top', 'right', 'bottom', 'left']) cabinet.append(make('span', `preview-edge preview-edge-${edge}`));
    const hex = make('div', 'preview-hex'); hex.setAttribute('aria-hidden', 'true');
    const scan = make('div', 'preview-scan'); scan.setAttribute('aria-hidden', 'true');
    this.previewCanvasSlot = make('div', 'selection-preview-canvas');
    this.previewStatus = make('p', 'selection-preview-status', 'Preparing fighter showcase…'); this.previewCanvasSlot.append(this.previewStatus);
    const backdrop = make('div', 'selection-preview-seal', 'BFI'); backdrop.setAttribute('aria-hidden', 'true');
    this.previewBanner = make('p', 'preview-banner', 'PLAYER 1 SELECT');
    this.previewName = make('h3', 'selection-name'); this.previewRole = make('p', 'selection-role');
    this.previewNote = make('p', 'selection-note', 'Every round is a fresh argument. Settle it with your hands.');
    this.previewTags = make('ul', 'preview-tags');
    this.identity = make('div', 'selection-identity'); this.identity.append(this.previewRole, this.previewName, this.previewTags, this.previewNote);
    this.live = make('p', 'sr-only'); this.live.setAttribute('role', 'status'); this.live.setAttribute('aria-live', 'polite');
    preview.append(hex, scan, cabinet, backdrop, this.previewCanvasSlot, this.previewBanner, this.identity);
    const rosterPanel = make('section', 'roster-panel'); rosterPanel.setAttribute('aria-label', 'Fighter roster');
    this.sideTabs = make('div', 'selection-side-tabs');
    this.sideButtons = [0, 1].map(side => {
      const b = button(`PLAYER ${side + 1}`); b.dataset.side = String(side);
      b.onclick = () => { if (side === 1 && !this.confirmed[0]) return; this.side = side; this.hoverId = null; this.refresh(true); };
      this.sideTabs.append(b); return b;
    });
    this.rosterGrid = make('div', 'roster-grid');
    this.rosterButtons = new Map();
    for (const definition of roster) {
      const b = button('', 'roster-card'); b.dataset.fighter = definition.id;
      const image = make('img', 'roster-image'); image.alt = ''; image.hidden = true;
      const initial = make('span', 'roster-initial', definition.label[0]); initial.setAttribute('aria-hidden', 'true');
      const frame = make('span', 'roster-card-frame'); frame.setAttribute('aria-hidden', 'true');
      const labels = make('span', 'roster-card-label'); labels.append(make('span', 'roster-card-index', String(this.rosterButtons.size + 1).padStart(2, '0')), make('strong', '', definition.label));
      const marker = make('span', 'roster-card-marker');
      b.append(initial, image, frame, labels, marker);
      b.onclick = () => this.confirmFighter(definition.id);
      b.onfocus = () => this.previewFighter(definition.id);
      b.onpointerenter = () => { if (!b.disabled) this.previewFighter(definition.id); };
      this.rosterButtons.set(definition.id, b); this.rosterGrid.append(b);
    }
    for (let i = roster.length; i < 6; i++) {
      const card = make('div', 'roster-card roster-future'); card.setAttribute('aria-label', 'Future roster slot');
      card.append(make('span', '', '＋'), make('small', '', 'TO BE ANNOUNCED')); this.rosterGrid.append(card);
    }
    this.rosterGrid.addEventListener('keydown', event => {
      const cards = [...this.rosterButtons.values()].filter(card => !card.disabled);
      const current = cards.indexOf(document.activeElement);
      if (current < 0 || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return;
      event.preventDefault();
      const direction = ['ArrowLeft', 'ArrowUp'].includes(event.code) ? -1 : 1;
      const next = cards[(current + direction + cards.length) % cards.length];
      next.focus();
    });
    const seatGrid = make('div', 'selection-seats');
    this.seats = [0, 1].map(side => {
      const seat = make('section', `selection-seat seat-${side}`);
      seat.append(arcadeFrame(true), make('span', 'archive-eyebrow', `PLAYER ${side + 1}`));
      const name = make('strong', 'seat-name'); const control = make('div', 'seat-control');
      const buttons = ['human', 'cpu'].map(value => {
        const b = button(value === 'human' ? 'Human' : 'CPU');
        b.onclick = () => { config.control[side] = value; this.changed(); this.refresh(); }; control.append(b); return b;
      });
      const difficulty = make('select', 'seat-difficulty'); difficulty.setAttribute('aria-label', `Player ${side + 1} CPU difficulty`);
      for (const [id, preset] of Object.entries(difficulties)) { const opt = make('option', '', preset.label || id); opt.value = id; difficulty.append(opt); }
      difficulty.onchange = () => { config.difficulty[side] = difficulty.value; this.changed(); };
      seat.append(name, control, difficulty); seatGrid.append(seat); return { seat, name, buttons, difficulty };
    });
    rosterPanel.append(this.sideTabs, this.rosterGrid, seatGrid); this.fighterBody.append(preview, rosterPanel);

    this.stageBody = make('div', 'selection-stages');
    this.stageHero = make('div', 'stage-hero');
    this.stageArt = make('div', 'stage-hero-art');
    this.stageHero.append(arcadeFrame(), this.stageArt);
    const stageCopy = make('div', 'stage-hero-copy'); this.stageName = make('h3'); this.stageDescription = make('p'); this.stageHazard = make('p', 'stage-hazard');
    stageCopy.append(make('span', 'archive-eyebrow', 'THE NEXT BATTLEGROUND'), this.stageName, this.stageDescription, this.stageHazard); this.stageHero.append(stageCopy);
    this.stageGrid = make('div', 'stage-grid'); this.stageButtons = new Map();
    for (const [i, stage] of stages.entries()) {
      const b = button('', `stage-card${stage.comingSoon ? ' coming-soon' : ''}`); b.dataset.stage = stage.id;
      const art = make('div', 'stage-card-art'); art.dataset.art = stage.art || stage.id;
      if (stage.preview || stage.image) art.style.backgroundImage = `url("${stage.preview || stage.image}")`;
      b.append(arcadeFrame(true), art, make('span', 'stage-card-number', `ARENA ${String(i + 1).padStart(2, '0')}`), make('strong', '', stage.label || stage.name || stage.id));
      if (stage.comingSoon) {
        b.disabled = true;
        const lock = make('span', 'stage-lock');
        lock.append(make('em', 'stage-lock-title', 'COMING SOON'), make('span', 'stage-lock-banner', 'LOCKED'));
        b.append(lock);
      }
      b.onclick = () => { if (stage.comingSoon) return; config.stage = stage.id; this.changed(); this.refresh(); };
      this.stageButtons.set(stage.id, b); this.stageGrid.append(b);
    }
    const stageRules = make('label', 'selection-stage-rules'); this.hazards = make('input'); this.hazards.type = 'checkbox';
    if (typeof config.hazards !== 'boolean') config.hazards = true;
    this.hazards.checked = config.hazards;
    this.hazards.onchange = () => { config.hazards = this.hazards.checked; this.changed(); };
    const hazardCopy = make('span'); hazardCopy.append(make('strong', '', 'Arena hazards'), make('small', '', 'Telegraphed danger zones. Jump or move clear.'));
    stageRules.append(this.hazards, hazardCopy);
    this.stageBody.append(this.stageHero, this.stageGrid, stageRules);
    const footer = make('footer', 'selection-footer');
    const roundsField = make('label', 'selection-rounds'); roundsField.append(make('span', '', 'MATCH LENGTH'));
    this.rounds = make('select');
    for (const [value, text] of [[2, 'Best of three'], [1, 'Single round']]) { const opt = make('option', '', text); opt.value = value; this.rounds.append(opt); }
    this.rounds.onchange = () => { config.roundsToWin = Number(this.rounds.value); this.changed(); };
    roundsField.append(this.rounds);
    this.footerSummary = make('p', 'selection-summary');
    this.proceed = button('Choose arena  →', 'btn btn-primary selection-proceed');
    this.proceed.onclick = async () => {
      if (!this.confirmed.every(Boolean)) { this.confirmFighter(this.shownFighter().id); return; }
      if (this.step === 'fighters' && stages.length) { this.setStep('stages'); return; }
      if (this.busy) return;
      this.busy = true; this.proceed.disabled = true; this.proceed.textContent = 'Entering arena…';
      try { await onFight(); } finally { this.busy = false; this.proceed.disabled = false; this.refresh(); }
    };
    footer.append(roundsField, this.footerSummary, this.proceed);
    this.root.append(header, this.steps, this.fighterBody, this.stageBody, footer, this.live); container.append(this.root);
    this.root.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.code === 'Escape') { e.preventDefault(); if (!this.back()) onBack(); }
    });
    if (!stages.some(s => s.id === config.stage) && stages[0]) config.stage = stages[0].id;
    this.refresh();
  }
  changed() { this.onChange(this.config); }
  shownFighter() {
    const id = this.hoverId || this.config.fighters[this.side];
    return this.roster.find(f => f.id === id && !(this.confirmed[1 - this.side] && this.config.fighters[1 - this.side] === id))
      || this.roster.find(f => !this.confirmed[1 - this.side] || f.id !== this.config.fighters[1 - this.side]);
  }
  previewFighter(id) {
    if (this.confirmed[1 - this.side] && this.config.fighters[1 - this.side] === id) return;
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.refresh(true);
  }
  confirmFighter(id) {
    const from = this.side;
    const result = assignFighter(this.config.fighters, this.side, id, this.confirmed);
    if (!result.accepted) return;
    this.config.fighters[0] = result.fighters[0];
    this.config.fighters[1] = result.fighters[1];
    this.confirmed[from] = true;
    this.side = result.side;
    this.hoverId = null;
    this.changed();
    const label = this.roster.find(f => f.id === id)?.label || id;
    if (from === 0) {
      this.live.textContent = `${label} locked in for Player 1. Player 2, choose your fighter.`;
      this.refresh(true);
      this.rosterButtons.get(this.shownFighter().id)?.focus();
      return;
    }
    this.live.textContent = `${label} locked in for Player 2.`;
    this.refresh(true);
    if (this.stages.length) this.setStep('stages');
  }
  focusDefault() {
    if (this.step === 'fighters') return this.rosterButtons.get(this.shownFighter().id);
    const current = this.stageButtons.get(this.config.stage);
    return current && !current.disabled ? current : [...this.stageButtons.values()].find(b => !b.disabled);
  }
  setStep(step) {
    if (step === 'stages' && !this.confirmed.every(Boolean)) return;
    this.step = step; this.refresh(step === 'fighters');
    this.focusDefault()?.focus();
  }
  show() {
    this.refresh(true);
    if (!this.root.contains(document.activeElement)) this.focusDefault()?.focus({ preventScroll: true });
  }
  reset() {
    this.confirmed = [false, false]; this.side = 0; this.step = 'fighters'; this.hoverId = null;
    this.refresh(true);
  }
  back() {
    if (this.step === 'stages') { this.setStep('fighters'); return true; }
    if (this.side === 1) {
      this.confirmed = [false, false]; this.side = 0; this.hoverId = null;
      this.refresh(true); this.focusDefault()?.focus(); return true;
    }
    return false;
  }
  setPreviewCanvas(canvas) { this.previewCanvas = canvas; this.previewCanvasSlot.replaceChildren(canvas); canvas.classList.add('fighter-showcase'); canvas.setAttribute('aria-label', 'Rotating 3D fighter preview'); }
  previewError(message = 'Fighter showcase unavailable. You can still enter the arena.') { this.previewStatus.textContent = message; this.previewCanvasSlot.replaceChildren(this.previewStatus); }
  setPortrait(id, url) {
    this.portraits.set(id, url);
    const card = this.rosterButtons.get(id); if (!card) return;
    const img = card.querySelector('img'); img.src = url; img.hidden = false; card.classList.add('has-portrait');
  }
  setStagePortrait(id, url) {
    const art = this.stageButtons.get(id)?.querySelector('.stage-card-art');
    if (art) { art.style.backgroundImage = `url("${url}")`; art.classList.add('has-stage-portrait'); }
    this.stagePortraits ||= new Map(); this.stagePortraits.set(id, url); this.refresh();
  }
  refresh(animate = false) {
    const selected = this.shownFighter();
    this.heading.textContent = this.step === 'fighters' ? 'Choose your fighter' : 'Choose your arena';
    this.fighterBody.hidden = this.step !== 'fighters'; this.stageBody.hidden = this.step !== 'stages';
    this.fighterStep.setAttribute('aria-current', String(this.step === 'fighters')); this.stageStep.setAttribute('aria-current', String(this.step === 'stages'));
    this.stageStep.disabled = !this.confirmed.every(Boolean);
    this.preview.dataset.side = String(this.side);
    this.previewBanner.textContent = `PLAYER ${this.side + 1} SELECT`;
    this.previewName.textContent = selected.label;
    this.previewRole.textContent = selected.combat?.archetype || (typeof selected.archetype === 'string' ? selected.archetype : selected.archetype?.label) || 'ARCADE COMBATANT';
    this.previewNote.textContent = selected.combat?.description || selected.description || selected.tagline || 'The bell is the only invitation you need.';
    const signatures = selected.combat?.signature || [];
    this.previewTags.replaceChildren(...signatures.map(id => make('li', '', selected.combat?.moves?.[id]?.name || id.replace(/([A-Z])/g, ' $1').trim())));
    this.previewCanvasSlot.dataset.side = this.side;
    if (animate) {
      if (this.previewCanvas && !this.previewCanvas.isConnected) this.previewCanvasSlot.replaceChildren(this.previewCanvas);
      this.identity.classList.remove('name-enter'); void this.identity.offsetWidth; this.identity.classList.add('name-enter');
      this.preview.classList.remove('cabinet-enter'); void this.preview.offsetWidth; this.preview.classList.add('cabinet-enter');
      this.onPreview(selected.id, this.side);
    }
    for (const [id, card] of this.rosterButtons) {
      const owner = this.confirmed[0] && this.config.fighters[0] === id ? 0 : this.confirmed[1] && this.config.fighters[1] === id ? 1 : -1;
      const taken = owner === 1 - this.side;
      card.disabled = taken;
      card.setAttribute('aria-pressed', String(id === selected.id));
      card.dataset.owner = owner < 0 ? '' : String(owner);
      card.querySelector('.roster-card-marker').textContent = owner < 0 ? '' : `P${owner + 1}`;
    }
    for (const side of [0, 1]) {
      this.sideButtons[side].setAttribute('aria-pressed', String(this.side === side));
      this.sideButtons[side].disabled = side === 1 && !this.confirmed[0];
      const seat = this.seats[side];
      seat.seat.classList.toggle('seat-active', this.side === side);
      seat.name.textContent = this.confirmed[side] ? `${this.roster.find(f => f.id === this.config.fighters[side])?.label} · Ready` : side === this.side ? 'Choose your fighter' : 'Waiting for Player 1';
      seat.buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(this.config.control[side] === ['human', 'cpu'][i])));
      seat.difficulty.value = this.config.difficulty[side]; seat.difficulty.hidden = this.config.control[side] !== 'cpu';
    }
    const stage = this.stages.find(s => s.id === this.config.stage) || this.stages[0];
    if (stage) {
      this.stageName.textContent = stage.label || stage.name || stage.id;
      this.stageDescription.textContent = stage.description || stage.tagline || 'A new arena. The same unfinished business.';
      this.stageHazard.textContent = typeof stage.hazard === 'string' ? stage.hazard : stage.hazard?.description || stage.hazard?.label || stage.hazard?.name || 'Watch the edges. Every arena has a personality.';
      this.stageArt.dataset.art = stage.art || stage.id;
      const preview = this.stagePortraits?.get(stage.id) || stage.preview || stage.image;
      this.stageArt.style.backgroundImage = preview ? `url("${preview}")` : '';
      this.stageArt.classList.toggle('has-stage-portrait', Boolean(preview));
      for (const [id, b] of this.stageButtons) b.setAttribute('aria-pressed', String(stage.id === id));
    }
    this.rounds.value = this.config.roundsToWin;
    this.hazards.checked = this.config.hazards;
    this.footerSummary.textContent = [0, 1].map(side => this.confirmed[side] ? this.roster.find(f => f.id === this.config.fighters[side])?.label : `P${side + 1} · Not selected`).join('  vs  ');
    if (!this.busy) this.proceed.textContent = !this.confirmed.every(Boolean) ? `Confirm Player ${this.side + 1}` : this.step === 'fighters' && this.stages.length ? 'Choose arena  →' : 'Enter the arena';
  }
}
