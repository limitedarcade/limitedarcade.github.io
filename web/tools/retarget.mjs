// Retarget the shared clip set from a source rig onto an imported character,
// then refuse to ship the result if it fails the checks below.
//
// This is the whole "already rigged import" route from
// docs/web-fighter-and-stage-workflow.md. It runs headless: three's own
// AnimationMixer plays the source clips, every frame is sampled at `fps`, and
// fresh quaternion tracks are written onto the target skeleton. No DCC app is
// involved, so adding an animation to every retargeted fighter is a matter of
// adding one clip to the source rig and re-running each fighter's builder.
//
// Adding a fighter should be a config object, not a copy of this file. The only
// character-specific facts are the bone map, the fist table, and the paths --
// everything else here is general.

import * as T from 'three';
import { readScene, saveScene } from './convert-scene.mjs';
import { MOVES } from '../game/src/engine/frameData.js';

// Canonical joint key -> bone name in the source rig. Target bones are matched
// by normalised name, so a Mixamo export ('mixamorigLeftHand_73'), a raw
// Mixamo FBX ('mixamorig:LeftHand') and a plain 'LeftHand' all land on the
// same key without a per-character alias list.
export const SOURCE_BONES = Object.freeze({
  Hips: 'hips', Spine: 'spine', Spine2: 'chest', Neck: 'neck', Head: 'head',
  LeftShoulder: 'shoulderL', LeftArm: 'upperArmL', LeftForeArm: 'forearmL', LeftHand: 'handL',
  RightShoulder: 'shoulderR', RightArm: 'upperArmR', RightForeArm: 'forearmR', RightHand: 'handR',
  LeftUpLeg: 'upLegL', LeftLeg: 'legL', LeftFoot: 'footL', RightUpLeg: 'upLegR', RightLeg: 'legR', RightFoot: 'footR',
});

export const normaliseBoneName = name =>
  name.replace(/^mixamorig[:_]?/i, '').replace(/^:/, '').replace(/_\d+$/, '');

// Every clip the combat set needs. Derived from the move table rather than
// listed again here, so a new move cannot be added without its clip.
export const REQUIRED_CLIPS = Object.freeze([...new Set([
  ...Object.values(MOVES).map(move => move.clip),
  'tpose', 'idle', 'guard', 'walkF', 'walkB', 'crouch', 'crouchGuard', 'jump', 'land',
  'hitHigh', 'hitLow', 'blockHit', 'grabbed', 'knockdown', 'getUp', 'dizzy',
  'finisherVictim', 'victory', 'defeat', 'intro',
])]);

const angleBetween = (a, b) => T.MathUtils.radToDeg(2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))));

// Curl one grouped finger chain about each joint's local X.
//
// X is the flexion axis these rigs actually use: the middle and tip joints
// carry pure local-X rotations in bind, and the Z component on a knuckle is its
// authored spread rather than a bend, so rotateX composes with it correctly.
//
// The numbers are small on purpose. A rig that groups four fingers into one
// chain has no gaps for them to nest into, so a real hand's 250-plus degrees
// drives the mitten straight through the palm. Whatever a fighter's table says
// is the single owner of finger pose -- nothing may re-pose these at runtime,
// or the asset you review and the asset the game renders are two different
// poses.
function poseFingers(target, fist) {
  if (!fist) return;
  target.traverse(bone => {
    if (!bone.isBone) return;
    const finger = bone.name.match(/Hand(?:Index|Middle|Ring|Pinky)([123])(?:_|$)/);
    if (finger) bone.rotateX(fist.index[Number(finger[1]) - 1]);
    const thumb = bone.name.match(/HandThumb([123])(?:_|$)/);
    if (thumb) bone.rotateX(fist.thumb[Number(thumb[1]) - 1]);
  });
}

