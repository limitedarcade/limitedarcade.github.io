import * as THREE from '../vendor/three.module.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { VFX_PRESETS } from './vfxPresets.js';

const clamp = THREE.MathUtils.clamp;
const number = (value, fallback, min, max) => Number.isFinite(value) ? clamp(value, min, max) : fallback;
const vector = (value, fallback) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? [...value] : [...fallback];
const smooth = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// Object3D.clone shares Skeleton.bones. The shield has a skeleton even though
// it has no animation, so remap every bone to the instance's own hierarchy.
function cloneRig(source) {
  const root = source.clone(true), copies = new Map();
  const pair = (a, b) => { copies.set(a, b); a.children.forEach((child, i) => pair(child, b.children[i])); };
  pair(source, root);
  source.traverse(original => {
    if (!original.isSkinnedMesh) return;
    const mesh = copies.get(original);
    mesh.skeleton = original.skeleton.clone();
    mesh.skeleton.bones = original.skeleton.bones.map(bone => copies.get(bone));
    if (mesh.skeleton.bones.some(bone => !bone)) throw new Error('VFX skeleton has a bone outside its scene');
    mesh.bind(mesh.skeleton, original.bindMatrix);
  });
  return root;
}

// Use the union of the animation, not its frequently invisible first frame.
// A separate parent normalizes the export; animation tracks keep their local
// coordinate system and cannot overwrite the instance's position or scale.
function animationBounds(gltf) {
  const root = gltf.scene, box = new THREE.Box3().setFromObject(root);
  const mixer = new THREE.AnimationMixer(root);
  for (const clip of gltf.animations || []) {
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true; action.play();
    for (let i = 0; i <= 32; i++) {
      mixer.setTime(clip.duration * i / 32);
      root.updateMatrixWorld(true);
      box.union(new THREE.Box3().setFromObject(root));
    }
    action.stop();
  }
  mixer.uncacheRoot(root); root.updateMatrixWorld(true);
  const size = box.getSize(new THREE.Vector3()), extent = Math.max(size.x, size.y, size.z);
  if (box.isEmpty() || !Number.isFinite(extent) || extent <= 0) throw new Error('VFX asset has no usable bounds');
  return { center: box.getCenter(new THREE.Vector3()), extent };
}

