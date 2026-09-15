// The visual half of a fighter: model, materials, and the state-to-clip map.
//
// The sim never mentions an animation and the view never decides a rule. The
// join is `clipForState`. Authored contact markers map startup, active,
// and recovery separately so balance changes preserve the strike's contact.
// Unmarked move-specific clips retain their already-authored timing.

import * as THREE from '../vendor/three.module.js';
import { attackClipTime, CONTACT_MARKERS } from './clipTiming.js';
import { HitRecoil } from './hitRecoil.js';
import { fighterAnimations } from './fighterAnimations.js';
import { loadBinaryModel } from './binaryModel.js';
import { buildFighter } from '../fighters/_shared/meshCodec.js';
import { PoseAmp } from './poseAmp.js';
import { MovementPose, movementClipTime } from './movementPose.js';
import { FighterRim } from './rimLight.js';
import { FighterDamage } from './fighterDamage.js';
import { Dismemberment } from './dismemberment.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { moveOf, totalFrames, TICK } from '../engine/frameData.js';

// Every clip the full combat set wants, and what to fall back to when the rig
// has not been re-exported with it yet. A missing clip degrades to a related
// pose instead of freezing the fighter mid-round.
const CLIP_FALLBACK = Object.freeze({
  idle: ['idle', 'guard'],
  guard: ['guard', 'idle'],
  walkF: ['walkF', 'idle'],
  walkB: ['walkB', 'walkF', 'idle'],
  sprint: ['sprint', 'walkF', 'idle'],
  backHop: ['backHop', 'jump', 'walkB', 'guard', 'idle'],
  juggle: ['juggle', 'hitHigh', 'hit', 'knockdown', 'guard', 'idle'],
  crouch: ['crouch', 'guard'],
  crouchGuard: ['crouchGuard', 'crouch', 'guard'],
  jump: ['jump', 'idle'],
  land: ['land', 'crouch', 'idle'],
  lightPunch: ['lightPunch', 'jab'],
  heavyPunch: ['heavyPunch', 'jab'],
  lightKick: ['lightKick', 'jab'],
  heavyKick: ['heavyKick', 'lightKick', 'jab'],
  crouchPunch: ['crouchPunch', 'lightPunch', 'jab'],
  crouchKick: ['crouchKick', 'heavyKick', 'jab'],
  jumpAttack: ['jumpAttack', 'heavyKick', 'jab'],
  grab: ['grab', 'lightPunch', 'jab'],
  grabHold: ['grabHold', 'grab', 'guard'],
  throw: ['throw', 'heavyKick', 'jab'],
  finisher: ['finisher', 'heavyPunch', 'jab'],
  hitHigh: ['hitHigh', 'hit', 'guard'],
  hitLow: ['hitLow', 'hitHigh', 'hit', 'guard'],
  blockHit: ['blockHit', 'guard'],
  knockdown: ['knockdown', 'hitHigh', 'guard'],
  downed: ['knockdown', 'defeat', 'hitHigh', 'guard'],
  getUp: ['getUp', 'idle'],
  grabbed: ['grabbed', 'hitHigh', 'guard'],
  dizzy: ['dizzy', 'hitHigh', 'idle'],
  finisherVictim: ['finisherVictim', 'knockdown', 'hitHigh'],
  victory: ['victory', 'idle'],
  defeat: ['defeat', 'knockdown', 'idle'],
  intro: ['intro', 'guard', 'idle'],
});

const LOOPING = new Set(['idle', 'guard', 'walkF', 'walkB', 'sprint', 'crouch', 'crouchGuard', 'dizzy', 'grabHold', 'victory']);

export function clipForState(view) {
  switch (view.state) {
    case 'attack': return (view.moveData || moveOf(view.move, view)).clip;
    case 'walkF': return 'walkF';
    case 'walkB': return 'walkB';
    case 'sprint': return 'sprint';
    case 'backHop': return 'backHop';
    case 'juggle': return 'juggle';
    case 'crouch': return 'crouch';
    case 'blockStand': return 'guard';
    case 'blockCrouch': return 'crouchGuard';
    case 'blockStun': return 'blockHit';
    case 'jump': return 'jump';
    case 'landing': return 'land';
    case 'grabbing': return 'grabHold';
    case 'grabbed': return 'grabbed';
    case 'hitStun': return view.lastHitLevel === 'low' ? 'hitLow' : 'hitHigh';
    case 'knockdown': return 'knockdown';
    case 'downed': return 'downed';
    case 'getUp': return 'getUp';
    case 'dizzy': return 'dizzy';
    case 'finished': return 'finisherVictim';
    case 'victory': return 'victory';
    case 'defeat': return 'defeat';
    case 'intro': return 'intro';
    default: return 'idle';
  }
}

