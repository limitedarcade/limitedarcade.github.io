import * as THREE from '../vendor/three.module.js';

// Restore before the mixer samples: additive flinches never contaminate clips.
export class HitRecoil {
  constructor(model, pivot) { this.model = model; this.pivot = pivot; this.saved = []; this.age = 1; }
  hit(event, profile) { this.event = event; this.power = profile.recoil; this.age = 0; }
  restore() {
    for (const [bone, rotation] of this.saved) bone.quaternion.copy(rotation);
    this.saved.length = 0;
    this.pivot.scale.set(1, 1, 1);
    this.pivot.position.y = 0;
  }
  apply(dt) {
    if (this.age >= 0.24 || !this.event) return;
    const weight = (1 - this.age / 0.24) ** 2 * this.power;
    const low = this.event.level === 'low';
    const end = this.model.getObjectByName(low ? 'chest' : 'head');
    if (!end) return;
    this.model.updateWorldMatrix(true, true);
    const target = end.getWorldPosition(new THREE.Vector3());
    target.x += (this.event.facing || 1) * 0.12 * weight;
    target.y -= (low ? 0.07 : 0.025) * weight;
    // Bounded CCD: rotate each parent toward the displaced struck-bone target.
    for (const name of low ? ['spine', 'hips'] : ['neck', 'chest', 'spine']) {
      const bone = this.model.getObjectByName(name);
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
    end.rotateX(-0.16 * weight);
    const squash = 1 - 0.035 * weight;
    this.pivot.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    this.pivot.updateWorldMatrix(true, true);
    let bottom = Infinity;
    for (const name of ['footL', 'toeL', 'footR', 'toeR']) {
      const foot = this.model.getObjectByName(name);
      if (foot) bottom = Math.min(bottom, foot.getWorldPosition(new THREE.Vector3()).y);
    }
    if (bottom < 0.014) this.pivot.position.y += 0.014 - bottom;
    this.age += dt;
  }
}
