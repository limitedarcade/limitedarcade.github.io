// The HUD, built as DOM rather than drawn into the canvas.
//
// Text stays crisp at any device pixel ratio, it scales with CSS instead of a
// second projection, and a screen reader can announce the round state. The only
// canvas here is the blood on the lens, which has to be pixels.
//
// Portraits and display names are explicit placeholders: generated plates that
// read as unfinished on purpose, so nobody mistakes them for final art.

import { MATCH, STAGE_AXE_ZONE } from '../engine/frameData.js';
import { comboTier } from '../game/announcer.js';
import { fillAxePromptCommands, renderTokens, tokensFromActions } from './commandIcons.js';

// Health fraction at which the plate flashes and the screen edge starts to
// bleed. Shared with the announcer so the taunt and the visuals agree.
const DANGER = 0.25;

const PLACEHOLDER_TINT = ['#c8102e', '#1d4ed8'];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A deliberately unfinished portrait plate: initial, hazard stripes, and the
// word PLACEHOLDER small enough not to shout but present enough to be honest.
function placeholderPortrait(label, tint) {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#10151f';
  ctx.fillRect(0, 0, 160, 160);
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = tint;
  ctx.lineWidth = 12;
  for (let i = -160; i < 320; i += 34) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + 160, 160);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = tint;
  ctx.font = '700 96px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((label[0] || '?').toUpperCase(), 80, 74);
  ctx.fillStyle = 'rgba(240,244,255,0.55)';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText('FIGHTER', 80, 138);
  return canvas.toDataURL();
}

export class Hud {
  constructor(container, { fighters, humanSides = [] }) {
    this.container = container;
    this.root = el('div', 'hud');
    this.plates = [];
    this.displayHealth = [1, 1];
    // Whose peril the screen reports. With a human in the match only their own
    // danger pulses -- being told the opponent is nearly dead is information,
    // not pressure, and it drains the moment of the player's own last hit.
    this.humanSides = humanSides;

    const top = el('div', 'hud-top');
    const centre = el('div', 'hud-centre');
    this.pips = [el('div', 'pips pips-left'), el('div', 'pips pips-right')];
    this.timer = el('div', 'timer', String(MATCH.timerTicks));
    const badge = el('div', 'timer-badge');
    badge.append(this.timer);
    centre.append(this.pips[0], badge, this.pips[1]);

    for (let side = 0; side < 2; side += 1) {
      const definition = fighters[side];
      const plate = el('div', `plate plate-${side === 0 ? 'left' : 'right'}`);
      const portrait = el('div', 'portrait');
      const img = document.createElement('img');
      img.alt = '';
      img.src = definition.portrait || placeholderPortrait(definition.label, PLACEHOLDER_TINT[side]);
      portrait.append(img);

      const body = el('div', 'plate-body');
      const name = el('div', 'plate-name', definition.label.toUpperCase());
      const track = el('div', 'health-track');
      const chip = el('div', 'health-chip');
      const fill = el('div', 'health-fill');
      track.append(chip, fill);
      const burstRow = el('div', 'burst-row');
      const burstTrack = el('div', 'burst-track');
      const burstFill = el('div', 'burst-fill');
      burstTrack.append(burstFill);
      burstRow.append(el('span', 'burst-label', 'BURST'), burstTrack);
      body.append(name, track, burstRow);
      plate.append(portrait, body);

      this.plates.push({ plate, chip, fill, name, burstFill });
      top.append(side === 0 ? plate : centre);
      if (side === 1) top.append(plate);
    }

    const bottom = el('div', 'hud-bottom');
    this.meters = [];
    for (let side = 0; side < 2; side += 1) {
      const meter = el('div', `meter meter-${side === 0 ? 'left' : 'right'}`);
      const stocks = el('div', 'meter-stocks', '0');
      const max = el('div', 'meter-max', 'MAX');
      const track = el('div', 'meter-track');
      const fill = el('div', 'meter-fill');
      track.append(fill);
      if (side === 0) meter.append(stocks, max, track);
      else meter.append(track, max, stocks);
      this.meters.push({ meter, stocks, fill, max });
      bottom.append(meter);
    }

    // A combo reads as two things at once: how many, and how bad. The count
    // ticks every hit; the tier banner only changes when a threshold is
    // crossed, so it lands as a verdict rather than a running total.
    this.combos = [];
    for (const side of ['left', 'right']) {
      const combo = el('div', `combo combo-${side}`);
      const tier = el('div', 'combo-tier');
      const count = el('div', 'combo-count');
      combo.append(tier, count);
      this.combos.push({ root: combo, tier, count, shownTier: 0 });
    }
    this.damageLayer = el('div', 'damage-layer');
    this.vignette = el('div', 'danger-vignette');
    this.announce = el('div', 'announce');
    this.announce.setAttribute('aria-live', 'assertive');
    this.finisherBar = el('div', 'finisher-bar');
    this.finisherFill = el('div', 'finisher-fill');
    this.finisherBar.append(this.finisherFill);

    this.recoveries = [0, 1].map(side => {
      const root = el('div', `recovery-cue recovery-cue-${side === 0 ? 'left' : 'right'}`);
      root.hidden = true;
      root.append(el('strong', 'recovery-title', `P${side + 1} · CHOOSE YOUR RECOVERY`));
      const choices = el('div', 'recovery-choices');
      const command = (icon, label) => {
        const item = el('span', 'recovery-choice');
        const glyph = el('b', 'recovery-icon', icon);
        item.append(glyph, el('span', '', label));
        choices.append(item);
        return glyph;
      };
      command('↓', 'Stay down');
      command('↑', 'or BLOCK: rise');
      const forward = command('→', 'Roll forward');
      const back = command('←', 'Roll back');
      root.append(choices, el('span', 'recovery-wait', 'No input also stays down.'));
      return { root, forward, back };
    });

    this.blood = document.createElement('canvas');
    this.blood.className = 'screen-blood';
    this.bloodCtx = this.blood.getContext('2d');
    this.bloodFade = 0;

    this.axePrompts = [0, 1].map(side => this.makeAxePrompt(side));

    this.root.append(this.blood, this.vignette, top, bottom, this.damageLayer,
      this.combos[0].root, this.combos[1].root, this.announce, this.finisherBar,
      ...this.recoveries.map(cue => cue.root),
      ...this.axePrompts.map(prompt => prompt.root));
    container.append(this.root);
    this.resize();
  }

