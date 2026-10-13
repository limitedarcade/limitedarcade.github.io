import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../game/src/vendor/three.module.js';
import { surfacePose } from '../game/src/render/surfacePose.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';
import { GoreDebris } from '../game/src/render/goreProps.js';
import { Dismemberment } from '../game/src/render/dismemberment.js';
import { surfaceNormals } from '../game/src/render/surfaceNormals.js';

test('buffer normal generation matches Three exactly for indexed, flat and degenerate surfaces', () => {
  for (const indexed of [true, false]) {
    let geometry = new T.SphereGeometry(1, 32, 24);
    if (!indexed) { const old = geometry; geometry = old.toNonIndexed(); old.dispose(); }
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + Math.sin(i) * .2), p.getY(i) * .73, p.getZ(i) * 1.3);
    p.setXYZ(0, 0, 0, 0); p.setXYZ(1, 0, 0, 0); p.setXYZ(2, 0, 0, 0);
    const expected = geometry.clone(); expected.computeVertexNormals();
    surfaceNormals(geometry);
    assert.deepEqual(geometry.attributes.normal.array, expected.attributes.normal.array);
    // Repeated live deformation must clear previous accumulation, too.
    p.setXYZ(3, .3, .4, .7); expected.attributes.position.setXYZ(3, .3, .4, .7);
    surfaceNormals(geometry); expected.computeVertexNormals();
    assert.deepEqual(geometry.attributes.normal.array, expected.attributes.normal.array);
    geometry.dispose(); expected.dispose();
  }
});

test('a cut pose matches Three skinning with four weights, morphs and transformed bind/world matrices', () => {
  const geometry = new T.BoxGeometry(1, 2, 1), count = geometry.attributes.position.count;
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(Array.from({ length: count }, () => [0, 1, 2, 3]).flat(), 4));
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(Array.from({ length: count }, () => [.4, .3, .2, .1]).flat(), 4));
  geometry.morphAttributes.position = [geometry.attributes.position.clone()];
  geometry.morphAttributes.position[0].array.forEach((v, i, array) => { array[i] = v + (i % 3 === 0 ? .15 : -.02); });
  const mesh = new T.SkinnedMesh(geometry, new T.MeshStandardMaterial()), parent = new T.Group(); parent.add(mesh);
  const bones = Array.from({ length: 4 }, () => new T.Bone()); bones.forEach(b => mesh.add(b));
  mesh.position.set(.2, -.3, .1); mesh.rotation.y = .3; mesh.updateMatrixWorld(true);
  mesh.bind(new T.Skeleton(bones)); mesh.morphTargetInfluences[0] = .6;
  parent.position.set(4, 2, -1); parent.scale.set(1.1, .9, 1.4); parent.rotation.z = -.3;
  bones.forEach((b, i) => { b.rotation.set(i * .2, i * -.1, i * .12); b.position.set(i * .1, i * .02, 0); });
  for (const mode of ['attached', 'detached']) {
    mesh.bindMode = mode; parent.updateMatrixWorld(true); mesh.skeleton.update();
    const pose = surfacePose(mesh), actual = new T.Vector3(), expected = new T.Vector3();
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, expected).applyMatrix4(mesh.matrixWorld); pose(i, actual);
      assert.ok(actual.distanceTo(expected) < 1e-12, `${mode}: vertex ${i}`);
    }
  }
  geometry.dispose(); mesh.material.dispose();
});

