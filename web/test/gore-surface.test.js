import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';

test('a later head cut does not collect arm vertices removed by an earlier cut', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, 0,2,0, 1,2,0, 0,3,0],3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array.from({length:6},()=>[0,1,0,0]).flat(),4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([
    .9,.1,0,0, .9,.1,0,0, .9,.1,0,0, .1,.9,0,0, .1,.9,0,0, .1,.9,0,0,
  ],4));
  const arm = new THREE.Bone(); arm.name='arm'; const head = new THREE.Bone(); head.name='head';
  const mesh = new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial());
  mesh.add(arm,head); mesh.bind(new THREE.Skeleton([arm,head]));
  const damage = new FighterDamage(mesh);
  assert.equal(damage.severByBones([/^arm$/])[0].positions.length,12);
  const cut = damage.severByBones([/^head$/])[0].positions;
  assert.deepEqual([cut[3],cut[7],cut[11]], [3,4,5]);
  damage.dispose(); geometry.dispose(); mesh.material.dispose();
});

function panel() {
  const geometry = new THREE.PlaneGeometry(2, 2, 1, 1);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  const model = new THREE.Group(); model.add(mesh);
  return { model, mesh, geometry };
}

test('rigid head attachments detach with the bone and restore on the next round', () => {
  const model = new THREE.Group(), head = new THREE.Bone(); head.name = 'head'; model.add(head);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(.3,.3,.3),new THREE.MeshStandardMaterial()); head.add(helmet);
  const damage = new FighterDamage(model);
  assert.equal(damage.severByBones([/^arm$/]), null);
  const cut = damage.severByBones([/^head$/]);
  assert.equal(cut[0].record.mesh,helmet); assert.equal(cut[0].positions.length, helmet.geometry.attributes.position.count * 4);
  assert.ok([...helmet.geometry.attributes.severMask.array].every(value => value === 1));
  assert.equal(damage.severByBones([/^head$/]), null);
  damage.resetRound(); assert.ok([...helmet.geometry.attributes.severMask.array].every(value => value === 0));
  damage.dispose(); helmet.geometry.dispose(); helmet.material.dispose();
});

test('a contact inside a coarse triangle gets a surface wound even when no vertex is inside its radius', () => {
  const { model, mesh, geometry } = panel();
  const damage = new FighterDamage(model);
  damage.onHit({ type: 'hit', x: 0.17, y: 0.12, z: 0.01 }, 1);
  const wound = damage.wounds[0];
  assert.equal(damage.woundCount.value, 1);
  assert.ok(Math.abs(wound.x - 0.17) < 1e-6);
  assert.ok(Math.abs(wound.y - 0.12) < 1e-6);
  assert.ok(Math.abs(wound.z) < 1e-6);
  assert.ok(wound.w > 0 && wound.w < 0.1);
  assert.ok([...mesh.geometry.attributes.position.array].every(Number.isFinite));
  assert.equal(geometry.getAttribute('battleSurfacePosition'), undefined);
  damage.dispose(); assert.equal(mesh.geometry, geometry);
});

test('wounds use common model coordinates across transformed meshes and keep their physical size', () => {
  const { model, mesh } = panel();
  model.position.set(5, 2, 0); model.scale.setScalar(2);
  mesh.position.set(0.4, 1, 0);
  const damage = new FighterDamage(model);
  damage.onHit({ type: 'hit', x: 6.2, y: 4.2, z: 0.01 }, 2);
  const wound = damage.wounds[0];
  assert.ok(Math.abs(wound.x - 0.6) < 1e-6);
  assert.ok(Math.abs(wound.y - 1.1) < 1e-6);
  assert.ok(Math.abs(wound.w * 2 - 0.079) < 1e-6);
  const original = wound.clone();
  model.position.x += 10; model.rotation.y = Math.PI;
  model.updateWorldMatrix(true, true);
  assert.deepEqual(wound, original, 'animation and facing do not slide the stored mark');
  damage.dispose();
});

test('repeated contacts soak an existing wound, independent contacts stay bounded, and resets reach compiled materials', () => {
  const { model, mesh } = panel();
  const damage = new FighterDamage(model);
  const event = { type: 'hit', x: 0.2, y: 0.1, z: 0.01 };
  damage.onHit({ ...event, type: 'block' }, 2);
  assert.equal(damage.woundCount.value, 0);
  for (let i = 0; i < 40; i++) damage.onHit(event, 2);
  assert.equal(damage.woundCount.value, 1);
  assert.ok(damage.wounds[0].w <= 0.079 * 1.35);
  for (let i = 0; i < 40; i++) damage.onHit({ ...event, x: -0.9 + (i % 8) * 0.25, y: -0.9 + Math.floor(i / 8) * 0.35 }, 1);
  assert.equal(damage.woundCount.value, 16);
  assert.ok(damage.wounds.every(w => w.toArray().every(Number.isFinite) && w.w > 0));
  const shader = { vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>\n#include <roughnessmap_fragment>', uniforms: {} };
  mesh.material.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uBattleWounds.value, damage.wounds);
  assert.doesNotMatch(shader.fragmentShader, /\b(?:attribute|const|uniform|varying|float|int|vec[234]|mat[234])\s+patch\b/,
    'injected GLSL must not declare the reserved patch keyword');
  damage.resetRound();
  assert.equal(shader.uniforms.uBattleWoundCount.value, 0);
  assert.ok(shader.uniforms.uBattleWounds.value.every(w => w.w === 0));
  damage.dispose();
});