  makeAxePrompt(side) {
    const root = el('div', `axe-prompt axe-prompt-${side === 0 ? 'p1' : 'p2'}`);
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    root.setAttribute('aria-hidden', 'true');
    const card = el('div', 'axe-prompt-card');
    const kicker = el('span', 'axe-prompt-kicker', `P${side + 1} · THROW`);
    const title = el('strong', 'axe-prompt-title', 'ICE AXE');
    const arcade = el('div', 'axe-prompt-cmd axe-prompt-arcade cmd-strip');
    const touch = el('div', 'axe-prompt-cmd axe-prompt-touch cmd-strip');
    const orKeys = el('span', 'axe-prompt-or', 'or');
    const keys = el('div', 'axe-prompt-keys cmd-strip');
    orKeys.hidden = true;
    keys.hidden = true;
    renderTokens(arcade, tokensFromActions(['down', 'lp', 'hp']));
    renderTokens(touch, tokensFromActions(['down', 'grab']));
    card.append(kicker, title, arcade, touch, orKeys, keys);
    root.append(card, el('i', 'axe-prompt-caret'));
    return { root, kicker, title, keys, side, shown: false, keySig: '' };
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.blood.width = Math.round(innerWidth * dpr * 0.5);
    this.blood.height = Math.round(innerHeight * dpr * 0.5);
  }