// Per-bone rest correction, so the source rig's motion lands on a differently
// sculpted skeleton without inheriting that sculpt's quirks.
function restCorrections(target, source, boneMap) {
  const pairs = [], aligned = new Map();
  target.traverse(bone => {
    if (!bone.isBone) return;
    const key = normaliseBoneName(bone.name);
    const from = source.getObjectByName(boneMap[key]);
    if (!from) return;
    const targetRest = bone.getWorldQuaternion(new T.Quaternion());
    const sourceRest = from.getWorldQuaternion(new T.Quaternion());
    const align = new T.Quaternion();
    // Imported arms are usually in an A pose. Align their rest directions with
    // the canonical T pose before applying motion, avoiding a permanent droop.
    if (/(?:^|Left|Right)(?:Arm|ForeArm)$/.test(key)) {
      const child = bone.children.find(n => n.isBone), other = from.children.find(n => n.isBone);
      if (child && other) {
        const a = child.getWorldPosition(new T.Vector3()).sub(bone.getWorldPosition(new T.Vector3())).normalize();
        const b = other.getWorldPosition(new T.Vector3()).sub(from.getWorldPosition(new T.Vector3())).normalize();
        align.setFromUnitVectors(a, b);
      }
    }
    // Wrists cannot use that same child-direction match. The source rig has no
    // fingers, so its hand's only child is a tip bone, while an imported hand's
    // first bone child is usually the thumb -- matching them aims the wrist at
    // the thumb.
    //
    // Use the source rig's own definition of a neutral wrist instead: its hand
    // and forearm share one world rest, so the wrist is collinear with the
    // forearm. Inheriting the forearm's correction and cancelling the
    // difference between the two bind orientations puts the wrist exactly
    // there. That is also what drops any grip a character was sculpted holding.
    else if (/Hand$/.test(key)) {
      const forearm = aligned.get(key.replace(/Hand$/, 'ForeArm'));
      if (forearm) align.copy(forearm.align).multiply(forearm.targetRest).multiply(targetRest.clone().invert());
    }
    aligned.set(key, { align: align.clone(), targetRest: targetRest.clone() });
    pairs.push({
      bone, from, key,
      rest: bone.quaternion.clone(),
      position: bone.position.clone(),
      offset: sourceRest.clone().invert().multiply(align).multiply(targetRest),
    });
  });
  return pairs;
}

// Bake every source clip into target-space keyframe tracks.
function bakeClips(target, source, pairs, animations, fps) {
  const mixer = new T.AnimationMixer(source);
  const hip = pairs.find(p => p.key === 'Hips');
  const sourceHipRest = hip.from.getWorldPosition(new T.Vector3());
  const heightRatio = new T.Box3().setFromObject(target).getSize(new T.Vector3()).y
    / new T.Box3().setFromObject(source).getSize(new T.Vector3()).y;
  const hipParentInverse = hip.bone.parent.matrixWorld.clone().invert();
  const origin = new T.Vector3().applyMatrix4(hipParentInverse);
  const clips = [];
  for (const clip of animations) {
    mixer.stopAllAction();
    const action = mixer.clipAction(clip); action.play();
    const times = [], positions = [], values = pairs.map(() => []);
    const frames = Math.max(2, Math.ceil(clip.duration * fps) + 1);
    for (let f = 0; f < frames; f++) {
      const time = clip.duration * f / (frames - 1);
      times.push(time);
      action.time = Math.min(time, Math.max(0, clip.duration - 1e-6));
      mixer.update(0); source.updateMatrixWorld(true);
      const delta = hip.from.getWorldPosition(new T.Vector3()).sub(sourceHipRest).multiplyScalar(heightRatio);
      delta.applyMatrix4(hipParentInverse).sub(origin).add(hip.position);
      positions.push(...delta.toArray());
      for (let i = 0; i < pairs.length; i++) {
        const p = pairs[i];
        const world = p.from.getWorldQuaternion(new T.Quaternion()).multiply(p.offset);
        const parent = p.bone.parent.getWorldQuaternion(new T.Quaternion()).invert();
        p.bone.quaternion.copy(parent.multiply(world));
        p.bone.updateMatrixWorld(true);
        values[i].push(...p.bone.quaternion.toArray());
      }
    }
    clips.push(new T.AnimationClip(clip.name, clip.duration, [
      ...pairs.map((p, i) => new T.QuaternionKeyframeTrack(`${p.bone.name}.quaternion`, times, values[i])),
      new T.VectorKeyframeTrack(`${hip.bone.name}.position`, times, positions),
    ]));
  }
  return clips;
}

