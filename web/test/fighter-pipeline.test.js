import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../game/src/vendor/three.module.js';
import { FighterDamage } from '../game/src/render/fighterDamage.js';
import { Dismemberment } from '../game/src/render/dismemberment.js';
import { buildConfidenceClips } from '../game/src/render/confidenceClips.js';
import { FINISHER_SCRIPTS, finisherCinematicAt } from '../game/src/engine/fatalities.js';

function glb(name) {
  const data=readFileSync(new URL(`../game/public/fighters/carney/${name}.glb`,import.meta.url));
  return JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString('utf8'));
}
test('Blender export retains the skin and animation contract with embedded UV textures',()=>{
  const before=glb('carney-rigged'),after=glb('carney-hero');
  assert.deepEqual(after.animations.map(a=>a.name).sort(),before.animations.map(a=>a.name).sort());
  assert.deepEqual(after.skins[0].joints.map(i=>after.nodes[i].name).sort(),before.skins[0].joints.map(i=>before.nodes[i].name).sort());
  assert.equal(after.meshes.length,6);assert.equal(after.images.length,6);
  for(const mesh of after.meshes)for(const p of mesh.primitives){
    for(const attr of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'])assert.ok(attr in p.attributes);
    assert.ok(after.materials[p.material].pbrMetallicRoughness.baseColorTexture);
  }
  assert.ok(after.images.every(image=>Number.isInteger(image.bufferView)&&!image.uri));
});
test('a cinematic head cut removes the real Trump head and resets without damaging its source',async()=>{
  const factory=await import('../game/src/fighters/trump/createFighterModel.js');
  await factory.prewarm();const built=factory.createFighter();
  const damage=new FighterDamage(built.group),gore=new Dismemberment({damage,model:built.group});
  built.group.updateMatrixWorld(true);
  const cut=gore.sever('head');assert.equal(cut.region,'head');
  let owned=0,removed=0;
  for(const {mesh,sever} of damage.meshes){
    const ids=new Set(mesh.skeleton.bones.flatMap((b,i)=>/^(head|neck)$/i.test(b.name)?[i]:[]));
    const g=mesh.geometry;
    for(let i=0;i<g.attributes.position.count;i++){
      let weight=0;
      for(let j=0;j<4;j++)if(ids.has(g.attributes.skinIndex.array[i*4+j]))weight+=g.attributes.skinWeight.array[i*4+j];
      if(weight>=0.5){owned++;if(sever.array[i]===1)removed++;}
    }
  }
  assert.ok(owned>1000);assert.equal(removed,owned);
  damage.resetRound();gore.resetRound();
  assert.ok(damage.meshes.every(r=>r.sever.array.every(v=>v===0)));
  assert.equal(gore.count,0);damage.dispose();built.dispose();
});
test('cinematic clip edits sample finite poses, and the last camera pose holds after the result',()=>{
  const source=new THREE.AnimationClip('heavyPunch',0.74,[new THREE.QuaternionKeyframeTrack('head.quaternion',[0,.26,.74],[0,0,0,1,0,.1,0,.994987,0,0,0,1])]);
  const clips=buildConfidenceClips({heavyPunch:source,victory:source});
  assert.equal(clips.length,3);
  assert.ok(clips.every(c=>c.tracks.every(t=>Array.from(t.values).every(Number.isFinite))));
  const finish={script:'cold-cut'},duration=FINISHER_SCRIPTS['cold-cut'].duration;
  const end=finisherCinematicAt(finish,duration),held=finisherCinematicAt(finish,10000);
  assert.deepEqual(held.attacker,end.attacker);assert.deepEqual(held.camera,end.camera);
});
