import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { WeaponView } from '../game/src/render/weapons.js';

const near = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
const snapshot = (extra = {}) => ({ stageId: 'lake-america', round: 1, phase: 'fight',
  fighters: [], projectiles: [], axeUsed: false, axePrompt: [], ...extra });
const throwAt = (extra = {}) => ({ id: 1, kind: 'axe', x: -2, y: 1.1, facing: 1, age: 0, ...extra });

function fixture({ sprite = false } = {}) {
  const scene = new THREE.Scene(), group = new THREE.Group(); scene.add(group);
  const stage = { group, id: 'lake-america', generation: 0 };
  const steel = new THREE.MeshStandardMaterial({ color: '#c3dae1', metalness: 0.8, emissive: '#10191e', emissiveIntensity: 0.12 });
  const wrap = new THREE.MeshStandardMaterial({ color: '#8b2537' });
  const axe = sprite
    ? new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.92), new THREE.MeshBasicMaterial({ color: '#ffffff' }))
    : new THREE.Group();
  axe.name = 'lake-america-axe'; axe.position.set(-5, 0.85, -0.65);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1, 0.09), wrap);
  handle.position.set(0.04, -0.2, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.16, 0.14), [steel, wrap]);
  head.position.set(0.2, 0.45, 0);
  if (!sprite) axe.add(handle, head);
  // A neighbouring prop shares steel with the axe. Highlighting it would be a
  // material ownership bug, not an intended readiness cue.
  const neighbour = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), steel);
  neighbour.position.x = 5; group.add(axe, neighbour);
  const view = new WeaponView(scene, stage, { loader: { load() {} } });
  return { scene, stage, view, axe, handle, head, neighbour, steel, wrap };
}

test('a grouped axe highlights all child materials and restores the original palette', () => {
  const { view, axe, handle, head, neighbour, steel, wrap } = fixture();
  const steelColor = steel.color.clone(), wrapColor = wrap.color.clone();
  view.update(snapshot({ axePrompt: [1] }), 0.2);
  assert.equal(axe.visible, true);
  assert.notEqual(head.material[0], steel);
  assert.notEqual(handle.material, wrap);
  assert.equal(head.material[1], handle.material, 'shared materials stay shared within the axe');
  assert.ok(head.material[0].emissiveIntensity > steel.emissiveIntensity);
  assert.ok(handle.material.emissiveIntensity > wrap.emissiveIntensity);
  assert.ok(steel.color.equals(steelColor)); assert.ok(wrap.color.equals(wrapColor));
  assert.equal(neighbour.material, steel);
  view.update(snapshot());
  assert.ok(head.material[0].color.equals(steelColor));
  assert.ok(head.material[0].emissive.equals(steel.emissive));
  assert.equal(head.material[0].emissiveIntensity, steel.emissiveIntensity);
  const cloned = handle.material; let disposed = 0;
  cloned.addEventListener('dispose', () => disposed++);
  view.clear();
  assert.equal(handle.material, wrap); assert.equal(head.material[0], steel);
  assert.equal(disposed, 1);
});

