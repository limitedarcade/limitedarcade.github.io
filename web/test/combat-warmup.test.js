import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { warmCombatAssets } from '../game/src/render/combatWarmup.js';
import { SpritePool } from '../game/src/render/vfx.js';
import { DroneStrike } from '../game/src/render/droneStrike.js';

test('drone preparation waits for both models and shares its in-flight promise', async () => {
  const pending = [], calls = [];
  const loader = { loadAsync: url => {
    calls.push(url);
    return new Promise(resolve => pending.push(resolve));
  } };
  // Exercise loading separately from the constructor's canvas-based glow art.
  const drone = Object.assign(Object.create(DroneStrike.prototype), {
    loader, droneModel: new THREE.Group(), beam: new THREE.Group(),
  });
  const ready = drone.load();
  assert.equal(drone.load(), ready); assert.equal(calls.length, 2);
  let finished = false; ready.then(() => { finished = true; });
  const model = () => ({ scene: new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()) });
  pending[0](model());
  await Promise.resolve(); await Promise.resolve();
  assert.equal(finished, false);
  pending[1](model()); await ready;
  assert.equal(finished, true);
  assert.equal(drone.droneModel.children.length, 1); assert.equal(drone.beam.children.length, 1);
  assert.equal(drone.load(), ready);
});

for (const failure of [null, 'compile', 'render']) test(`attack warmup restores scene state after ${failure || 'success'}`, async () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  const attached = new THREE.Group(), detached = new THREE.Group();
  attached.visible = detached.visible = false; scene.add(attached);
  const texture = new THREE.Texture(), material = new THREE.MeshBasicMaterial({ map: texture });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); mesh.visible = false; detached.add(mesh);
  const previousTarget = {}, target = {}, uploaded = [];
  let current = previousTarget, compiles = 0, draws = 0;
  const renderer = {
    getRenderTarget: () => current,
    setRenderTarget: value => { current = value; },
    initTexture: value => uploaded.push(value),
    compileAsync: async () => {
      assert.equal(current, target);
      if (++compiles === 2 && failure === 'compile') throw Error('compile');
    },
    render: () => {
      draws++;
      assert.equal(current, target); assert.equal(detached.parent, scene);
      assert.ok(attached.visible && detached.visible && mesh.visible);
      assert.equal(mesh.frustumCulled, false);
      if (failure === 'render') throw Error('render');
    },
  };
  const task = warmCombatAssets({ renderer, scene, camera, target, roots: [attached, detached, null] });
  if (failure) await assert.rejects(task, new RegExp(failure)); else await task;
  assert.equal(current, previousTarget);
  assert.equal(compiles, 2); assert.equal(draws, failure === 'compile' ? 0 : 1);
  assert.deepEqual(uploaded, [texture]);
  assert.equal(attached.parent, scene); assert.equal(detached.parent, null);
  assert.equal(attached.visible, false); assert.equal(detached.visible, false); assert.equal(mesh.visible, false);
  assert.equal(mesh.frustumCulled, true);
});

test('particle warmup allocates the full capacity once, without leaving live effects', () => {
  const scene = new THREE.Scene(), pool = new SpritePool(scene, new THREE.Texture(), { capacity: 5 });
  const prepared = new Set(pool.warmupRoots());
  assert.equal(prepared.size, 5); assert.equal(pool.live.size, 0);
  assert.ok([...prepared].every(sprite => !sprite.visible));
  assert.deepEqual(new Set(pool.warmupRoots()), prepared);
  const live = Array.from({ length: 5 }, () => pool.acquire());
  assert.ok(live.every(sprite => prepared.has(sprite)));
  assert.equal(pool.acquire(), null);
  for (const sprite of live) pool.release(sprite);
  assert.equal(scene.children.length, 5);
});
