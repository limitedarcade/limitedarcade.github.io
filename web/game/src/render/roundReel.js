import * as THREE from '../vendor/three.module.js';
import { reelAt, endCard } from '../engine/reelTimeline.js';
import { PALETTE as C } from './palette.js';
import { stageOutcome } from '../engine/stageOutcomes.js';

export const WIN_QUOTES = ['“That is how you close a round.”', '“Keep the rematch warm.”'];

// Screen-space Three.js plates. The callout is an animated textured plane,
// rendered after the arena, with its own depth and slam scale.
export class RoundReel {
  constructor({ audio, camera, reducedMotion }) {
    this.audio = audio; this.fightCamera = camera; this.reducedMotion = reducedMotion;
    this.scene = new THREE.Scene(); this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 10);
    this.camera.position.z = 2;
    this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas); this.texture.colorSpace = THREE.SRGBColorSpace;
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
    }));
    this.scene.add(this.plane); this.key = null; this.visible = false;
    this.live = document.createElement('span'); this.live.className = 'sr-only';
    this.live.setAttribute('aria-live', 'assertive'); document.body.append(this.live);
    this.resize();
  }
  resize() {
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.min(1920, Math.round(innerWidth * ratio));
    this.canvas.height = Math.round(innerHeight * this.canvas.width / innerWidth);
    this.key = null;
  }
  reset() { this.key = null; this.visible = false; this.cueKey = null; }
  update(s) {
    const edit = reelAt(s), key = `${s.round}:${s.phase}:${edit.stage}`;
    this.edit = edit;
    this.visible = !['play', 'walkout', 'slowmo', 'freeze', 'execution'].includes(edit.stage) || (edit.stage === 'execution' && !!s.finisher);
    if (key !== this.key) { this.key = key; this.draw(s, edit); }
    if (key !== this.cueKey) {
      this.cueKey = key;
      if (edit.voice) this.audio.voice(edit.voice);
      if (['round', 'fight', 'ko', 'result', 'intermission'].includes(edit.stage)) {
        this.audio.impact(); this.fightCamera.addShake(this.reducedMotion ? 0 : edit.stage === 'fight' ? 0.4 : 0.18);
      }
      if (edit.text) this.live.textContent = edit.text;
    }
    const slam = ['round', 'fight', 'ko', 'result'].includes(edit.stage);
    const t = Math.max(0, edit.t);
    const scale = !this.reducedMotion && slam ? 1 + 1.5 * Math.exp(-t * 22) - 0.05 * Math.sin(t * 22) * Math.exp(-t * 8) : 1;
    this.plane.scale.setScalar(scale);
    this.plane.material.opacity = this.reducedMotion ? 1 : Math.min(1, t * 18 + 0.15);
    return edit;
  }
  draw(s, edit) {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const text = (label, x, y, size, color = C.gold, font = 'Fatal Fighter', align = 'center', maxWidth = w * 0.9) => {
      ctx.save(); ctx.font = `${size}px "${font}", Impact, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size * 0.095); ctx.strokeStyle = C.ink;
      ctx.shadowColor = C.ink; ctx.shadowBlur = size * 0.1; ctx.shadowOffsetY = size * 0.055;
      ctx.strokeText(label, x, y, maxWidth);
      const grad = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
      grad.addColorStop(0, color === C.gold ? C.goldLight : C.paper); grad.addColorStop(0.42, color);
      grad.addColorStop(1, color === C.gold ? C.goldDeep : color);
      ctx.fillStyle = grad; ctx.fillText(label, x, y, maxWidth); ctx.restore();
    };
    const plate = (y, height, color = C.ink) => { ctx.fillStyle = color; ctx.globalAlpha = 0.88; ctx.fillRect(0, y, w, height); ctx.globalAlpha = 1; };
    if (edit.stage === 'execution' && s.finisher) {
      plate(0, h * 0.075);
      text(s.finisher.name.toUpperCase(), w / 2, h * 0.04, Math.min(w * 0.035, h * 0.044), C.gold, 'Great Fighter');
    } else if (edit.stage === 'versus') {
      plate(0, h * 0.065); plate(h * 0.84, h * 0.16);
      ctx.fillStyle = C.red; ctx.fillRect(0, h * 0.84, w * 0.45, 3);
      ctx.fillStyle = C.blue; ctx.fillRect(w * 0.55, h * 0.84, w * 0.45, 3);
      text('VS', w / 2, h * 0.45, Math.min(w * 0.2, h * 0.22), C.gold);
      for (let side = 0; side < 2; side++) text(s.fighters[side].label.toUpperCase(), w * (side ? 0.76 : 0.24), h * 0.9,
        Math.min(w * 0.055, h * 0.07), C.paper, 'Great Fighter', 'center', w * 0.43);
      text('LAKE AMERICA', w / 2, h * 0.033, Math.min(w * 0.023, h * 0.026), C.paper, 'Segoe UI');
    } else if (edit.stage === 'intermission') {
      ctx.fillStyle = '#080c18e8'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = C.gold; ctx.fillRect(w * 0.42, h * 0.35, w * 0.16, 3);
      text('THE RIVALRY CONTINUES', w / 2, h * 0.29, Math.min(w * 0.027, h * 0.035), C.paper, 'Segoe UI');
      text(edit.text, w / 2, h * 0.5, Math.min(w * 0.13, h * 0.2), C.gold);
      text('RESET. REFOCUS. RETURN.', w / 2, h * 0.67, Math.min(w * 0.022, h * 0.029), C.paper, 'Segoe UI');
    } else if (edit.stage === 'roundVictory') {
      const winner = s.roundWinner;
      plate(h * 0.75, h * 0.25);
      text(winner === null ? 'NO ONE STANDS' : `${s.fighters[winner].label.toUpperCase()} WINS`, w / 2, h * 0.82,
        Math.min(w * 0.065, h * 0.07), C.gold);
      if (winner !== null) text(WIN_QUOTES[winner], w / 2, h * 0.9, Math.min(w * 0.025, h * 0.032), C.paper, 'Segoe UI');
    } else if (edit.stage === 'result') {
      const card = endCard(s);
      const outcome = stageOutcome(s);
      const color = card.kind === 'fatality' ? C.red : card.kind === 'double' ? C.paper : C.gold;
      if (outcome) {
        // Leave the action and shoreline sign unobstructed during the ending.
        plate(0, h * .08);
        text(`${s.fighters[s.winner].label.toUpperCase()} WINS · ${card.title}`, w / 2, h * .04,
          Math.min(w * .035, h * .043), color, 'Great Fighter');
        plate(h * .92, h * .08);
        text(outcome.quote, w / 2, h * .96, Math.min(w * .024, h * .03), C.paper, 'Segoe UI');
      } else {
      plate(h * 0.08, h * 0.26);
      text(card.title, w / 2, h * 0.18, Math.min(w * 0.13, h * 0.14), color);
      text(card.subtitle, w / 2, h * 0.3, Math.min(w * 0.032, h * 0.036), C.paper, 'Segoe UI');
      if (s.winner !== null) {
        plate(h * 0.8, h * 0.2);
        text(s.fighters[s.winner].label.toUpperCase(), w / 2, h * 0.85, Math.min(w * 0.048, h * 0.054), C.paper, 'Great Fighter');
        text(s.finisher?.tagline || WIN_QUOTES[s.winner], w / 2, h * 0.93, Math.min(w * 0.025, h * 0.031), C.paper, 'Segoe UI');
      }
      }
    } else if (edit.text) {
      const color = edit.stage === 'ko' || edit.stage === 'finish' ? C.red : C.gold;
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-0.065);
      const gradient = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      gradient.addColorStop(0, '#080c1800'); gradient.addColorStop(0.35, C.ink); gradient.addColorStop(0.65, C.ink); gradient.addColorStop(1, '#080c1800');
      ctx.fillStyle = gradient; ctx.globalAlpha = 0.72; ctx.fillRect(-w / 2, -h * 0.13, w, h * 0.26); ctx.restore();
      text(edit.text, w / 2, h * 0.49, Math.min(w * 0.17, h * 0.25), color);
    }
    this.texture.needsUpdate = true;
  }
  render(renderer) {
    if (!this.visible) return;
    const auto = renderer.autoClear; renderer.autoClear = false;
    renderer.clearDepth(); renderer.render(this.scene, this.camera); renderer.autoClear = auto;
  }
}