test('a transformed GLB hierarchy throws around its geometry centre for either facing', () => {
  for (const facing of [-1, 1]) {
    const { view, stage, axe, head, steel } = fixture();
    const exported = new THREE.Group(); exported.position.set(3, 2, -4);
    exported.rotation.set(0.05, 0.12, -0.2); exported.scale.setScalar(1.4);
    stage.group.add(exported); exported.add(axe);
    const vertices = Array.from(head.geometry.attributes.position.array);
    const localPosition = axe.position.clone(), localRotation = axe.quaternion.clone();
    stage.group.updateMatrixWorld(true);
    const sourceSize = new THREE.Box3().setFromObject(axe).getSize(new THREE.Vector3());
    view.update(snapshot({ axePrompt: [0] }), 0.1);
    const p = throwAt({ facing, age: 0 });
    view.update(snapshot({ axeUsed: true, projectiles: [p] }));
    const projectile = view.live.get(p.id);
    assert.ok(projectile); assert.equal(axe.visible, false);
    assert.equal(projectile.children[0].visible, true);
    const box = new THREE.Box3().setFromObject(projectile), center = box.getCenter(new THREE.Vector3());
    near(center.x, p.x, 'centred X'); near(center.y, p.y, 'centred Y'); near(center.z, 0.25, 'centred Z');
    const size = box.getSize(new THREE.Vector3());
    near(size.x, sourceSize.x, 'world width preserved'); near(size.y, sourceSize.y, 'world height preserved');
    assert.equal(projectile.scale.x, facing);
    const thrownHead = projectile.children[0].children[1];
    assert.equal(thrownHead.geometry, head.geometry, 'source geometry shared without edits');
    assert.notEqual(thrownHead.material[0], head.material[0]);
    assert.ok(thrownHead.material[0].color.equals(steel.color), 'throw never inherits pickup glow');
    view.update(snapshot({ axeUsed: true, projectiles: [{ ...p, age: 9 }] }));
    near(projectile.rotation.z, -facing * 9 * 0.35, 'simulation spin');
    const rotation = projectile.rotation.z;
    view.update(snapshot({ axeUsed: true, projectiles: [{ ...p, age: 9 }] }), 0.5);
    near(projectile.rotation.z, rotation, 'spin holds when simulation age holds');
    assert.deepEqual(Array.from(head.geometry.attributes.position.array), vertices);
    assert.ok(axe.position.equals(localPosition)); assert.ok(axe.quaternion.equals(localRotation));
    view.clear();
  }
});

test('old painted axe remains a visible centred projectile', () => {
  const { view, axe } = fixture({ sprite: true });
  view.update(snapshot({ axePrompt: [0] }), 0.1);
  assert.notEqual(axe.material.color.getHex(), 0xffffff);
  view.update(snapshot({ axeUsed: true, projectiles: [throwAt()] }));
  const projectile = view.live.get(1), center = new THREE.Box3().setFromObject(projectile).getCenter(new THREE.Vector3());
  near(center.x, -2, 'sprite X'); near(center.y, 1.1, 'sprite Y');
  assert.equal(projectile.children[0].material.color.getHex(), 0xffffff);
  view.update(snapshot({ round: 2 }));
  assert.equal(axe.visible, true); assert.equal(view.live.size, 0);
  view.clear();
});

test('round resets and stage changes retire projectiles and dispose only owned materials', () => {
  const { scene, stage, view, axe, head, steel } = fixture();
  let sourceMaterialsDisposed = 0, sourceGeometryDisposed = 0;
  steel.addEventListener('dispose', () => sourceMaterialsDisposed++);
  head.geometry.addEventListener('dispose', () => sourceGeometryDisposed++);
  view.update(snapshot({ axeUsed: true, projectiles: [throwAt()] }));
  const first = view.live.get(1); let ownedDisposed = 0;
  for (const material of view.liveMaterials.get(1).values()) material.addEventListener('dispose', () => ownedDisposed++);
  view.update(snapshot({ round: 2, axePrompt: [1] }));
  assert.equal(view.live.size, 0); assert.equal(first.parent, null); assert.equal(axe.visible, true);
  assert.equal(ownedDisposed, 2);
  view.update(snapshot({ round: 2, axeUsed: true, projectiles: [throwAt()] }));
  const second = view.live.get(1); assert.notEqual(second, first);
  // The frame can still contain the previous match snapshot after stage swap.
  stage.group.remove(axe); stage.id = 'capitol'; stage.generation++;
  view.update(snapshot({ round: 2, axeUsed: true, projectiles: [throwAt()] }));
  assert.equal(view.live.size, 0); assert.equal(second.parent, null);
  assert.equal(view.axeStyle, null); assert.equal(scene.children.length, 1);
  assert.equal(sourceMaterialsDisposed, 0); assert.equal(sourceGeometryDisposed, 0);
});

test('late axe loading and projectile removal never retain stale clones', () => {
  const { stage, view, axe } = fixture();
  stage.group.remove(axe);
  view.update(snapshot({ axeUsed: true, projectiles: [throwAt()] }));
  assert.equal(view.live.size, 0);
  stage.group.add(axe);
  view.update(snapshot({ axeUsed: true, projectiles: [throwAt()] }));
  const mesh = view.live.get(1); assert.ok(mesh);
  view.update(snapshot({ axeUsed: true }));
  assert.equal(view.live.size, 0); assert.equal(mesh.parent, null);
  assert.equal(axe.visible, false);
  view.clear(); assert.equal(axe.visible, true);
});
