import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { CinematicGrip } from './cinematicGrip.js';
import { TRIBUTE, tributeImpact, tributeTime, tributePose, smooth, lerp } from '../engine/beaverTribute.js';

const UP = new THREE.Vector3(0, 1, 0);
const BASE = import.meta.env?.BASE_URL || '/';
// Clone the bone graph independently while sharing the immutable mesh/textures.
function cloneRig(source) {
  const copy = source.clone(true), originals = [], clones = [];
  source.traverse(node => originals.push(node)); copy.traverse(node => clones.push(node));
  const map = new Map(originals.map((node, i) => [node, clones[i]]));
  for (const original of originals) if (original.isSkinnedMesh) {
    const mesh = map.get(original); mesh.skeleton = original.skeleton.clone();
    mesh.skeleton.bones = original.skeleton.bones.map(bone => map.get(bone));
    mesh.bindMatrix.copy(original.bindMatrix); mesh.bindMatrixInverse.copy(original.bindMatrixInverse);
  }
  return copy;
}
function signFace() {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 448;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ba803e'; ctx.fillRect(0, 0, 1024, 448);
  for (let i = 0; i < 180; i++) {
    const y = (i * 97) % 448;
    ctx.strokeStyle = i % 3 ? '#80512638' : '#f7c27555'; ctx.lineWidth = 1 + i % 3;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(300, y + 9, 730, y - 9, 1024, y + 2); ctx.stroke();
  }
  ctx.fillStyle = '#48230e'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = '900 132px Georgia'; ctx.fillText('LAKE', 512, 128, 890);
  ctx.font = '900 136px Georgia'; ctx.fillText('ONTARIO', 512, 310, 920);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  return new THREE.Mesh(new THREE.PlaneGeometry(1.48, .62), new THREE.MeshStandardMaterial({ map, roughness: .88 }));
}

