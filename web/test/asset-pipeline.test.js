import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { weaponsFor } from '../game/src/render/weapons.js';
import { getFighter, listFighters } from '../game/src/fighters/catalog.js';
import { packScene } from '../tools/pack-scene.mjs';
import { parseScenePack } from '../game/src/render/scenePack.js';
import { jobs, MANIFEST } from '../tools/asset-pipeline.mjs';

const publicFile = path => new URL(`../game/public/${path}`, import.meta.url);

test('a match fetches only the weapons its fighters can put on screen', () => {
  assert.deepEqual(weaponsFor(getFighter('officer_flock')).sort(), ['knife', 'shuriken']);
  assert.deepEqual(weaponsFor(getFighter('carney')), ['hockey']);
  assert.deepEqual(weaponsFor(getFighter('trump')), []);
  assert.deepEqual(weaponsFor(getFighter('lang')), []);
});

test('scene packs decode to bit-identical geometry', async () => {
  const json = JSON.parse(readFileSync(publicFile('gore/viscera.json'), 'utf8'));
  const { bytes } = await packScene(json);
  assert.ok(bytes.length < readFileSync(publicFile('gore/viscera.json')).length / 3, 'the pack is much smaller than the JSON');
  const group = await parseScenePack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const byName = new Map(group.children.map(child => [child.name, child.geometry]));
  const walk = (node, visit) => { visit(node); for (const child of node.children || []) walk(child, visit); };
  let meshes = 0;
  walk(json.object, node => {
    if (!node.geometry || !node.name) return;
    const source = json.geometries.find(g => g.uuid === node.geometry).data, decoded = byName.get(node.name);
    for (const [name, attribute] of Object.entries(source.attributes)) {
      assert.deepEqual([...decoded.attributes[name].array], attribute.array.map(v => Math.fround(v)), `${node.name}.${name}`);
    }
    if (source.index) assert.deepEqual([...decoded.index.array], source.index.array, `${node.name} index`);
    meshes++;
  });
  assert.ok(meshes > 5, 'the library has its organ meshes');
});

test('the asset pipeline manifest points at real masters and runtime paths', () => {
  for (const job of jobs()) assert.ok(existsSync(publicFile(job.source)), `${job.source} exists`);
  // Packed outputs replace their JSON masters at runtime; the code must ask for the pack.
  const flock = readFileSync(new URL('../game/src/fighters/officer_flock.js', import.meta.url), 'utf8');
  const gore = readFileSync(new URL('../game/src/render/goreProps.js', import.meta.url), 'utf8');
  assert.match(flock, /fighters\/officer_flock\/model\.bin/);
  assert.match(gore, /gore\/viscera\.bin/);
  for (const path of MANIFEST.devOnly) assert.ok(!jobs().some(job => job.output === path), `${path} is not also a shipped output`);
});

test('every roster fighter has a pre-rendered portrait', () => {
  for (const { id } of listFighters()) {
    assert.ok(existsSync(publicFile(`portraits/${id}.webp`)), `portraits/${id}.webp (run npm run render-portraits)`);
  }
});

test('every music track goes through the audio pipeline', async () => {
  const { MUSIC_TRACKS } = await import('../game/src/game/fightAudio.js');
  const audio = new Set(jobs().filter(job => job.kind === 'audio').map(job => job.output));
  for (const { file } of Object.values(MUSIC_TRACKS)) assert.ok(audio.has(`music/${file}`), `music/${file} is in tools/asset-pipeline.json "audio"`);
});
