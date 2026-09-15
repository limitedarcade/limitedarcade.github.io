import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../game/src/vendor/three.module.js';
import { GLTFLoader } from '../game/src/vendor/GLTFLoader.js';
import { ImpactClock, impactProfile, rumble, stopRumble } from '../game/src/render/impact.js';
import { FightCamera } from '../game/src/render/camera.js';
import { HitRecoil } from '../game/src/render/hitRecoil.js';
import { SpritePool } from '../game/src/render/vfx.js';
import { createVfxTextures } from '../game/src/render/vfxTextures.js';
import { Match, PHASE } from '../game/src/engine/match.js';

test('impact vocabulary, intensity bounds and counter/KO priority', () => {
  for (const [event, type] of [[{ move: 'lightPunch' }, 'blunt'], [{ move: 'heavyKick' }, 'slash'],
    [{ type: 'block' }, 'block'], [{ counter: true }, 'counter'], [{ ko: true, counter: true }, 'ko']]) {
    assert.equal(impactProfile(event).type, type);
  }
  for (const power of [0, 0.55, 1.35, 2.6, 99]) {
    const p = impactProfile({ bloodScale: power });
    assert.ok(p.pause >= 4 && p.pause <= 12); assert.equal(p.slow, 0);
    assert.equal(p.grade, p.heavy ? 3 : 0); assert.equal(p.dolly, p.heavy ? 0.4 : 0);
  }
});

test('cosmetic pause and grade durations use seconds at 30, 60 and 144 Hz', () => {
  for (const hz of [30, 60, 144]) {
    const clock = new ImpactClock(); clock.hit(impactProfile({ ko: true }));
    let elapsed = 0;
    while (clock.hold > 1e-8) { clock.rendered(1 / hz); elapsed += 1 / hz; }
    assert.ok(Math.abs(elapsed - 0.2) <= 1 / hz + 1e-8);
    assert.equal(clock.grade, 0); assert.equal(clock.scale, 1);
    clock.reset(); assert.equal(clock.frozen, false);
  }
});

test('counter slowdown starts after hold; KO suppresses counter slowdown in trades', () => {
  const c = new ImpactClock(); c.hit(impactProfile({ counter: true }));
  assert.equal(c.scale, 0.35); const frames = c.hold;
  for (let i = 0; i < frames; i++) c.rendered(1 / 60);
  assert.equal(c.scale, 0.35); c.rendered(0.09); assert.ok(c.scale > 0.35 && c.scale < 1);
  c.hit(impactProfile({ ko: true })); c.hit(impactProfile({ counter: true })); assert.equal(c.scale, 1);
});

test('camera dolly is exactly 0.4 metres toward contact, stable during freeze and reversible', () => {
  const camera = new THREE.PerspectiveCamera(33, 1.7, 0.05, 90), rig = new FightCamera(camera);
  const snapshot = { distance: 2, fighters: [{ x: -1, y: 0 }, { x: 1, y: 0 }] };
  rig.update(1 / 60, snapshot); const baseline = camera.position.clone();
  rig.hit({ x: 0.6, y: 1.4 }, impactProfile({ bloodScale: 1.5 }));
  rig.update(0, snapshot, { frozen: true, impactDt: 1 / 60 });
  assert.ok(Math.abs(camera.position.distanceTo(baseline) - 0.4) < 1e-6);
  const contact = camera.position.clone();
  for (let i = 0; i < 12; i++) rig.update(0, snapshot, { frozen: true, impactDt: 1 / 60 });
  assert.ok(contact.distanceTo(camera.position) < 1e-8);
  rig.update(0, snapshot, { reducedMotion: true, impactDt: 1 / 60 });
  assert.ok(baseline.distanceTo(camera.position) < 1e-8);
  for (let i = 0; i < 40; i++) rig.update(0, snapshot, { impactDt: 1 / 60 });
  assert.ok(baseline.distanceTo(camera.position) < 1e-8);
});

test('sprite capacity is enforced and released sprites cannot have two owners', () => {
  const scene = new THREE.Scene(), pool = new SpritePool(scene, new THREE.Texture(), { capacity: 2 });
  const a = pool.acquire(), b = pool.acquire(); assert.equal(pool.acquire(), null);
  pool.release(a); pool.release(a); assert.equal(pool.acquire(), a); assert.equal(pool.acquire(), null);
  assert.equal(scene.children.length, 2); pool.release(a); pool.release(b);
});

test('rumble is scaled, bounded and tolerates missing or rejected actuators', async () => {
  const calls = [], p = impactProfile({ bloodScale: 2, ko: true });
  const pad = { vibrationActuator: { playEffect: (...args) => { calls.push(args); return Promise.resolve(); }, reset: () => calls.push('reset') } };
  rumble(pad, p); rumble(pad, p, 0.5); stopRumble([pad, null]);
  assert.equal(calls[0][0], 'dual-rumble'); assert.equal(calls[0][1].duration, 280);
  assert.equal(calls[1][1].strongMagnitude, calls[0][1].strongMagnitude / 2);
  assert.ok(calls[0][1].weakMagnitude <= 1); assert.equal(calls[2], 'reset');
  rumble(null, p); rumble({ vibrationActuator: { playEffect: () => Promise.reject(new Error('unsupported')) } }, p);
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('lethal contacts carry KO on the hit event itself, including simultaneous kills', () => {
  const m = new Match(); m.setPhase(PHASE.FIGHT);
  m.fighters.forEach((f, side) => { f.x = side ? 0.4 : -0.4; f.health = 1; f.startMove('lightPunch'); f.moveFrame = 3; });
  const hits = m.step([{}, {}]).filter(e => e.type === 'hit');
  assert.equal(hits.length, 2); assert.ok(hits.every(e => e.ko));
});

for (const id of ['trump', 'carney']) test(`${id}: recoil works on both rig formats and restores every bone without drift`, async () => {
  const factory = await import(`../game/src/fighters/${id}/createFighterModel.js`);
  await factory.prewarm(); const packed = factory.createFighter();
  const b = readFileSync(new URL(`../game/public/fighters/${id}/${id}-rigged.glb`, import.meta.url));
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '', resolve, reject));
  for (const model of [packed.group, gltf.scene]) for (const facing of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.rotation.y = facing * Math.PI / 2; pivot.add(model);
    const recoil = new HitRecoil(model, pivot), bones = [];
    model.traverse(bone => { if (bone.isBone) bones.push([bone, bone.quaternion.clone()]); });
    for (const level of ['mid', 'low']) {
      recoil.hit({ facing, level }, impactProfile({ bloodScale: 1.5 }));
      recoil.apply(0);
      assert.ok(bones.some(([bone, q]) => bone.quaternion.angleTo(q) > 0.001));
      for (let i = 0; i < 30; i++) { recoil.restore(); recoil.apply(1 / 60); }
      recoil.restore();
      for (const [bone, q] of bones) assert.ok(bone.quaternion.angleTo(q) < 1e-6, bone.name);
      assert.equal(pivot.scale.y, 1);
    }
  }
  packed.dispose();
});
