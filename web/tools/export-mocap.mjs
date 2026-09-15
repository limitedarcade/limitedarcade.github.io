// Offline BVH -> character-space, animation-only GLB. Original character GLBs
// and mocap files are inputs only. No machine learning or runtime retargeting.
import * as T from 'three';
import { BVHLoader } from 'three/examples/jsm/loaders/BVHLoader.js';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readScene } from './convert-scene.mjs';

export const BONE_MAP = {
  hips: 'Hips', spine: 'Spine2', chest: 'Chest', neck: 'Neck2', head: 'Head',
  shoulderL: 'LeftShoulder', upperArmL: 'LeftArm', forearmL: 'LeftForeArm', handL: 'LeftHand',
  shoulderR: 'RightShoulder', upperArmR: 'RightArm', forearmR: 'RightForeArm', handR: 'RightHand',
  upLegL: 'LeftLeg', legL: 'LeftShin', footL: 'LeftFoot', toeL: 'LeftToeBase',
  upLegR: 'RightLeg', legR: 'RightShin', footR: 'RightFoot', toeR: 'RightToeBase',
};
const vec = () => new T.Vector3(), quat = () => new T.Quaternion();
const wp = b => b.getWorldPosition(vec()), wq = b => b.getWorldQuaternion(quat());
const smooth = t => { t = T.MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const rootPath = fileURLToPath(new URL('../', import.meta.url));
const path = s => resolve(rootPath, s);
const hash = b => createHash('sha256').update(b).digest('hex');

// Trim windows refer to source seconds. Runtime timing is independently mapped
// through contact/release markers; these do not change game frame data.
export const GAME_CLIPS = [
  { source: 'jab_right', name: 'lightPunch', label: 'Piston jab', start: .05, end: .94, duration: .52, contact: .43, release: .54 },
  { source: 'cross_right', name: 'heavyPunch', label: 'Power cross', start: .28, end: 1.5, duration: .74, contact: .73, release: .83 },
  { source: 'front_kick', name: 'lightKick', label: 'Front kick', start: .58, end: 2.03, duration: .78, contact: 1.18, release: 1.30 },
  { source: 'roundhouse_kick_right', name: 'heavyKick', label: 'Full-body roundhouse', start: 1.04, end: 3.13, duration: 1.02, contact: 1.99, release: 2.16 },
  { source: 'uppercut_right', name: 'uppercut', label: 'Rising uppercut', start: .52, end: 1.65, duration: .83, contact: .97, release: 1.07 },
  // The supplied sweep_kick is waist-high, so keep the game's authored sweep.
  { source: 'knee_strike', name: 'risingKnee', label: 'Driving knee', start: .43, end: 1.9, duration: .88, contact: .97, release: 1.16 },
];

// Solve leg position with the captured knee plane. Matching world rotations
// alone lets shorter legs skate: the ankle goals instead follow scaled source
// foot paths, with planted source feet staying planted on the target character.
export function solveLeg(hip, knee, ankle, goal) {
  const h = wp(hip), k = wp(knee), a = wp(ankle);
  const l1 = h.distanceTo(k), l2 = k.distanceTo(a);
  const direction = goal.clone().sub(h), requested = direction.length();
  const d = T.MathUtils.clamp(requested, Math.abs(l1 - l2) + 1e-5, l1 + l2 - 1e-5);
  direction.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const bend = k.clone().sub(h).addScaledVector(direction, -k.clone().sub(h).dot(direction));
  if (bend.lengthSq() < 1e-10) bend.set(0, 0, 1).addScaledVector(direction, -direction.z);
  bend.normalize();
  const desiredKnee = h.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1*l1 - along*along)));
  const aim = (bone, child, point) => {
    const pivot = wp(bone);
    const correction = quat().setFromUnitVectors(wp(child).sub(pivot).normalize(), point.clone().sub(pivot).normalize());
    bone.quaternion.copy(wq(bone.parent).invert().multiply(correction).multiply(wq(bone)));
    bone.updateMatrixWorld(true);
  };
  aim(hip, knee, desiredKnee);
  aim(knee, ankle, h.clone().addScaledVector(direction, d));
  return Math.max(0, requested - (l1 + l2));
}

