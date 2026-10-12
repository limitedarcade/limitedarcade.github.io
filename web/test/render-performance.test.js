import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';
import { ConfidenceProps } from '../game/src/render/confidenceProps.js';
import { GoreDebris } from '../game/src/render/goreProps.js';
import { batchStaticMeshes } from '../game/src/render/staticBatch.js';
import { FINISHER_SCRIPTS } from '../game/src/engine/fatalities.js';

test('cinematic lights keep the same visible light count before, during and after the finisher', () => {
  const scene = new THREE.Scene(), props = new ConfidenceProps(scene);
  const model = new THREE.Group(), hand = new THREE.Bone(); hand.name = 'handR'; model.add(hand); scene.add(model);
  const views = [{ model, root: model }];
  const lights = () => { const result = []; scene.traverseVisible(o => { if (o.isLight) result.push(o); }); return result; };
  const before = lights(); assert.equal(before.length, 2); assert.equal(props.key.intensity, 0);
  props.update({ phase: 'finisher', finisher: { script: 'cold-cut', attacker: 0, originX: 0, facing: 1 } }, views, 121);
  assert.deepEqual(lights(), before); assert.equal(props.key.intensity, 18); assert.ok(props.flash.intensity > 0);
  props.update({ phase: 'fight' }, views, 0);
  assert.deepEqual(lights(), before); assert.equal(props.key.intensity, 0); assert.equal(props.flash.intensity, 0);
});

test('dense fighter contacts use a bounded posed sample and still find the surface', () => {
  const model = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 2; i++) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), material.clone());
    mesh.position.x = i * 4; model.add(mesh);
  }
  const damage = new FighterDamage(model);
  let samples = 0;
  for (const { mesh } of damage.meshes) {
    const original = mesh.getVertexPosition;
    mesh.getVertexPosition = function (...args) { samples++; return original.apply(this, args); };
  }
  damage.onHit({ type: 'hit', x: .12, y: .18, z: .98 });
  assert.ok(samples < 6000, `${samples} posed samples exceeded the per-contact budget`);
  const wound = damage.wounds[0]; assert.ok(Math.abs(wound.z - .976) < .02);
  assert.ok(Math.abs(wound.x - .12) < .02 && Math.abs(wound.y - .18) < .02);
  damage.dispose();
});

test('detached surfaces reuse their prepared material across cuts and pool retirement', () => {
  const gore = new GoreDebris(new THREE.Scene()), source = new THREE.MeshStandardMaterial({ vertexColors: true });
  const material = gore.surfaceMaterialFor(source, true);
  assert.equal(material, gore.surfaceMaterialFor(source, true));
  assert.notEqual(material, source); assert.equal(material.vertexColors, true);
  let disposed = false; material.addEventListener('dispose', () => disposed = true);
  const piece = gore.add(new THREE.Mesh(new THREE.BoxGeometry(), material), { velocity: new THREE.Vector3() });
  gore.resetRound(); assert.equal(disposed, false); assert.equal(piece.mesh.parent, null);
  gore.dispose(); assert.equal(disposed, true);
});

test('static batching preserves transformed geometry and keeps interactive props and spatial cells separate', () => {
  const root = new THREE.Group(); root.position.set(10, 0, 3);
  const material = new THREE.MeshStandardMaterial();
  for (const x of [1, 3, 50]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); mesh.name = 'scenery';
    mesh.position.set(x, 1, 2); mesh.rotation.y = .6; mesh.scale.x = x === 3 ? -2 : 1;
    mesh.castShadow = true; root.add(mesh);
  }
  const prop = new THREE.Mesh(new THREE.BoxGeometry(), material); prop.name = 'axe'; root.add(prop);
  const before = new THREE.Box3().setFromObject(root);
  const result = batchStaticMeshes(root, mesh => mesh.name === 'scenery');
  assert.deepEqual(result, { sourceDraws: 2, batches: 1, savedDraws: 1 });
  assert.equal(root.getObjectByName('axe'), prop); assert.equal(prop.parent, root);
  const after = new THREE.Box3().setFromObject(root);
  assert.ok(before.min.distanceTo(after.min) < 1e-5 && before.max.distanceTo(after.max) < 1e-5);
  let triangles = 0; root.traverse(o => { if (o.isMesh) triangles += o.geometry.index.count / 3; });
  assert.equal(triangles, 48);
});

test('Cold Cut holds a readable two-person camera through the windups and strikes', () => {
  const cameras = FINISHER_SCRIPTS['cold-cut'].shots.filter(s => s.frame >= 48 && s.frame <= 192).map(s => s.camera);
  assert.equal(cameras.length, 4);
  for (const camera of cameras) {
    assert.ok(camera.z >= 4.8); assert.equal(camera.orbit, cameras[0].orbit);
    assert.equal(camera.x, 0); assert.equal(camera.roll, undefined);
  }
});

test('whole authored parts retain their indexed topology, UVs and world pose when detached', () => {
  const gore = new GoreDebris(new THREE.Scene()), geometry = new THREE.BoxGeometry(.3, .5, .4);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.position.set(3, 2, .1); mesh.rotation.y = .7; mesh.updateMatrixWorld(true);
  const positions = [], point = new THREE.Vector3();
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld); positions.push(point.x, point.y, point.z, i);
  }
  const origin = new THREE.Vector3(3, 2, .1);
  const piece = gore.addSurfaceLimb({ record: { geometry, mesh }, positions }, origin, new THREE.Vector3());
  assert.equal(piece.mesh.geometry.attributes.position.count, geometry.attributes.position.count);
  assert.deepEqual(piece.mesh.geometry.index.array, geometry.index.array);
  assert.deepEqual(piece.mesh.geometry.attributes.uv.array, geometry.attributes.uv.array);
  const before = new THREE.Box3().setFromObject(mesh), after = new THREE.Box3().setFromObject(piece.mesh);
  assert.ok(before.min.distanceTo(after.min) < 1e-6 && before.max.distanceTo(after.max) < 1e-6);
  assert.ok(piece.mesh.geometry.attributes.normal.array.every(Number.isFinite));
  gore.dispose();
});
