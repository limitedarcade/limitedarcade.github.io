import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeClips } from '../game/src/render/binaryClips.js';
import { decodeModelPack } from '../game/src/render/modelPack.js';
import { decodeModel, buildFighter } from '../game/src/fighters/_shared/meshCodec.js';
import * as THREE from '../game/src/vendor/three.module.js';

function buffer(path) { const b = readFileSync(new URL(path, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); }
for (const id of ['trump', 'carney']) test(`${id} binary runtime preserves mesh and all authored animation samples`, async () => {
  const pack = decodeModelPack(buffer(`../game/public/fighters/${id}/fighter.bin`));
  const source = await import(`../game/src/fighters/${id}/surfaceData.js`);
  const actual = decodeModel(pack.model, pack.stream), expected = decodeModel(source.SURFACE_MODEL, source.SURFACE_STREAM);
  assert.equal(actual.length, expected.length);
  actual.forEach((part, i) => { for (const key of ['position','normal','colour','weights','joints','index']) assert.deepEqual(part[key], expected[i][key]); });
  const built = buildFighter(THREE, pack.model, null, pack.rig, { decodedParts: actual });
  assert.equal(built.clips.length, 32);
  const clips = decodeClips(buffer(`../game/public/fighters/${id}/combat.bin`));
  const { SPECIAL_CLIPS } = await import(`../game/src/fighters/${id}/specialClips.js`);
  assert.equal(clips.length, SPECIAL_CLIPS.length);
  for (const [i, clip] of clips.entries()) {
    assert.equal(clip.name, SPECIAL_CLIPS[i].name); assert.ok(clip.validate());
    for (const [j, track] of clip.tracks.entries()) {
      assert.deepEqual(track.values, Float32Array.from(SPECIAL_CLIPS[i].tracks[j].values));
      assert.deepEqual(track.times, Float32Array.from(SPECIAL_CLIPS[i].tracks[j].times));
    }
    built.mixer.clipAction(clip).play(); built.mixer.update(0.2); built.mixer.stopAllAction();
  }
  built.dispose();
});
test('invalid binary pack headers fail early', () => {
  assert.throws(() => decodeClips(new ArrayBuffer(12)), /Invalid/);
  assert.throws(() => decodeModelPack(new ArrayBuffer(12)), /Invalid/);
});
