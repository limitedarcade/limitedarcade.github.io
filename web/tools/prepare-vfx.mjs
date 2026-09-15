#!/usr/bin/env node
// Prepare the deliberately small runtime VFX pack without recompressing or
// rewriting the artists' models. Run with --check for a read-only integrity check.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'game/public/vfx');
const check = process.argv.includes('--check');
const sampleRate = 60;
const selections = [
  {
    id: 'fireball', sourceFile: 'fireball_vfx.glb',
    orientation: {
      shape: 'volume', principalAxis: null, normalizeBy: 'maxDimension',
      notes: 'Nearly spherical mesh. Recenter its nonzero source center before scaling or spinning. No authored animation; movement, spin, pulse and fade are runtime controls.',
    },
  },
  {
    id: 'laser', sourceFile: 'laser_shot.glb',
    orientation: {
      shape: 'crossed-planes', principalAxis: 'z', normalizeBy: 'length',
      notes: 'Two crossed textured planes; original length is 2 along Z, centered at the origin. Rotate the wrapper +PI/2 around Y for +X travel. Adjust local Z length independently of X/Y thickness.',
    },
  },
  {
    id: 'shield', sourceFile: 'pro4ik_utcm_3.0_shield.glb',
    orientation: {
      shape: 'disc', principalAxis: 'z', normalizeBy: 'diameter',
      notes: 'Disc lies in XY and faces Z, approximately 19.9277 units in diameter. Contains a skin and bones despite having no animation clip: use SkeletonUtils.clone for independent instances. Recenter before scaling. A scale near 0.1 gives a fighter-sized disc.',
    },
  },
  {
    id: 'appearance', sourceFile: 'appearance_effect_light_beam.glb',
    orientation: {
      shape: 'layered-ground-planes', principalAxis: 'y', normalizeBy: 'animatedDiameter',
      notes: 'Authored as horizontal XZ layers, not an upright column. Preserve orientation for ground summons; rotate the wrapper +PI/2 around X for an upright camera-facing effect. The 1.6667-second clip scales in during its first 0.37 seconds and then rotates; provide a runtime fade. Preserve original textures and their alpha.',
    },
  },
  {
    id: 'burst', sourceFile: '27444eb10a4f4409b4a2649738ec7441.glb',
    orientation: {
      shape: 'layered-ground-planes', principalAxis: 'y', normalizeBy: 'animatedDiameter',
      notes: 'Layered XZ rings and a shallow volume. Preserve orientation for a ground sigil or rotate the wrapper +PI/2 around X for upright impacts. The complete 12.5999-second clip mainly rotates rings and applies single-key layer poses; it is not a baked explosion. Use runtime scale/fade envelopes for a burst or loop the animation for a sustained sigil. Some layers have opaque default materials; preserve material distinctions.',
    },
  },
];