  update(snapshot, dt, extras = {}) {
    this.timer.textContent = String(snapshot.timer).padStart(2, '0');
    this.timer.classList.toggle('urgent', snapshot.timer <= 10);

    for (let side = 0; side < 2; side += 1) {
      const view = snapshot.fighters[side];
      const recovery = this.recoveries[side];
      recovery.root.hidden = snapshot.phase !== 'fight' || !this.humanSides.includes(side) || view.state !== 'downed';
      if (!recovery.root.hidden) {
        recovery.forward.textContent = view.facing >= 0 ? '→' : '←';
        recovery.back.textContent = view.facing >= 0 ? '←' : '→';
      }
      const plate = this.plates[side];
      const pct = Math.max(0, view.healthPct);
      plate.fill.style.width = `${pct * 100}%`;
      // The chip bar drains toward the real value, so a big combo reads as one
      // long slide rather than an instant jump nobody sees.
      this.displayHealth[side] += (pct - this.displayHealth[side]) * Math.min(1, dt * 3.4);
      if (this.displayHealth[side] < pct) this.displayHealth[side] = pct;
      plate.chip.style.width = `${this.displayHealth[side] * 100}%`;
      plate.plate.classList.toggle('danger', pct <= DANGER);
      plate.burstFill.style.width = `${Math.min(1, view.meterPct * 1.4) * 100}%`;

      const meter = this.meters[side];
      const withinStock = (view.meterPct * MATCH.meterMax) % 1;
      meter.stocks.textContent = String(view.stocks);
      meter.fill.style.width = `${(view.stocks >= MATCH.meterMax ? 1 : withinStock) * 100}%`;
      meter.meter.classList.toggle('maxed', view.stocks >= MATCH.meterMax);
      meter.meter.classList.toggle('ready', view.stocks >= MATCH.finisherStocks);

      const pipRow = this.pips[side];
      if (pipRow.childElementCount !== snapshot.roundsToWin) {
        pipRow.replaceChildren(...Array.from({ length: snapshot.roundsToWin }, () => el('i', 'pip')));
      }
      [...pipRow.children].forEach((pip, i) => pip.classList.toggle('won', i < view.roundsWon));

      // The banner belongs to the attacker, so it is drawn on the far side
      // from the fighter taking the hits.
      const combo = this.combos[side === 0 ? 1 : 0];
      if (view.comboCount >= 2) {
        combo.count.textContent = `${view.comboCount} HITS`;
        const tier = comboTier(view.comboCount);
        if (tier && tier.hits > combo.shownTier) {
          combo.shownTier = tier.hits;
          combo.tier.textContent = tier.label;
          combo.tier.classList.remove('pop');
          void combo.tier.offsetWidth;
          combo.tier.classList.add('pop');
        }
        combo.root.classList.add('show');
      } else {
        combo.root.classList.remove('show');
        combo.shownTier = 0;
        combo.tier.textContent = '';
      }
    }

    // The screen itself reports that someone is one hit from losing. It ramps
    // with how deep into danger they are rather than snapping on at the line.
    const watched = this.humanSides.length ? this.humanSides : [0, 1];
    const worst = Math.min(...watched.map((side) => Math.max(0, snapshot.fighters[side].healthPct)));
    const danger = snapshot.phase === 'fight' && worst <= DANGER ? 1 - worst / DANGER : 0;
    this.vignette.style.opacity = String(danger * 0.9);
    this.vignette.classList.toggle('show', danger > 0);

    if (snapshot.phase === 'finisherWindow') {
      const left = 1 - snapshot.phaseFrame / MATCH.finisherWindowFrames;
      this.finisherBar.classList.add('show');
      this.finisherFill.style.width = `${Math.max(0, left) * 100}%`;
    } else this.finisherBar.classList.remove('show');

    if (this.bloodFade > 0) {
      this.bloodFade = Math.max(0, this.bloodFade - dt * 0.42);
      this.blood.style.opacity = String(this.bloodFade);
    }

    this.updateAxePrompts(snapshot, extras);
  }

  updateAxePrompts(snapshot, { project, bindings } = {}) {
    const ready = new Set([...(snapshot.axePrompt || []), ...(snapshot.ringPrompt || [])]);
    for (const prompt of this.axePrompts) {
      const view = snapshot.fighters[prompt.side];
      const name = snapshot.ringPrompt?.includes(prompt.side) ? 'Rescue Ring' : 'Ice Axe';
      prompt.title.textContent = name.toUpperCase();
      const show = ready.has(prompt.side) && this.humanSides.includes(prompt.side);
      if (show !== prompt.shown) {
        prompt.shown = show;
        prompt.root.classList.toggle('show', show);
        prompt.root.setAttribute('aria-hidden', String(!show));
        if (show) {
          prompt.root.setAttribute('aria-label',
            `${name} ready for player ${prompt.side + 1}. Crouch and press light punch and heavy punch.`);
        } else {
          prompt.root.removeAttribute('aria-label');
        }
      }
      if (!show) continue;
      const solo = this.humanSides.length < 2;
      prompt.kicker.textContent = solo ? 'THROW' : `P${prompt.side + 1} · THROW`;
      const keySig = `${prompt.side}:${bindings?.[prompt.side]?.down}|${bindings?.[prompt.side]?.lp}|${bindings?.[prompt.side]?.hp}`;
      if (prompt.keySig !== keySig) {
        prompt.keySig = keySig;
        fillAxePromptCommands(prompt.root.querySelector('.axe-prompt-arcade'), prompt.keys, { bindings, side: prompt.side });
        const or = prompt.root.querySelector('.axe-prompt-or');
        if (or) or.hidden = prompt.keys.hidden;
      }
      if (!project || !view) continue;
      const [nx, ny] = project(view.x, view.y + STAGE_AXE_ZONE.promptLift);
      prompt.root.style.left = `${(Math.min(0.9, Math.max(0.1, nx)) * 100).toFixed(2)}%`;
      prompt.root.style.top = `${(Math.min(0.72, Math.max(0.16, ny)) * 100).toFixed(2)}%`;
    }
  }

