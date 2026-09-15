import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../game/src/vendor/three.module.js';
import { Match, PHASE } from '../game/src/engine/match.js';
import { fatalityOf, finisherCinematicAt, FINISHER_SCRIPTS } from '../game/src/engine/fatalities.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';
import { Dismemberment } from '../game/src/render/dismemberment.js';
import { GoreDebris } from '../game/src/render/goreProps.js';
import { ColdCutIce, iceArmPose, ARM_BEATS, COLD_CUT_ICE_ARMS } from '../game/src/render/coldCutIce.js';
import { coldCutCamera } from '../game/src/render/finisherDirector.js';
import { GLTFLoader } from '../game/src/vendor/GLTFLoader.js';

for (const opponent of ['officer_flock', 'trump']) for (const side of [0, 1]) test(`${opponent} finisher emits each cut and slapshot once, facing ${side}`, { skip: !COLD_CUT_ICE_ARMS }, () => {
  const m = new Match({ left: { id: side ? opponent : 'carney' }, right: { id: side ? 'carney' : opponent } });
  m.startFinisher(fatalityOf('carney-cold-cut'), side);
  assert.equal(m.finisher.script, 'cold-cut-flock');
  const beats = [], finals = [];
  for (let i = 0; i < FINISHER_SCRIPTS[m.finisher.script].duration; i++) for (const event of m.step([{}, {}])) {
    if (event.type === 'finisherBeat') beats.push([event.frame, event.effectType, event.region]);
    if (event.type === 'finisher') finals.push(i + 1);
  }
  assert.deepEqual(beats.map(b => b.slice(0, 2)), [[100, 'slash'], [110, 'slash'], [200, 'slapshot'], [246, 'slapshot'], [391, 'final']]);
  assert.deepEqual(finals, [391]); assert.equal(m.phase, PHASE.MATCH_END);
});


test('ice-arm flock script stays disabled until limbs read on ice', () => {
  assert.equal(COLD_CUT_ICE_ARMS, false);
  const m = new Match({ left: { id: 'carney' }, right: { id: 'trump' } });
  m.startFinisher(fatalityOf('carney-cold-cut'), 0);
  assert.equal(m.finisher.script, 'cold-cut');
});

test('unsupported opponents retain the original cold-cut sequence', () => {
  const m = new Match({ left: { id: 'carney' }, right: { id: 'carney' } });
  m.startFinisher(fatalityOf('carney-cold-cut'), 0);
  assert.equal(m.finisher.script, 'cold-cut');
});

test('camera is continuous, holds before the final contact, and does not restart slapshot animation', () => {
  const f = { script: 'cold-cut-flock' };
  let previous = finisherCinematicAt(f, 0);
  for (let frame = 1; frame <= 510; frame++) {
    const next = finisherCinematicAt(f, frame);
    assert.ok(Math.abs(next.camera.x - previous.camera.x) < 0.16);
    assert.ok(Math.abs(next.camera.orbit - previous.camera.orbit) < 0.04);
    previous = next;
  }
  assert.deepEqual(finisherCinematicAt(f, 330).camera, finisherCinematicAt(f, 371).camera);
  assert.equal(finisherCinematicAt(f, 224).attacker.clipTime, 0.9);
  assert.equal(finisherCinematicAt(f, 250).attacker.clipTime, 80 / 60);
});

test('arms land before contact, stay still for the windup, and mirror their ice travel', () => {
  for (const region of ['leftArm', 'rightArm']) {
    const spawn = { x: 0.58, y: 1.3, z: 0 };
    const landed = iceArmPose(region, 160, 0, 1, spawn);
    assert.equal(landed.y, 0);
    assert.deepEqual(iceArmPose(region, 190, 0, 1, spawn), landed);
    const right = iceArmPose(region, 275, 0, 1, spawn);
    const left = iceArmPose(region, 275, 0, -1, { ...spawn, x: -spawn.x });
    assert.equal(left.x, -right.x); assert.equal(left.y, right.y);
  }
});