function unpackGlb(buffer, filename) {
  assert.equal(buffer.readUInt32LE(0), 0x46546c67, `${filename}: GLB magic`);
  assert.equal(buffer.readUInt32LE(4), 2, `${filename}: GLB version`);
  assert.equal(buffer.readUInt32LE(8), buffer.length, `${filename}: GLB byte length`);
  const chunks = [];
  let offset = 12;
  while (offset < buffer.length) {
    assert.ok(offset + 8 <= buffer.length, `${filename}: truncated chunk header`);
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    assert.equal(length % 4, 0, `${filename}: chunk alignment`);
    assert.ok(offset + 8 + length <= buffer.length, `${filename}: truncated chunk`);
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  assert.equal(chunks[0]?.type, 0x4e4f534a, `${filename}: first chunk must be JSON`);
  const json = JSON.parse(chunks[0].data.toString('utf8'));
  const binary = chunks.find(chunk => chunk.type === 0x004e4942)?.data;
  assert.ok(binary, `${filename}: embedded binary required`);
  assert.equal(json.asset.version, '2.0', `${filename}: glTF version`);
  assert.equal(json.buffers.length, 1, `${filename}: expected one embedded buffer`);
  assert.ok(!json.buffers[0].uri, `${filename}: external buffers are not permitted`);
  assert.ok(json.buffers[0].byteLength <= binary.length, `${filename}: invalid buffer length`);
  for (const view of json.bufferViews ?? []) {
    assert.equal(view.buffer, 0, `${filename}: external buffer view`);
    assert.ok((view.byteOffset ?? 0) + view.byteLength <= binary.length, `${filename}: invalid buffer view range`);
  }
  for (const image of json.images ?? []) {
    assert.ok(image.bufferView != null && !image.uri, `${filename}: image must be embedded`);
  }
  for (const key of ['title', 'author', 'license', 'source']) {
    assert.equal(typeof json.asset.extras?.[key], 'string', `${filename}: missing ${key} attribution`);
  }
  return { json, binary };
}

// Materials are omitted only from the in-memory bounds measurement. The actual
// output GLB is an exact source copy, including every texture, skin and clip.
function measurementGlb(json, binary) {
  const document = structuredClone(json);
  document.materials = (document.materials ?? []).map(() => ({}));
  delete document.images;
  delete document.textures;
  const jsonData = Buffer.from(JSON.stringify(document));
  const jsonChunk = Buffer.alloc(Math.ceil(jsonData.length / 4) * 4, 0x20);
  jsonData.copy(jsonChunk);
  const buffer = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + binary.length);
  buffer.writeUInt32LE(0x46546c67, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(jsonChunk.length, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  jsonChunk.copy(buffer, 20);
  const binaryOffset = 20 + jsonChunk.length;
  buffer.writeUInt32LE(binary.length, binaryOffset);
  buffer.writeUInt32LE(0x004e4942, binaryOffset + 4);
  binary.copy(buffer, binaryOffset + 8);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
}

function boxData(box) {
  const numbers = vector => vector.toArray().map(number => {
    assert.ok(Number.isFinite(number), 'Nonfinite asset bounds');
    return Number(number.toFixed(7));
  });
  return {
    min: numbers(box.min), max: numbers(box.max),
    size: numbers(box.getSize(new THREE.Vector3())),
    center: numbers(box.getCenter(new THREE.Vector3())),
  };
}

function updateAndMeasure(scene) {
  scene.updateMatrixWorld(true);
  scene.traverse(object => { if (object.isSkinnedMesh) object.skeleton.update(); });
  return new THREE.Box3().setFromObject(scene, true);
}

async function measureBounds(json, binary) {
  const gltf = await new GLTFLoader().parseAsync(measurementGlb(json, binary), '');
  const rest = updateAndMeasure(gltf.scene);
  const animated = rest.clone();
  const clips = [];
  for (const clip of gltf.animations) {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    // Include all authored key times as well as uniform samples. This records an
    // envelope suitable for normalization; it is not a collision volume proof.
    const times = new Set([0, clip.duration]);
    const steps = Math.ceil(clip.duration * sampleRate);
    for (let step = 0; step <= steps; step++) times.add(clip.duration * step / Math.max(1, steps));
    for (const track of clip.tracks) for (const time of track.times) times.add(time);
    const clipBounds = new THREE.Box3();
    for (const time of [...times].sort((a, b) => a - b)) {
      mixer.setTime(time);
      clipBounds.union(updateAndMeasure(gltf.scene));
    }
    animated.union(clipBounds);
    clips.push({
      name: clip.name, durationSeconds: clip.duration, tracks: clip.tracks.length,
      bounds: boxData(clipBounds), samples: times.size,
    });
    mixer.stopAllAction();
    mixer.uncacheRoot(gltf.scene);
  }
  gltf.scene.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    if (object.material) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
    }
  });
  return {
    clips,
    bounds: {
      coordinateSpace: 'scene, including source node transforms and skin pose',
      method: 'Exact vertex rest bounds; animation envelope sampled at 60 Hz and all authored key times.',
      rest: boxData(rest), animated: boxData(animated),
    },
  };
}

