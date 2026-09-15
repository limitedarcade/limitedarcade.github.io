import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

const READY_GOLD = new THREE.Color('#ffc16a');

// GLTF meshes frequently share materials with other stage props. Give the axe
// its own palette, while retaining the originals for restoration and throws.
function cloneMaterials(root, originals = new Map()) {
  const materials = new Map(), bindings = [];
  root.traverse(object => {
    if (!object.material) return;
    const original = object.material;
    const copy = material => {
      const source = originals.get(material) || material;
      if (!materials.has(source)) materials.set(source, source.clone());
      return materials.get(source);
    };
    object.material = Array.isArray(original) ? original.map(copy) : copy(original);
    bindings.push({ object, original });
  });
  return { materials, bindings };
}

// The exported Empty can have an off-centre origin and transformed ancestors.
// Keep its world orientation and size, then rotate the throw around the actual
// geometry rather than the old pickup location. Geometry/textures stay shared.
function projectileModel(source, originals) {
  source.updateWorldMatrix(true, true);
  const model = source.clone(true);
  source.matrixWorld.decompose(model.position, model.quaternion, model.scale);
  model.position.set(0, 0, 0);
  model.matrixAutoUpdate = true;
  model.visible = true;
  const bounds = new THREE.Box3().setFromObject(model);
  if (!bounds.isEmpty()) model.position.sub(bounds.getCenter(new THREE.Vector3()));
  const appearance = cloneMaterials(model, originals);
  const group = new THREE.Group(); group.add(model);
  return { group, materials: appearance.materials };
}