export class FighterView {
  constructor(definition, { scene, side = 0 }) {
    this.definition = definition;
    this.scene = scene;
    this.side = side;
    // Built before any load, because dress() attaches it to every material.
    this.rim = new FighterRim(side);
    this.root = new THREE.Group();
    this.model = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.currentKey = null;
    this.ready = false;
    scene.add(this.root);
  }

  dress(model) {
    model.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      // Skinned bounds are computed from the bind pose, so a fighter mid-kick
      // culls itself at the screen edge unless this is off.
      node.frustumCulled = false;
      const dressMaterial = source => {
        const material = this.definition.preserveMaterials ? source.clone() : new THREE.MeshPhysicalMaterial({
          map: source.map || null,
          vertexColors: Boolean(node.geometry.attributes.color) && !source.map,
          color: source.color?.clone() || new THREE.Color(0xffffff),
          roughness: 0.88,
          metalness: 0,
          clearcoat: 0,
          clearcoatRoughness: 0.6,
          sheen: 0.04,
          sheenColor: new THREE.Color(0x7f9dc8),
        });
        if (!this.definition.preserveMaterials) material.roughness = Math.max(material.roughness || 0, 0.84);
        if (!this.definition.preserveMaterials) material.metalness = Math.min(material.metalness || 0, 0.12);
        if (!this.definition.preserveMaterials && material.normalScale) material.normalScale.multiplyScalar(0.45);
        const flock = this.definition.id === 'officer_flock';
        // Packed roughness/metalness maps carry near-black channels that defeat
        // a high scalar roughness and made Flock's kit sparkle like foil under
        // the stage's coloured keys -- a specular moire that crawled across the
        // uniform every time the fighter swayed. Drop the packing on every Flock
        // material, not only the albedo-textured ones: the helmet shell's R/M
        // pair is its *only* map and was the worst offender, 127k triangles of
        // it. With the map gone the shell needs its scalars set by hand, or it
        // renders as flat grey putty.
        if ((!this.definition.preserveMaterials && source.map) || flock) {
          material.roughnessMap = null;
          material.metalnessMap = null;
        }
        if (flock && !source.map) {
          material.roughness = 0.6;
          material.metalness = 0;
          // The bare shell sits near-black under the cold fill; a steel grey
          // gives it something to catch the key with.
          if (material.color) material.color.setHex(0x6b6b6b);
        }
        if (flock && source.map) {
          // The uniform albedo is painted almost black (linear ~0.02), so the
          // warm key barely lifts it off the backdrop and the back half crushes
          // out entirely. Gain the map back up, hold roughness high so the
          // coloured lights stay diffuse, and halve the already-halved normal
          // strength again -- at fighting distance the weave was the moire.
          material.color.multiplyScalar(2.0);
          material.roughness = 0.95;
          material.metalness = 0;
          if (material.normalScale) material.normalScale.multiplyScalar(0.55);
        }
        if (flock && material.emissive && material.map) {
          material.emissiveMap = material.map;
          material.emissive.setHex(0xffffff);
          // A sliver of self-fill so the shadow side never reads as a black
          // cut-out against the ice.
          material.emissiveIntensity = 0.16;
        }
        if (!this.definition.preserveMaterials && 'clearcoat' in material) material.clearcoat = 0;
        if (material.map) material.map.colorSpace = THREE.SRGBColorSpace;
        for (const value of Object.values(material)) if (value?.isTexture) value.anisotropy = 8;
        this.rim.attach(material);
        source.dispose();
        return material;
      };
      node.material = Array.isArray(node.material) ? node.material.map(dressMaterial) : dressMaterial(node.material);
    });
  }

  place(model) {
    // Finger pose belongs to the bake (tools/build-officer-flock.mjs, FIST) and
    // is deliberately not touched here: a runtime counter-pose means the asset
    // you review and the asset the game renders are two different poses.
    //
    // Normalise to the authored fighting height and drop the feet onto y=0, so
    // two sculpts of different native scale share one arena and one camera.
    // ObjectLoader rigs need a full matrix update (including inverse bind
    // matrices) before their first skinned bounds measurement.
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    model.scale.setScalar(this.definition.authoredHeight / size.y);
    model.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(model);
    const centre = scaled.getCenter(new THREE.Vector3());
    model.position.set(-centre.x, -scaled.min.y, -centre.z);

    this.pivot = new THREE.Group();
    this.pivot.add(model);
    this.root.add(this.pivot);
    this.model = model;
    this.recoil = new HitRecoil(model, this.pivot);
    this.poseAmp = new PoseAmp(model);
    this.movementPose = new MovementPose(model, this.pivot);
    // After dress(): it swaps in geometry carrying the damage attribute and
    // extends the materials dress() has just built.
    this.damage = new FighterDamage(model);
    // Dismemberment sits on top of the damage attribute rather than beside it:
    // both write the same per-vertex buffers, and one owner for those buffers
    // is what keeps a bleeding stump and a missing forearm consistent.
    this.gore = new Dismemberment({ damage: this.damage, model, debris: this.debris, side: this.side });
  }

  // The debris pool is shared by both fighters and owned by the scene, so it is
  // handed in rather than built here.
  setDebris(debris) {
    this.debris = debris;
    if (this.gore) this.gore.debris = debris;
  }

  bindClips(mixer, clips) {
    this.mixer = mixer;
    this.clips = clips;
    this.actions = {};
    for (const [name, clip] of Object.entries(clips)) {
      this.actions[name] = mixer.clipAction(clip);
    }
    this.available = Object.keys(this.actions);
    this.ready = true;
  }

  async loadFactory() {
    if (this.definition.sceneAsset) {
      const model = await new THREE.ObjectLoader().loadAsync(`${import.meta.env.BASE_URL}${this.definition.sceneAsset}`);
      this.dress(model);
      this.place(model);
      const mixer = new THREE.AnimationMixer(model);
      this.bindClips(mixer, Object.fromEntries(model.animations.map(clip => [clip.name, clip])));
      return this;
    }
    const pack = await loadBinaryModel(this.definition.id);
    const built = buildFighter(THREE, pack.model, null, pack.rig, { decodedParts: pack.decodedParts, castShadow: true, receiveShadow: true });
    this.built = built;
    built.mixer.stopAllAction();
    this.dress(built.group);
    this.place(built.group);
    this.bindClips(built.mixer, built.clipMap);
    return this;
  }

  async loadGltf() {
    const url = `${import.meta.env.BASE_URL}${this.definition.runtimeAsset || `fighters/${this.definition.id}/${this.definition.id}-rigged.glb`}`;
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    this.dress(model);
    this.place(model);
    const mixer = new THREE.AnimationMixer(model);
    const clips = {};
    for (const clip of gltf.animations) clips[clip.name] = clip;
    this.bindClips(mixer, clips);
    return this;
  }

  async load(format = 'threejs') {
    this.format = this.definition.runtime === 'gltf' ? 'gltf' : format;
    if ((format === 'threejs' && this.definition.runtime !== 'gltf') || this.definition.sceneAsset) await this.loadFactory();
    else await this.loadGltf();
    const extras = await fighterAnimations(this.definition, Object.values(this.clips));
    for (const clip of extras) {
      this.clips[clip.name] = clip; this.actions[clip.name] = this.mixer.clipAction(clip);
    }
    this.available = Object.keys(this.actions);
    return this;
  }

  resolveClip(key) {
    for (const candidate of CLIP_FALLBACK[key] || [key]) {
      if (this.actions[candidate]) return candidate;
    }
    return this.available[0] || null;
  }

  // `view` is one entry from Match.snapshot().fighters.
  apply(view, dt, { scale = 1, freeAnimation = false } = {}) {
    if (!this.ready) return;
    this.recoil.restore();
    this.poseAmp.restore();
    this.root.position.set(view.x, view.y, 0);
    // Recoil and movement are additive. Restore the entire pivot every sample
    // so a finished roll cannot leave the next idle tilted or translated.
    this.pivot.position.set(0, 0, 0);
    this.pivot.rotation.set(0, view.facing >= 0
      ? this.definition.facingRotationY
      : -this.definition.facingRotationY, 0);

    const key = view.cinematicClip || (view.state === 'attack' && this.actions[view.move] ? view.move : clipForState(view));
    if (key !== this.currentKey || view.state !== this.previousState || view.stateFrame < this.previousStateFrame || view.reelKey !== this.reelKey || (view.state === 'attack' && (view.move !== this.previousMove || view.moveFrame < this.previousMoveFrame))) this.play(key, view);
    this.reelKey = view.reelKey;
    this.previousMove = view.move;
    this.currentKey = key;
    this.previousMoveFrame = view.moveFrame;
    this.previousState = view.state;
    this.previousStateFrame = view.stateFrame;
    if (this.mixer) {
      this.mixer.timeScale = scale;
      this.mixer.update(dt);
      // The simulation owns attack time, including hitstop and dropped render
      // frames. Playing by wall time made the fist recover before hits landed.
      if (view.state === 'attack' && this.current && !freeAnimation) {
        const duration = this.current.getClip().duration;
        const move = view.moveData || moveOf(view.move, view);
        const name = this.current.getClip().name;
        const markers = this.current.getClip().userData?.contactMarkers || this.definition.contactMarkers?.[name] || CONTACT_MARKERS[name];
        this.current.time = attackClipTime(view.moveFrame, move, duration, markers);
        this.mixer.update(0);
      }
      if (this.current && !freeAnimation && !view.cinematicClip) {
        const time = movementClipTime(view, this.current.getClip().duration, this.current.getClip().userData);
        if (time !== null) {
          this.current.time = time;
          this.mixer.update(0);
        }
      }
    }
    if (view.cinematicClip && this.current) {
      this.current.time = Math.min(this.current.getClip().duration, view.clipTime || 0);
      this.mixer.update(0);
    }
    // After the mixer, before the recoil: a flinch should bend the amplified
    // pose rather than being flattened back toward the authored one.
    this.poseAmp.apply();
    if (!view.cinematicClip && !this.current?.getClip().userData?.authoredMovement) this.movementPose.apply(view);
    this.rim.setFacing(view.facing);
    this.rim.update(dt);
  }

  flinch(event, profile, healthPct = 1) {
    this.recoil?.hit(event, profile);
    // Blocks are filtered inside onHit: a guarded blow marks nobody.
    this.damage?.onHit(event, profile?.power);
    // Severance is decided after the wound is painted, so a limb that comes off
    // leaves the blood of the blow that took it behind on the stump.
    this.gore?.onHit(event, healthPct, { standHeight: this.definition?.authoredHeight || 1.86 });
    return this.gore?.drain() || null;
  }

  resetDamage() { this.damage?.resetRound(); this.gore?.resetRound(); }

  applyRecoil(dt) {
    this.recoil?.apply(dt);
    // Hanging strands need the posed-and-recoiled skeleton, otherwise they
    // pin to last frame's shoulder and drag through the sleeve.
    this.gore?.update(dt);
  }

  play(key, view) {
    const name = this.resolveClip(key);
    if (!name) return;
    const action = this.actions[name];
    const loop = LOOPING.has(key);
    const frameDriven = !view.cinematicClip && movementClipTime(view, action.getClip().duration) !== null;
    // A held pose must also hold blend weights during hitstop. Starting these
    // reactions cleanly prevents a previous walk/attack leaking into the body
    // while it lies still, including when two states share a fallback clip.
    if (frameDriven) this.mixer.stopAllAction();
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.timeScale = this.timeScaleFor(key, name, view);
    action.play();
    if (this.current && this.current !== action && !frameDriven) {
      // Crossfades are short on attacks: a 0.15 s blend on a 4-frame startup
      // hides the entire startup and makes fast moves unreadable.
      action.crossFadeFrom(this.current, loop ? 0.16 : 0.06, false);
    }
    this.current = action;
  }

  timeScaleFor(key, name, view) {
    if (view?.state !== 'attack' || !view.move) return 1;
    const wanted = totalFrames(view.moveData || moveOf(view.move, view)) * TICK;
    const duration = this.clips[name]?.duration || wanted;
    return Math.max(0.25, Math.min(4, duration / wanted));
  }

  dispose() {
    this.mixer?.stopAllAction();
    this.gore?.dispose();
    this.damage?.dispose();
    if (this.built) this.built.dispose();
    else {
      const textures = new Set(), materials = new Set();
      this.model?.traverse(node => {
        node.geometry?.dispose();
        for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
          if (!material) continue;
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      });
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
    }
    this.scene.remove(this.root);
  }
}