function effectMaterial(source, preset) {
  const parameters = {
    // Base colour carries glTF transparency; emissive maps often omit alpha.
    map: source.map || source.emissiveMap || null, alphaMap: source.alphaMap || null,
    transparent: true, opacity: source.opacity, side: preset.additive ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: false, depthTest: true, toneMapped: !preset.additive,
    blending: preset.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  };
  // Solid fire geometry needs surface shading to retain its sculpted layers.
  // Textured cards stay unlit so a stage's key light cannot wash them out.
  const material = preset.additive ? new THREE.MeshBasicMaterial(parameters)
    : new THREE.MeshStandardMaterial({ ...parameters, roughness: 0.42, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0.28 });
  // Convert the texture's colour to brightness before tinting. Blue fire and
  // red shields must not multiply a baked orange/cyan texture into black.
  material.onBeforeCompile = shader => {
    const emission = source.emissiveMap && material.map;
    if (emission) {
      shader.uniforms.vfxEmission = { value: source.emissiveMap };
      shader.fragmentShader = 'uniform sampler2D vfxEmission;\n' + shader.fragmentShader;
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      #ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D(map, vMapUv);
        vec3 effectLight = sampledDiffuseColor.rgb;
        ${emission ? 'effectLight = max(effectLight, texture2D(vfxEmission, vMapUv).rgb);' : ''}
        sampledDiffuseColor.rgb = vec3(max(effectLight.r, max(effectLight.g, effectLight.b)));
        diffuseColor *= sampledDiffuseColor;
      #endif
    `);
  };
  material.customProgramCacheKey = () => `vfx-brightness-v2-${Boolean(source.emissiveMap && material.map)}`;
  const color = source.color || new THREE.Color(1, 1, 1);
  // Preserve the fireball's two-tone geometry without baking in its hue.
  material.userData.vfxLuminance = material.map ? 1 : clamp(0.45 + color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722, 0.45, 1);
  material.userData.vfxOpacity = source.opacity ?? 1;
  return material;
}

function disposeTemplate(gltf) {
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  gltf.scene.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    if (node.skeleton) skeletons.add(node.skeleton);
    for (const m of node.material ? [].concat(node.material) : []) materials.add(m);
  });
  for (const m of materials) for (const value of Object.values(m)) if (value?.isTexture) textures.add(value);
  for (const item of [...geometries, ...materials, ...textures, ...skeletons]) item.dispose();
}

export class ModelVfx {
  constructor(scene, { assetBase = import.meta.env?.BASE_URL || '/', quality = 1,
    reducedMotion = false, loader = new GLTFLoader(), presets = VFX_PRESETS, maxActive = 12, maxPerAsset = 4 } = {}) {
    this.scene = scene; this.assetBase = assetBase; this.quality = quality; this.reducedMotion = reducedMotion;
    this.loader = loader; this.presets = presets; this.maxActive = maxActive; this.maxPerAsset = maxPerAsset;
    this.templates = new Map(); this.pending = new Map(); this.errors = new Map();
    this.free = new Map(); this.active = new Set(); this.disposed = false;
  }

  // Failed loads are recorded, never thrown into combat. A later explicit
  // preload retries; a missed contact is never replayed after a slow download.
  async preload(ids = Object.keys(this.presets)) {
    if (this.disposed) return [];
    return Promise.all(ids.map(id => {
      if (this.templates.has(id)) return true;
      if (this.pending.has(id)) return this.pending.get(id);
      const preset = this.presets[id];
      if (!preset) return false;
      const promise = Promise.resolve().then(() => this.loader.loadAsync(`${this.assetBase.replace(/\/?$/, '/')}${preset.asset}`))
        .then(gltf => {
          if (this.disposed) { disposeTemplate(gltf); return false; }
          let bounds;
          try { bounds = animationBounds(gltf); } catch (error) { disposeTemplate(gltf); throw error; }
          this.templates.set(id, { gltf, ...bounds });
          try { this.free.set(id, [this.createInstance(id)]); }
          catch (error) { this.templates.delete(id); disposeTemplate(gltf); throw error; }
          this.errors.delete(id);
          return true;
        }).catch(error => { if (!this.disposed) this.errors.set(id, error); return false; })
        .finally(() => this.pending.delete(id));
      this.pending.set(id, promise);
      return promise;
    }));
  }

  createInstance(id) {
    const template = this.templates.get(id), model = cloneRig(template.gltf.scene);
    const root = new THREE.Group(), orientation = new THREE.Group(), normalization = new THREE.Group(), offset = new THREE.Group();
    root.name = `vfx-${id}`; root.visible = false;
    offset.position.copy(template.center).negate(); offset.add(model);
    normalization.scale.setScalar(1 / template.extent); normalization.add(offset);
    orientation.add(normalization); root.add(orientation);
    const materials = new Map();
    model.traverse(node => {
      if (node.isLight || node.isCamera) { node.visible = false; return; }
      if (!node.material) return;
      const copy = source => {
        if (!materials.has(source)) materials.set(source, effectMaterial(source, this.presets[id]));
        return materials.get(source);
      };
      node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
      node.castShadow = node.receiveShadow = false;
      // Animated cards scale from zero; a rest-pose sphere can wrongly cull them.
      node.frustumCulled = false;
    });
    const mixer = new THREE.AnimationMixer(model), clip = template.gltf.animations?.[0];
    const action = clip ? mixer.clipAction(clip) : null;
    if (action) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
    const ownedGeometry = [], instanceMaterials = [...materials.values()];
    if (this.presets[id].rim) {
      // The imported honeycomb is softly masked. A slim perimeter keeps the
      // guard silhouette legible against bright ice without a new light.
      const geometry = new THREE.TorusGeometry(0.46, 0.006, 6, 64);
      const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, toneMapped: false });
      material.userData.vfxOpacity = 0.55; material.userData.vfxLuminance = 1;
      const rim = new THREE.Mesh(geometry, material); rim.position.z = 0.02;
      orientation.add(rim); ownedGeometry.push(geometry); instanceMaterials.push(material);
    }
    return { id, root, orientation, model, materials: instanceMaterials, ownedGeometry, mixer, clip, action, token: 0 };
  }

  spawn(id, options = {}) {
    if (this.disposed || !this.presets[id]) return null;
    if (!this.templates.has(id)) {
      if (!this.errors.has(id)) void this.preload([id]);
      return null;
    }
    const budget = Math.max(0, Math.min(this.maxActive, Math.max(1, Math.floor(this.maxActive * number(this.quality, 1, 0.1, 1) * (this.reducedMotion ? 0.5 : 1)))));
    if (this.active.size >= budget) return null;
    const liveCount = [...this.active].filter(item => item.id === id).length;
    if (liveCount >= this.maxPerAsset) return null;
    const pool = this.free.get(id), item = pool.pop() || this.createInstance(id);
    const preset = { ...this.presets[id], ...options };
    const duration = number(preset.duration, 1, 0.04, 30), speed = number(preset.speed, 1, 0.05, 8);
    item.settings = {
      size: number(preset.size, 1, 0.02, 20), duration, speed,
      delay: number(preset.delay, 0, 0, 30), opacity: number(preset.opacity, 1, 0, 1),
      spin: number(preset.spin, 0, -8, 8), grow: number(preset.grow, 0, 0, 2),
      stretch: vector(preset.stretch, [1, 1, 1]).map(n => clamp(n, 0.02, 20)),
      velocity: vector(preset.velocity, [0, 0, 0]), loop: preset.loop === true,
      fadeIn: number(preset.fadeIn, 0.08, 0, 0.5), fadeOut: number(preset.fadeOut, 0.3, 0.001, 0.8),
      clipStart: number(preset.clipStart, 0, 0, 1), clipEnd: number(preset.clipEnd, 1, 0, 1), manual: preset.manual === true,
    };
    item.age = -item.settings.delay; item.token++;
    item.root.position.set(number(preset.x, 0, -1000, 1000), number(preset.y, 1, -1000, 1000), number(preset.z, 0.35, -1000, 1000));
    item.origin = item.root.position.clone(); item.root.rotation.set(0, 0, 0);
    item.orientation.rotation.fromArray(vector(preset.rotation, this.presets[id].rotation || [0, 0, 0]));
    const tint = new THREE.Color(this.presets[id].color);
    if (typeof preset.color === 'number' || preset.color?.isColor || /^#[0-9a-f]{6}$/i.test(preset.color)) tint.set(preset.color);
    const glow = number(preset.glow, 1, 0, 3);
    for (const m of item.materials) {
      m.color.copy(tint).multiplyScalar(glow * m.userData.vfxLuminance);
      if (m.emissive) m.emissive.copy(m.color);
    }
    item.action?.reset().play();
    this.active.add(item); this.scene.add(item.root); this.pose(item);
    const token = item.token;
    const current = () => item.token === token && this.active.has(item);
    return { id, root: item.root,
      stop: () => { if (current()) this.release(item); },
      setPosition: (x, y, z) => { if (current() && [x, y, z].every(Number.isFinite)) { item.origin.set(x, y, z); this.pose(item); } },
      seek: progress => { if (current() && Number.isFinite(progress)) { item.age = clamp(progress, 0, 1) * duration / speed; this.pose(item); } },
    };
  }

  pose(item) {
    const p = item.settings;
    item.root.visible = item.age >= 0;
    if (item.age < 0) return;
    const elapsed = item.age * p.speed;
    const phase = p.loop ? (elapsed % p.duration) / p.duration : Math.min(1, elapsed / p.duration);
    const envelope = (p.fadeIn === 0 ? 1 : smooth(phase / p.fadeIn)) * smooth((1 - phase) / p.fadeOut);
    const growth = this.reducedMotion ? 1 : 1 - p.grow * (1 - phase);
    item.root.scale.set(...p.stretch.map(n => n * p.size * growth));
    item.root.rotation.z = this.reducedMotion ? 0 : p.spin * elapsed;
    item.root.position.set(item.origin.x + p.velocity[0] * elapsed, item.origin.y + p.velocity[1] * elapsed, item.origin.z + p.velocity[2] * elapsed);
    for (const m of item.materials) m.opacity = m.userData.vfxOpacity * p.opacity * envelope * (this.reducedMotion ? 0.55 : 1);
    if (item.action) {
      // setTime past a finished LoopOnce action leaves it paused. Resetting
      // permits precise scrubbing and fresh loops without mutating the clip.
      item.action.reset().play();
      item.mixer.setTime((p.clipStart + (p.clipEnd - p.clipStart) * phase) * item.clip.duration);
    }
  }

  update(dt) {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    for (const item of this.active) {
      if (!item.settings.manual) item.age += dt;
      if (!item.settings.loop && item.age * item.settings.speed >= item.settings.duration) this.release(item);
      else this.pose(item);
    }
  }

  release(item) {
    if (!this.active.delete(item)) return;
    item.root.removeFromParent(); item.root.visible = false; item.action?.stop();
    this.free.get(item.id).push(item);
  }

  clear() { for (const item of this.active) this.release(item); }

  get stats() {
    return { active: this.active.size, pooled: [...this.free.values()].reduce((sum, pool) => sum + pool.length, 0),
      loaded: this.templates.size, failed: this.errors.size };
  }

  dispose() {
    if (this.disposed) return;
    this.clear(); this.disposed = true;
    for (const pool of this.free.values()) for (const item of pool) {
      item.mixer.uncacheRoot(item.model);
      item.materials.forEach(m => m.dispose());
      item.ownedGeometry.forEach(g => g.dispose());
      const skeletons = new Set(); item.model.traverse(node => { if (node.skeleton) skeletons.add(node.skeleton); });
      for (const skeleton of skeletons) skeleton.dispose();
    }
    for (const { gltf } of this.templates.values()) disposeTemplate(gltf);
    this.free.clear(); this.templates.clear(); this.errors.clear();
  }
}
