import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../game/src/vendor/three.module.js';
import { moves as trumpMoves } from '../game/src/fighters/trump/moves.js';
import { moves as carneyMoves } from '../game/src/fighters/carney/moves.js';
import { officerMoves } from '../game/src/fighters/officerMoves.js';
import { langMoves } from '../game/src/fighters/langMoves.js';
import { StrikePose, STRIKE_PROFILES, strikeSample } from '../game/src/render/strikePose.js';
import { HitRecoil } from '../game/src/render/hitRecoil.js';

for (const [fighter, moves] of [['trump', trumpMoves], ['carney', carneyMoves], ['officer_flock', officerMoves], ['lang', langMoves]]) {
  for (const moveId of ['lightPunch', 'heavyPunch', 'lightKick', 'heavyKick']) {
    test(`${fighter} ${moveId} anticipates, drives through contact and settles`, () => {
      const move = moves[moveId];
      const windup = strikeSample(fighter, moveId, Math.max(1, Math.floor(move.startup / 2)), move);
      const contact = strikeSample(fighter, moveId, move.startup + Math.floor(move.active / 2), move);
      const settled = strikeSample(fighter, moveId, move.startup + move.active + move.recovery, move);
      assert.ok(windup.travel < 0 && windup.lean < 0, 'readable anticipation moves away from contact');
      assert.ok(contact.travel > 0 && contact.lean > 0, 'contact drives toward the opponent');
      assert.ok(Math.abs(settled.travel) < 1e-8 && Math.abs(settled.lean) < 1e-8, 'recovery returns to authored stance');
      assert.equal(contact.plant, /Kick$/.test(moveId) ? 'support' : 'both');
    });
  }
}

test('all four fighters receive basic strike presentation without changing signature clips', () => {
  assert.deepEqual(Object.keys(STRIKE_PROFILES).sort(), ['carney', 'lang', 'officer_flock', 'trump']);
  assert.ok(STRIKE_PROFILES.lang.heavyPunch.drive < STRIKE_PROFILES.officer_flock.lightPunch.drive,
    'Lang stays deliberately ineffectual');
  assert.equal(strikeSample('trump', 'meteorKick', 6, trumpMoves.meteorKick), null);
});

test('imported Mixamo feet receive the same planted support as canonical feet', () => {
  const pivot = new THREE.Group(), model = new THREE.Group(); pivot.add(model);
  const left = new THREE.Bone(); left.name = 'mixamorigLeftFoot_52'; left.position.set(-0.2, 0, 0);
  const right = new THREE.Bone(); right.name = 'mixamorig:RightFoot'; right.position.set(0.2, 0, 0);
  model.add(left, right);
  const pose = new StrikePose(model, pivot, 'officer_flock'), move = officerMoves.heavyKick;
  pose.apply({ state: 'attack', move: 'heavyKick', moveFrame: 0, moveData: move, facing: -1, y: 0 });
  const anchor = left.getWorldPosition(new THREE.Vector3()); right.position.y = 0.3;
  pivot.position.set(0, 0, 0); pivot.rotation.set(0, 0, 0);
  pose.apply({ state: 'attack', move: 'heavyKick', moveFrame: move.startup + 1, moveData: move, facing: -1, y: 0 });
  assert.equal(pose.feet.length, 2);
  assert.ok(Math.abs(left.getWorldPosition(new THREE.Vector3()).x - anchor.x) < 0.045);
});

test('a basic kick keeps its support foot planted while the torso drives forward', () => {
  const scene = new THREE.Scene(), pivot = new THREE.Group(), model = new THREE.Group();
  const footL = new THREE.Bone(); footL.name = 'footL'; footL.position.set(-0.18, 0, 0);
  const footR = new THREE.Bone(); footR.name = 'footR'; footR.position.set(0.18, 0, 0);
  const head = new THREE.Bone(); head.name = 'head'; head.position.set(0, 1.65, 0);
  model.add(footL, footR, head); pivot.add(model); scene.add(pivot);
  const pose = new StrikePose(model, pivot, 'trump');
  const move = trumpMoves.heavyKick;
  pose.apply({ state: 'attack', move: 'heavyKick', moveFrame: 0, moveData: move, facing: 1, y: 0 });
  scene.updateMatrixWorld(true);
  const anchor = footL.getWorldPosition(new THREE.Vector3());
  footR.position.y = 0.35;
  pose.apply({ state: 'attack', move: 'heavyKick', moveFrame: move.startup + 1, moveData: move, facing: 1, y: 0 });
  scene.updateMatrixWorld(true);
  const planted = footL.getWorldPosition(new THREE.Vector3());
  assert.ok(Math.abs(planted.x - anchor.x) < 0.045, `support foot drifted ${planted.x - anchor.x}`);
  assert.ok(Math.abs(pivot.rotation.z) > 0.05, 'whole torso visibly commits through contact');
});

test('hit recoil carries the victim in the direction of impact', () => {
  const pivot = new THREE.Group(), model = new THREE.Group(); pivot.add(model);
  const hips = new THREE.Bone(); hips.name = 'hips'; hips.position.y = 0.9;
  const spine = new THREE.Bone(); spine.name = 'spine'; spine.position.y = 0.25;
  const chest = new THREE.Bone(); chest.name = 'chest'; chest.position.y = 0.25;
  const head = new THREE.Bone(); head.name = 'head'; head.position.y = 0.35;
  hips.add(spine); spine.add(chest); chest.add(head); model.add(hips);
  const recoil = new HitRecoil(model, pivot);
  recoil.hit({ facing: 1, level: 'high' }, { recoil: 1 }); recoil.apply(1 / 60);
  assert.ok(pivot.position.x > 0.05, 'rightward impact moves the body right');
  assert.ok(pivot.rotation.z < 0, 'rightward impact tips the body right');
  recoil.restore();
  recoil.hit({ facing: -1, level: 'high' }, { recoil: 1 }); recoil.apply(1 / 60);
  assert.ok(pivot.position.x < -0.05, 'leftward impact moves the body left');
  assert.ok(pivot.rotation.z > 0, 'leftward impact tips the body left');
});

test('compact selection and practice preview keep their primary controls visible', () => {
  const selection = readFileSync(new URL('../game/src/render/productMenus.css', import.meta.url), 'utf8');
  const practice = readFileSync(new URL('../game/src/render/practicePanel.js', import.meta.url), 'utf8');
  assert.match(selection, /@media \(max-width: 850px\)[\s\S]*\.selection-footer \{ position: fixed;/);
  assert.match(selection, /\.roster-future \{ display: none; \}/);
  assert.match(practice, /action === 'watch'\) this\.setPreviewing\(true\)/);
});
