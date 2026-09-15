import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from '../game/src/vendor/three.module.js';
import { ModelVfx } from '../game/src/render/modelVfx.js';
import { VFX_PRESETS } from '../game/src/render/vfxPresets.js';
import { CombatVfx } from '../game/src/render/combatVfx.js';

const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 1e-6, `${label}: ${actual} != ${expected}`);
const preset = (asset = 'effect.glb') => ({ asset, color: '#ffffff', size: 1, duration: 1,
  opacity: 1, glow: 1, rotation: [0, 0, 0], grow: 0, spin: 0, additive: true });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const meshes = root => { const list = []; root.traverse(node => { if (node.isMesh) list.push(node); }); return list; };
const watchDisposal = resource => {
  let count = 0;
  resource.addEventListener('dispose', () => count++);
  return () => count;
};

function asset({ animated = false, skinned = false, externalBone = false, separateEmission = false } = {}) {
  const scene = new THREE.Group(), model = new THREE.Group(); model.name = 'authored';
  const texture = new THREE.Texture();
  const emission = separateEmission ? new THREE.Texture() : texture;
  const first = new THREE.MeshStandardMaterial({ color: '#ff6000', opacity: 0.8, map: texture, emissiveMap: emission });
  const second = new THREE.MeshStandardMaterial({ color: '#00aaff', opacity: 0.5 });
  const geometry = new THREE.BoxGeometry(2, 2, 2);
  let mesh, bone;
  if (skinned || externalBone) {
    const count = geometry.attributes.position.count;
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4));
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    mesh = new THREE.SkinnedMesh(geometry, [first, second]);
    bone = new THREE.Bone(); bone.name = 'effect-bone';
    if (!externalBone) model.add(bone);
    model.add(mesh); scene.add(model); scene.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton([bone]));
  } else {
    mesh = new THREE.Mesh(geometry, [first, second]); model.add(mesh); scene.add(model);
  }
  mesh.name = 'effect-mesh';
  // The second node deliberately shares both geometry and a source material.
  const shared = new THREE.Mesh(geometry, first); shared.name = 'shared-mesh'; model.add(shared);
  model.position.set(9, 4, -2);
  const animations = animated ? [new THREE.AnimationClip('expand', 4, [
    new THREE.VectorKeyframeTrack('authored.scale', [0, 4], [0, 0, 0, 2, 2, 2]),
  ])] : [];
  if (animated) model.scale.setScalar(0);
  scene.updateMatrixWorld(true);
  return { gltf: { scene, animations }, scene, model, mesh, shared, geometry, texture, emission, first, second, bone };
}

async function fixture(options = {}, sourceOptions = {}) {
  const source = asset(sourceOptions), scene = new THREE.Scene(), calls = [];
  const library = new ModelVfx(scene, { assetBase: '/sub/game', presets: { sample: preset() },
    loader: { loadAsync: async url => { calls.push(url); return source.gltf; } }, ...options });
  await library.preload();
  return { source, scene, library, calls };
}

test('model effects preload once, obey both pool caps, reuse instances, and reject stale stop handles', async () => {
  const sources = { 'one.glb': asset(), 'two.glb': asset() }, calls = [];
  const scene = new THREE.Scene();
  const library = new ModelVfx(scene, { assetBase: '/nested/game/', maxActive: 3, maxPerAsset: 2,
    presets: { one: preset('one.glb'), two: preset('two.glb') },
    loader: { loadAsync: async url => { calls.push(url); return sources[url.split('/').at(-1)].gltf; } } });
  await Promise.all([library.preload(), library.preload()]);
  assert.deepEqual(calls.sort(), ['/nested/game/one.glb', '/nested/game/two.glb']);
  assert.equal(library.stats.pooled, 2);
  const first = library.spawn('one'), second = library.spawn('one');
  assert.equal(library.spawn('one'), null, 'per-asset cap');
  assert.ok(library.spawn('two')); assert.equal(library.spawn('two'), null, 'total cap');
  first.stop(); first.stop();
  const reused = library.spawn('one'); assert.equal(reused.root, first.root);
  first.stop(); assert.equal(library.stats.active, 3, 'an old handle cannot stop a new use');
  second.stop(); reused.stop(); library.clear();
  assert.equal(scene.children.length, 0); assert.equal(library.stats.pooled, 3);
  library.dispose();
});

