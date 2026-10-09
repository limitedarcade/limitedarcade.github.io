import * as THREE from '../vendor/three.module.js';
import { fighterBone } from './fighterBones.js';

// The authored clips remain the source of the choreography. This pass only
// supplies the small whole-body mechanics that a keyframed limb cannot: a
// planted base, an anticipation away from the target, and a drive through the
// contact frame. Values are fighter-specific and confined to the four normals;
// signature moves and their authored choreography retain their own poses.
export const STRIKE_PROFILES = Object.freeze({
  trump: Object.freeze({
    lightPunch: Object.freeze({ windup: 0.035, drive: 0.075, lean: 0.045, plant: 'both' }),
    heavyPunch: Object.freeze({ windup: 0.070, drive: 0.145, lean: 0.090, plant: 'both' }),
    lightKick: Object.freeze({ windup: 0.045, drive: 0.095, lean: 0.060, plant: 'support' }),
    heavyKick: Object.freeze({ windup: 0.080, drive: 0.165, lean: 0.105, plant: 'support' }),
  }),
  carney: Object.freeze({
    lightPunch: Object.freeze({ windup: 0.030, drive: 0.085, lean: 0.042, plant: 'both' }),
    heavyPunch: Object.freeze({ windup: 0.060, drive: 0.130, lean: 0.078, plant: 'both' }),
    lightKick: Object.freeze({ windup: 0.040, drive: 0.110, lean: 0.055, plant: 'support' }),
    heavyKick: Object.freeze({ windup: 0.070, drive: 0.155, lean: 0.095, plant: 'support' }),
  }),
  officer_flock: Object.freeze({
    lightPunch: Object.freeze({ windup: 0.028, drive: 0.070, lean: 0.040, plant: 'both' }),
    heavyPunch: Object.freeze({ windup: 0.065, drive: 0.125, lean: 0.075, plant: 'both' }),
    lightKick: Object.freeze({ windup: 0.035, drive: 0.085, lean: 0.048, plant: 'support' }),
    heavyKick: Object.freeze({ windup: 0.070, drive: 0.140, lean: 0.082, plant: 'support' }),
  }),
  // His authored flails remain the joke: lots of anticipation, little drive.
  lang: Object.freeze({
    lightPunch: Object.freeze({ windup: 0.045, drive: 0.022, lean: 0.025, plant: 'both' }),
    heavyPunch: Object.freeze({ windup: 0.080, drive: 0.035, lean: 0.038, plant: 'both' }),
    lightKick: Object.freeze({ windup: 0.050, drive: 0.025, lean: 0.026, plant: 'support' }),
    heavyKick: Object.freeze({ windup: 0.085, drive: 0.045, lean: 0.045, plant: 'support' }),
  }),
});

const WORLD_Z = new THREE.Vector3(0, 0, 1);
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function strikeSample(fighterId, moveId, frame, move) {
  const profile = STRIKE_PROFILES[fighterId]?.[moveId];
  if (!profile || !move) return null;
  const startup = Math.max(1, move.startup || 1);
  const active = Math.max(1, move.active || 1);
  const recovery = Math.max(1, move.recovery || 1);
  const f = Math.max(0, frame || 0);
  let travel = 0;
  let lean = 0;
  let plantWeight = 1;
  if (f < startup) {
    // Pull away early and arrive back at neutral on the last startup frame, so
    // the authored limb is the first thing that crosses the contact plane.
    const p = clamp(f / startup);
    const anticipation = Math.sin(p * Math.PI);
    travel = -profile.windup * anticipation;
    lean = -profile.lean * 0.65 * anticipation;
  } else if (f < startup + active) {
    const p = clamp((f - startup) / active);
    const punchThrough = 0.78 + 0.22 * Math.sin(p * Math.PI);
    travel = profile.drive * punchThrough;
    lean = profile.lean * punchThrough;
    // A tiny allowed slide is the follow-through, not an ice-skating foot.
    plantWeight = profile.plant === 'support' ? 0.88 : 0.74;
  } else {
    const p = smooth((f - startup - active) / recovery);
    travel = profile.drive * (1 - p);
    lean = profile.lean * (1 - p);
    plantWeight = 0.8 + 0.2 * p;
  }
  return { ...profile, travel, lean, plantWeight };
}

// Additive, restored every FighterView.apply() when the pivot is reset. The
// anchor is measured in world space once per attack, then the support foot is
// pulled back toward it after the lean. This makes the torso commit without
// letting both shoes skate toward the opponent.
export class StrikePose {
  constructor(model, pivot, fighterId) {
    this.model = model;
    this.pivot = pivot;
    this.fighterId = fighterId;
    this.feet = ['footL', 'footR'].map(name => fighterBone(model, name)).filter(Boolean);
    this.point = new THREE.Vector3();
    this.anchors = [];
    this.attackKey = null;
  }

  apply(view) {
    const sample = view.state === 'attack'
      ? strikeSample(this.fighterId, view.move, view.moveFrame, view.moveData)
      : null;
    if (!sample) { this.attackKey = null; this.anchors.length = 0; return; }
    const key = `${view.move}:${view.moveFrame < (this.lastFrame ?? -1) ? (this.serial = (this.serial || 0) + 1) : (this.serial || 0)}`;
    this.lastFrame = view.moveFrame;
    if (key !== this.attackKey || !this.anchors.length) {
      this.attackKey = key;
      this.pivot.updateWorldMatrix(true, true);
      this.anchors = this.feet.map(foot => foot.getWorldPosition(new THREE.Vector3()));
    }

    const facing = Math.sign(view.facing || 1);
    this.pivot.position.x += facing * sample.travel;
    this.pivot.rotateOnWorldAxis(WORLD_Z, -facing * sample.lean);
    if (!this.feet.length) return;

    this.pivot.updateWorldMatrix(true, true);
    const current = this.feet.map(foot => foot.getWorldPosition(new THREE.Vector3()));
    let indices = current.map((_, index) => index);
    if (sample.plant === 'support' && indices.length > 1) {
      // The foot that rose least from its attack-start height is the support
      // foot. This works for both mirrored clips without hard-coding a leg.
      indices = [indices.reduce((best, index) =>
        Math.abs(current[index].y - this.anchors[index].y) < Math.abs(current[best].y - this.anchors[best].y) ? index : best, 0)];
    }
    const dx = indices.reduce((sum, index) => sum + current[index].x - this.anchors[index].x, 0) / indices.length;
    this.pivot.position.x -= dx * sample.plantWeight;
    this.pivot.updateWorldMatrix(true, true);
    let bottom = Infinity;
    for (const foot of this.feet) bottom = Math.min(bottom, foot.getWorldPosition(this.point).y);
    if (bottom < view.y + 0.008) this.pivot.position.y += view.y + 0.008 - bottom;
  }
}