export function retarget(scene, source, name) {
  const target = Object.fromEntries(Object.keys(BONE_MAP).map(n => [n, scene.getObjectByName(n)]));
  if (Object.values(target).some(b => !b)) throw Error('Unsupported target skeleton');
  const sourceBones = Object.fromEntries(source.skeleton.bones.map(b => [b.name, b]));
  const sroot = source.skeleton.bones[0];
  sroot.updateMatrixWorld(true); scene.updateMatrixWorld(true);
  const bind = Object.fromEntries(Object.entries(target).map(([n,b]) => [n, {q:b.quaternion.clone(), p:b.position.clone()}]));
  const pairs = Object.entries(BONE_MAP).map(([n,s]) => {
    const bone = target[n], from = sourceBones[s];
    if (!from) throw Error(`Missing source bone ${s}`);
    const correction = quat();
    if (/^(upperArm|forearm|upLeg|leg)[LR]$/.test(n)) {
      correction.setFromUnitVectors(wp(bone.children.find(b=>b.isBone)).sub(wp(bone)).normalize(),
        wp(from.children.find(b=>b.isBone)).sub(wp(from)).normalize());
    }
    return {n, bone, from, offset: wq(from).invert().multiply(correction).multiply(wq(bone))};
  });
  const sourceLeg = wp(sourceBones.LeftLeg).distanceTo(wp(sourceBones.LeftShin)) + wp(sourceBones.LeftShin).distanceTo(wp(sourceBones.LeftFoot));
  const targetLeg = wp(target.upLegL).distanceTo(wp(target.legL)) + wp(target.legL).distanceTo(wp(target.footL));
  const ratio = targetLeg / sourceLeg;
  const feetRest = {L:wp(target.footL), R:wp(target.footR)};
  const sourceRestFeet = {L:wp(sourceBones.LeftFoot), R:wp(sourceBones.RightFoot)};
  const sourceRestFloor = Math.min(wp(sourceBones.LeftToeEnd).y, wp(sourceBones.RightToeEnd).y);
  const hipRest = wp(target.hips), parentInverse = target.hips.parent.matrixWorld.clone().invert();
  const mx = new T.AnimationMixer(sroot), action = mx.clipAction(source.clip); action.play();
  const frames = Math.round(source.clip.duration*30)+1;
  const times = [], values = pairs.map(()=>[]), positions = [], metrics = [];
  let initialHip, floor = Infinity, maxReachError = 0;
  // Ankle-to-floor offsets are character proportions, not the source's units.
  for (let f=0; f<frames; f++) {
    action.time=source.clip.duration*f/(frames-1); mx.update(0); sroot.updateMatrixWorld(true);
    floor=Math.min(floor, wp(sourceBones.LeftToeEnd).y, wp(sourceBones.RightToeEnd).y);
  }
  for (let f=0; f<frames; f++) {
    const t=source.clip.duration*f/(frames-1); times.push(t);
    action.time=t; mx.update(0); sroot.updateMatrixWorld(true);
    const sourceHip=wp(sourceBones.Hips);
    if(!initialHip) initialHip=sourceHip.clone();
    const hipDelta=sourceHip.clone().sub(initialHip);
    hipDelta.y=sourceHip.y-(floor-sourceRestFloor);
    target.hips.position.copy(hipRest.clone().add(hipDelta.multiplyScalar(ratio)).applyMatrix4(parentInverse));
    for(const p of pairs) {
      p.bone.quaternion.copy(wq(p.bone.parent).invert().multiply(wq(p.from)).multiply(p.offset));
      p.bone.updateMatrixWorld(true);
    }
    // Feet maintain their captured world orientation when the leg IK bends.
    for(const side of ['L','R']) {
      const prefix=side==='L'?'Left':'Right', foot=target[`foot${side}`];
      const orientation=wq(foot), sf=wp(sourceBones[`${prefix}Foot`]);
      const goal=vec().set(hipRest.x+(sf.x-initialHip.x)*ratio,
        feetRest[side].y+(sf.y-(floor+sourceRestFeet[side].y-sourceRestFloor))*ratio,
        hipRest.z+(sf.z-initialHip.z)*ratio);
      // Source hip/foot proportions can leave a near-straight leg unreachable.
      // Report that residual rather than stretching the character's bones.
      maxReachError=Math.max(maxReachError,solveLeg(target[`upLeg${side}`],target[`leg${side}`],foot,goal));
      foot.quaternion.copy(wq(foot.parent).invert().multiply(orientation)); foot.updateMatrixWorld(true);
    }
    positions.push(...target.hips.position.toArray());
    for(let i=0;i<pairs.length;i++) {
      const q=pairs[i].bone.quaternion;
      const prev=values[i].slice(-4);
      if(prev.length && q.toArray().reduce((s,v,j)=>s+v*prev[j],0)<0) q.set(-q.x,-q.y,-q.z,-q.w);
      values[i].push(...q.toArray());
    }
    metrics.push({t, rightHand:wp(sourceBones.RightHand).sub(sourceHip).toArray(), leftHand:wp(sourceBones.LeftHand).sub(sourceHip).toArray(),
      rightFoot:wp(sourceBones.RightFoot).toArray(),leftFoot:wp(sourceBones.LeftFoot).toArray()});
  }
  mx.stopAllAction();mx.uncacheRoot(sroot);
  for(const [n,b] of Object.entries(target)){b.quaternion.copy(bind[n].q);b.position.copy(bind[n].p);} scene.updateMatrixWorld(true);
  const clip=new T.AnimationClip(`mocap_${name}`, source.clip.duration,[
    ...pairs.map((p,i)=>new T.QuaternionKeyframeTrack(`${p.n}.quaternion`,times,values[i])),
    new T.VectorKeyframeTrack('hips.position',times,positions),
  ]);
  clip.userData={label:name.replaceAll('_',' '),source:`Motifect / ${name}.bvh`,retargeted:true,sourceDuration:source.clip.duration};
  return {clip,metrics,ratio,maxReachError};
}

