// Overwatch: the summoned surveillance drone and the laser it rakes across the
// floor.
//
// Every transform here is read from `snapshot.strike`, which the simulation
// resolves into world geometry -- muzzle, floor contact, phase, progress. The
// renderer owns look, never position, so the beam you can see and the beam that
// can hit you are the same line even during hitstop, a pause, or a reel.
//
// The beam is three coaxial pieces rather than one: a hard white core that
// carries the shape, a soft red sheath that carries the danger colour, and the
// authored laser card between them for texture. Layering them costs two extra
// draws and is the difference between a bright cylinder and something that
// reads as burning air.

import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { BEAM } from '../engine/overwatch.js';

// Danger amber shifting to red, straight off the colour bible: the telegraph is
// the same signal a stage hazard uses, so a player who has learned one arena
// already knows what the lock-on means.
const AMBER = new THREE.Color(0xffc63d);
const RED = new THREE.Color(0xd81f2a);
const WHITE = new THREE.Color(0xfff4e2);

const DRONE_SIZE = 0.92;

// A soft radial falloff for the floor bloom. A plain plane with a flat material
// is a bright square, which is exactly what a light pool must not be.
function glowTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.28, 'rgba(255,228,190,0.72)');
  gradient.addColorStop(0.62, 'rgba(216,31,42,0.26)');
  gradient.addColorStop(1, 'rgba(216,31,42,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Geometry authored along +Z so a single `lookAt` aims the whole assembly, and
// unit-length so `scale.z` is the beam length in metres.
function tube(radius, segments) {
  return new THREE.CylinderGeometry(radius, radius, 1, segments, 1, true).rotateX(Math.PI / 2);
}

function additive(color, opacity, { depthWrite = false, side = THREE.DoubleSide } = {}) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side,
    blending: THREE.AdditiveBlending, depthWrite, toneMapped: false });
}

