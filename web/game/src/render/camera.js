// The classic 2D-fighter camera: track the midpoint, pull back as the fighters
// separate, and never show the outside of the arena.
//
// Framing is driven by the sim's distance rather than by either fighter, so the
// shot stays symmetric -- a camera that follows "the player" makes the CPU look
// like it is teleporting whenever the player walks.

import * as THREE from '../vendor/three.module.js';
import { PHYSICS } from '../engine/frameData.js';

const BASE_HEIGHT = 2.24;
const LOOK_HEIGHT = 1.46;

// Leave room for the HUD and touch controls. Fit the full lane position and
// airborne height, rather than zooming toward whichever fighter is attacking.
export function combatFraming(snapshot, aspect, fov, compact = false) {
  const [a, b] = snapshot.fighters;
  const limit = PHYSICS.arenaMax - 2.4;
  const x = THREE.MathUtils.clamp((a.x + b.x) / 2, -limit, limit);
  const top = Math.max(a.y, b.y) + 2.25;
  const bottom = Math.min(0, a.y, b.y) - 0.08;
  const safeTop = compact ? 0.20 : aspect < 1 ? 0.16 : 0.14;
  const safeBottom = compact || aspect < 1 ? 0.76 : 0.91;
  const tangent = Math.tan(fov * Math.PI / 360);
  const verticalFit = (top - bottom) / (2 * tangent * (safeBottom - safeTop));
  const horizontalFit = (Math.max(Math.abs(a.x - x), Math.abs(b.x - x)) + 0.85)
    / (tangent * Math.max(0.25, aspect) * 0.85);
  const z = Math.max(5.0 + snapshot.distance * 0.13, verticalFit, horizontalFit);
  const lookY = (top + bottom) / 2 + (safeTop + safeBottom - 1) * z * tangent;
  return { x, z, lookY, y: lookY + 0.48, top, bottom, safeTop, safeBottom };
}

export class FightCamera {
  constructor(camera) {
    this.camera = camera;
    this.x = 0;
    this.y = BASE_HEIGHT;
    this.z = 8.2;
    this.lookY = LOOK_HEIGHT;
    this.shake = 0;
    this.cinematic = 0;
    this.portrait = false;
    this.impact = null;
    // Angle of the rig around the look point. Zero is the flat side-on shot
    // the whole match is played from; the reel swings it for the beats where
    // the fight has already stopped and the camera is free to editorialise.
    this.orbit = 0;
    this.shakeAge = 1;
    this.shakeDirection = 1;
  }

  setViewport(width, height) {
    const aspect = width / height;
    this.portrait = aspect < 1.0;
    this.compact = height < 500 && aspect >= 1;
    this.camera.aspect = aspect;
    // A phone held upright sees a much narrower slice of the lane, so the lens
    // widens and the rig backs off rather than cropping the fighters' heads.
    this.camera.fov = aspect < 0.75 ? 46 : aspect < 1.35 ? 39 : 33;
    this.baseFov = this.camera.fov;
    this.widthBias = aspect < 1.0 ? 1.9 : aspect < 1.5 ? 0.8 : 0;
    this.camera.updateProjectionMatrix();
  }

  addShake(amount, direction = 0) {
    if (!(amount > 0)) return;
    // Contacts never stack into an unbounded rumble. The strongest recent
    // impulse wins, with an envelope measured in real seconds during hitstop.
    this.shake = Math.min(0.75, Math.max(this.shake, amount));
    this.shakeAge = 0;
    this.shakeDirection = Math.sign(direction) || this.shakeDirection;
  }

  resetImpact() {
    this.impact = null; this.shake = 0; this.shakeAge = 1;
  }

  hit(event, profile) {
    if (profile.dolly) this.impact = { x: event.x, y: event.y, amount: profile.dolly, age: 0 };
  }