export function cutClip(raw, spec, guard) {
  const count=Math.ceil(spec.duration*60)+1;
  const times=Array.from({length:count},(_,i)=>i*spec.duration/(count-1));
  const tracks=raw.tracks.map(track=>{
    const interpolant=track.createInterpolant(), stance=guard.tracks.find(t=>t.name===track.name)?.createInterpolant().evaluate(0);
    const values=[];
    for(const t of times){
      const sourceTime=T.MathUtils.lerp(spec.start,spec.end,t/spec.duration);
      const v=Array.from(interpolant.evaluate(sourceTime));
      // Short authored settle into/out of the game's stance; source action is
      // untouched through the impact. Hip offsets settle with the same envelope.
      const weight=smooth(t/.07)*smooth((spec.duration-t)/.12);
      if(stance) {
        if(v.length===4) values.push(...quat().fromArray(stance).slerp(quat().fromArray(v),weight).toArray());
        else values.push(...v.map((x,i)=>T.MathUtils.lerp(stance[i],x,weight)));
      } else values.push(...v);
    }
    return new track.constructor(track.name,times,values);
  });
  const clip=new T.AnimationClip(spec.name,spec.duration,tracks);
  clip.userData={...raw.userData,label:spec.label,sourceRange:[spec.start,spec.end],
    contactMarkers:[spec.contact,spec.release].map(t=>(t-spec.start)/(spec.end-spec.start)*spec.duration)};
  return clip;
}

