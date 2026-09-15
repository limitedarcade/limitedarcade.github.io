import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { GoreDebris } from '../game/src/render/goreProps.js';
import { StumpFlesh, measureCutRadius } from '../game/src/render/stumpFlesh.js';
import { REGION_BY_ID } from '../game/src/render/goreAtlas.js';
import { movementClipTime } from '../game/src/render/movementPose.js';

test('rotated debris settles with its lowest surface on the floor', () => {
  const pool = new GoreDebris(new THREE.Scene());
  const piece = pool.addOrgan('armChunk', new THREE.Vector3(0, 1, 0), new THREE.Vector3());
  for (let i = 0; i < 600; i++) pool.update(1 / 60);
  assert.equal(piece.settled, true);
  assert.ok(Math.abs(new THREE.Box3().setFromObject(piece.mesh).min.y - 0.02) < 1e-5);
  pool.dispose();
});

test('a distant cut cannot inflate the current wound', () => {
  const bone = new THREE.Bone();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 8 }, () => [0.17, 2, 0]).flat(), 3));
  const mesh = new THREE.Mesh(geometry);
  const damage = { meshes: [{ mesh, geometry, sever: { array: new Float32Array(8).fill(0.5) } }] };
  assert.equal(measureCutRadius(damage, bone, new THREE.Vector3(0, 1, 0), 0.085), 0.085);
  geometry.dispose(); mesh.material.dispose();
});

test('attached Gib tissue fits the wound and does not dispose the shared library', () => {
  const model = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'upperArmL'; model.add(bone);
  const tissue = new THREE.BoxGeometry(0.23, 0.1, 0.15), material = new THREE.MeshStandardMaterial();
  let disposed = false; tissue.addEventListener('dispose', () => { disposed = true; });
  const flesh = new StumpFlesh(model);
  const stump = flesh.attach(REGION_BY_ID.leftArm, { debris: { library: new Map([['armChunk', tissue]]), materialFor: () => material } });
  const attached = stump.cap.getObjectByName('stumpGibFlesh');
  assert.equal(attached.geometry, tissue);
  const size = new THREE.Box3().setFromObject(attached).getSize(new THREE.Vector3());
  assert.ok(Math.max(size.x, size.y, size.z) < 0.18);
  flesh.dispose(); assert.equal(disposed, false);
  tissue.dispose(); material.dispose();
});

test('defeat advances by simulation time and holds its final pose', () => {
  assert.equal(movementClipTime({ state: 'defeat', stateFrame: 30 }, 2), 0.5);
  assert.equal(movementClipTime({ state: 'defeat', stateFrame: 600 }, 2), 2);
});
