import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { REGION_BY_ID } from '../game/src/render/goreAtlas.js';
import { StumpFlesh } from '../game/src/render/stumpFlesh.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';
import { Dismemberment } from '../game/src/render/dismemberment.js';

function miniRig() {
  const model = new THREE.Group();
  const spine = new THREE.Bone(); spine.name = 'spine';
  const hips = new THREE.Bone(); hips.name = 'hips'; hips.position.set(0, -0.18, 0);
  const chest = new THREE.Bone(); chest.name = 'chest'; chest.position.set(0, 0.2, 0);
  const upperArmL = new THREE.Bone(); upperArmL.name = 'upperArmL'; upperArmL.position.set(0.22, 0.05, 0);
  const forearmL = new THREE.Bone(); forearmL.name = 'forearmL'; forearmL.position.set(0.28, 0, 0);
  const handL = new THREE.Bone(); handL.name = 'handL'; handL.position.set(0.22, 0, 0);
  const upLegL = new THREE.Bone(); upLegL.name = 'upLegL'; upLegL.position.set(0.1, -0.05, 0);
  const legL = new THREE.Bone(); legL.name = 'legL'; legL.position.set(0, -0.32, 0);
  const footL = new THREE.Bone(); footL.name = 'footL'; footL.position.set(0, -0.28, 0);
  model.add(spine);
  spine.add(chest); spine.add(hips);
  chest.add(upperArmL); upperArmL.add(forearmL); forearmL.add(handL);
  hips.add(upLegL); upLegL.add(legL); legL.add(footL);
  model.updateMatrixWorld(true);
  return { model, spine, chest, upperArmL, forearmL, upLegL };
}

test('a severed stump is a meat plug with lining, not an empty tube', () => {
  const { model, upperArmL } = miniRig();
  const flesh = new StumpFlesh(model);
  const stump = flesh.attach(REGION_BY_ID.leftArm, { force: 2, dx: 1 });
  assert.ok(stump, 'flesh must attach to the upper arm');
  assert.equal(stump.cap.parent, upperArmL);

  const plug = stump.cap.getObjectByName('stumpPlug');
  const lining = stump.cap.getObjectByName('stumpLining');
  const chip = stump.cap.getObjectByName('stumpBone');
  assert.ok(plug && lining && chip, 'the sleeve is corked, lined, and shows bone');

  plug.geometry.computeBoundingBox();
  const size = plug.geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(plug.scale.x);
  assert.ok(size.y > size.x * 0.4, 'the plug has depth along the cut, not a paper disc');
  assert.ok(lining.scale.y > lining.scale.x * 0.5, 'the lining reaches back into the sleeve');

  const flaps = flesh.hanging.children.filter(m => m.name === 'stumpFlap');
  const tendons = flesh.hanging.children.filter(m => m.name === 'stumpTendon');
  assert.ok(flaps.length >= 4, 'muscle flaps hang off the rim');
  assert.ok(tendons.length >= 3, 'tendons hang off the rim');
  flesh.dispose();
});

test('hanging strands droop and lag the stump instead of staying rigid', () => {
  const { model, upperArmL } = miniRig();
  const flesh = new StumpFlesh(model);
  flesh.attach(REGION_BY_ID.leftArm, { force: 1.6, dx: 0 });
  const strand = flesh.stumps[0].strands[0];
  assert.ok(strand.points.at(-1).y < strand.points[0].y - 0.02, 'strands spawn hanging down');

  for (let i = 0; i < 24; i++) flesh.update(1 / 60);
  const settledTip = strand.points.at(-1).y;
  assert.ok(settledTip < strand.points[0].y - 0.04, 'gravity keeps the meat below the cut');

  const pinX = strand.points[0].x;
  const tipX = strand.points.at(-1).x;
  upperArmL.position.x += 0.45;
  model.updateMatrixWorld(true);
  flesh.update(1 / 60);
  const pinDelta = strand.points[0].x - pinX;
  const tipDelta = strand.points.at(-1).x - tipX;
  assert.ok(pinDelta > 0.2, 'the pin follows the bone');
  assert.ok(tipDelta < pinDelta * 0.85, 'the hanging tip lags, which is the swing');
  flesh.dispose();
});

test('taking the torso retires flesh that was hanging from a now-gone leg', () => {
  const { model } = miniRig();
  const flesh = new StumpFlesh(model);
  flesh.attach(REGION_BY_ID.leftLeg);
  assert.equal(flesh.count, 1);
  flesh.attach(REGION_BY_ID.torso);
  assert.equal(flesh.stumps.some(s => s.regionId === 'leftLeg'), false,
    'leg flesh cannot stay on a bone the torso just took');
  assert.equal(flesh.stumps.some(s => s.regionId === 'torso'), true);
  flesh.dispose();
});

test('reset clears plugs and hanging meshes so the next round starts clean', () => {
  const { model, upperArmL } = miniRig();
  const flesh = new StumpFlesh(model);
  flesh.attach(REGION_BY_ID.leftArm);
  flesh.attach(REGION_BY_ID.head);
  assert.ok(flesh.count >= 2);
  flesh.reset();
  assert.equal(flesh.count, 0);
  assert.equal(flesh.hanging.children.length, 0);
  assert.equal(upperArmL.children.filter(c => c.name.startsWith('stumpCap')).length, 0);
  flesh.dispose();
});

test('a real arm cut on Trump fills the stump instead of leaving a hollow sleeve', async () => {
  const factory = await import('../game/src/fighters/trump/createFighterModel.js');
  await factory.prewarm();
  const built = factory.createFighter();
  built.group.updateMatrixWorld(true);
  const damage = new FighterDamage(built.group);
  const gore = new Dismemberment({ damage, model: built.group });
  const cut = gore.sever('leftArm');
  assert.equal(cut.region, 'leftArm');
  assert.equal(gore.flesh.count, 1);
  const stump = gore.flesh.stumps[0];
  assert.ok(stump.cap.getObjectByName('stumpPlug'));
  assert.ok(stump.cap.getObjectByName('stumpLining'));
  assert.ok(gore.flesh.hanging.children.length >= 6);
  gore.resetRound();
  assert.equal(gore.flesh.count, 0);
  gore.dispose();
  damage.dispose();
  built.dispose();
});