function geometryData(json) {
  const primitives = (json.meshes ?? []).flatMap(mesh => mesh.primitives);
  return {
    meshes: (json.meshes ?? []).length, primitives: primitives.length,
    vertices: primitives.reduce((sum, primitive) => sum + json.accessors[primitive.attributes.POSITION].count, 0),
    triangles: primitives.reduce((sum, primitive) => {
      assert.equal(primitive.mode ?? 4, 4, 'Expected triangle geometry');
      const count = json.accessors[primitive.indices ?? primitive.attributes.POSITION].count;
      assert.equal(count % 3, 0, 'Triangle vertex/index count');
      return sum + count / 3;
    }, 0),
    skins: (json.skins ?? []).length, materials: (json.materials ?? []).length,
    embeddedImages: (json.images ?? []).length,
  };
}

async function emit(filename, contents) {
  const target = path.join(output, filename);
  if (check) {
    assert.deepEqual(await readFile(target), Buffer.isBuffer(contents) ? contents : Buffer.from(contents), `${filename} is stale; run node tools/prepare-vfx.mjs`);
  } else {
    await writeFile(target, contents);
  }
}

async function main() {
  assert.ok(process.argv.slice(2).every(argument => argument === '--check'), 'Usage: node tools/prepare-vfx.mjs [--check]');
  if (!check) await mkdir(output, { recursive: true });
  const assets = [];
  for (const selection of selections) {
    const source = await readFile(path.join(root, 'vfx', selection.sourceFile));
    const { json, binary } = unpackGlb(source, selection.sourceFile);
    const measurements = await measureBounds(json, binary);
    const metadata = json.asset.extras;
    const asset = {
      id: selection.id, url: `vfx/${selection.id}.glb`, sourceFile: `vfx/${selection.sourceFile}`,
      bytes: source.length, sha256: createHash('sha256').update(source).digest('hex'),
      attribution: { title: metadata.title, author: metadata.author, license: metadata.license, source: metadata.source },
      sourceAssetMetadata: json.asset,
      changes: 'File renamed for the runtime pack; GLB contents are byte-for-byte unchanged.',
      geometry: geometryData(json), extensionsUsed: json.extensionsUsed ?? [],
      cameras: (json.cameras ?? []).length,
      punctualLights: (json.extensions?.KHR_lights_punctual?.lights ?? []).length,
      ...measurements, orientation: selection.orientation,
    };
    await emit(`${selection.id}.glb`, source);
    assets.push(asset);
  }
  const manifest = {
    version: 1,
    generatedBy: 'node tools/prepare-vfx.mjs',
    totalBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
    selectionPolicy: 'The five small, reusable effects only. Large lightning, a-bomb, ultrako and explosion source assets are intentionally excluded from this pack.',
    assets,
  };
  await emit('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  const credits = [
    '# VFX asset attribution', '',
    'Metadata below is copied exactly from each source GLB. All five selected assets declare CC BY 4.0 in their embedded metadata.', '',
    'The distributed GLBs are byte-for-byte copies with shorter filenames. The game may transform their size, orientation, tint, opacity and animation timing when displaying them.', '',
    ...assets.flatMap(asset => [
      `## ${asset.attribution.title}`, '',
      `- Runtime file: ${asset.id}.glb`,
      `- Author: ${asset.attribution.author}`,
      `- License: ${asset.attribution.license}`,
      `- Source: ${asset.attribution.source}`,
      `- Changes: ${asset.changes}`, '',
    ]),
    'No endorsement by these artists is implied.', '',
  ].join('\n');
  await emit('ATTRIBUTION.md', credits);
  console.log(`${check ? 'Verified' : 'Prepared'} ${assets.length} VFX assets, ${manifest.totalBytes.toLocaleString('en-US')} bytes (${(manifest.totalBytes / 1048576).toFixed(2)} MiB).`);
  for (const asset of assets) console.log(`${asset.id}: ${asset.geometry.triangles} triangles; ${asset.clips.map(clip => `${clip.name} ${clip.durationSeconds.toFixed(4)}s`).join(', ') || 'static'}; ${asset.bytes} bytes`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
