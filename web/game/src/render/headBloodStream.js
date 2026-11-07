import * as THREE from '../vendor/three.module.js';

const SEGMENTS = 32, SIDES = 8, DROPS = 48;
const TAU = Math.PI * 2;

// Analytic, bounded geometry: scrubbing, pause and mirrored finishes all show
// the same stream, without emitting new meshes or fetching assets on impact.
export class HeadBloodStream {
  constructor(parent) {
    this.root = new THREE.Group(); this.root.name = 'Airborne head blood stream';
    this.root.visible = false; parent.add(this.root);
    this.positions = new Float32Array((SEGMENTS + 1) * SIDES * 3);
    const normals = new Float32Array(this.positions.length), colors = new Float32Array(this.positions.length), indices = [];
    for (let ring = 0; ring <= SEGMENTS; ring++) for (let side = 0; side < SIDES; side++) {
      const i = (ring * SIDES + side) * 3, angle = side / SIDES * TAU;
      normals.set([Math.cos(angle), 0, Math.sin(angle)], i);
      const bright = .65 + .35 * Math.sin(angle + ring * .31) ** 2;
      colors.set([bright, bright * .025, bright * .045], i);
      if (ring < SEGMENTS) {
        const a = ring * SIDES + side, b = ring * SIDES + (side + 1) % SIDES;
        indices.push(a, b, a + SIDES, b, b + SIDES, a + SIDES);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setIndex(indices);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 14);
    this.material = new THREE.MeshBasicMaterial({ color: '#bc0c1a', vertexColors: true,
      toneMapped: false, side: THREE.DoubleSide });
    this.tube = new THREE.Mesh(geometry, this.material); this.tube.frustumCulled = false; this.root.add(this.tube);
    this.dropMaterial = this.material.clone(); this.dropMaterial.vertexColors = false;
    this.drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.dropMaterial, DROPS);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.drops.frustumCulled = false;
    this.drops.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 14); this.root.add(this.drops);
    this.point = [0, 0, 0]; this.transform = new THREE.Object3D();
  }

  hide() { this.root.visible = false; }

  update(frame, { sample, radius, land, enabled = true, reducedMotion = false }) {
    this.root.visible = enabled && !reducedMotion && frame > 0 && frame < land;
    if (!this.root.visible) return;
    const fade = Math.min(1, frame / 8, (land - frame) / 18);
    for (let ring = 0; ring <= SEGMENTS; ring++) {
      const u = ring / SEGMENTS;
      sample(Math.max(0, frame - u * Math.min(frame, 24)), this.point);
      const x = this.point[0] + Math.sin(frame * .19 + u * 18) * .055 * u;
      const y = Math.max(.025, this.point[1] - radius + .025 - u * 2.6 - u * u * 1.5);
      const z = this.point[2] + Math.sin(frame * .13 + u * 24) * .05 * u;
      const width = (.042 + Math.sin(frame * .25 - u * 30) * .023) * (1 - u * .86) * fade;
      for (let side = 0; side < SIDES; side++) {
        const angle = side / SIDES * TAU, i = (ring * SIDES + side) * 3;
        this.positions[i] = x + Math.cos(angle) * width;
        this.positions[i + 1] = y;
        this.positions[i + 2] = z + Math.sin(angle) * width;
      }
    }
    this.tube.geometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < DROPS; i++) {
      const seed = ((i * 37) % DROPS) / DROPS;
      const age = ((frame / 60 + seed * .8) % .8);
      const born = frame - age * 60;
      sample(Math.max(0, born), this.point);
      const spread = age * (.18 + seed * .32), angle = i * 2.39996;
      this.transform.position.set(this.point[0] + Math.cos(angle) * spread,
        this.point[1] - radius - age * 3.2 - 6 * age * age,
        this.point[2] + Math.sin(angle) * spread);
      const size = born >= 0 && this.transform.position.y > .03 ? (.005 + seed * .006) * fade : 0;
      this.transform.scale.set(size, size * (1.5 + age * 1.5), size);
      this.transform.updateMatrix(); this.drops.setMatrixAt(i, this.transform.matrix);
    }
    this.drops.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.root.removeFromParent(); this.tube.geometry.dispose(); this.drops.geometry.dispose();
    this.material.dispose(); this.dropMaterial.dispose();
  }
}