export class BeaverTribute {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.name = 'Beaver head presentation'; scene.add(this.root);
    this.root.visible = false; this.beavers = []; this.grips = [new CinematicGrip(), new CinematicGrip()];
    this.legs = [new CinematicGrip(), new CinematicGrip()]; this.hipSaved = null;
    this.cut = null; this.ready = null;
  }
  async load() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const loader = new GLTFLoader();
      const [asset, sign] = await Promise.all([loader.loadAsync(`${BASE}props/beaver/beaver.glb`), loader.loadAsync(`${BASE}props/beaver/signpost.glb`)]);
      this.sign = sign.scene; this.sign.name = 'Lake Ontario trophy sign';
      const face = signFace(); face.position.set(0, .96, .086); this.sign.add(face); this.root.add(this.sign);
      for (let i = 0; i < 3; i++) {
        const model = cloneRig(asset.scene), pivot = new THREE.Group(); pivot.add(model); this.root.add(pivot);
        model.traverse(node => { if (node.isMesh) { node.castShadow = true; node.receiveShadow = true; node.frustumCulled = false; } });
        const mixer = new THREE.AnimationMixer(model), actions = {};
        for (const clip of asset.animations) actions[clip.name] = mixer.clipAction(clip).play();
        this.beavers.push({ pivot, model, mixer, actions });
      }
    })().catch(error => { this.ready = null; throw error; });
    return this.ready;
  }
  restore() {
    this.grips.forEach(grip => grip.restore()); this.legs.forEach(grip => grip.restore());
    if (this.hipSaved) { this.hipSaved[0].position.copy(this.hipSaved[1]); this.hipSaved = null; }
  }
  reset() {
    this.restore();
    if (this.cut) for (const piece of this.cut.pieces) piece.scripted = false;
    this.cut = null; this.root.visible = false;
  }
  capture(cut) {
    if (!cut?.pieces?.length) return;
    this.cut = cut;
    const bounds = new THREE.Box3();
    for (const piece of cut.pieces) {
      piece.scripted = true;
      piece.mesh.geometry.computeBoundingBox();
      bounds.union(piece.mesh.geometry.boundingBox);
    }
    this.center = bounds.getCenter(new THREE.Vector3());
    this.radius = Math.max(.1, (bounds.max.y - bounds.min.y) * .5);
    this.spawn = new THREE.Vector3(cut.x, cut.y, cut.z).add(this.center);
  }
  active(snapshot) { return tributeImpact(snapshot.finisher) !== null && ['finisher', 'matchEnd'].includes(snapshot.phase); }
  actors(snapshot, actors, frame) {
    if (!this.active(snapshot)) return actors;
    const t = tributeTime(snapshot.finisher, frame);
    if (t < TRIBUTE.lift) return actors;
    const pose = tributePose(t), side = snapshot.finisher.attacker, actor = actors[side];
    const origin = Math.max(-1.4, Math.min(1.4, snapshot.finisher.originX));
    actors[side] = { ...actor, x: origin + pose.carneyX * snapshot.finisher.facing, y: 0,
      cinematicClip: 'beaverPresentation', clipTime: (t - TRIBUTE.lift) / 60,
      reelKey: 'beaverPresentation', cinematicTurn: 0 };
    return actors;
  }
  update(snapshot, views, frame, { reducedMotion = false, gore = true } = {}) {
    if (!this.active(snapshot)) { if (this.root.visible || this.cut) this.reset(); return null; }
    const impact = tributeImpact(snapshot.finisher), t = tributeTime(snapshot.finisher, frame);
    this.root.visible = frame >= impact;
    if (!this.root.visible) return null;
    const finish = snapshot.finisher, facing = finish.facing, origin = Math.max(-1.4, Math.min(1.4, finish.originX));
    const pose = tributePose(t), worldX = x => origin + x * facing;
    if (this.sign) { this.sign.position.set(worldX(pose.signX), 0, pose.signZ); this.sign.visible = t >= 55; }
    const carryWeight = pose.lift * (1 - smooth((t - TRIBUTE.take) / 35));
    const walking = (t > 55 && t < TRIBUTE.arrive) || (t > TRIBUTE.lift && t < TRIBUTE.present);
    for (const [i, beaver] of this.beavers.entries()) {
      const offsets = [[-.78, .78], [0, .25], [.78, .78]][i];
      const gather = smooth((t - 100) / 45), spread = smooth((t - TRIBUTE.take) / 65);
      const x = pose.groupX + lerp((i - 1) * 1.3, offsets[0], gather) + (i - 1) * .12 * spread;
      const z = lerp(lerp(i === 1 ? .16 : .4, .28, gather), .60 + offsets[1], spread);
      beaver.pivot.position.set(worldX(x), walking && !reducedMotion ? Math.abs(Math.sin(t * .19 + i * 2)) * .013 : 0, z);
      // Point toward travel, then toward Carney while presenting.
      const holdingYaw = Math.atan2(-offsets[0] * facing, .5);
      beaver.pivot.rotation.y = lerp(lerp(-facing * Math.PI / 2, holdingYaw, gather), (i - 1) * -.45 * facing, spread);
      beaver.pivot.visible = t >= 55;
      for (const [name, action] of Object.entries(beaver.actions)) {
        const weight = name === 'beaverCarry' ? carryWeight : name === 'beaverWalk' ? (walking ? 1 - carryWeight : 0) : (walking ? 0 : 1 - carryWeight);
        action.setEffectiveWeight(weight); action.time = ((t / 60 + i * .14) % action.getClip().duration);
      }
      beaver.mixer.update(0);
      beaver.pivot.updateWorldMatrix(true, true);
    }
    const view = views[finish.attacker];
    if (view?.pivot && t >= TRIBUTE.lift) {
      const turn = smooth((t - TRIBUTE.lift) / 55);
      view.root.position.z = lerp(.6, .28, smooth(pose.place / .4)) * smooth((t - TRIBUTE.lift) / 80) * (1 - pose.retreat);
      view.pivot.rotation.y = lerp(facing * view.definition.facingRotationY, view.definition.facingRotationY - Math.PI / 2, turn);
      view.root.updateWorldMatrix(true, true);
      const hips = view.model.getObjectByName('hips');
      const bend = smooth((t - TRIBUTE.lift) / 85) * (1 - pose.place);
      if (hips && bend > 0) {
        const feet = ['L','R'].map(side => view.model.getObjectByName('foot'+side)?.getWorldPosition(new THREE.Vector3()));
        this.hipSaved = [hips, hips.position.clone()];
        const target = hips.getWorldPosition(new THREE.Vector3()); target.y -= .5 * bend;
        hips.position.copy(hips.parent.worldToLocal(target)); view.root.updateWorldMatrix(true,true);
        for (const [i,side] of ['L','R'].entries()) if (feet[i])
          this.legs[i].apply(view.model, feet[i], feet[i].clone().add(new THREE.Vector3(0,.35,1)), side, 'leg');
      }
    }
    const head = new THREE.Vector3(worldX(3.05), this.radius || .16, .6);
    const contacts = [];
    let rotation = new THREE.Quaternion();
    if (this.cut && gore) {
      if (t < TRIBUTE.land) {
        const a = t / TRIBUTE.land;
        head.copy(this.spawn).lerp(new THREE.Vector3(worldX(1.95), this.radius + .025, .6), a);
        head.y += Math.sin(a * Math.PI) * .65;
        rotation.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -facing * a * Math.PI * 2);
      } else if (t < TRIBUTE.slide) {
        const a = smooth((t - TRIBUTE.land) / (TRIBUTE.slide - TRIBUTE.land));
        head.set(worldX(lerp(1.95, 3.05, a)), this.radius + .025, .6);
        rotation.setFromAxisAngle(UP, facing * a * .65);
      } else {
        head.set(worldX(pose.headX), lerp(this.radius + .025, .43 + this.radius, pose.lift), lerp(.6, .9, pose.lift));
        rotation.setFromAxisAngle(UP, lerp(facing * .65, facing * Math.PI / 2, pose.lift));
      }
      if (t >= TRIBUTE.present) {
        const raise = smooth(pose.place / .45), across = smooth((pose.place - .4) / .45), lower = smooth((pose.place - .85) / .15);
        head.set(worldX(lerp(-.08, pose.signX, across)),
          lerp(.43 + this.radius, pose.signTop + this.radius + .24, raise) - .24 * lower,
          lerp(.9, pose.signZ, across));
      }
      if (view?.model && t >= TRIBUTE.present - 20 && t < TRIBUTE.release) {
        const reach = smooth((t - TRIBUTE.present + 20) / 20) * (1 - smooth((t - TRIBUTE.place) / (TRIBUTE.release - TRIBUTE.place)));
        for (const [i, side] of ['L', 'R'].entries()) {
          const hand = view.model.getObjectByName('hand' + side);
          if (!hand) continue;
          const support = facing > 0 ? side === 'L' : side === 'R';
          const contactX = lerp(i ? -.14 : .14, -.10 * facing, smooth((pose.place - .4) / .4));
          const target = head.clone().add(new THREE.Vector3(contactX, -.07, .015));
          const handReach = reach * (support ? 1 : 1 - smooth((pose.place - .4) / .25));
          target.lerp(hand.getWorldPosition(new THREE.Vector3()), 1 - handReach);
          const overSign = smooth((pose.place - .35) / .35);
          this.grips[i].apply(view.model, target, target.clone().add(new THREE.Vector3((i ? -1 : 1) * .45,
            lerp(-.32, .4, overSign), lerp(.45, -.2, overSign))), side);
          contacts.push({ side, target: target.toArray(), actual: hand.getWorldPosition(new THREE.Vector3()).toArray() });
        }
      }
      for (const piece of this.cut.pieces) {
        piece.mesh.quaternion.copy(rotation);
        piece.mesh.position.copy(head).sub(this.center.clone().applyQuaternion(rotation));
      }
    }
    return { t, head: head.toArray(), pose, contacts };
  }
}

export function tributeCamera(t, origin, facing, { reducedMotion = false, portrait = false, aspect = 16 / 9 } = {}) {
  const pose = tributePose(t);
  let target, position;
  if (reducedMotion) { target = [1.1, 1, .3]; position = [1.1, 1.7, 9]; }
  else if (t < TRIBUTE.present - 25) {
    const track = smooth((t - 12) / 30);
    const x = lerp(.65, Math.min(3.05, pose.groupX), track);
    target = [x, .6, .4]; position = [x + 1.1 * (1 - pose.carry), 1.05, 5.0];
  } else {
    const reveal = smooth((t - TRIBUTE.present + 25) / (TRIBUTE.hero - TRIBUTE.present + 25));
    target = [lerp(.45, .05, reveal), lerp(.75, 1.05, reveal), .35];
    position = [lerp(-1.65, -1.1, reveal), lerp(1.1, .92, reveal), lerp(5.0, 5.7, reveal)];
  }
  if (portrait) position[2] *= Math.max(1, 1.1 / aspect);
  const world = a => [origin + a[0] * facing, a[1], a[2]];
  return { authored: true, position: world(position), target: world(target), fov: 38, cut: 'beaver-tribute' };
}