// All transforms come from simulation frames, including hitstop and pause.
export class WeaponView {
  constructor(scene, stage, { loader = new GLTFLoader() } = {}) {
    this.scene = scene; this.stage = stage; this.models = {}; this.live = new Map();
    this.liveMaterials = new Map(); this.axeStyle = null; this.ringStyle = null; this.time = 0;
    for (const kind of ['shuriken', 'knife', 'hockey']) {
      loader.load(`${import.meta.env?.BASE_URL || '/'}weapons/${kind}.glb`, gltf => {
        const model = new THREE.Group();
        model.add(gltf.scene);
        if (kind === 'shuriken') model.rotation.x = Math.PI / 2;
        if (kind === 'knife') model.rotation.y = -Math.PI / 2;
        if (kind === 'hockey') model.rotation.z = Math.PI;
        model.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3());
        const centre = bounds.getCenter(new THREE.Vector3());
        model.position.sub(centre);
        const group = new THREE.Group(); group.add(model);
        group.scale.setScalar((kind === 'hockey' ? 1.65 : kind === 'knife' ? 0.42 : 0.32) / Math.max(size.x, size.y, size.z));
        this.models[kind] = group;
      }, undefined, error => console.warn(`Weapon ${kind} unavailable`, error));
    }
  }
  update(snapshot, dt = 0) {
    // Stage rebuilds and rounds can reuse projectile IDs. Never carry a clone
    // of disposed stage geometry into the next arena or a new round.
    if (this.stageGroup !== this.stage.group || this.stageGeneration !== this.stage.generation
      || this.stageId !== this.stage.id || this.round !== snapshot.round) {
      this.clear();
      this.stageGroup = this.stage.group; this.stageGeneration = this.stage.generation;
      this.stageId = this.stage.id; this.round = snapshot.round;
    }
    if (snapshot.stageId && this.stage.id && snapshot.stageId !== this.stage.id) {
      this.clear(); return;
    }
    this.time += dt;
    const wanted = new Set();
    const axe = this.stage.group.getObjectByName('lake-america-axe');
    const ring = this.stage.group.getObjectByName('lake-america-rescue-ring');
    if (this.ringStyle?.root !== ring) {
      this.restoreRing();
      if (ring) this.ringStyle = { root: ring, visible: ring.visible, ...cloneMaterials(ring) };
    }
    if (ring) {
      ring.visible = !snapshot.ringUsed;
      const ready = !snapshot.ringUsed && snapshot.ringPrompt?.length;
      const glow = ready ? (this.stage.reducedMotion ? .7 : .65 + Math.sin(this.time * 4.2) * .25) : 0;
      for (const [original, material] of this.ringStyle.materials) {
        if (material.emissive) {
          material.emissive.copy(original.emissive).lerp(READY_GOLD, glow * .36);
          material.emissiveIntensity = original.emissiveIntensity + glow * .7;
        }
      }
    }
    if (this.axeStyle?.root !== axe) {
      this.restoreAxe();
      if (axe) this.axeStyle = { root: axe, visible: axe.visible, ...cloneMaterials(axe) };
    }
    if (axe) {
      axe.visible = !snapshot.axeUsed;
      const ready = !snapshot.axeUsed && snapshot.axePrompt?.length;
      const glow = ready ? (this.stage.reducedMotion ? 0.7 : 0.65 + Math.sin(this.time * 4.2) * 0.25) : 0;
      for (const [original, material] of this.axeStyle.materials) {
        if (material.color) material.color.copy(original.color).lerp(READY_GOLD, glow * 0.24);
        if (material.emissive) {
          material.emissive.copy(original.emissive).lerp(READY_GOLD, glow * 0.36);
          material.emissiveIntensity = original.emissiveIntensity + glow * 0.7;
        }
      }
    }
    const items = [...snapshot.projectiles];
    if (snapshot.phase === 'fight') for (const f of snapshot.fighters) {
      if (f.state !== 'attack' || f.moveData?.weapon !== 'hockey') continue;
      const t = f.moveFrame / (f.moveData.startup + f.moveData.active);
      if (t > 1.15) continue;
      items.push({ id: `hockey-${f.side}`, kind: 'hockey', x: f.x + f.facing * 0.95,
        y: 1.25, facing: f.facing, age: f.moveFrame, angle: f.facing * (1.8 - Math.min(1, t) * 3.2) });
    }
    for (const p of items) {
      wanted.add(p.id);
      let mesh = this.live.get(p.id);
      if (mesh && mesh.userData.weaponKind !== p.kind) { this.remove(p.id); mesh = null; }
      if (!mesh) {
        const source = p.kind === 'axe' ? axe : p.kind === 'rescueRing' ? ring : this.models[p.kind];
        if (!source) continue;
        const style = p.kind === 'axe' ? this.axeStyle : p.kind === 'rescueRing' ? this.ringStyle : null;
        const originals = style
          ? new Map([...style.materials].map(([original, clone]) => [clone, original])) : undefined;
        const projectile = projectileModel(source, originals);
        mesh = projectile.group; mesh.userData.weaponKind = p.kind;
        this.liveMaterials.set(p.id, projectile.materials);
        this.scene.add(mesh); this.live.set(p.id, mesh);
      }
      mesh.position.set(p.x, p.y, 0.25);
      if (p.kind === 'axe') mesh.scale.x = p.facing < 0 ? -1 : 1;
      mesh.rotation.z = p.angle ?? (p.kind === 'knife' ? (p.facing < 0 ? Math.PI : 0) : -p.facing * p.age * 0.35);
    }
    for (const id of this.live.keys()) if (!wanted.has(id)) this.remove(id);
  }
  remove(id) {
    this.scene.remove(this.live.get(id));
    for (const material of this.liveMaterials.get(id)?.values() || []) material.dispose();
    this.liveMaterials.delete(id); this.live.delete(id);
  }
  restoreAxe() {
    if (!this.axeStyle) return;
    const { root, visible, bindings, materials } = this.axeStyle;
    root.visible = visible;
    for (const { object, original } of bindings) object.material = original;
    for (const material of materials.values()) material.dispose();
    this.axeStyle = null;
  }
  clear() {
    for (const id of this.live.keys()) this.remove(id);
    this.restoreAxe();
    this.restoreRing();
  }
  restoreRing() {
    if (!this.ringStyle) return;
    const { root, visible, bindings, materials } = this.ringStyle;
    root.visible = visible;
    for (const { object, original } of bindings) object.material = original;
    for (const material of materials.values()) material.dispose();
    this.ringStyle = null;
  }
}