test('an explicitly small total cap remains a hard limit', async () => {
  const { library } = await fixture({ maxActive: 1 });
  assert.ok(library.spawn('sample'));
  assert.equal(library.spawn('sample'), null);
  library.dispose();
});

test('performance and reduced-motion settings reduce effect budgets and motion', async () => {
  const { library } = await fixture({ maxActive: 12, maxPerAsset: 12, quality: 0.5, reducedMotion: true });
  const first = library.spawn('sample', { spin: 4, grow: 0.5, size: 2 });
  library.update(0.25);
  near(first.root.rotation.z, 0, 'no reduced-motion spin'); near(first.root.scale.x, 2, 'no reduced-motion growth');
  assert.ok(library.spawn('sample')); assert.ok(library.spawn('sample'));
  assert.equal(library.spawn('sample'), null, 'performance and reduced motion apply together');
  library.dispose();
});

test('each effect owns its tint and material arrays while source geometry and textures remain shared', async () => {
  const { library, source, calls } = await fixture();
  const initialColor = source.first.color.clone();
  const red = library.spawn('sample', { color: '#ff0000' }), blue = library.spawn('sample', { color: '#0000ff' });
  library.update(0.25);
  const redMesh = red.root.getObjectByName('effect-mesh'), blueMesh = blue.root.getObjectByName('effect-mesh');
  assert.ok(Array.isArray(redMesh.material)); assert.equal(redMesh.material.length, 2);
  assert.notEqual(redMesh.material[0], blueMesh.material[0]); assert.notEqual(redMesh.material[0], source.first);
  assert.equal(redMesh.material[0], red.root.getObjectByName('shared-mesh').material, 'sharing within one clone is retained');
  assert.equal(redMesh.geometry, source.geometry); assert.equal(redMesh.material[0].map, source.texture);
  assert.equal(redMesh.material[0].color.getHex(), 0xff0000); assert.equal(blueMesh.material[0].color.getHex(), 0x0000ff);
  assert.ok(source.first.color.equals(initialColor)); assert.equal(source.first.opacity, 0.8);
  assert.equal(redMesh.material[0].opacity, 0.8); assert.equal(redMesh.material[1].opacity, 0.5);
  assert.equal(redMesh.material[0].depthWrite, false); assert.equal(redMesh.material[0].toneMapped, false);
  assert.equal(calls[0], '/sub/game/effect.glb', 'subpath hosting gains exactly one slash');
  library.dispose();
});

test('skinned shield clones bind only their own bones and do not alter the source or another use', async () => {
  const { library, source } = await fixture({}, { skinned: true });
  const left = library.spawn('sample'), right = library.spawn('sample');
  const a = left.root.getObjectByName('effect-mesh'), b = right.root.getObjectByName('effect-mesh');
  assert.notEqual(a.skeleton, b.skeleton); assert.notEqual(a.skeleton, source.mesh.skeleton);
  assert.notEqual(a.skeleton.bones[0], b.skeleton.bones[0]); assert.notEqual(a.skeleton.bones[0], source.bone);
  assert.equal(a.skeleton.bones[0], left.root.getObjectByName('effect-bone'));
  a.skeleton.bones[0].position.x = 3;
  assert.equal(b.skeleton.bones[0].position.x, 0); assert.equal(source.bone.position.x, 0);
  assert.notEqual(a.skeleton.boneMatrices, b.skeleton.boneMatrices);
  library.dispose();
});

test('animated bounds include the full clip and normalization never overwrites placement', async () => {
  const { library, source } = await fixture({}, { animated: true });
  const effect = library.spawn('sample', { x: -5, y: 7, z: 2, size: 4, duration: 2, speed: 2, delay: 0.5 });
  assert.equal(effect.root.visible, false); assert.ok(source.model.scale.equals(new THREE.Vector3(0, 0, 0)), 'bounds sampling restores authored pose');
  library.update(0.25); assert.equal(effect.root.visible, false);
  library.update(0.25); assert.equal(effect.root.visible, true);
  library.update(0.5);
  const model = effect.root.getObjectByName('authored'); near(model.scale.x, 1, 'half of the complete four-second clip');
  const bounds = new THREE.Box3().setFromObject(effect.root), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
  near(size.x, 2, 'half expansion inside four-metre envelope');
  near(center.x, -5, 'world x'); near(center.y, 7, 'world y'); near(center.z, 2, 'world z');
  near(effect.root.scale.x, 4, 'wrapper scale is independent of animated scale');
  library.update(0.5);
  assert.equal(library.stats.active, 0, 'speed changes lifetime while delay remains world seconds');
  assert.equal(effect.root.parent, null);
  library.dispose();
});