// The gate. These are the failures that have actually happened on this project
// and were only caught later from a screenshot, so they throw rather than warn.
export function inspect(target, clips, config) {
  const problems = [], notes = [];
  const expect = config.expect || {};

  const missing = REQUIRED_CLIPS.filter(name => !clips.some(clip => clip.name === name));
  if (missing.length) problems.push(`Missing clips: ${missing.join(', ')}`);
  for (const clip of clips) if (!clip.validate()) problems.push(`Clip ${clip.name} failed validate()`);

  // Wrists collinear with the forearm in the T pose, which is what the source
  // rig calls neutral. A character sculpted gripping something ships with a
  // permanent roll through every clip unless this fails loudly.
  //
  // Measured on the baked clip rather than on the skeleton's bind pose: the
  // correction lives in the tracks, and the bind is deliberately left as the
  // artist sculpted it so the skin weights still mean what they meant.
  const bones = [];
  target.traverse(b => { if (b.isBone) bones.push({ bone: b, quaternion: b.quaternion.clone(), position: b.position.clone() }); });
  const neutral = clips.find(clip => clip.name === 'tpose') || clips[0];
  if (neutral) {
    const mixer = new T.AnimationMixer(target);
    mixer.clipAction(neutral).play();
    mixer.setTime(0);
    target.updateMatrixWorld(true);
    const worldOf = key => {
      const found = bones.find(entry => normaliseBoneName(entry.bone.name) === key);
      return found?.bone.getWorldQuaternion(new T.Quaternion()) || null;
    };
    for (const side of ['Left', 'Right']) {
      const hand = worldOf(`${side}Hand`), forearm = worldOf(`${side}ForeArm`);
      if (!hand || !forearm) continue;
      const off = angleBetween(hand, forearm);
      notes.push(`${side} wrist ${off.toFixed(1)}° from forearm in ${neutral.name}`);
      if (off > (expect.wristToleranceDeg ?? 20)) problems.push(`${side} wrist is ${off.toFixed(1)}° off the forearm in ${neutral.name}`);
    }
    mixer.stopAllAction(); mixer.uncacheRoot(target);
    for (const entry of bones) { entry.bone.quaternion.copy(entry.quaternion); entry.bone.position.copy(entry.position); }
    target.updateMatrixWorld(true);
  }

  // Materials whose only texture is a packed roughness/metalness pair. These
  // have no albedo, so any runtime rule that strips packed maps renders them as
  // flat untextured plastic -- how Flock's 127k-triangle helmet became putty.
  let triangles = 0, heaviest = null;
  const mapless = new Set();
  target.traverse(node => {
    if (!node.isMesh) return;
    const count = (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
    triangles += count;
    if (!heaviest || count > heaviest.count) heaviest = { name: node.name, count };
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (material && !material.map && (material.roughnessMap || material.metalnessMap)) mapless.add(material.name || node.name);
    }
  });
  if (mapless.size) notes.push(`No-albedo materials (do not strip their packed maps): ${[...mapless].join(', ')}`);
  notes.push(`${Math.round(triangles)} triangles, heaviest mesh ${heaviest?.name} at ${heaviest?.count}`);
  if (expect.triangles && Math.round(triangles) !== expect.triangles) {
    problems.push(`Triangles ${Math.round(triangles)}, expected ${expect.triangles}`);
  }
  if (expect.maxTriangles && triangles > expect.maxTriangles) {
    problems.push(`Triangles ${Math.round(triangles)} over budget ${expect.maxTriangles}`);
  }
  return { problems, notes, triangles: Math.round(triangles) };
}

export async function buildFighter(config) {
  const {
    paths, boneMap = SOURCE_BONES, fist, fps = 30, detach = [],
    attachToHead = true, headAttachmentOffset = [0, 0, 0],
  } = config;
  const target = (await readScene(paths.target)).scene;
  const source = await readScene(paths.source);
  target.updateMatrixWorld(true); source.scene.updateMatrixWorld(true);

  // Props sculpted far outside the body skew fighter bounds, and therefore
  // every portrait and the arena camera. Export them as reusable props instead.
  for (const { name, output } of detach) {
    const node = target.getObjectByName(name);
    if (!node) continue;
    const prop = new T.Group();
    prop.attach(node);
    await saveScene(prop, output);
  }

  const pairs = restCorrections(target, source.scene, boneMap);
  const expected = config.expect?.bones ?? Object.keys(boneMap).length;
  if (pairs.length !== expected) {
    const found = new Set(pairs.map(p => p.key));
    throw Error(`Mapped ${pairs.length} bones, expected ${expected}. Missing: ${Object.keys(boneMap).filter(k => !found.has(k)).join(', ')}`);
  }

  // Rigid components -- helmets, cameras, insignia -- are not weighted body
  // meshes, so they need an explicit parent to follow.
  if (attachToHead) {
    const head = pairs.find(p => p.key === 'Head').bone;
    const attachments = [];
    target.traverse(n => { if (n.isMesh && !n.isSkinnedMesh) attachments.push(n); });
    const offset = new T.Vector3(...headAttachmentOffset);
    for (const mesh of attachments) {
      head.attach(mesh);
      if (offset.lengthSq()) {
        const world = mesh.getWorldPosition(new T.Vector3()).add(offset);
        mesh.position.copy(head.worldToLocal(world));
        mesh.updateMatrixWorld(true);
      }
    }
  }

  poseFingers(target, fist);
  const clips = bakeClips(target, source.scene, pairs, source.animations, fps);
  for (const p of pairs) { p.bone.quaternion.copy(p.rest); p.bone.position.copy(p.position); }
  target.updateMatrixWorld(true);
  target.animations = clips;

  const { problems, notes } = inspect(target, clips, config);
  for (const note of notes) console.log(`  · ${note}`);
  if (problems.length) throw Error(`${config.id} failed the build gate:\n  - ${problems.join('\n  - ')}`);

  await saveScene(target, paths.output);
  return target;
}