// The capture performer and caricatures have different leg/body proportions.
// Fit the two kick contact heights to their existing attack bands, offline.
// Keep the captured hip, torso, support leg, ankle orientation and knee plane.
export function fitKickHeight(scene, clip, spec, id) {
  if(!['lightKick','heavyKick'].includes(spec.name))return clip;
  const side=spec.name==='heavyKick'?'L':'R';
  const hip=scene.getObjectByName(`upLeg${side}`),knee=scene.getObjectByName(`leg${side}`),ankle=scene.getObjectByName(`foot${side}`);
  const bounds=new T.Box3().setFromObject(scene), scale=1.92/bounds.getSize(vec()).y;
  const height=spec.name==='lightKick'?.87:id==='carney'?1.48:1.23;
  const [contact,release]=clip.userData.contactMarkers, mx=new T.AnimationMixer(scene), action=mx.clipAction(clip);action.play();
  const times=clip.tracks[0].times, values=[[],[],[]], affected=[hip,knee,ankle];
  for(const time of times){
    action.time=Math.min(time,clip.duration-1e-6);mx.update(0);scene.updateMatrixWorld(true);
    const goal=wp(ankle),rotation=wq(ankle);
    const weight=smooth(time/contact)*smooth((clip.duration-time)/(clip.duration-release));
    goal.y=T.MathUtils.lerp(goal.y,bounds.min.y+height/scale,weight);
    solveLeg(hip,knee,ankle,goal);
    ankle.quaternion.copy(wq(ankle.parent).invert().multiply(rotation));ankle.updateMatrixWorld(true);
    affected.forEach((bone,i)=>values[i].push(...bone.quaternion.toArray()));
  }
  mx.stopAllAction();mx.uncacheRoot(scene);scene.updateMatrixWorld(true);
  for(let i=0;i<affected.length;i++){
    const name=`${affected[i].name}.quaternion`,index=clip.tracks.findIndex(t=>t.name===name);
    clip.tracks[index]=new T.QuaternionKeyframeTrack(name,times,values[i]);
  }
  clip.userData.contactHeightTarget=height;
  return clip;
}

// A small standards-compliant glTF writer keeps motion separate from meshes.
// Names are the binding contract; the game attaches the clips to its GLB rig.
export function encodeMotionGLB(scene, clips) {
  const bones=[];scene.traverse(n=>{if(n.isBone)bones.push(n)});
  const indices=new Map(bones.map((b,i)=>[b,i]));
  const nodes=bones.map(b=>({name:b.name,translation:b.position.toArray(),rotation:b.quaternion.toArray(),scale:b.scale.toArray(),
    ...(b.children.some(c=>indices.has(c))?{children:b.children.filter(c=>indices.has(c)).map(c=>indices.get(c))}:{})}));
  const json={asset:{version:'2.0',generator:'Battle for Independence / offline mocap retargeter'},scene:0,
    scenes:[{nodes:bones.filter(b=>!indices.has(b.parent)).map(b=>indices.get(b))}],nodes,animations:[],accessors:[],bufferViews:[],buffers:[]};
  const chunks=[];let offset=0;
  const accessor=(array,type)=>{
    const floats=Float32Array.from(array), chunk=Buffer.from(floats.buffer);
    const view=json.bufferViews.push({buffer:0,byteOffset:offset,byteLength:chunk.length})-1;chunks.push(chunk);offset+=chunk.length;
    const components={SCALAR:1,VEC3:3,VEC4:4}[type];
    return json.accessors.push({bufferView:view,componentType:5126,count:array.length/components,type,
      ...(type==='SCALAR'?{min:[array[0]],max:[array.at(-1)]}:{})})-1;
  };
  for(const clip of clips){
    const animation={name:clip.name,extras:clip.userData||{},samplers:[],channels:[]};
    for(const track of clip.tracks){
      const [name,property]=track.name.split('.'), node=nodes.findIndex(n=>n.name===name);
      if(node<0)throw Error(`Missing GLB target ${name}`);
      const sampler=animation.samplers.push({input:accessor(track.times,'SCALAR'),output:accessor(track.values,property==='quaternion'?'VEC4':'VEC3'),interpolation:'LINEAR'})-1;
      animation.channels.push({sampler,target:{node,path:property==='quaternion'?'rotation':'translation'}});
    }
    json.animations.push(animation);
  }
  json.buffers=[{byteLength:offset}];
  const raw=Buffer.from(JSON.stringify(json)), jsonSize=(raw.length+3)&~3, bin=Buffer.concat(chunks);
  const output=Buffer.alloc(12+8+jsonSize+8+bin.length);
  output.writeUInt32LE(0x46546c67,0);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);
  output.writeUInt32LE(jsonSize,12);output.writeUInt32LE(0x4e4f534a,16);output.fill(0x20,20,20+jsonSize);raw.copy(output,20);
  output.writeUInt32LE(bin.length,20+jsonSize);output.writeUInt32LE(0x004e4942,24+jsonSize);bin.copy(output,28+jsonSize);
  return output;
}

