import * as THREE from '../vendor/three.module.js';
import { ColdCutIce, ARM_BEATS } from './coldCutIce.js';
import { CinematicGrip } from './cinematicGrip.js';

const UP = new THREE.Vector3(0, 1, 0);
// A bounded, reusable cinematic prop. World-space aiming starts at the posed
// hand; neither the prop nor its effects can move a simulation hitbox.
export class ConfidenceProps {
  constructor(scene) {
    this.root = new THREE.Group(); scene.add(this.root);
    this.ice = new ColdCutIce(this.root);
    this.grip = new CinematicGrip();
    this.stick = new THREE.Group(); this.root.add(this.stick);
    const carbon = new THREE.MeshStandardMaterial({ color: 0x151b26, roughness: 0.35, metalness: 0.6 });
    const tape = new THREE.MeshStandardMaterial({ color: 0xf4e9cf, roughness: 0.85 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xffbb31, emissive: 0xe45704, emissiveIntensity: 0.35, metalness: 0.5, roughness: 0.3 });
    const box = (x,y,z, material, px,py,pz = 0) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(x,y,z), material);
      mesh.position.set(px,py,pz); mesh.castShadow = true; this.stick.add(mesh); return mesh;
    };
    box(0.035, 1.45, 0.045, carbon, 0, 0.43);
    box(0.05, 0.25, 0.06, tape, 0, -0.17);
    box(0.32, 0.08, 0.055, gold, 0.12, 1.13).rotation.z = -0.16;
    for (let i=0;i<6;i++) box(0.037,0.013,0.047,tape,0,0.64+i*0.06);
    const glow = new THREE.MeshBasicMaterial({ color: 0xffd271, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.arc = new THREE.Mesh(new THREE.RingGeometry(0.65, 0.9, 48, 1, -0.6, 2.5), glow);
    this.root.add(this.arc);
    this.flash = new THREE.PointLight(0xffb444, 0, 5); this.root.add(this.flash);
    this.key = new THREE.PointLight(0xffe3c2, 18, 8, 2); this.root.add(this.key);
    this.hand = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.root.visible = false;
  }
  update(snapshot, views, frame, reducedMotion = false) {
    const finish = snapshot.finisher;
    this.root.visible = ['cold-cut', 'cold-cut-flock'].includes(finish?.script) && ['finisher', 'matchEnd'].includes(snapshot.phase);
    if (!this.root.visible) return;
    const view = views[finish.attacker];
    const hand = view?.model?.getObjectByName('handR');
    if (!hand) { this.root.visible = false; return; }
    view.root.updateMatrixWorld(true); hand.getWorldPosition(this.hand);
    const x = Math.max(-1.4, Math.min(1.4, finish.originX));
    const facing = finish.facing;
    this.key.position.set(x, 2.7, 2.6);
    if (finish.script === 'cold-cut-flock') {
      this.ice.update(Math.min(frame, 510), x, facing);
      const cutting = frame >= 81 && frame < 124, final = frame >= 372 && frame < 400;
      const slap = frame >= 170 && frame < 285;
      let pulse = 0;
      if (cutting || final) {
        const contact = final ? 391 : frame < 105 ? 100 : 110;
        const phase = THREE.MathUtils.clamp((frame - contact) / 16, -1, 1);
        this.target.set(x + 0.58 * facing, final ? 1.67 : 1.35, -phase * 0.9);
        pulse = Math.max(0, 1 - Math.abs(frame - contact) / 7);
      } else if (slap) {
        const beat = frame < 220 ? ARM_BEATS.leftArm : ARM_BEATS.rightArm;
        const phase = THREE.MathUtils.clamp((frame - beat.hit) / 17, -1, 1);
        this.target.set(x + (beat.x + phase * 0.75) * facing, 0.12 + Math.abs(phase) * 0.85, beat.lane);
        pulse = Math.max(0, 1 - Math.abs(frame - beat.hit) / 6);
      } else this.target.set(this.hand.x - 0.45 * facing, this.hand.y + 1.15, this.hand.z - 0.25);
      this.stick.position.copy(this.hand);
      const direction = this.target.clone().sub(this.hand);
      this.stick.quaternion.setFromUnitVectors(UP, direction.clone().normalize());
      // The blade, 1.13m from the grip, reaches the authored contact plane.
      this.stick.scale.y = THREE.MathUtils.clamp(direction.length() / 1.13, 0.85, 1.65);
      if (frame >= 54 && frame < 400) {
        const gripTarget = this.hand.clone().addScaledVector(direction.clone().normalize(), .28);
        this.grip.apply(view.model, gripTarget, new THREE.Vector3(x - .8 * facing, .75, .6));
      }
      this.arc.position.copy(this.target); this.arc.rotation.set(0, facing * 0.2, -frame * 0.12 * facing);
      this.arc.scale.set(facing, slap ? 0.15 : 0.45, 1);
      this.arc.material.opacity = reducedMotion ? 0 : pulse * 0.55;
      this.flash.position.copy(this.target); this.flash.intensity = reducedMotion ? 0 : pulse * 4;
      return;
    }
    this.stick.scale.y = 1;
    const swingStart = frame >= 192 ? 192 : 102;
    const phase = Math.max(0, Math.min(1, (frame - swingStart) / 40));
    if (frame < 102 || (frame >= 142 && frame < 192)) {
      this.target.set(this.hand.x - 0.5 * facing, this.hand.y + 1.0, this.hand.z - 0.35);
    } else if (frame < 234) {
      this.target.set(x + 0.65 * facing, frame >= 192 ? 1.68 : 1.25, 0.5 - phase);
    } else {
      this.target.set(this.hand.x + 0.4 * facing, this.hand.y + 1.1, this.hand.z);
    }
    this.stick.position.copy(this.hand);
    this.stick.quaternion.setFromUnitVectors(UP, this.target.sub(this.hand).normalize());
    const pulse = Math.max(0, 1 - Math.min(Math.abs(frame-121), Math.abs(frame-218))/10);
    this.arc.position.set(x + 0.12*facing, frame >= 192 ? 1.63 : 1.2, 0.18);
    this.arc.rotation.set(0, 0.2*facing, -phase*1.8*facing);
    this.arc.scale.set(facing, 0.48, 1);
    this.arc.material.opacity = reducedMotion ? 0 : pulse * 0.8;
    this.flash.position.copy(this.arc.position); this.flash.intensity = reducedMotion ? 0 : pulse * 7;
  }
}
