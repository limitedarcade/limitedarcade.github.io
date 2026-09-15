import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { STAGES, stageById, stageImpactStrength } from '../game/src/render/stageRegistry.js';
import { buildArena } from '../game/src/render/arenaArchitecture.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';
import { FighterRim } from '../game/src/render/rimLight.js';
import { StageAmbience } from '../game/src/game/stageAmbience.js';
import { Stage } from '../game/src/render/stage.js';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from '../game/src/vendor/GLTFLoader.js';

test('arena registry provides unique IDs, distinct atmospheres and non-damaging reactive dressing', () => {
  assert.equal(STAGES.length, 4);
  assert.equal(new Set(STAGES.map(stage => stage.id)).size, STAGES.length);
  assert.equal(new Set(STAGES.map(stage => stage.palette.sky)).size, STAGES.length);
  assert.equal(stageById('missing').id, 'lake-america');
  for (const stage of STAGES) {
    assert.ok(stage.ambient.wind > 0); assert.ok(stage.ambient.water > 0);
    assert.ok(stage.hazard.description); assert.ok(stage.music);
  }
  assert.equal(stageImpactStrength({ type: 'block', bloodScale: 4 }), 0);
  assert.equal(stageImpactStrength({ bloodScale: 0.5 }), 0);
  assert.ok(stageImpactStrength({ bloodScale: 2 }) > 0);
  assert.equal(stageImpactStrength({ ko: true, bloodScale: 0.1 }), 1);
});

test('alternate arenas provide bounded architecture and keep the fight lane at floor level', () => {
  for (const definition of STAGES.slice(1)) {
    const stage = {
      group: new THREE.Group(), interactives: [], mist: [], fireGlows: [],
      buildDecalSurface() {}, buildAtmosphere() {}, buildDebris() {},
    };
    buildArena(stage, definition);
    assert.ok(stage.group.children.length > 40);
    assert.ok(stage.group.children.length < 220, `${definition.id}: bounded draw objects`);
    assert.equal(stage.ice.position.y, 0);
    assert.equal(stage.ice.rotation.x, -Math.PI / 2);
    assert.ok(stage.interactives.length >= 1);
    assert.ok(stage.interactives.every(prop => prop.home.z < -3));
  }
});

test('surface damage persists, remains bounded, resets and preserves source buffers and rim shaders', () => {
  const model = new THREE.Group();
  const geometry = new THREE.SphereGeometry(0.25, 32, 24);
  const originalPositions = geometry.attributes.position.array.slice();
  const material = new THREE.MeshPhysicalMaterial({ color: 0xbb9988 });
  const rim = new FighterRim(0); rim.attach(material);
  const priorCompile = material.onBeforeCompile;
  const mesh = new THREE.Mesh(geometry, material); mesh.position.y = 1.65; model.add(mesh);
  const damage = new FighterDamage(model);
  assert.equal(mesh.geometry.attributes.position, geometry.attributes.position);
  damage.onHit({ type: 'block', x: 0.2, y: 1.65 }, 3);
  assert.equal(damage.hits, 0);
  damage.onHit({ type: 'hit', level: 'high', x: 0.23, y: 1.65 }, 2);
  const attribute = mesh.geometry.attributes.battleDamage;
  const first = attribute.array.slice();
  assert.ok(first.some(value => value > 0));
  for (let i = 0; i < 30; i++) damage.onHit({ type: 'hit', level: 'high', x: 0.23, y: 1.65 }, 4);
  assert.ok(attribute.array.every(value => value >= 0 && value <= 1));
  assert.ok(attribute.array.every((value, i) => value >= first[i]));
  assert.deepEqual(geometry.attributes.position.array, originalPositions);
  const shader = { vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>\n#include <roughnessmap_fragment>\n#include <emissivemap_fragment>', uniforms: {} };
  material.onBeforeCompile(shader);
  assert.ok(shader.vertexShader.includes('attribute vec4 battleDamage'));
  assert.ok(shader.fragmentShader.includes('uRimColor'));
  assert.ok(shader.fragmentShader.includes('freshBlood'));
  damage.resetRound(); assert.ok(attribute.array.every(value => value === 0));
  damage.dispose(); assert.equal(mesh.geometry, geometry); assert.equal(material.onBeforeCompile, priorCompile);
});

test('shared materials are extended once when a model has several meshes', () => {
  const model = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  for (let i = 0; i < 2; i++) model.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const damage = new FighterDamage(model);
  const shader = { vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>', uniforms: {} };
  material.onBeforeCompile(shader);
  assert.equal(shader.vertexShader.match(/attribute vec4 battleDamage/g).length, 1);
  damage.dispose();
});

test('stage ambience is lazy, owns a bounded loop graph and follows pause and effects bus', () => {
  const param = () => ({ value: 0, target: 0, cancelScheduledValues() {}, setTargetAtTime(value) { this.target = value; } });
  const nodes = [];
  const node = () => {
    const result = { gain: param(), frequency: param(), Q: param(), playbackRate: param(), connected: [],
      connect(target) { this.connected.push(target); return target; }, disconnect() { this.disconnected = true; },
      start() { this.started = true; }, stop() { this.stopped = true; } };
    nodes.push(result); return result;
  };
  const audio = {}, ambience = new StageAmbience(audio);
  ambience.setStage('palm-resort'); assert.equal(ambience.ctx, null);
  audio.ctx = { currentTime: 0, createGain: node, createBufferSource: node, createBiquadFilter: node, createOscillator: node,
    createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData(i) { return data[i]; } }; } };
  audio.effects = node(); ambience.pause(false);
  assert.equal(ambience.output.connected[0], audio.effects);
  assert.equal(ambience.sources.length, 3); assert.equal(ambience.nodes.length, 9);
  assert.equal(ambience.output.gain.target, 0.43);
  const count = nodes.length;
  for (const stage of STAGES) ambience.setStage(stage);
  assert.equal(nodes.length, count);
  ambience.pause(true); assert.equal(ambience.output.gain.target, 0); assert.equal(ambience.depth.gain.target, 0);
  const sources = [...ambience.sources]; ambience.dispose();
  assert.ok(sources.every(source => source.stopped)); assert.equal(ambience.nodes.length, 0);
});