test('pause delta freezes animation, fade and trajectory; looping and pooled animation restart correctly', async () => {
  const { library } = await fixture({}, { animated: true });
  const effect = library.spawn('sample', { loop: true, duration: 1, speed: 2, velocity: [3, 0, 0], x: 2 });
  library.update(0.125);
  const mesh = effect.root.getObjectByName('effect-mesh'), model = effect.root.getObjectByName('authored');
  const before = { x: effect.root.position.x, opacity: mesh.material[0].opacity, scale: model.scale.x };
  for (const dt of [0, -1, NaN, Infinity]) library.update(dt);
  assert.deepEqual({ x: effect.root.position.x, opacity: mesh.material[0].opacity, scale: model.scale.x }, before);
  near(before.x, 2.75, 'velocity advances using playback speed');
  library.update(0.5);
  near(model.scale.x, before.scale, 'one full loop returns to matching animation pose');
  assert.equal(library.stats.active, 1);
  effect.stop();
  const reused = library.spawn('sample', { duration: 1 });
  assert.equal(reused.root, effect.root); near(model.scale.x, 0, 'reused animation restarts at beginning');
  library.update(0.25); near(model.scale.x, before.scale, 'new playback is independent of prior mixer time');
  library.dispose();
});

test('manual snapshot effects hold their pose, support clip windows, and ignore controls from a retired handle', async () => {
  const { library } = await fixture({}, { animated: true });
  const effect = library.spawn('sample', { manual: true, duration: 2, speed: 3, clipStart: 0.25, clipEnd: 0.75 });
  const model = effect.root.getObjectByName('authored');
  near(model.scale.x, 0.5, 'clip starts at selected authored time');
  effect.seek(0.5); effect.setPosition(-3, 4, 2);
  near(model.scale.x, 1, 'halfway through the selected clip window');
  library.update(60);
  near(model.scale.x, 1, 'elapsed render time cannot advance a manual effect');
  assert.equal(library.stats.active, 1); assert.ok(effect.root.position.equals(new THREE.Vector3(-3, 4, 2)));
  effect.seek(0.9); near(model.scale.x, 1.4, 'late clip window sample');
  effect.stop();
  const reused = library.spawn('sample', { manual: true, x: 1, y: 2, z: 3 });
  effect.seek(0.8); effect.setPosition(99, 99, 99); effect.stop();
  assert.equal(library.stats.active, 1); assert.ok(reused.root.position.equals(new THREE.Vector3(1, 2, 3)));
  near(model.scale.x, 0, 'stale seek cannot change the reused animation');
  library.dispose();
});

test('instant contact envelopes are visible on the triggering frame and hold through hitstop', async () => {
  const { library } = await fixture();
  const effect = library.spawn('sample', { fadeIn: 0, opacity: 0.5 });
  const material = effect.root.getObjectByName('effect-mesh').material[0];
  assert.equal(effect.root.visible, true); near(material.opacity, 0.4, 'contact opacity before any update');
  library.update(0); near(material.opacity, 0.4, 'contact remains visible during frozen delta');
  library.dispose();
});

test('clear during a pending load never replays the missed contact; later use stays available', async () => {
  const waiting = deferred(), source = asset(), calls = [];
  const scene = new THREE.Scene(), library = new ModelVfx(scene, { presets: { sample: preset() },
    loader: { loadAsync: url => { calls.push(url); return waiting.promise; } } });
  assert.equal(library.spawn('sample'), null);
  const preload = library.preload();
  library.clear(); waiting.resolve(source.gltf); await preload;
  assert.equal(calls.length, 1); assert.equal(library.stats.loaded, 1);
  assert.equal(library.stats.active, 0); assert.equal(scene.children.length, 0);
  assert.ok(library.spawn('sample')); library.dispose();
});

