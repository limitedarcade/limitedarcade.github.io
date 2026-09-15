import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as T from 'three';
import { readScene } from '../tools/convert-scene.mjs';
import { GAME_CLIPS, solveLeg } from '../tools/export-mocap.mjs';
import { attackClipTime } from '../game/src/render/clipTiming.js';
import { MOVES } from '../game/src/engine/frameData.js';

const path=s=>fileURLToPath(new URL(`../${s}`,import.meta.url));
function metadata(bytes){return JSON.parse(bytes.toString('utf8',20,20+bytes.readUInt32LE(12)));}
for(const id of ['carney','trump']) {
  test(`${id}: animation-only GLB binds every clip to the real fighter without meshes or textures`,async()=>{
    const bytes=readFileSync(path(`game/public/fighters/${id}/mocap.glb`)),json=metadata(bytes);
    assert.equal(bytes.readUInt32LE(8),bytes.length);
    assert.equal(json.meshes,undefined);assert.equal(json.images,undefined);assert.equal(json.textures,undefined);
    const gltf=await readScene(path(`game/public/fighters/${id}/${id==='carney'?'carney-hero':'trump-rigged'}.glb`));
    const pack=await readScene(path(`game/public/fighters/${id}/mocap.glb`));
    assert.equal(pack.animations.length,GAME_CLIPS.length);
    assert.ok(bytes.length<350000,'Gameplay should not download the full capture library');
    const library=await readScene(path(`game/public/fighters/${id}/mocap-library.glb`));
    assert.equal(library.animations.length,40);
    pack.animations.push(...library.animations);
    assert.equal(pack.animations.length,40+GAME_CLIPS.length);
    const names=new Set(pack.animations.map(c=>c.name));assert.equal(names.size,pack.animations.length);
    for(const c of pack.animations){
      assert.ok(c.validate(),c.name);
      for(const track of c.tracks){
        assert.ok(gltf.scene.getObjectByName(track.name.split('.')[0]),track.name);
        assert.ok(Array.from(track.values).every(Number.isFinite),`${c.name}/${track.name}`);
        for(let i=1;i<track.times.length;i++)assert.ok(track.times[i]>track.times[i-1]);
        if(track.name.endsWith('.quaternion'))for(let i=0;i<track.values.length;i+=4){
          const length=Math.hypot(...track.values.subarray(i,i+4));assert.ok(Math.abs(length-1)<1e-4,`${c.name} quaternion ${length}`);
        }
      }
    }
    // No generic pack motion may silently replace low attacks, weapon specials,
    // movement, the authored cinematic, or synchronized throw/victim poses.
    for(const name of ['crouchKick','meteorKick','spinKick','walkF','sprint','confidenceSlash','throw','knockdown'])assert.ok(!names.has(name),name);
    const restBounds=new T.Box3().setFromObject(gltf.scene), modelScale=1.92/restBounds.getSize(new T.Vector3()).y;
    const mixer=new T.AnimationMixer(gltf.scene);
    for(const spec of GAME_CLIPS){
      const c=pack.animations.find(c=>c.name===spec.name), extras=json.animations.find(a=>a.name===spec.name).extras;
      const move=MOVES[spec.name];assert.ok(move,spec.name);
      const [contact,release]=extras.contactMarkers;
      assert.ok(contact>0&&release>contact&&release<c.duration);
      assert.ok(Math.abs(attackClipTime(move.startup,move,c.duration,[contact,release])-contact)<1e-8);
      mixer.stopAllAction();mixer.clipAction(c).play();mixer.setTime(contact);gltf.scene.updateMatrixWorld(true);
      const origin=gltf.scene.getObjectByName('hips').getWorldPosition(new T.Vector3());
      const limbs=['handL','handR','footL','footR','legL','legR'].map(n=>gltf.scene.getObjectByName(n).getWorldPosition(new T.Vector3()).sub(origin));
      const legLength=gltf.scene.getObjectByName('legR').position.length()+gltf.scene.getObjectByName('footR').position.length();
      assert.ok(Math.max(...limbs.map(p=>p.z))>legLength*.4,`${spec.name} must strike forward relative to this fighter's proportions`);
      if(extras.contactHeightTarget){
        const ankle=gltf.scene.getObjectByName(spec.name==='heavyKick'?'footL':'footR').getWorldPosition(new T.Vector3());
        const contactHeight=(ankle.y-restBounds.min.y)*modelScale;
        assert.ok(Math.abs(contactHeight-extras.contactHeightTarget)<.04,`${id}/${spec.name}: ankle ${contactHeight.toFixed(3)}m misses its existing attack band`);
      }
      // Loading and sampling again after a different clip must be deterministic.
      const head=gltf.scene.getObjectByName('head').getWorldPosition(new T.Vector3());
      mixer.stopAllAction();mixer.clipAction(gltf.animations.find(c=>c.name==='guard')).play();mixer.setTime(.1);
      mixer.stopAllAction();mixer.clipAction(c).play();mixer.setTime(contact);gltf.scene.updateMatrixWorld(true);
      assert.ok(head.distanceTo(gltf.scene.getObjectByName('head').getWorldPosition(new T.Vector3()))<1e-6);
    }
    mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);
  });
}
test('foot fitting reaches an ankle target without stretching either bone',()=>{
  const root=new T.Group(),hip=new T.Bone(),knee=new T.Bone(),foot=new T.Bone();
  root.add(hip);hip.add(knee);knee.add(foot);knee.position.set(0,-.4,.04);foot.position.set(0,-.4,-.04);root.updateMatrixWorld(true);
  const lengths=[knee.position.length(),foot.position.length()],goal=new T.Vector3(.15,-.63,.16);
  solveLeg(hip,knee,foot,goal);
  assert.ok(foot.getWorldPosition(new T.Vector3()).distanceTo(goal)<1e-6);
  assert.deepEqual([knee.position.length(),foot.position.length()],lengths);
});