  // A floating damage number at the projected contact point. Capped rather
  // than pooled: a long combo should read as a rising column of numbers, but
  // a hundred live nodes during a finisher is a frame-rate problem, not a
  // readability one.
  damageNumber(nx, ny, damage, kind = '') {
    if (this.damageLayer.childElementCount > 14) this.damageLayer.firstElementChild.remove();
    const node = el('div', `damage-pop ${kind}`, String(damage));
    node.style.left = `${(nx * 100).toFixed(2)}%`;
    node.style.top = `${(ny * 100).toFixed(2)}%`;
    // Nudge each one off the last so stacked hits do not overprint.
    node.style.setProperty('--drift', `${(Math.random() - 0.5) * 3.2}rem`);
    node.addEventListener('animationend', () => node.remove(), { once: true });
    this.damageLayer.append(node);
  }

  clearDamage() {
    this.damageLayer.replaceChildren();
  }

  say(text, kind = '') {
    this.announce.textContent = text;
    this.announce.className = `announce show ${kind}`;
    void this.announce.offsetWidth;
    this.announce.classList.add('pop');
  }

  clearSay() {
    this.announce.className = 'announce';
  }

  // Blood on the lens. Drawn in screen space at the projected hit position so a
  // face-height connect splatters high and a sweep splatters low.
  splatterScreen(nx, ny, power) {
    const ctx = this.bloodCtx;
    const w = this.blood.width;
    const h = this.blood.height;
    const cx = nx * w;
    const cy = ny * h;
    const drops = Math.round(5 + power * 9);
    for (let i = 0; i < drops; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const spread = Math.pow(Math.random(), 0.55) * (w * 0.09) * (0.5 + power);
      const r = (1 + Math.pow(Math.random(), 2) * 9) * (0.5 + power * 0.45);
      const x = cx + Math.cos(angle) * spread, y = cy + Math.sin(angle) * spread;
      const pigment = ctx.createRadialGradient(x - r * 0.2, y - r * 0.25, 0, x, y, r);
      pigment.addColorStop(0, 'rgba(154,39,46,0.62)');
      pigment.addColorStop(0.3, 'rgba(76,5,16,0.78)');
      pigment.addColorStop(0.8, 'rgba(54,3,12,0.65)');
      pigment.addColorStop(1, 'rgba(74,6,18,0)');
      ctx.fillStyle = pigment;
      ctx.beginPath();
      ctx.ellipse(x, y,
        r, r * (0.5 + Math.random()), Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    this.bloodFade = Math.min(0.65, this.bloodFade + 0.2 + power * 0.12);
    this.blood.style.opacity = String(this.bloodFade);
  }

  clearBlood() {
    this.bloodCtx.clearRect(0, 0, this.blood.width, this.blood.height);
    this.bloodFade = 0;
    this.blood.style.opacity = '0';
  }

  resetRound() {
    this.displayHealth = [1, 1];
    this.clearBlood();
    this.clearDamage();
    this.vignette.classList.remove('show');
    this.vignette.style.opacity = '0';
    for (const combo of this.combos) {
      combo.root.classList.remove('show');
      combo.shownTier = 0;
      combo.tier.textContent = '';
    }
    for (const prompt of this.axePrompts) {
      prompt.shown = false;
      prompt.root.classList.remove('show');
      prompt.root.removeAttribute('aria-label');
      prompt.root.setAttribute('aria-hidden', 'true');
    }
  }
}