test('failed loads are suppressed during combat and retried by explicit preload', async () => {
  const source = asset(); let calls = 0;
  const library = new ModelVfx(new THREE.Scene(), { presets: { sample: preset() },
    loader: { loadAsync: async () => { if (++calls === 1) throw new Error('offline'); return source.gltf; } } });
  assert.deepEqual(await library.preload(), [false]); assert.equal(library.stats.failed, 1);
  for (let i = 0; i < 20; i++) assert.equal(library.spawn('sample'), null);
  assert.equal(calls, 1, 'missing VFX cannot cause a request storm');
  assert.deepEqual(await library.preload(), [true]); assert.equal(library.stats.failed, 0);
  assert.ok(library.spawn('sample')); assert.equal(calls, 2);
  library.dispose();
});

test('invalid skeleton load fails cleanly and can be replaced on explicit retry', async () => {
  const invalid = asset({ externalBone: true }), valid = asset(); let calls = 0;
  const disposed = watchDisposal(invalid.geometry);
  const library = new ModelVfx(new THREE.Scene(), { presets: { sample: preset() },
    loader: { loadAsync: async () => ++calls === 1 ? invalid.gltf : valid.gltf } });
  assert.deepEqual(await library.preload(), [false]);
  assert.equal(library.stats.loaded, 0, 'failed instantiation is not a usable template');
  assert.equal(disposed(), 1, 'invalid asset is released');
  assert.equal(library.spawn('sample'), null);
  assert.deepEqual(await library.preload(), [true]); assert.ok(library.spawn('sample'));
  library.dispose();
});

test('release retains shared resources and full disposal releases each owned resource exactly once', async () => {
  const { library, source, scene } = await fixture();
  const counts = [source.geometry, source.first, source.second, source.texture].map(watchDisposal);
  const first = library.spawn('sample'), second = library.spawn('sample');
  const owned = new Set([...meshes(first.root), ...meshes(second.root)].flatMap(mesh => [].concat(mesh.material)));
  const ownedCounts = [...owned].map(watchDisposal);
  first.stop(); library.clear();
  assert.ok(counts.every(count => count() === 0)); assert.ok(ownedCounts.every(count => count() === 0));
  library.dispose(); library.dispose();
  assert.ok(counts.every(count => count() === 1)); assert.ok(ownedCounts.every(count => count() === 1));
  assert.deepEqual(library.stats, { active: 0, pooled: 0, loaded: 0, failed: 0 });
  assert.equal(scene.children.length, 0); assert.equal(library.spawn('sample'), null);
  assert.deepEqual(await library.preload(), []);
});

test('a generated shield perimeter is reused and releases its own resources without disposing the imported mesh early', async () => {
  const { library, source } = await fixture({ presets: { sample: { ...preset(), rim: true } } });
  const sourceDisposal = watchDisposal(source.geometry);
  const first = library.spawn('sample'), second = library.spawn('sample');
  const generated = [...meshes(first.root), ...meshes(second.root)].filter(mesh => mesh.geometry !== source.geometry);
  assert.ok(generated.length >= 2, 'each active shield has a readable perimeter');
  const ownGeometry = [...new Set(generated.map(mesh => mesh.geometry))], ownMaterials = [...new Set(generated.flatMap(mesh => [].concat(mesh.material)))];
  const counts = [...ownGeometry, ...ownMaterials].map(watchDisposal);
  first.stop(); const reused = library.spawn('sample'); assert.equal(reused.root, first.root);
  library.clear(); assert.equal(sourceDisposal(), 0); assert.ok(counts.every(count => count() === 0));
  library.dispose(); library.dispose();
  assert.equal(sourceDisposal(), 1); assert.ok(counts.every(count => count() === 1));
});

