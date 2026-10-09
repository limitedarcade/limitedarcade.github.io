import * as THREE from '../vendor/three.module.js';
import { fighterBone } from './fighterBones.js';

const WORLD_Z = new THREE.Vector3(0, 0, 1);

// Restore before the mixer samples: additive flinches never contaminate clips.
export class HitRecoil {
  constructor(model, pivot) {
    this.model = model; this.pivot = pivot; this.saved = []; this.age = 1;
    this.bones = Object.fromEntries(['hips', 'spine', 'chest', 'neck', 'head', 'footL', 'toeL', 'footR', 'toeR']
      .map(role => [role, fighterBone(model, role)]));
  }
  hit(event, profile) { this.event = event; this.power = profile.recoil; this.duration = profile.recoilDuration ?? 0.24; this.age = 0; }
  restore() {
    for (const [bone, rotation] of this.saved) bone.quaternion.copy(rotation);
    this.saved.length = 0;
    this.pivot.scale.set(1, 1, 1);
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, 0, 0);
  }
  apply(dt) {
    if (this.age >= this.duration || !this.event) return;
    const weight = (1 - this.age / this.duration) ** 2 * this.power;
    const low = this.event.level === 'low';
    const block = this.event.type === 'block';
    const direction = Math.sign(this.event.facing || 1);
    const end = this.bones[low || block ? 'chest' : 'head'];
    if (!end) { this.age += dt; return; }
    this.model.updateWorldMatrix(true, true);
    const target = end.getWorldPosition(new THREE.Vector3());
    target.x += (this.event.facing || 1) * 0.12 * weight;
    target.y -= (low ? 0.07 : 0.025) * weight;
    // Bounded CCD: rotate each parent toward the displaced struck-bone target.
    for (const name of low || block ? ['spine', 'hips'] : ['neck', 'chest', 'spine']) {
      const bone = this.bones[name];
      if (!bone) continue;
      this.saved.push([bone, bone.quaternion.clone()]);
      const localEnd = bone.worldToLocal(end.getWorldPosition(new THREE.Vector3())).normalize();
      const localTarget = bone.worldToLocal(target.clone()).normalize();
      const delta = new THREE.Quaternion().setFromUnitVectors(localEnd, localTarget);
      const angle = 2 * Math.acos(Math.min(1, Math.abs(delta.w)));
      if (angle > 0.12) delta.slerp(new THREE.Quaternion(), 1 - 0.12 / angle);
      bone.quaternion.multiply(delta);
      bone.updateWorldMatrix(false, true);
    }
    this.saved.push([end, end.quaternion.clone()]);
    if (!block) end.rotateX(-0.16 * weight);
    const squash = 1 - 0.035 * weight;
    this.pivot.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    // Carry the whole body along the incoming force. The skeleton bend sells
    // the local contact; this short translation/tilt makes the reaction follow
    // the attack direction instead of collapsing in place.
    this.pivot.position.x += direction * 0.075 * weight;
    this.pivot.rotateOnWorldAxis(WORLD_Z, -direction * 0.055 * weight);
    this.pivot.updateWorldMatrix(true, true);
    let bottom = Infinity;
    for (const name of ['footL', 'toeL', 'footR', 'toeR']) {
      const foot = this.bones[name];
      if (foot) bottom = Math.min(bottom, foot.getWorldPosition(new THREE.Vector3()).y);
    }
    if (bottom < 0.014) this.pivot.position.y += 0.014 - bottom;
    this.age += dt;
  }
}