test('switching arenas disposes owned resources and releases a late lake GLB', async () => {
  const priorDocument = globalThis.document;
  const priorTextureLoad = THREE.TextureLoader.prototype.load;
  const priorImageLoad = THREE.ImageLoader.prototype.load;
  const priorGltfLoad = GLTFLoader.prototype.loadAsync;
  const callbacks = [];
  const context = new Proxy({}, { get(target, key) {
    if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => ({ addColorStop() {} });
    return target[key] || (() => {});
  } });
  globalThis.document = { createElement() { return { width: 0, height: 0, getContext() { return context; } }; } };
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  THREE.ImageLoader.prototype.load = (url, callback) => { callbacks.push(callback); };
  GLTFLoader.prototype.loadAsync = () => new Promise(resolve => callbacks.push(resolve));
  try {
    const scene = new THREE.Scene(), fighter = new THREE.Group(); scene.add(fighter);
    const stage = new Stage(scene, { reducedMotion: true });
    const ready = stage.ready;
    let disposed = 0; stage.decalPlane.geometry.addEventListener('dispose', () => disposed++);
    let reflectionDisposed = 0;
    stage.group.getObjectByName('Lake America · reflected shoreline and fighters').getRenderTarget()
      .addEventListener('dispose', () => reflectionDisposed++);
    stage.setStage('capitol');
    assert.equal(disposed, 1); assert.equal(stage.id, 'capitol');
    assert.equal(reflectionDisposed, 1, 'switching stages releases the reflection framebuffer');
    const children = stage.group.children.length;
    const late = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    let lateDisposed = 0; late.geometry.addEventListener('dispose', () => lateDisposed++);
    for (const callback of callbacks) callback({ scene: late });
    await ready;
    assert.equal(lateDisposed, 1);
    assert.equal(stage.group.children.length, children);
    assert.ok(scene.children.includes(fighter));
    const sceneCount = scene.children.length;
    stage.setStage('palm-resort'); stage.setStage('executive-lawn');
    assert.equal(scene.children.length, sceneCount);
    stage.impact({ type: 'hit', x: 0, y: 1.1, bloodScale: 3 }, { type: 'blunt', power: 3 });
    assert.ok(stage.debris.some(shard => shard.life > 0));
    stage.update(0.2);
    assert.ok(stage.interactives.some(prop => prop.strength > 0));
    stage.resetRound(); assert.ok(stage.interactives.every(prop => prop.strength === 0));
    assert.ok(stage.debris.every(shard => !shard.mesh.visible));
    stage.dispose(); assert.deepEqual(scene.children, [fighter]);
  } finally {
    globalThis.document = priorDocument;
    THREE.TextureLoader.prototype.load = priorTextureLoad;
    THREE.ImageLoader.prototype.load = priorImageLoad;
    GLTFLoader.prototype.loadAsync = priorGltfLoad;
  }
});

test('surface damage follows a real animated skinned model in both runtime formats', async () => {
  const factory = await import('../game/src/fighters/carney/createFighterModel.js');
  await factory.prewarm(); const packed = factory.createFighter();
  const data = readFileSync(new URL('../game/public/fighters/carney/carney-rigged.glb', import.meta.url));
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '', resolve, reject));
  for (const [model, clips] of [[packed.group, Object.values(packed.clipMap)], [gltf.scene, gltf.animations]]) {
    const damage = new FighterDamage(model), mixer = new THREE.AnimationMixer(model);
    const action = mixer.clipAction(clips.find(clip => clip.name === 'crouch') || clips[0]);
    action.play(); mixer.update(0.3); model.updateWorldMatrix(true, true);
    const head = model.getObjectByName('head'), contact = head.getWorldPosition(new THREE.Vector3());
    damage.onHit({ type: 'hit', level: 'high', x: contact.x, y: contact.y, z: contact.z }, 2);
    assert.ok(damage.meshes.some(record => record.damage.array.some(value => value > 0)));
    const marks = damage.meshes.map(record => record.damage.array.slice());
    mixer.update(0.2);
    damage.meshes.forEach((record, index) => assert.deepEqual(record.damage.array, marks[index]));
    damage.resetRound(); damage.dispose(); mixer.stopAllAction();
  }
  packed.dispose();
});
