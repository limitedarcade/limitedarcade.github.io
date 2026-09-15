import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../game/src/vendor/three.module.js';
import { FighterView, clipForState } from '../game/src/render/fighterView.js';
import { MovementPose } from '../game/src/render/movementPose.js';
import { PHYSICS } from '../game/src/engine/frameData.js';
import { decodeModelPack } from '../game/src/render/modelPack.js';
import { decodeModel, buildFighter } from '../game/src/fighters/_shared/meshCodec.js';

function fixture(imported = false) {
  const view = new FighterView({ facingRotationY: Math.PI / 2 }, { scene: new THREE.Scene() });
  const model = new THREE.Group();
  const hips = new THREE.Bone(); hips.name = imported ? 'mixamorigHips_1' : 'hips';
  hips.position.y = 0.95;
  const head = new THREE.Bone(); head.name = imported ? 'mixamorigHead_5' : 'head'; head.position.y = 0.7;
  const foot = new THREE.Bone(); foot.name = imported ? 'mixamorigLeftFoot_23' : 'footL'; foot.position.y = -0.95;
  hips.add(head, foot); model.add(hips);
  view.pivot = new THREE.Group(); view.pivot.add(model); view.root.add(view.pivot);
  view.model = model;
  view.recoil = { restore() {} };
  view.poseAmp = { restore() {}, apply() {} };
  view.movementPose = new MovementPose(model, view.pivot);
  const clip = (name, from, to) => new THREE.AnimationClip(name, 1, [
    new THREE.VectorKeyframeTrack(`${hips.name}.position`, [0, 1], [0, from, 0, 0, to, 0]),
  ]);
  const clips = Object.fromEntries([
    clip('idle', 0.95, 0.95), clip('walkF', 0.9, 1), clip('jump', 0.75, 0.95),
    clip('hitHigh', 0.95, 0.8), clip('knockdown', 0.95, 0.2), clip('getUp', 0.2, 0.95),
  ].map(c => [c.name, c]));
  view.bindClips(new THREE.AnimationMixer(model), clips);
  return { view, hips };
}

const snap = (state, stateFrame = 0, rest = {}) => ({ state, stateFrame, x: -1, y: 0, facing: 1, ...rest });
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} vs ${expected}`);

test('a completed knockdown stays at its final pose indefinitely and only rises on getUp', () => {
  const { view, hips } = fixture();
  view.apply(snap('knockdown', PHYSICS.knockdownFrames), 1 / 60);
  close(hips.position.y, 0.2, 'knockdown ends on floor');
  for (const frame of [0, 1, 60, 6000]) {
    view.apply(snap('downed', frame), 0.3);
    close(hips.position.y, 0.2, 'waiting never samples idle or getUp');
  }
  view.apply(snap('getUp', PHYSICS.getUpFrames / 2, { recovery: 'stand' }), 0.5);
  close(hips.position.y, 0.575, 'half the recovery takes half the clip');
  view.apply(snap('getUp', PHYSICS.getUpFrames, { recovery: 'stand' }), 0);
  close(hips.position.y, 0.95, 'standing at the simulation recovery endpoint');
});

test('juggle, hop, sprint and directional recoveries remain still during hitstop', () => {
  for (const state of ['sprint', 'backHop', 'juggle', 'getUp']) {
    const { view, hips } = fixture();
    const snapshot = snap(state, 8, { recovery: 'forward', y: state === 'juggle' ? 1.3 : 0 });
    view.apply(snapshot, 1 / 60);
    const time = view.current.time;
    const position = hips.position.clone(), pivot = view.pivot.position.clone(), rotation = view.pivot.quaternion.clone();
    for (let i = 0; i < 12; i++) view.apply(snapshot, 1 / 30);
    close(view.current.time, time, `${state} clock`);
    close(hips.position.distanceTo(position), 0, `${state} bones`);
    close(view.pivot.position.distanceTo(pivot), 0, `${state} offset`);
    close(view.pivot.quaternion.angleTo(rotation), 0, `${state} rotation`);
  }
});

for (const imported of [false, true]) test(`${imported ? 'imported Officer' : 'canonical'} rig rolls both ways and restores its pivot`, () => {
  const { view } = fixture(imported);
  assert.ok(view.movementPose.hips, 'pelvis found by rig alias');
  assert.equal(view.movementPose.contactBones.length, 3);
  const orientations = [];
  for (const recovery of ['forward', 'back']) {
    for (let frame = 0; frame <= PHYSICS.rollFrames; frame++) {
      view.apply(snap('getUp', frame, { recovery }), 1 / 60);
      assert.ok(view.pivot.position.toArray().every(Number.isFinite));
      assert.ok(view.pivot.quaternion.toArray().every(Number.isFinite));
      if (frame === 6) orientations.push(view.pivot.quaternion.clone());
    }
    view.apply(snap('idle'), 0.2);
    close(view.pivot.position.length(), 0, 'roll translation reset');
    close(view.pivot.quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)), 0, 'roll rotation reset');
  }
  assert.ok(orientations[0].angleTo(orientations[1]) > 0.3, 'forward/back have opposite visible rolls');
});

test('airborne views preserve the simulation height and all new states resolve without new assets', () => {
  const { view } = fixture(true);
  for (const [state, clip] of [['sprint', 'walkF'], ['backHop', 'jump'], ['juggle', 'hitHigh'], ['downed', 'knockdown'], ['getUp', 'getUp']]) {
    assert.equal(view.resolveClip(clipForState(snap(state))), clip);
  }
  for (const state of ['backHop', 'juggle']) {
    view.apply(snap(state, 8, { x: 2.1, y: 1.4, facing: -1 }), 1 / 60);
    assert.deepEqual(view.root.position.toArray(), [2.1, 1.4, 0], 'no second jump arc');
  }
  view.apply(snap('idle'), 0.2);
  close(view.pivot.position.length(), 0, 'air reaction translation reset');
});

for (const id of ['trump', 'carney']) test(`${id}: the resting body surface stays above the floor`, () => {
  const bytes = readFileSync(new URL(`../game/public/fighters/${id}/fighter.bin`, import.meta.url));
  const pack = decodeModelPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  const built = buildFighter(THREE, pack.model, null, pack.rig, { decodedParts: decodeModel(pack.model, pack.stream) });
  built.mixer.stopAllAction();
  const scene = new THREE.Scene();
  const view = new FighterView({ id, authoredHeight: 1.86, facingRotationY: Math.PI / 2 }, { scene });
  view.place(built.group); view.bindClips(built.mixer, built.clipMap);
  view.apply(snap('downed', 100), 0); scene.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  let lowest = Infinity;
  built.group.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.skeleton?.update();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
      lowest = Math.min(lowest, point.y);
    }
  });
  assert.ok(lowest >= -0.001, `body clips the floor at ${lowest}`);
  assert.ok(built.group.getObjectByName('head').getWorldPosition(point).y < 0.7, 'resting head must stay low');
  built.dispose();
});