export class DroneStrike {
  constructor(scene, { stage = null, vfx = null, quality = 1, reducedMotion = false } = {}) {
    this.scene = scene;
    this.stage = stage;
    this.vfx = vfx;
    this.quality = quality;
    this.reducedMotion = reducedMotion;
    this.time = 0;
    this.scorchedTo = null;

    this.root = new THREE.Group();
    this.root.visible = false;
    scene.add(this.root);

    // ---- the drone ------------------------------------------------------
    this.droneRig = new THREE.Group();
    this.droneModel = new THREE.Group();      // filled in when the GLB lands
    this.droneRig.add(this.droneModel);
    this.root.add(this.droneRig);

    // Two counter-rotating rings around the camera body. The drone has no rotor
    // and no visible means of staying up, so the rings are what sell it as held
    // there rather than simply floating.
    this.halo = [];
    for (let i = 0; i < 2; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.42 + i * 0.13, 0.012, 6, 48),
        additive(i ? RED : AMBER, 0.75),
      );
      ring.rotation.x = Math.PI / 2 + (i ? 0.5 : -0.35);
      this.halo.push(ring);
      this.droneRig.add(ring);
    }

    // The lens. A flat additive card facing the viewer, so the glow reads at any
    // stage angle without a light of its own.
    // A sprite with no map is a solid square, and an additive solid square is a
    // white panel hanging in the sky -- the falloff is the whole effect.
    this.lens = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: AMBER, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.lens.scale.setScalar(0.9);
    this.droneRig.add(this.lens);

    // A short-range fill carried by the rig. The arena is lit for a night match
    // and the drone hangs above every practical key light, so without its own
    // lamp the model reads as a dark blob with a ring around it.
    this.fill = new THREE.PointLight(0xffd9a0, 0, 2.2, 2);
    this.droneRig.add(this.fill);

    // The strike's own light, and it is what puts the beam on the fighters and
    // the ice instead of leaving it a bright object in an unlit scene.
    this.light = new THREE.PointLight(RED.getHex(), 0, 4.2, 2);
    this.root.add(this.light);

    // ---- the beam -------------------------------------------------------
    this.beam = new THREE.Group();
    this.beam.visible = false;
    this.root.add(this.beam);
    this.core = new THREE.Mesh(tube(0.035, 8), additive(WHITE, 1));
    this.sheath = new THREE.Mesh(tube(0.085, 12), additive(RED, 0.45));
    this.bloomTube = new THREE.Mesh(tube(0.24, 12), additive(RED, 0.13));
    this.beam.add(this.core, this.sheath, this.bloomTube);
    this.card = null;                          // the authored laser, once loaded

    // ---- the floor ------------------------------------------------------
    // Contact bloom and lock reticle both lie flat on the ice; the sweep drags
    // them along, so they are persistent meshes rather than pooled one-shots.
    const contactMaterial = additive(WHITE, 0);
    contactMaterial.map = glowTexture();
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactMaterial);
    this.contact.rotation.x = -Math.PI / 2;
    this.contact.position.y = 0.012;
    this.root.add(this.contact);

    this.reticle = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 40), additive(AMBER, 0));
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.position.y = 0.014;
    this.root.add(this.reticle);

    this.load();
  }

  load() {
    const base = import.meta.env?.BASE_URL ?? '/';
    const loader = new GLTFLoader();
    loader.load(`${base}fx/surveillance_drone.glb`, gltf => {
      const model = gltf.scene;
      // Sketchfab exports arrive at arbitrary scale and origin. Normalise both
      // so the rig can pose the drone in metres without knowing the asset.
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      model.position.sub(bounds.getCenter(new THREE.Vector3()));
      const holder = new THREE.Group();
      holder.add(model);
      holder.scale.setScalar(DRONE_SIZE / Math.max(size.x, size.y, size.z));
      // The camera body hangs down its own -Y. Stand it up and face it along
      // the rig's +X, so the rig only ever has to yaw and pitch.
      holder.rotation.set(Math.PI * 0.5, 0, -Math.PI * 0.5);
      // The export's emissive is an equipment-light detail map, not a glow.
      // Lifting it is what keeps the housing readable against a night sky.
      model.traverse(node => {
        if (!node.isMesh) return;
        node.material = node.material.clone();
        node.material.emissiveIntensity = 2.4;
        node.material.toneMapped = true;
      });
      this.droneModel.add(holder);
    }, undefined, error => console.warn('Overwatch drone unavailable', error));

    loader.load(`${base}fx/laser_beam.glb`, gltf => {
      const model = gltf.scene;
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      model.position.sub(bounds.getCenter(new THREE.Vector3()));
      const holder = new THREE.Group();
      holder.add(model);
      // Normalised on every axis: a unit along Z so `beam.scale.z` stays the
      // one place the beam's length is decided, and a unit across so the card's
      // own width is a plain multiplier in metres rather than whatever the
      // export happened to be authored at.
      holder.scale.set(1 / Math.max(size.x, size.y, 0.001), 1 / Math.max(size.x, size.y, 0.001), 1 / size.z);
      model.traverse(node => {
        if (!node.isMesh) return;
        node.material = node.material.clone();
        node.material.transparent = true;
        node.material.depthWrite = false;
        node.material.blending = THREE.AdditiveBlending;
        node.material.toneMapped = false;
        // The export ships a x10 emissive strength, which is a sensible value
        // for a card viewed alone and a screen-clearing white one on top of a
        // bloom pass and a lit ice sheet.
        node.material.emissiveIntensity = 1;
        for (const map of [node.material.map, node.material.emissiveMap]) {
          if (map) map.wrapS = map.wrapT = THREE.RepeatWrapping;
        }
      });
      this.card = holder;
      this.beam.add(holder);
    }, undefined, error => console.warn('Overwatch beam unavailable', error));
  }

  // `strike` is `snapshot.strike`; `dt` is real seconds, so the beam keeps
  // boiling through hitstop instead of freezing into a bright stick.
  update(strike, dt = 0) {
    this.time += dt;
    if (!strike) {
      if (this.root.visible) this.clear();
      return;
    }
    this.root.visible = true;
    const { phase, t, facing } = strike;
    const muzzle = new THREE.Vector3(strike.muzzleX, strike.muzzleY, 0.1);
    const floor = new THREE.Vector3(strike.contactX, 0, 0.1);

    this.poseDrone(strike, muzzle, phase, t, dt);

    if (phase === 'deploy') {
      this.beam.visible = false;
      this.setContact(0, 0);
      this.reticle.material.opacity = 0;
      this.light.intensity = 0;
      return;
    }

    if (phase === 'lock') {
      // The threat, drawn before it is real: a hairline of the beam's own
      // geometry at a fraction of its width, plus a reticle tightening on the
      // opening contact. Sixteen frames is short, but it is the difference
      // between a screen-wide attack and an ambush.
      const flicker = 0.35 + 0.65 * Math.abs(Math.sin(this.time * 34));
      this.drawBeam(muzzle, floor, 0.09 * flicker, 0.16 * flicker, AMBER, 0.55);
      this.reticle.position.set(floor.x, 0.014, 0.1);
      this.reticle.scale.setScalar(1 + (1 - t) * 2.6);
      this.reticle.material.opacity = 0.25 + 0.55 * t;
      this.reticle.material.color.copy(AMBER).lerp(RED, t);
      this.reticle.rotation.z += dt * 5;
      this.setContact(0, 0);
      this.light.position.copy(muzzle);
      this.light.color.copy(AMBER).lerp(RED, t);
      this.light.intensity = this.lit() ? 0.6 + 1.2 * t : 0;
      return;
    }

    // ---- firing ---------------------------------------------------------
    // The first frames overshoot: the beam punches in at several times its
    // width and settles, which gives it a crack rather than a fade-in.
    const punch = phase === 'fire' ? Math.max(0, 1 - t * 16) : 0;
    const dying = phase === 'fade' ? 1 - t : 1;
    const boil = 1 + Math.sin(this.time * 47) * 0.07 + Math.sin(this.time * 113) * 0.035;
    this.drawBeam(muzzle, floor, (1 + punch * 1.8) * boil * dying,
      (1 + punch * 1.2) * boil * dying, RED, dying);
    this.reticle.material.opacity = 0;

    // Capped below one on purpose. Bloom triggers at 0.86 luma and these are
    // additive on top of a white ice sheet, so anything that reaches full
    // brightness takes the whole screen with it.
    this.setContact(Math.min(0.68, (0.44 + punch * 0.55) * dying),
      1.0 + punch * 1.1 + Math.sin(this.time * 60) * 0.06);
    this.contact.position.set(floor.x, 0.012, 0.1);
    this.light.position.set(floor.x, 0.8, 0.2);
    this.light.color.copy(RED);
    this.light.intensity = this.lit() ? 2.1 * dying : 0;

    if (phase === 'fire') this.burnFloor(floor.x, facing);
  }

  // The drone itself: unfolds on deploy, holds station over its own floor
  // contact through the sweep, and folds away on the tail.
  poseDrone(strike, muzzle, phase, t, dt) {
    const rig = this.droneRig;
    rig.position.copy(muzzle);
    if (phase === 'deploy') {
      // Arrives from above with an overshoot -- the way a thing that was
      // already watching drops into place, rather than being built.
      const k = 1 - Math.pow(1 - t, 3);
      rig.position.y = muzzle.y + (1 - k) * 2.4;
      rig.scale.setScalar(k * (1 + Math.sin(t * Math.PI) * 0.22));
    } else if (phase === 'fade') {
      rig.scale.setScalar(Math.max(0, 1 - t) ** 0.7);
    } else {
      rig.scale.setScalar(1);
      rig.position.y = muzzle.y + Math.sin(this.time * 6) * 0.045;
    }

    // Yaw to the side it is covering, then pitch the body down the beam. The
    // lens has to point along the shot, or the whole thing reads as a prop that
    // happens to have a laser next to it.
    rig.rotation.y = strike.facing >= 0 ? 0 : Math.PI;
    rig.rotation.z = -strike.facing * Math.atan(1 / BEAM.slope);

    const spin = phase === 'deploy' ? 9 : phase === 'lock' ? 16 : 5;
    this.halo[0].rotation.z += spin * dt;
    this.halo[1].rotation.z -= spin * dt * 1.4;
    const charge = phase === 'deploy' ? t * 0.3
      : phase === 'lock' ? 0.3 + t * 0.7
        : phase === 'fire' ? 1 : 1 - t;
    for (const [i, ring] of this.halo.entries()) {
      ring.material.opacity = (0.3 + charge * 0.7) * (i ? 0.7 : 1);
      ring.material.color.copy(AMBER).lerp(RED, charge);
    }
    this.lens.position.set(strike.facing * 0.16, -0.1, 0.14);
    this.lens.material.opacity = Math.min(1, charge * 1.3);
    this.lens.material.color.copy(AMBER).lerp(WHITE, Math.max(0, charge - 0.5) * 2);
    this.lens.scale.setScalar(0.5 + charge * 0.9);
    this.fill.intensity = this.lit() ? rig.scale.x * (1.6 + charge * 1.4) : 0;
  }

  // Aim, stretch and tint the three coaxial tubes plus the authored card.
  drawBeam(muzzle, floor, width, glowWidth, color, opacity) {
    const length = muzzle.distanceTo(floor);
    this.beam.visible = true;
    this.beam.position.copy(muzzle).lerp(floor, 0.5);
    this.beam.lookAt(floor);
    this.beam.scale.set(1, 1, length);

    this.core.scale.set(width, width, 1);
    this.core.material.opacity = 0.9 * opacity;
    this.sheath.scale.set(glowWidth * 1.6, glowWidth * 1.6, 1);
    this.sheath.material.color.copy(color);
    this.sheath.material.opacity = 0.32 * opacity;
    this.bloomTube.scale.set(glowWidth * 2.6, glowWidth * 2.6, 1);
    this.bloomTube.material.color.copy(color);
    this.bloomTube.material.opacity = 0.05 * opacity * (this.reducedMotion ? 0.4 : 1);

    if (!this.card) return;
    this.card.visible = opacity > 0.05;
    // Metres across, now that the loader normalised the card to a unit.
    this.card.scale.x = this.card.scale.y = glowWidth * 0.34;
    this.card.rotation.z = this.time * 3.4;            // roll the cross-quad
    this.card.traverse(node => {
      if (!node.isMesh) return;
      node.material.opacity = opacity * 0.5;
      // Scroll the emissive along the shot so the beam has flow, not just glow.
      for (const map of [node.material.map, node.material.emissiveMap]) {
        if (map) map.offset.y = (-this.time * 2.6) % 1;
      }
    });
  }

  // Scorch, embers and a burn line dragged along behind the contact. The trail
  // is what makes the sweep feel like it happened: the beam is gone in seven
  // tenths of a second, and the mark on the ice is the only evidence left.
  burnFloor(x, facing) {
    const step = 0.22;
    if (this.scorchedTo === null) this.scorchedTo = x - facing * step;
    let guard = 0;
    while ((x - this.scorchedTo) * facing > step && guard < 60) {
      this.scorchedTo += facing * step;
      guard += 1;
      this.stage?.scorch?.(this.scorchedTo, 0, 0.34);
      if (this.reducedMotion || !this.vfx) continue;
      for (let i = 0; i < this.vfx.scaled(5); i += 1) {
        const angle = Math.random() * Math.PI;
        this.vfx.particle({
          x: this.scorchedTo, y: 0.05, z: (Math.random() - 0.5) * 0.55,
          vx: Math.cos(angle) * 2.4 - facing * 1.6, vy: 1.8 + Math.random() * 5.2,
          vz: (Math.random() - 0.5) * 2.6,
          size: 0.03 + Math.random() * 0.07, life: 0.24 + Math.random() * 0.4,
          color: Math.random() < 0.6 ? WHITE : RED, gravity: 8.5, kind: 'spark', drag: 0.6,
        });
      }
    }
  }

  clear() {
    this.root.visible = false;
    this.beam.visible = false;
    this.light.intensity = 0;
    this.scorchedTo = null;
    this.setContact(0, 0);
    this.reticle.material.opacity = 0;
  }

  // Two real lights are two extra passes over every lit thing on screen. That
  // is a fair price on a desktop and not one on the quality tier that already
  // gave up shadows and bloom, so the strike falls back to its own additive
  // geometry there -- dimmer, but not a different effect.
  lit() {
    return !this.reducedMotion && this.quality >= 1;
  }

  setContact(heat, size) {
    this.contact.material.opacity = heat;
    this.contact.scale.setScalar(Math.max(0.001, size));
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse(node => {
      node.geometry?.dispose?.();
      if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
      else node.material?.dispose?.();
    });
  }
}
