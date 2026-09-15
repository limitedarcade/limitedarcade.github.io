import * as THREE from '../vendor/three.module.js';

export class HazardMarker {
  constructor(scene) {
    this.root = new THREE.Group(); this.root.visible = false; scene.add(this.root);
    const material = new THREE.MeshBasicMaterial({ color: 0xffb72d, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), material);
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.028;
    const lines = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.61, 8, 1), material.clone());
    lines.rotation.x = -Math.PI / 2; lines.position.y = 0.029; this.lines = lines;
    this.root.add(this.ring, lines); this.time = 0;
  }
  update(hazard, dt, reducedMotion = false) {
    this.root.visible = Boolean(hazard);
    if (!hazard) return;
    this.time += dt;
    this.root.position.x = hazard.x;
    this.root.scale.setScalar(hazard.radius);
    const urgency = 1 - Math.max(0, Math.min(1, hazard.remaining / 50));
    this.ring.material.color.setHex(urgency > 0.65 ? 0xff4135 : 0xffc63d);
    this.ring.material.opacity = reducedMotion ? 0.75 : 0.55 + Math.sin(this.time * 16) * 0.25;
    this.lines.scale.setScalar(1.5 - urgency * 0.5);
  }
  dispose() { this.root.traverse(n => { n.geometry?.dispose(); n.material?.dispose(); }); this.root.removeFromParent(); }
}
