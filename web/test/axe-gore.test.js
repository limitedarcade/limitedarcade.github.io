import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { Dismemberment } from '../game/src/render/dismemberment.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';
import { GoreDebris } from '../game/src/render/goreProps.js';
import { enableNodeImageDecoding } from './helpers/node-image-decoding.js';

enableNodeImageDecoding();

test('axe hits choose one available arm at every contact height and health, never a leg or lethal region', () => {
  for (const y of [.5, 1.1, 1.7]) for (const health of [1, .2, 0]) {
    const removed = new Set();
    const target = { enabled: true, severed: removed, sever(id, options) { removed.add(id); return { region: id, ...options }; } };
    const hit = { type: 'hit', weapon: 'axe', y, facing: -1 };
    const first = Dismemberment.prototype.onHit.call(target, hit, health);
    assert.equal(first.region, 'leftArm'); assert.equal(first.cinematic, true);
    assert.equal(first.dx, -1);
    assert.equal(Dismemberment.prototype.onHit.call(target, hit, health).region, 'rightArm');
    assert.equal(Dismemberment.prototype.onHit.call(target, hit, health), null);
    assert.deepEqual([...removed], ['leftArm', 'rightArm']);
  }
});

test('blocked axes and disabled gore never sever', () => {
  const target = { enabled: true, sever() { assert.fail('cut must be suppressed'); } };
  assert.equal(Dismemberment.prototype.onHit.call(target, { type: 'block', weapon: 'axe', y: 1.1 }, 1), null);
  target.enabled = false;
  assert.equal(Dismemberment.prototype.onHit.call(target, { type: 'hit', weapon: 'axe', y: 1.1 }, 1), null);
});

test('a full-health axe hit removes a complete arm from the actual Trump model, persists through a head cut, and resets for replay', async () => {
  const factory = await import('../game/src/fighters/trump/createFighterModel.js');
  await factory.prewarm();
  const { group: model } = factory.createFighter(), scene = new THREE.Scene(); scene.add(model);
  model.updateMatrixWorld(true);
  const damage = new FighterDamage(model), debris = new GoreDebris(scene);
  const gore = new Dismemberment({ damage, model, debris });
  const hit = { type: 'hit', weapon: 'axe', x: 0, y: 1.1, facing: 1 };
  const cut = gore.onHit(hit, 1);
  assert.equal(cut?.region, 'leftArm'); assert.ok(cut.pieces.length);
  const stump = gore.flesh.stumps.find(s => s.regionId === 'leftArm');
  assert.ok(stump.region.chain.some(pattern => pattern.test('upperArmL')), 'whole arm detaches, including upper arm');
  assert.ok(gore.sever('head', { cinematic: true })?.pieces.length);
  assert.ok(gore.has('leftArm'), 'the axe injury survives the finisher');
  gore.resetRound(); damage.resetRound(); debris.resetRound();
  assert.equal(gore.count, 0);
  assert.ok(gore.onHit(hit, 1)?.pieces.length, 'next exhibition starts with a fresh arm');
  gore.dispose(); damage.dispose(); debris.dispose();
});
