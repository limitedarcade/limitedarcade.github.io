import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../game/src/vendor/three.module.js';
import { GLTFLoader } from '../game/src/vendor/GLTFLoader.js';
import { STAGE_AXE_ZONE } from '../game/src/engine/frameData.js';
import { WeaponView } from '../game/src/render/weapons.js';

const directory = new URL('../game/public/stages/lake-america-3d/', import.meta.url);
const bytes = readFileSync(new URL('lake-america.glb', directory));
const manifest = JSON.parse(readFileSync(new URL('manifest.json', directory), 'utf8'));
assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'runtime file must be glTF binary');
assert.equal(bytes.readUInt32LE(4), 2, 'runtime file must be glTF 2');
assert.equal(bytes.readUInt32LE(8), bytes.byteLength, 'GLB must not be truncated');
const metadata = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
const loaded = new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
const near = (a, b, label, epsilon = 1e-5) => assert.ok(Math.abs(a - b) < epsilon, `${label}: ${a} != ${b}`);

test('right rescue ring is local, human-sized and throws without hiding its stand', async () => {
  const gltf = await loaded, group = gltf.scene.clone(true);
  const ring = group.getObjectByName('lake-america-rescue-ring'); assert.ok(ring);
  near(ring.getWorldPosition(new THREE.Vector3()).x, 5, 'right pickup position');
  const size = new THREE.Box3().setFromObject(ring).getSize(new THREE.Vector3());
  assert.ok(size.x > .75 && size.x < 1 && size.y > .75 && size.z > .15);
  assert.equal(manifest.rescueRing.node, ring.name);
  const scene = new THREE.Scene(), stage = { group, id:'lake-america', generation:1 };
  const view = new WeaponView(scene, stage, {loader:{load(){}}});
  const snapshot = {stageId:stage.id,round:1,phase:'fight',fighters:[],projectiles:[],ringPrompt:[1]};
  view.update(snapshot);
  view.update({...snapshot,ringUsed:true,ringPrompt:[],projectiles:[{id:80,kind:'rescueRing',x:4,y:1.1,facing:-1,age:2}]});
  assert.equal(ring.visible,false); assert.equal(view.live.size,1);
  group.traverse(o => {if(o.name.startsWith('12_')) assert.equal(o.visible,true);});
  view.update({...snapshot,round:2}); assert.equal(ring.visible,true); assert.equal(view.live.size,0);
  view.clear();
});

test('the exported lake is self-contained and stays within its scenery triangle budget', async () => {
  for (const resource of [...(metadata.buffers || []), ...(metadata.images || [])]) {
    assert.ok(!resource.uri || resource.uri.startsWith('data:'), `external runtime dependency: ${resource.uri}`);
  }
  const { scene } = await loaded;
  let triangles = 0, meshes = 0;
  scene.traverse(object => {
    assert.equal(Boolean(object.isCamera || object.isLight), false, `preview-only object exported: ${object.name}`);
    if (!object.isMesh) return;
    meshes++;
    const { geometry } = object;
    triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    assert.ok(geometry.attributes.normal, `${object.name}: normals required`);
    assert.ok(geometry.attributes.position.array.every(Number.isFinite), `${object.name}: finite vertex coordinates`);
  });
  assert.ok(triangles > 10000, 'the level must contain the complete modeled environment');
  assert.ok(triangles <= 240000, `${triangles} triangles exceeds the 240k scenery budget`);
  assert.equal(triangles, manifest.triangles, 'manifest tracks the exported geometry');
  assert.equal(meshes, manifest.meshObjects, 'manifest tracks exported mesh count');
});

test('the actual GLB supports both arena edges with upward-facing level ground', async () => {
  const { scene } = await loaded; scene.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0);
  for (let step = 0; step <= 128; step++) {
    const x = -8 + step / 8;
    raycaster.set(origin.set(x, 2.5, 0), down);
    const [hit] = raycaster.intersectObject(scene, true);
    assert.ok(hit, `floor gap at x=${x}`);
    // Substrate is 5cm below the slabs and closes their narrow joints.
    assert.ok(hit.point.y >= -0.051 && hit.point.y <= 0.005, `floor height ${hit.point.y} at x=${x} (${hit.object.name})`);
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    assert.ok(normal.y > 0.99, `downward/tilted floor normal ${normal.y} at x=${x} (${hit.object.name})`);
  }
});

test('the modeled scenery leaves the complete fighting corridor clear above the ground', async () => {
  const { scene } = await loaded; scene.updateMatrixWorld(true);
  const corridor = new THREE.Box3(new THREE.Vector3(-8, 0.03, -0.35), new THREE.Vector3(8, 3.6, 0.35));
  const triangle = new THREE.Triangle(), blockers = new Set();
  scene.traverse(object => {
    if (!object.isMesh || !new THREE.Box3().setFromObject(object).intersectsBox(corridor)) return;
    const geometry = object.geometry, position = geometry.attributes.position, indices = geometry.index;
    const count = indices?.count ?? position.count;
    for (let i = 0; i < count; i += 3) {
      const index = offset => indices ? indices.getX(i + offset) : i + offset;
      triangle.a.fromBufferAttribute(position, index(0)).applyMatrix4(object.matrixWorld);
      triangle.b.fromBufferAttribute(position, index(1)).applyMatrix4(object.matrixWorld);
      triangle.c.fromBufferAttribute(position, index(2)).applyMatrix4(object.matrixWorld);
      if (corridor.intersectsTriangle(triangle)) { blockers.add(object.name); break; }
    }
  });
  assert.deepEqual([...blockers], [], 'scenery must stay outside the playable X[-8,8], Z[-.35,.35] corridor');
});