test('shaded effects retain the alpha-bearing base texture, tint independently, and release separate emission textures', async () => {
  const { library, source } = await fixture({ presets: { sample: { ...preset(), additive: false } } }, { separateEmission: true });
  const baseDisposed = watchDisposal(source.texture), emissionDisposed = watchDisposal(source.emission);
  const first = library.spawn('sample', { color: '#4488ff' }), second = library.spawn('sample', { color: '#ff8844' });
  const material = first.root.getObjectByName('effect-mesh').material[0], other = second.root.getObjectByName('effect-mesh').material[0];
  assert.equal(material.map, source.texture, 'base alpha must not be replaced by the opaque emission texture');
  assert.notEqual(material.color.getHex(), other.color.getHex());
  assert.ok(material.emissive.equals(material.color)); assert.ok(other.emissive.equals(other.color));
  assert.equal(source.first.map, source.texture); assert.equal(source.first.emissiveMap, source.emission);
  library.update(0.25); near(material.opacity, source.first.opacity, 'base alpha multiplier survives shading');
  library.clear(); assert.equal(baseDisposed(), 0); assert.equal(emissionDisposed(), 0);
  library.dispose(); assert.equal(baseDisposed(), 1); assert.equal(emissionDisposed(), 1);
});

test('disposal during loading releases the late template without adding instances or scene nodes', async () => {
  const waiting = deferred(), source = asset();
  const counts = [source.geometry, source.first, source.second, source.texture].map(watchDisposal);
  const scene = new THREE.Scene(), library = new ModelVfx(scene, { presets: { sample: preset() },
    loader: { loadAsync: () => waiting.promise } });
  const pending = library.preload(); library.dispose(); waiting.resolve(source.gltf);
  assert.deepEqual(await pending, [false]);
  assert.ok(counts.every(count => count() === 1));
  assert.equal(scene.children.length, 0); assert.equal(library.pending.size, 0);
  assert.deepEqual(library.stats, { active: 0, pooled: 0, loaded: 0, failed: 0 });
});

function combatFixture() {
  const calls = [];
  const effects = new CombatVfx({ spawn: (id, settings) => {
    const handle = { stops: 0, progress: [], positions: [],
      stop() { this.stops++; }, seek(value) { this.progress.push(value); },
      setPosition(...values) { this.positions.push(values); } };
    calls.push({ id, settings, handle }); return handle;
  } });
  return { effects, calls };
}
const shieldSnapshot = (changes = {}) => ({ round: 1, stageId: 'lake-america', phase: 'fight',
  fighters: [{ id: 'officer_flock', side: 0, state: 'attack', move: 'bodyCheck', moveFrame: 7,
    moveData: { startup: 8, active: 4, recovery: 16 }, x: -2, y: 0, facing: 1, ...changes }] });

test('combat accents belong only to supported signature contacts and leave weapons and cinematics alone', () => {
  const { effects, calls } = combatFixture();
  const contact = { type: 'hit', move: 'burstStrike', attackerId: 'trump', x: 2, y: 1.2 };
  for (const event of [
    { ...contact, move: 'lightPunch' }, { ...contact, move: 'heavyPunch' },
    { ...contact, weapon: 'laser' }, { ...contact, weapon: 'knife' },
    { ...contact, finisherId: 'cinematic' }, { ...contact, type: 'finisher' },
    { ...contact, attackerId: 'officer_flock' },
  ]) assert.equal(effects.onHit(event), null);
  assert.equal(calls.length, 0);
  effects.onHit(contact); assert.equal(calls.at(-1).id, 'fireball');
  assert.equal(calls.at(-1).settings.fadeIn, 0); assert.equal(calls.at(-1).settings.x, 2);
  effects.onHit({ ...contact, attackerId: 'carney' }); assert.equal(calls.at(-1).id, 'burst');
  assert.equal(calls.at(-1).settings.color, '#9ceaff');
  effects.onHit({ ...contact, move: 'groundBreaker', attackerId: 'carney' });
  assert.deepEqual(calls.at(-1).settings.rotation, [0, 0, 0]); assert.equal(calls.at(-1).settings.y, 0.06);
  effects.sync(shieldSnapshot({ state: 'idle', id: 'carney' }));
  effects.onHit({ ...contact, attacker: 0, attackerId: undefined });
  assert.equal(calls.at(-1).id, 'burst', 'snapshot identity fallback preserves the correct fighter palette');
  assert.equal(effects.onSummon(null), null);
  effects.onSummon({ muzzleX: -1.7, muzzleY: 2.45 });
  assert.equal(calls.at(-1).id, 'appearance'); assert.equal(calls.at(-1).settings.x, -1.7);
  assert.equal(calls.at(-1).settings.y, 2.45);
});

