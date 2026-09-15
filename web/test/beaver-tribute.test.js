import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../game/src/vendor/three.module.js';
import { TRIBUTE, tributeTime, tributePose } from '../game/src/engine/beaverTribute.js';
import { BeaverTribute, tributeCamera } from '../game/src/render/beaverTribute.js';
import { FINISHER_SCRIPTS, fatalityOf } from '../game/src/engine/fatalities.js';
import { Match } from '../game/src/engine/match.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';
import { Dismemberment } from '../game/src/render/dismemberment.js';

test('both cold-cut variants reserve time for placement and a hero hold after the lethal impact', () => {
  for (const id of ['cold-cut', 'cold-cut-flock']) {
    const script = FINISHER_SCRIPTS[id];
    assert.equal(script.duration - script.impactFrame, TRIBUTE.end);
    assert.ok(TRIBUTE.hero > TRIBUTE.release && TRIBUTE.end - TRIBUTE.hero >= 60);
  }
  assert.equal(tributeTime({ id: 'carney-whiteout' }, 400), null);
});

test('head stays under scripted ownership through pickup, placement, match end and reset on either side', () => {
  for (const facing of [-1, 1]) {
    const director = new BeaverTribute(new THREE.Scene());
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(.2, .3, .2));
    const piece = { mesh, scripted: false }, cut = { pieces: [piece], x: .58 * facing, y: 1.5, z: 0 };
    director.capture(cut);
    const snapshot = { phase: 'finisher', finisher: { id: 'carney-cold-cut', script: 'cold-cut-flock', facing, originX: 0, attacker: 0 } };
    let previous;
    for (let t = 0; t <= TRIBUTE.end; t++) {
      const state = director.update(snapshot, [], 391 + t);
      assert.equal(piece.scripted, true);
      assert.ok(state.head.every(Number.isFinite));
      if (previous) assert.ok(new THREE.Vector3(...state.head).distanceTo(previous) < .13, `head jumps at ${t}`);
      previous = new THREE.Vector3(...state.head);
    }
    mesh.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(mesh);
    assert.ok(Math.abs(bounds.min.y - tributePose(TRIBUTE.end).signTop) < 1e-6);
    assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x - tributePose(TRIBUTE.end).signX * facing) < 1e-6);
    const position = mesh.position.clone();
    director.update({ ...snapshot, phase: 'matchEnd' }, [], 10000);
    assert.deepEqual(mesh.position, position);
    director.reset(); assert.equal(piece.scripted, false); assert.equal(director.cut, null); assert.equal(director.root.visible, false);
  }
});

test('tribute camera mirrors and keeps the sign in the final frame at desktop and phone aspect ratios', () => {
  for (const aspect of [16/9, .46]) for (const facing of [-1,1]) {
    const camera = new THREE.PerspectiveCamera(38, aspect, .01, 100);
    const shot = tributeCamera(TRIBUTE.hero, 0, facing, { portrait: aspect < 1, aspect });
    camera.position.fromArray(shot.position); camera.lookAt(new THREE.Vector3(...shot.target)); camera.updateMatrixWorld(true);
    for (const x of [.275, 1.825]) for (const y of [.6, 1.65]) {
      const projected = new THREE.Vector3(x * facing, y, .72).project(camera);
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1);
    }
  }
});

test('runtime beaver has three skeletal clips, one shared mesh and a bounded asset size', () => {
  const bytes = readFileSync(new URL('../game/public/props/beaver/beaver.glb', import.meta.url));
  const gltf = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)));
  assert.ok(bytes.length < 2_000_000);
  assert.equal(gltf.meshes.length, 1); assert.equal(gltf.skins.length, 1);
  assert.deepEqual(gltf.animations.map(a => a.name).sort(), ['beaverCarry','beaverIdle','beaverWalk']);
  assert.ok(gltf.nodes.every(node => !/lake-america|Fighting shelf/.test(node.name)));
});

test('Trump’s complete authored head detaches, including face vertices weighted to the chest', async () => {
  const factory = await import('../game/src/fighters/trump/createFighterModel.js');
  await factory.prewarm(); const built = factory.createFighter();
  const damage = new FighterDamage(built.group), collected = [];
  const debris = { addSurfaceLimb(chunk) { collected.push(chunk); return null; } };
  const gore = new Dismemberment({ damage, model: built.group, debris });
  const cut = gore.sever('head', { cinematic: true });
  assert.ok(cut);
  const head = built.group.getObjectByName('Head');
  const vertices = collected.filter(chunk => chunk.record.mesh === head).reduce((count,chunk)=>count+chunk.positions.length/4,0);
  assert.equal(vertices,head.geometry.attributes.position.count);
  assert.ok([...head.geometry.attributes.severMask.array].every(mask => mask === 1));
  damage.resetRound(); gore.resetRound(); damage.dispose(); built.dispose();
});

test('match does not end during the beaver handoff', () => {
  const match = new Match({ left: { id: 'carney' }, right: { id: 'trump' } });
  match.startFinisher(fatalityOf('carney-cold-cut'), 0);
  for (let i = 0; i < 391 + TRIBUTE.release; i++) match.step([{},{}]);
  assert.equal(match.phase, 'finisher');
  while (match.phase === 'finisher') match.step([{},{}]);
  assert.equal(match.phase, 'matchEnd');
});

test('placement lifts the head clear of the wooden board before crossing onto the post', () => {
  const director = new BeaverTribute(new THREE.Scene());
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(.26,.38,.26));
  director.capture({ pieces:[{mesh}], x:.58,y:1.5,z:0 });
  const snapshot = {phase:'finisher',finisher:{id:'carney-cold-cut',script:'cold-cut-flock',facing:1,originX:0,attacker:0}};
  for(let t=TRIBUTE.take;t<=TRIBUTE.release;t++) {
    director.update(snapshot,[],391+t); mesh.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(mesh), pose=tributePose(t);
    if(bounds.max.x > pose.signX-.775 && bounds.max.z > pose.signZ-.075 && bounds.min.z < pose.signZ+.075)
      assert.ok(bounds.min.y >= pose.signTop-1e-6, `head crosses the board at ${t}`);
  }
  director.reset();mesh.geometry.dispose();mesh.material.dispose();
});