test('the stage axe has a real 3D silhouette, local pivot, and an independent persistent stump', async () => {
  const { scene } = await loaded; scene.updateMatrixWorld(true);
  const axe = scene.getObjectByName('lake-america-axe');
  assert.ok(axe, 'the axe pickup needs its stable runtime node');
  assert.equal(manifest.axe.node, axe.name);
  const pivot = axe.getWorldPosition(new THREE.Vector3());
  near(pivot.x, STAGE_AXE_ZONE.x, 'pickup aligns with simulation range');
  for (const [i, axis] of ['x', 'y', 'z'].entries()) near(pivot[axis], manifest.axe.position[i], `manifest pivot ${axis}`);
  const box = new THREE.Box3().setFromObject(axe), size = box.getSize(new THREE.Vector3());
  assert.ok(size.x > 0.4 && size.y > 0.9 && size.z > 0.07, `axe needs volume, received ${size.toArray()}`);
  assert.ok(Math.max(size.x, size.y, size.z) < 1.8, 'axe remains human-scaled');
  const localCentre = axe.worldToLocal(box.getCenter(new THREE.Vector3()));
  assert.ok(localCentre.length() < 0.8, `axe vertices must stay local to their pickup pivot: ${localCentre.toArray()}`);
  const stump = [];
  scene.traverse(object => { if (object.name.startsWith('lake-america-axe-stump') && object.isMesh) stump.push(object); });
  assert.ok(stump.length, 'stump remains stage scenery');
  for (const part of stump) {
    for (let parent = part.parent; parent; parent = parent.parent) assert.notEqual(parent, axe, 'using the axe must not hide its stump');
    near(new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3()).x, pivot.x, `stump ${part.name} aligns with axe`, 0.4);
  }
});

test('floating scenery exports independently named local pivots for runtime water motion', async () => {
  const { scene } = await loaded; scene.updateMatrixWorld(true);
  assert.ok(manifest.floatingNodes.length >= 7, 'six ice floes and a navigation buoy');
  assert.equal(new Set(manifest.floatingNodes).size, manifest.floatingNodes.length);
  for (const name of manifest.floatingNodes) {
    const node = scene.getObjectByName(name); assert.ok(node, `missing floating node ${name}`);
    const pivot = node.getWorldPosition(new THREE.Vector3());
    assert.ok(pivot.y < 0 && pivot.y > -0.8, `${name} pivot stays at the waterline`);
    const bounds = new THREE.Box3().setFromObject(node), size = bounds.getSize(new THREE.Vector3());
    assert.ok(Math.max(size.x, size.y, size.z) < 6, `${name} is independently bounded`);
    assert.ok(node.worldToLocal(bounds.getCenter(new THREE.Vector3())).length() < 1.4, `${name} has local geometry for rotation`);
    assert.ok(bounds.max.y > -0.65 && bounds.min.y < -0.45, `${name} intersects the water surface`);
  }
});

test('bilingual signs stay attached to their architecture behind the fighting lane', async () => {
  const { scene } = await loaded; scene.updateMatrixWorld(true);
  const sign = scene.getObjectByName('lake-america-trail-sign');
  assert.ok(sign, 'the complete trail sign needs one parent transform');
  const labels = [];
  scene.traverse(object => { if (object.isMesh && /^(Sign[ _]·|Station[ _]·)/.test(object.name)) labels.push(object); });
  assert.equal(labels.length, 4);
  for (const label of labels) {
    const bounds = new THREE.Box3().setFromObject(label), center = bounds.getCenter(new THREE.Vector3());
    assert.ok(bounds.max.z < -8, `${label.name} floats in the foreground`);
    if (label.name.startsWith('Sign')) {
      assert.equal(label.parent, sign);
      assert.ok(Math.abs(center.x + 6.5) < .25, 'trail lettering follows the scaled sign');
      assert.ok(bounds.getSize(new THREE.Vector3()).x < 3.5);
    } else {
      near(center.x, 8.8, 'rescue lettering follows the relocated cabin', .15);
      near(center.z, -12.405, 'rescue lettering sits on the cabin fascia', .03);
      assert.ok(bounds.getSize(new THREE.Vector3()).x < 3.1);
    }
  }
});

test('WeaponView throws actual exported axe meshes while leaving its stump and source intact', async () => {
  const { scene: source } = await loaded;
  const scene = new THREE.Scene(), stage = { group: source.clone(true), id: 'lake-america', generation: 0 };
  scene.add(stage.group);
  const view = new WeaponView(scene, stage, { loader: { load() {} } });
  const axe = stage.group.getObjectByName('lake-america-axe'); assert.ok(axe);
  const snapshot = { stageId: stage.id, round: 1, phase: 'fight', fighters: [], axeUsed: false, axePrompt: [1], projectiles: [] };
  view.update(snapshot, 0.1);
  const p = { id: 1, kind: 'axe', x: -3, y: 1.1, facing: -1, age: 0 };
  view.update({ ...snapshot, axeUsed: true, axePrompt: [], projectiles: [p] });
  assert.equal(axe.visible, false);
  const projectile = view.live.get(1); assert.ok(projectile);
  let meshes = 0;
  projectile.traverse(object => { if (object.isMesh) meshes++; });
  assert.ok(meshes >= 3, 'handle, blade and grip all travel with the throw');
  const center = new THREE.Box3().setFromObject(projectile).getCenter(new THREE.Vector3());
  near(center.x, p.x, 'actual throw centred on simulation X'); near(center.y, p.y, 'actual throw centred on simulation Y');
  stage.group.traverse(object => { if (object.name.startsWith('lake-america-axe-stump')) assert.equal(object.visible, true); });
  view.update({ ...snapshot, round: 2 });
  assert.equal(axe.visible, true); assert.equal(view.live.size, 0);
  view.clear();
});
