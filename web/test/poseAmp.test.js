import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../game/src/vendor/three.module.js';
import { GLTFLoader } from '../game/src/vendor/GLTFLoader.js';
import { PoseAmp, POSE, POSE_TUNABLES, resetPose } from '../game/src/render/poseAmp.js';

// Mirrors MAX_ANGLE in poseAmp.js: past this a limb would fold the short way.
const MAX_ANGLE = 2.8;

// The contract is exactly "gain times the authored angle": amplification has to
// stay on the arc the clip already travels, or a punch stops being that punch.
for (const id of ['trump', 'carney']) test(`${id}: pose gain scales the authored angle on both rig formats and restores without drift`, async () => {
  const factory = await import(`../game/src/fighters/${id}/createFighterModel.js`);
  await factory.prewarm(); const packed = factory.createFighter();
  const b = readFileSync(new URL(`../game/public/fighters/${id}/${id}-rigged.glb`, import.meta.url));
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', resolve, reject));

  for (const model of [packed.group, gltf.scene]) {
    // Built at rest, exactly as FighterView.place() builds it, before any clip
    // has been sampled -- that is where the rest pose comes from.
    const amp = new PoseAmp(model);
    const bones = [];
    model.traverse(bone => { if (bone.isBone) bones.push([bone, bone.quaternion.clone()]); });

    const mixer = new THREE.AnimationMixer(model);
    const clip = (model === packed.group ? packed.clipMap.heavyPunch : Object.fromEntries(gltf.animations.map(c => [c.name, c])).heavyPunch);
    assert.ok(clip, 'heavyPunch is authored on both formats');
    mixer.clipAction(clip).play();
    mixer.update(clip.duration * 0.5);

    const authored = amp.groups.flatMap(g => g.bones.map((bone, i) => [bone, g.rest[i], bone.quaternion.clone()]));
    // `angleTo` bottoms out around 5e-4 on these rigs -- the quaternions are
    // not exactly unit length and acos amplifies that near zero -- so only
    // bones with real motion can have their angle checked, and restore is
    // asserted componentwise, where the copy is bit-exact or it is broken.
    const moving = authored.filter(([, rest, animated]) => rest.angleTo(animated) > 0.01);
    assert.ok(moving.length >= 4, 'mid-punch actually moves the amplified bones');

    for (const gain of [0.5, 1.4, 2]) {
      resetPose();
      for (const t of POSE_TUNABLES) POSE[t.key] = gain;
      amp.apply();
      for (const [bone, rest, animated] of moving) {
        const want = Math.min(rest.angleTo(animated) * gain, MAX_ANGLE);
        assert.ok(Math.abs(bone.quaternion.angleTo(rest) - want) < 1e-3, `${bone.name} at gain ${gain}`);
      }
      amp.restore();
      for (const [bone, , animated] of authored) {
        assert.deepEqual(bone.quaternion.toArray(), animated.toArray(), bone.name);
      }
    }

    // A gain left applied across many frames must not compound: restore has to
    // hand the mixer back the pose it wrote, not the amplified one.
    for (const t of POSE_TUNABLES) POSE[t.key] = 1.6;
    for (let i = 0; i < 120; i++) { amp.restore(); mixer.update(1 / 60); amp.apply(); }
    amp.restore();
    mixer.stopAllAction(); mixer.update(0);
    for (const [bone, q] of bones) bone.quaternion.copy(q);
    resetPose();
    amp.apply();
    for (const [bone, q] of bones) assert.deepEqual(bone.quaternion.toArray(), q.toArray(), `${bone.name} unamplified at 100%`);
  }
  packed.dispose();
});