test('prepared face candidates keep boundary clipping, UVs, materials and subsequent cuts identical to a full scan', () => {
  const geometry = new T.PlaneGeometry(4, 2, 40, 20), count = geometry.attributes.position.count;
  const weights = [], indices = [], colors = [];
  for (let i = 0; i < count; i++) {
    const x = geometry.attributes.position.getX(i);
    indices.push(0, 1, 0, 0); const weight = T.MathUtils.clamp((x + .5) / 1, 0, 1);
    weights.push(weight, 1 - weight, 0, 0); colors.push(.02 + i / count, .05, .1);
  }
  geometry.setAttribute('skinIndex', new T.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.clearGroups(); geometry.addGroup(0, 2400, 0); geometry.addGroup(2400, 2400, 1);
  const arm = new T.Bone(); arm.name = 'arm'; const head = new T.Bone(); head.name = 'head';
  const mesh = new T.SkinnedMesh(geometry, [new T.MeshStandardMaterial(), new T.MeshStandardMaterial()]);
  mesh.add(arm, head); mesh.bind(new T.Skeleton([arm, head]));
  const damage = new FighterDamage(mesh), debris = new GoreDebris(new T.Scene());
  for (const matcher of [/^arm$/, /^head$/]) {
    damage.prepareSever([matcher]);
    const chunks = damage.severByBones([matcher], { plane: { point: new T.Vector3(.1, 0, 0), normal: new T.Vector3(1, 0, 0), span: .6 } });
    for (const chunk of chunks || []) {
      assert.ok(chunk.faces.length < geometry.index.count / 3);
      const origin = new T.Vector3(.2, .4, .1), velocity = new T.Vector3();
      const fast = debris.addSurfaceLimb(chunk, origin, velocity);
      const full = debris.addSurfaceLimb({ ...chunk, faces: null }, origin, velocity);
      assert.equal(Boolean(fast), Boolean(full));
      if (!fast) continue;
      for (const name of ['position', 'normal', 'uv', 'color']) assert.deepEqual(fast.mesh.geometry.attributes[name].array, full.mesh.geometry.attributes[name].array, name);
      assert.deepEqual(fast.mesh.geometry.groups, full.mesh.geometry.groups);
    }
  }
  damage.dispose(); debris.dispose(); geometry.dispose(); mesh.material.forEach(m => m.dispose());
});

test('loading rehearsal leaves no live damage or debris, and prepared buffers transfer ownership only once', () => {
  const scene = new T.Scene(), model = new T.Group(), bone = new T.Bone(); bone.name = 'head'; model.add(bone); scene.add(model);
  const mesh = new T.Mesh(new T.BoxGeometry(.3, .4, .3), new T.MeshStandardMaterial()); mesh.name = 'Head'; bone.add(mesh);
  const damage = new FighterDamage(model), debris = new GoreDebris(scene), gore = new Dismemberment({ damage, model, debris });
  const view = { damage, gore };
  debris.warmupMeshes([view]);
  assert.equal(gore.debris, debris); assert.equal(gore.count, 0); assert.equal(gore.drain(), null);
  assert.equal(damage.hits, 0); assert.equal(damage.woundCount.value, 0); assert.equal(debris.pieces.length, 0);
  assert.ok(damage.meshes.every(r => r.sever.array.every(v => v === 0)));
  const record = damage.meshes[0], prepared = record.preparedSurface;
  assert.ok(prepared); let releases = 0; prepared.addEventListener('dispose', () => releases++);
  const chunk = damage.severByBones([/^head$/])[0];
  const piece = debris.addSurfaceLimb(chunk, new T.Vector3(), new T.Vector3());
  assert.equal(piece.mesh.geometry, prepared); assert.equal(record.preparedSurface, null);
  debris.resetRound(); assert.equal(releases, 1);
  gore.resetRound(); damage.resetRound(); debris.warmupMeshes([view]);
  const next = record.preparedSurface; assert.notEqual(next, prepared);
  let unusedReleased = false; next.addEventListener('dispose', () => unusedReleased = true);
  const templates = [...gore.flesh.preparedOwned], disposed = new Set();
  templates.forEach(g => g.addEventListener('dispose', () => disposed.add(g)));
  gore.resetRound(); assert.equal(disposed.size, 0, 'round reset retains reusable region templates');
  gore.dispose(); damage.dispose(); debris.dispose();
  assert.equal(disposed.size, templates.length); assert.equal(unusedReleased, true); assert.equal(releases, 1);
  mesh.geometry.dispose(); mesh.material.dispose();
});