  update(dt, snapshot, { focus = null, reducedMotion = false, shot = null, impactDt = dt, frozen = false } = {}) {
    const fov = shot?.fov ?? this.baseFov ?? 33;
    if (this.camera.fov !== fov) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    if (shot?.authored && shot.position && shot.target && (!reducedMotion || shot.static)) {
      this.camera.position.fromArray(shot.position);
      this.camera.lookAt(...shot.target);
      // Keep the tracking rig synchronized when an authored shot hands back.
      this.x = shot.target[0]; this.lookY = shot.target[1]; this.y = shot.position[1];
      this.z = Math.hypot(shot.position[0] - this.x, shot.position[2]);
      this.orbit = Math.atan2(shot.position[0] - this.x, shot.position[2]);
      this.shake = THREE.MathUtils.damp(this.shake, 0, 9, impactDt);
      return;
    }
    if (dt <= 0 && impactDt <= 0) return;
    const [a, b] = snapshot.fighters;
    const midX = shot?.x ?? (focus ? focus.x : (a.x + b.x) / 2);
    const spread = focus ? 1.1 : snapshot.distance;
    const highest = Math.max(a.y, b.y);
    const framing = !shot && !focus ? combatFraming(snapshot, this.camera.aspect, fov, this.compact) : null;

    const fitZ = (snapshot.distance + 1.65) / (2 * Math.tan(this.camera.fov * Math.PI / 360) * this.camera.aspect);
    const wantZ = framing?.z ?? Math.max(shot?.tight && !this.portrait ? 0 : fitZ, (shot?.z ?? (focus ? 4.4 : 6.2 + spread * 0.60)) + (this.widthBias || 0));
    const wantY = framing?.y ?? shot?.y ?? (BASE_HEIGHT + highest * 0.28 + (focus ? 0.15 : 0));
    const wantLook = framing?.lookY ?? shot?.lookY ?? (LOOK_HEIGHT + highest * 0.3);

    // Half the lane width is off-limits at the ends, so the camera stops before
    // the painted backdrop runs out rather than clamping mid-shot.
    const limit = Math.max(0, (PHYSICS.arenaMax - 2.4));
    const clampedX = Math.max(-limit, Math.min(limit, midX));

    const rate = focus ? 7 : 6;
    this.x = THREE.MathUtils.damp(this.x, clampedX, rate, dt);
    this.y = THREE.MathUtils.damp(this.y, wantY, rate, dt);
    this.z = THREE.MathUtils.damp(this.z, Math.max(shot?.tight ? 2.8 : 4.4, wantZ), wantZ > this.z ? 10 : 3.6, dt);
    this.lookY = THREE.MathUtils.damp(this.lookY, wantLook, rate, dt);
    if (shot?.authored || (shot?.cut !== undefined && this.lastCut !== shot.cut)) {
      this.lastCut = shot.cut;
      this.x = clampedX; this.y = wantY; this.z = wantZ; this.lookY = wantLook;
    }
    if (!shot?.tight) this.lastCut = null;

    if (framing) {
      // Pull out immediately when a jump, crossing or viewport resize would
      // otherwise crop a subject during the slower inward camera easing.
      const tangent = Math.tan(fov * Math.PI / 360);
      const horizontal = (Math.max(Math.abs(a.x - this.x), Math.abs(b.x - this.x)) + 0.85)
        / (tangent * this.camera.aspect * 0.9);
      const vertical = Math.max((framing.top - this.lookY) / (tangent * (1 - 2 * framing.safeTop)),
        (this.lookY - framing.bottom) / (tangent * (2 * framing.safeBottom - 1)));
      this.z = Math.max(this.z, horizontal, vertical);
    }

    this.shakeAge += Math.max(0, impactDt);
    this.shake = THREE.MathUtils.damp(this.shake, 0, 16, impactDt);
    if (reducedMotion || this.shake < 0.001) this.shake = 0;
    const kick = reducedMotion ? 0 : this.shake;
    const kickX = kick * this.shakeDirection * Math.cos(this.shakeAge * 88) * 0.10;
    const kickY = kick * Math.sin(this.shakeAge * 73) * 0.055;

    // Orbit runs on real time rather than sim time, because the beat it exists
    // for is the KO freeze -- where dt is zero for the whole hold. Easing
    // toward the target angle is what produces the swing; there is no separate
    // animation to keep in step.
    const wantOrbit = reducedMotion ? 0 : (shot?.orbit ?? 0);
    this.orbit = THREE.MathUtils.damp(this.orbit, wantOrbit, shot?.orbitRate ?? 1.7, Math.max(dt, impactDt));
    if (shot?.authored) this.orbit = wantOrbit;

    // At orbit zero, combat uses a symmetric flat shot. Cinematic orbits are
    // reserved for beats where the fight has already stopped.
    this.camera.position.set(
      this.x + Math.sin(this.orbit) * this.z + kickX,
      this.y + kickY,
      Math.cos(this.orbit) * this.z,
    );
    if (this.impact && !reducedMotion) {
      const hit = this.impact;
      const amount = hit.amount * Math.exp(-hit.age * 11);
      const toward = new THREE.Vector3(hit.x, hit.y, 0).sub(this.camera.position).normalize();
      this.camera.position.addScaledVector(toward, amount);
      if (!frozen) hit.age += impactDt;
      if (hit.age > 0.5) this.impact = null;
    }
    this.camera.lookAt(this.x + kickX * 0.25, this.lookY + kickY * 0.25, 0);
    if (kick) this.camera.rotateZ(kick * Math.sin(this.shakeAge * 61) * 0.005);
    if (!reducedMotion && shot?.roll) this.camera.rotateZ(shot.roll);
  }
}