test('combat shields follow authoritative frames and placement, freeze with snapshots, and retire at phase changes', () => {
  const { effects, calls } = combatFixture(), snapshot = shieldSnapshot();
  effects.sync(snapshot); assert.equal(calls.length, 1); assert.equal(calls[0].settings.manual, true);
  const shield = calls[0].handle;
  effects.sync(snapshot);
  assert.equal(calls.length, 1, 'same attack retains its pooled handle');
  assert.deepEqual(shield.progress, [4 / 14, 4 / 14]);
  assert.deepEqual(shield.positions, [[-1.38, 1.12, 0.25], [-1.38, 1.12, 0.25]]);
  effects.sync(shieldSnapshot({ x: -1, y: 0.3, moveFrame: 9 }));
  near(shield.progress.at(-1), 6 / 14, 'simulation progress');
  for (const [axis, expected] of [-0.38, 1.42, 0.25].entries()) near(shield.positions.at(-1)[axis], expected, `shield axis ${axis}`);
  effects.sync({ ...snapshot, phase: 'finisher' }); assert.equal(shield.stops, 1); assert.equal(effects.shields.size, 0);
  effects.sync(snapshot); assert.equal(calls.length, 2);
  effects.sync({ ...snapshot, round: 2, fighters: [] }); assert.equal(calls[1].handle.stops, 1);
  effects.sync(snapshot); effects.sync(null); assert.equal(calls[2].handle.stops, 1);
  assert.equal(effects.shields.size, 0); assert.equal(effects.fighters.length, 0);
});

test('shield cues reject unrelated fighters and moves, and end before the recovery finishes', () => {
  const { effects, calls } = combatFixture();
  for (const changes of [{ id: 'trump' }, { state: 'idle' }, { move: 'heavyPunch' },
    { moveData: null }, { moveFrame: 2 }, { moveFrame: 17 }]) effects.sync(shieldSnapshot(changes));
  assert.equal(calls.length, 0);
  effects.sync(shieldSnapshot({ move: 'hammerRush', facing: -1, moveFrame: 3 }));
  assert.equal(calls.length, 1); assert.equal(calls[0].settings.rotation[1], -0.45);
  assert.deepEqual(calls[0].handle.positions[0], [-2.62, 1.12, 0.25]);
  effects.sync(shieldSnapshot({ moveFrame: 17 })); assert.equal(calls[0].handle.stops, 1);
});

test('the shipped VFX pack matches its manifest, embeds dependencies and fits a small gameplay budget', async () => {
  const manifest = JSON.parse(await readFile(new URL('../game/public/vfx/manifest.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.assets.map(item => item.id).sort(), Object.keys(VFX_PRESETS).sort());
  let totalBytes = 0, totalTriangles = 0;
  for (const entry of manifest.assets) {
    assert.equal(VFX_PRESETS[entry.id].asset, entry.url);
    const bytes = await readFile(new URL(`../game/public/${entry.url}`, import.meta.url));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${entry.id}: GLB magic`);
    assert.equal(bytes.readUInt32LE(4), 2); assert.equal(bytes.readUInt32LE(8), bytes.length);
    assert.equal(bytes.length, entry.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
    for (const resource of [...(json.buffers || []), ...(json.images || [])]) assert.ok(!resource.uri, `${entry.id}: external resource`);
    let triangles = 0;
    for (const mesh of json.meshes || []) for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4, `${entry.id}: expected triangles`);
      triangles += (json.accessors[primitive.indices ?? primitive.attributes.POSITION].count / 3);
    }
    assert.equal(triangles, entry.geometry.triangles);
    assert.ok(bytes.length <= 2 * 1024 * 1024, `${entry.id}: asset exceeds 2 MiB`);
    assert.ok(triangles < 10000, `${entry.id}: oversized combat mesh`);
    for (const key of ['title', 'author', 'license', 'source']) assert.ok(entry.attribution[key], `${entry.id}: attribution ${key}`);
    totalBytes += bytes.length; totalTriangles += triangles;
  }
  assert.equal(totalBytes, manifest.totalBytes); assert.ok(totalBytes < 4 * 1024 * 1024);
  assert.ok(totalTriangles < 10000, 'large lightning and A-bomb meshes must stay out of the combat pack');
});