test('actual Flock mesh yields solid arms and head; cinematic pieces survive, reset releases resources', async () => {
  const json = JSON.parse(await readFile(new URL('../game/public/fighters/officer_flock/model.json', import.meta.url), 'utf8'));
  // Headless geometry verification substitutes only image pixels; the actual
  // mesh, skeleton, groups, UVs and materials still go through ObjectLoader.
  for (const image of json.images || []) image.url = { data: [255, 255, 255, 255], width: 1, height: 1, type: 'Uint8Array' };
  const model = new T.ObjectLoader().parse(json), scene = new T.Scene(); scene.add(model); model.updateMatrixWorld(true);
  const damage = new FighterDamage(model), debris = new GoreDebris(scene);
  const gore = new Dismemberment({ damage, model, debris }), ice = new ColdCutIce(scene);
  for (const region of ['leftArm', 'rightArm', 'head']) {
    const cut = gore.sever(region, { cinematic: true });
    assert.ok(cut?.pieces.length, `${region} must create surface geometry`);
    assert.ok(cut.pieces.every(p => p.mesh.isMesh && p.mesh.geometry.attributes.position.count >= 3));
    if (region !== 'head') ice.capture(cut);
  }
  ice.update(270, 0, 1);
  const before = [...ice.arms.values()].flatMap(a => a.pieces).map(p => p.mesh.position.toArray());
  debris.update(1 / 60);
  assert.deepEqual([...ice.arms.values()].flatMap(a => a.pieces).map(p => p.mesh.position.toArray()), before);
  assert.equal(gore.sever('leftArm', { cinematic: true }), null);
  ice.reset(); debris.resetRound(); gore.resetRound(); damage.resetRound();
  assert.equal(debris.pieces.length, 0); assert.equal(debris.owned.size, 0); assert.equal(gore.count, 0);
  assert.ok(gore.sever('leftArm', { cinematic: true })?.pieces.length, 'rematch can cut again');
  gore.dispose(); damage.dispose(); debris.dispose();
});

test('Trump in both runtime formats yields his own complete surface limbs with floor-safe pursuit and clean resets', async () => {
  const factory = await import('../game/src/fighters/trump/createFighterModel.js');
  await factory.prewarm(); const packed = factory.createFighter();
  const data = await readFile(new URL('../game/public/fighters/trump/trump-rigged.glb', import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '');
  for (const model of [packed.group, gltf.scene]) for (const facing of [1, -1]) {
    const scene = new T.Scene(); scene.add(model);
    model.rotation.y = facing === 1 ? 0 : Math.PI; model.updateMatrixWorld(true);
    const damage = new FighterDamage(model), debris = new GoreDebris(scene);
    const gore = new Dismemberment({ damage, model, debris }), ice = new ColdCutIce(scene);
    for (const region of ['leftArm', 'rightArm', 'head']) {
      const cut = gore.sever(region, { cinematic: true });
      assert.ok(cut?.pieces.length, `${region} must produce Trump's surface geometry`);
      assert.ok(cut.pieces.every(p => p.mesh.geometry.attributes.normal && p.mesh.geometry.attributes.position.count >= 3));
      if (region !== 'head') {
        for (const piece of cut.pieces) {
          const materials = Array.isArray(piece.mesh.material) ? piece.mesh.material : [piece.mesh.material];
          assert.ok(materials.every(m => m.emissive.getHex() === 0), 'cinematic fill must not bleach the surface');
          assert.ok(materials.every(m => m.customProgramCacheKey() === 'cinematic-surface-v2'));
          assert.equal(materials.every(m => !String(m.onBeforeCompile || '').includes('severMask')), true);
        }
        ice.capture(cut);
      } else {
        for (const piece of cut.pieces) {
          const materials = Array.isArray(piece.mesh.material) ? piece.mesh.material : [piece.mesh.material];
          assert.ok(materials.every(m => m.emissive.getHex() === 0), 'detached head must retain its original hue');
        }
      }
    }
    for (const frame of [160, 200, 220, 246, 270, 330]) {
      ice.update(frame, 0, facing);
      for (const arm of ice.arms.values()) for (const piece of arm.pieces) {
        piece.mesh.updateMatrixWorld(true);
        const box = new T.Box3().setFromObject(piece.mesh);
        assert.ok(box.min.y >= .024, `no limb penetrates the ice at ${frame}`);
        assert.ok(Number.isFinite(box.max.x));
      }
    }
    ice.reset(); debris.resetRound(); gore.resetRound(); damage.resetRound();
    assert.equal(debris.owned.size, 0);
    assert.equal(gore.count, 0);
    gore.dispose(); damage.dispose(); debris.dispose(); scene.remove(model);
  }
  packed.dispose();
});

test('coldCutCamera pursues each slapshot across the full ice slide without dropping to master', () => {
  const left = [], right = [];
  for (let frame = ARM_BEATS.leftArm.hit; frame < ARM_BEATS.rightArm.hit + 60; frame++) {
    const shot = coldCutCamera(frame, 0, 1, { trackLimbs: true, subjects: {} });
    if (frame < ARM_BEATS.rightArm.hit) left.push(shot.cut);
    else right.push(shot.cut);
  }
  assert.ok(left.every(cut => cut === 'leftArm'), 'left slapshot stays on leftArm');
  assert.ok(right.every(cut => cut === 'rightArm'), 'right slapshot stays on rightArm');
  let previous = coldCutCamera(ARM_BEATS.leftArm.hit, 0, 1, { trackLimbs: true, subjects: {} });
  for (let frame = ARM_BEATS.leftArm.hit + 1; frame < ARM_BEATS.leftArm.hit + 45; frame++) {
    const next = coldCutCamera(frame, 0, 1, { trackLimbs: true, subjects: {} });
    assert.ok(Math.abs(next.target[0] - previous.target[0]) < 0.35, `left chase jumps at ${frame}`);
    previous = next;
  }
});
