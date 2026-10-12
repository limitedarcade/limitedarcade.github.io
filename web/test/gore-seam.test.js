import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../game/src/vendor/three.module.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';
import { Dismemberment } from '../game/src/render/dismemberment.js';
import { GoreDebris } from '../game/src/render/goreProps.js';
import { decodeModelPack } from '../game/src/render/modelPack.js';
import { decodeModel, buildFighter } from '../game/src/fighters/_shared/meshCodec.js';

const json = JSON.parse(await readFile(new URL('../game/public/gore/cut-surfaces.json', import.meta.url), 'utf8'));

test('Blender cut surfaces contain smooth coloured tissue and a separate marrow bone', () => {
  const library = new T.ObjectLoader().parse(json);
  for (const name of ['armCut', 'legCut', 'torsoCut', 'cutBone']) {
    const mesh = library.getObjectByName(name);
    assert.ok(mesh?.geometry.attributes.normal && mesh.geometry.attributes.color, name);
    assert.ok(mesh.geometry.index.count > 500, `${name} has a curved surface`);
    for (const attr of Object.values(mesh.geometry.attributes)) assert.ok([...attr.array].every(Number.isFinite));
    mesh.geometry.computeBoundingBox();
    assert.ok(mesh.geometry.boundingBox.max.y > 0 && mesh.geometry.boundingBox.min.y < -.3, 'cut face and inset volume share a seam');
  }
});

for (const fighter of ['carney', 'trump', 'lang', 'officer_flock']) test(`${fighter}: animated arm, leg and waist seams remain attached in both facings`, async () => {
  let model, built;
  if (fighter === 'officer_flock') {
    const source = JSON.parse(await readFile(new URL('../game/public/fighters/officer_flock/model.json', import.meta.url), 'utf8'));
    for (const image of source.images || []) image.url = { data: [255, 255, 255, 255], width: 1, height: 1, type: 'Uint8Array' };
    model = new T.ObjectLoader().parse(source);
  } else if (fighter === 'lang') {
    const bytes = await readFile(new URL('../game/public/fighters/lang/fighter.bin', import.meta.url));
    const pack = decodeModelPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    built = buildFighter(T, pack.model, null, pack.rig, { decodedParts: decodeModel(pack.model, pack.stream) });
    model = built.group;
  } else {
    const factory = await import(`../game/src/fighters/${fighter}/createFighterModel.js`);
    await factory.prewarm(); built = factory.createFighter(); model = built.group;
  }
  const scene = new T.Scene(); scene.add(model); model.updateMatrixWorld(true);
  const size = new T.Box3().setFromObject(model).getSize(new T.Vector3());
  model.scale.multiplyScalar(1.9 / size.y);
  const damage = new FighterDamage(model), debris = new GoreDebris(scene);
  const library = new T.ObjectLoader().parse(json);
  for (const mesh of library.children) { debris.library.set(mesh.name, mesh.geometry); debris.libraryMaterials.set(mesh.name, mesh.material); }
  const gore = new Dismemberment({ damage, model, debris });
  for (const facing of [0, Math.PI]) for (const cinematic of [false, true]) for (const id of ['leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'torso']) {
    model.rotation.y = facing; model.updateMatrixWorld(true);
    const cut = gore.sever(id, { cinematic });
    assert.ok(cut?.pieces.length, `${id} produces solid geometry`);
    const stump = gore.flesh.stumps.find(s => s.regionId === id);
    for (const record of damage.meshes) {
      if (!record.mesh.skeleton) continue;
      const bones = new Set(record.mesh.skeleton.bones.flatMap((bone, index) => stump.region.chain.some(pattern => pattern.test(bone.name)) ? [index] : []));
      const index = record.geometry.attributes.skinIndex, weight = record.geometry.attributes.skinWeight;
      if (!index || !weight) continue;
      let retainedDistal = 0;
      for (let i = 0; i < index.count; i++) {
        let bound = 0;
        for (let j = 0; j < 4; j++) if (bones.has(index.array[i * 4 + j])) bound += weight.array[i * 4 + j];
        if (bound >= .5 && record.sever.array[i] <= .5) retainedDistal++;
      }
      assert.equal(retainedDistal, 0, `${id}: fully owned distal geometry cannot survive by folding behind the cut plane`);
    }
    assert.ok(stump.seam.samples.length >= 3, `${id} finds its surface seam`);
    assert.equal(stump.cap.getObjectByName('stumpPlug').userData.authoredCut, true);
    for (let frame = 0; frame < 8; frame++) {
      stump.bone.rotation.z += .07;
      model.position.x += .025;
      model.updateMatrixWorld(true); gore.update(1 / 60);
      const center = stump.cap.getWorldPosition(new T.Vector3());
      assert.ok(center.distanceTo(stump.seam.center) < stump.worldRadius * .06, `${id} has no gap at pose ${frame}`);
      for (const strand of stump.strands) {
        const pin = model.localToWorld(strand.points[0].clone());
        assert.ok(pin.distanceTo(stump.seam.center) < stump.worldRadius * 2.5, 'continuous strands stay pinned to the wound');
      }
    }
    const piece = cut.pieces.find(p => p.mesh.getObjectByName(`detachedCut:${id}`));
    assert.ok(piece, 'outgoing limb owns its cut face');
    const cap = piece.mesh.getObjectByName(`detachedCut:${id}`), local = cap.position.clone();
    const detachedSurface = cap.getObjectByName('stumpPlug').geometry;
    const frozen = new Float32Array(detachedSurface.attributes.position.array);
    stump.bone.rotation.x += .2; model.updateMatrixWorld(true); gore.update(1 / 60);
    assert.deepEqual(detachedSurface.attributes.position.array, frozen, 'the detached tissue never deforms with the remaining body');
    piece.mesh.position.add(new T.Vector3(2, -1, .5)); piece.mesh.rotation.y += 1;
    piece.mesh.updateMatrixWorld(true);
    assert.deepEqual(cap.position.toArray(), local.toArray(), 'tissue cannot separate during limb flight');
    debris.resetRound(); gore.resetRound(); damage.resetRound();
    assert.equal(debris.owned.size, 0);
  }
  gore.dispose(); damage.dispose(); debris.dispose(); built?.dispose();
});