export async function buildMocap(){
  const report={source:'Motifect Combat Motion Pack',license:'See web/mocap/README.txt',targets:[],sources:[]};
  const files=readdirSync(path('mocap/BVH')).filter(n=>n.endsWith('.bvh')).sort();
  for(const id of ['carney','trump']){
    const input=path(`game/public/fighters/${id}/${id==='carney'?'carney-hero':'trump-rigged'}.glb`), fingerprint=hash(readFileSync(input));
    const gltf=await readScene(input), clips=[], details=[];
    for(const file of files){
      const data=readFileSync(path(`mocap/BVH/${file}`));
      const result=retarget(gltf.scene,new BVHLoader().parse(data.toString()),file.slice(0,-4));
      clips.push(result.clip);
      details.push({file,duration:result.clip.duration,scale:result.ratio,maxAnkleReachResidual:result.maxReachError});
      if(id==='carney')report.sources.push({file,sha256:hash(data),frames:result.metrics.length});
    }
    const guard=gltf.animations.find(c=>c.name==='guard');
    for(const spec of GAME_CLIPS)clips.push(fitKickHeight(gltf.scene,cutClip(clips.find(c=>c.name===`mocap_${spec.source}`),spec,guard),spec,id));
    for(const clip of clips)if(!clip.validate())throw Error(`Invalid ${id}/${clip.name}`);
    const gameClips=clips.filter(c=>!c.name.startsWith('mocap_')), library=clips.filter(c=>c.name.startsWith('mocap_'));
    const output=path(`game/public/fighters/${id}/mocap.glb`), bytes=encodeMotionGLB(gltf.scene,gameClips);writeFileSync(output,bytes);
    const libraryBytes=encodeMotionGLB(gltf.scene,library);writeFileSync(path(`game/public/fighters/${id}/mocap-library.glb`),libraryBytes);
    if(hash(readFileSync(input))!==fingerprint)throw Error('Input asset was modified');
    report.targets.push({id,inputSHA256:fingerprint,output:`fighters/${id}/mocap.glb`,bytes:bytes.length,clips:gameClips.length,
      library:`fighters/${id}/mocap-library.glb`,libraryBytes:libraryBytes.length,libraryClips:library.length,details,
      gameClips:clips.filter(c=>!c.name.startsWith('mocap_')).map(c=>({name:c.name,...c.userData}))});
    console.log(`${id}: ${gameClips.length} game clips / ${(bytes.length/1024).toFixed(0)} KiB GLB; ${library.length} review takes / ${(libraryBytes.length/1024/1024).toFixed(2)} MiB. Original SHA-256 unchanged.`);
  }
  mkdirSync(path('reference'),{recursive:true});writeFileSync(path('reference/mocap-build.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await buildMocap();
