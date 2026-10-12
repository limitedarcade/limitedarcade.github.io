import * as THREE from '../vendor/three.module.js';
import { ORGANS } from './goreAtlas.js';
import { loadScenePack } from './scenePack.js';

// Everything that leaves a body and stays on the floor.
//
// Two kinds of debris share one pool because they share one lifecycle: a limb,
// which is real geometry lifted out of the fighter at the moment it was cut,
// and an organ, which is a generated blob. Both fly ballistically, both land,
// both stay for the rest of the round, and both are recycled by the same cap --
// which is the only thing standing between a five-round match and a scene graph
// with four hundred meshes in it.
const GRAVITY = 17.0;
const FLOOR = 0.02;
const MAX_PIECES = 46;

const spin = new THREE.Vector3();
const toCamera = new THREE.Vector3();
const floorBounds = new THREE.Box3();

// The fallback blob, used until the viscera library has loaded and for any prop
// the library does not carry. `span` is the longest axis, so a round organ gets
// half of it as a radius and a strand divides by the stretch as well -- which
// keeps a generated piece exactly the size of the real mesh it stands in for.
function organGeometry(kind) {
  const spec = ORGANS[kind] || ORGANS.guts;
  const radius = spec.strand ? spec.span / (2 * 2.6) : spec.span / 2;
  const geometry = new THREE.IcosahedronGeometry(radius, spec.strand ? 2 : 1);
  const position = geometry.attributes.position;
  const noise = (x, y, z) => Math.sin(x * 9.1 + y * 4.7) * Math.cos(z * 7.3 + x * 2.2);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const lump = 1 + noise(x, y, z) * (spec.strand ? 0.16 : 0.34);
    // Strands are stretched along one axis so intestine reads as rope rather
    // than as another lump, without needing a second geometry path.
    position.setXYZ(i, x * lump, y * lump * (spec.strand ? 2.6 : 0.82), z * lump);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function organMaterial(kind) {
  const spec = ORGANS[kind] || ORGANS.guts;
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.24, 0.018, 0.026).lerp(new THREE.Color(0.42, 0.10, 0.09), 1 - spec.wet),
    roughness: 0.26 - spec.wet * 0.14,
    metalness: 0.0,
    emissive: new THREE.Color(0.05, 0.002, 0.004),
  });
}

// Where the baked prop library lives, relative to the site base. Built from the
// source art by tools/build-gore-props.mjs; see goreAtlas.js PROP_SOURCES.
// Packed from gore/viscera.json by the asset pipeline (tools/asset-pipeline.json).
const VISCERA_URL = 'gore/viscera.bin';
const CUT_SURFACES_URL = 'gore/cut-surfaces.bin';

export class GoreDebris {
  constructor(scene, { stage = null, assetBase = '' } = {}) {
    this.scene = scene;
    this.stage = stage;
    this.assetBase = assetBase;
    // Real geometry, keyed by organ id, once the library has loaded. Until then
    // -- and in a headless test, which never loads it -- every lookup falls
    // through to the procedural blob, so the system is never blocked on art.
    this.library = new Map();
    this.libraryMaterials = new Map();
    this.root = new THREE.Group();
    this.root.name = 'goreDebris';
    this.root.renderOrder = 2;
    scene.add(this.root);
    this.pieces = [];
    this.organGeometries = new Map();
    this.organMaterials = new Map();
    this.surfaceMaterials = new Map();
    this.owned = new Set();
  }

  // Fetch the baked viscera. Resolves either way: a missing or broken library is
  // a downgrade to procedural blobs, never a failed match.
  async load() {
    if (this.ready) return this.ready;
    this.ready = Promise.all([VISCERA_URL, CUT_SURFACES_URL].map(async path => { try {
      const url = new URL(`${this.assetBase}${path}`, location.href).href;
      const group = await loadScenePack(url);
      for (const child of group.children) {
        if (!child.isMesh || !child.name) continue;
        this.library.set(child.name, child.geometry);
        this.libraryMaterials.set(child.name, child.material);
      }
    } catch (error) {
      console.warn(`Gore library ${path} unavailable, using generated props.`, error);
    } })).then(() => this.library.size);
    return this.ready;
  }

  geometryFor(kind) {
    const real = this.library.get(kind);
    if (real) return real;
    if (!this.organGeometries.has(kind)) this.organGeometries.set(kind, organGeometry(kind));
    return this.organGeometries.get(kind);
  }

  materialFor(kind) {
    const real = this.libraryMaterials.get(kind);
    if (real) return real;
    if (!this.organMaterials.has(kind)) this.organMaterials.set(kind, organMaterial(kind));
    return this.organMaterials.get(kind);
  }

  surfaceMaterialFor(source, colored) {
    const key = `${source.uuid}:${colored}`;
    if (this.surfaceMaterials.has(key)) return this.surfaceMaterials.get(key);
    const material = new THREE.MeshStandardMaterial({
      map: source.map || null, color: source.color?.clone?.() || new THREE.Color(0xffffff),
      alphaMap: source.alphaMap || null, normalMap: source.normalMap || null,
      normalScale: source.normalScale?.clone?.() || new THREE.Vector2(1, 1),
      roughnessMap: source.roughnessMap || null, metalnessMap: source.metalnessMap || null,
      roughness: Math.max(.55, source.roughness ?? .85), metalness: Math.min(.15, source.metalness ?? 0),
      vertexColors: colored && !source.map, side: THREE.DoubleSide,
      transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest,
    });
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
        '#include <lights_fragment_end>\n'
        + 'totalEmissiveRadiance += max(diffuseColor.rgb, vec3(0.04, 0.05, 0.08)) * 0.22;');
    };
    material.customProgramCacheKey = () => 'cinematic-surface-v2';
    this.surfaceMaterials.set(key, material);
    return material;
  }

  // Compile future detached surfaces before the fight. These probes borrow
  // source buffers and cached materials; they never enter the debris pool.
  warmupMeshes(views) {
    const probes = new THREE.Group(); probes.visible = false;
    for (const view of views) {
      for (const record of view.damage?.meshes || []) {
        const materials = (Array.isArray(record.mesh.material) ? record.mesh.material : [record.mesh.material])
          .map(material => this.surfaceMaterialFor(material, Boolean(record.geometry.attributes.color)));
        const mesh = new THREE.Mesh(record.geometry, materials.length === 1 ? materials[0] : materials);
        probes.add(mesh);
      }
      const flesh = view.gore?.flesh;
      if (flesh) for (const material of [flesh.meat, flesh.boneMat]) {
        const geometry = view.damage.meshes.find(r => r.geometry.attributes.color)?.geometry;
        if (geometry) probes.add(new THREE.Mesh(geometry, material));
      }
    }
    return probes;
  }

  // Keep the pool bounded by retiring whatever landed longest ago -- never the
  // piece that is still in the air, because a limb vanishing mid-arc is the one
  // failure the player is guaranteed to be looking straight at.
  reclaim() {
    if (this.pieces.length < MAX_PIECES) return;
    let oldest = -1, bestAge = -Infinity;
    for (let i = 0; i < this.pieces.length; i++) {
      const piece = this.pieces[i];
      if (!piece.settled || piece.scripted) continue;
      if (piece.age > bestAge) { bestAge = piece.age; oldest = i; }
    }
    if (oldest < 0) oldest = this.pieces.findIndex(piece => !piece.scripted);
    if (oldest < 0) return;
    this.retire(this.pieces[oldest]);
    this.pieces.splice(oldest, 1);
  }

  retire(piece) {
    this.root.remove(piece.mesh);
    piece.mesh.traverse(node => {
      if (this.owned.has(node.geometry)) { node.geometry.dispose(); this.owned.delete(node.geometry); }
      for (const material of Array.isArray(node.material) ? node.material : [node.material])
        if (this.owned.has(material)) { material.dispose(); this.owned.delete(material); }
    });
  }

  add(mesh, { velocity, mass = 1, wet = 1, strand = false, pulse = false, transient = false }) {
    this.reclaim();
    this.root.add(mesh);
    const piece = {
      mesh, mass, wet, strand, pulse, transient, age: 0, settled: false, bled: 0, bounced: false,
      baseScale: mesh.scale.x,
      velocity: velocity.clone(),
      spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 14),
    };
    this.pieces.push(piece);
    return piece;
  }

  // A severed limb, built from the vertices the body just discarded. It is the
  // same silhouette that was attached a frame ago, which is the whole reason it
  // is worth lifting real geometry instead of throwing a generic lump.
  addLimb(positions, origin, velocity, { mass = 1 } = {}) {
    if (positions.length < 48) return null;
    const count = Math.floor(positions.length / 4);
    const array = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      array[i * 3] = positions[i * 4] - origin.x;
      array[i * 3 + 1] = positions[i * 4 + 1] - origin.y;
      array[i * 3 + 2] = positions[i * 4 + 2] - origin.z;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(array, 3));
    geometry.computeBoundingSphere();
    // The removed vertices are a point cloud, not a surface: the triangles they
    // belonged to are still indexed against the body. Rendering them as dense
    // points reads as wet tissue in motion and costs nothing to build, which is
    // the right trade for something on screen for under a second before it
    // lands and gets buried in its own puddle.
    const material = new THREE.PointsMaterial({
      color: new THREE.Color(0.46, 0.05, 0.055), size: 0.042, sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.position.copy(origin);
    this.owned.add(geometry);
    this.owned.add(material);
    // The spray is a flight effect, not a floor prop. Settled, a point cloud
    // turned to face the camera reads as a flat pink rectangle -- so it fades
    // out shortly after landing and leaves behind what actually belongs there:
    // its blood stain, and the real severed chunk the atlas spilled alongside.
    return this.add(points, { velocity, mass, wet: 1, transient: true });
  }

  // Bake the selected triangles in the current world pose. UVs and vertex
  // colours survive, so a uniform sleeve and glove remain recognisable on ice.
  addSurfaceLimb({ record, positions }, origin, velocity, { mass = 1 } = {}) {
    const sourceGeometry = record.geometry;
    if (positions.length / 4 === sourceGeometry.attributes.position.count) {
      // A complete authored part (head, helmet, etc.) already has its final
      // topology. Bake the pose into its indexed surface instead of clipping
      // and duplicating every triangle through Maps on the impact frame.
      const geometry = new THREE.BufferGeometry();
      const array = new Float32Array(sourceGeometry.attributes.position.count * 3);
      for (let i = 0; i < positions.length; i += 4) {
        const at = positions[i + 3] * 3;
        array[at] = positions[i] - origin.x; array[at + 1] = positions[i + 1] - origin.y; array[at + 2] = positions[i + 2] - origin.z;
      }
      geometry.setAttribute('position', new THREE.BufferAttribute(array, 3));
      if (sourceGeometry.index) geometry.setIndex(sourceGeometry.index.clone());
      geometry.groups = sourceGeometry.groups.map(g => ({ ...g }));
      for (const name of ['uv', 'color']) if (sourceGeometry.attributes[name]) geometry.setAttribute(name, sourceGeometry.attributes[name].clone());
      const color = geometry.attributes.color;
      if (color) for (let i = 0; i < color.count; i++) {
        let r = color.getX(i), g = color.getY(i), b = color.getZ(i);
        const luma = .2126 * r + .7152 * g + .0722 * b;
        if (luma < .08) { const t = (.08 - luma) / .08; r += (.14 - r) * t; g += (.18 - g) * t; b += (.32 - b) * t; }
        color.setXYZ(i, r, g, b);
      }
      geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const materials = (Array.isArray(record.mesh.material) ? record.mesh.material : [record.mesh.material])
        .map(material => this.surfaceMaterialFor(material, Boolean(color)));
      const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
      mesh.position.copy(origin); mesh.castShadow = true; this.owned.add(geometry);
      return this.add(mesh, { velocity, mass, wet: 1 });
    }
    const source = record.geometry, selected = new Map();
    for (let i = 0; i < positions.length; i += 4)
      selected.set(positions[i + 3], positions.slice(i, i + 3));
    const buckets = new Map(), count = source.index?.count ?? source.attributes.position.count;
    const interpolated = new Map(), intersections = new Map();
    const worldVertex = id => {
      if (selected.has(id)) return new THREE.Vector3().fromArray(selected.get(id));
      return record.mesh.getVertexPosition(id, new THREE.Vector3()).applyMatrix4(record.mesh.matrixWorld);
    };
    const intersection = (a, b, va, vb) => {
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (intersections.has(key)) return intersections.get(key);
      const t = (.5 - va) / (vb - va), id = -intersections.size - 1;
      selected.set(id, worldVertex(a).lerp(worldVertex(b), t).toArray());
      const attributes = {};
      for (const name of ['uv', 'color']) {
        const attr = source.attributes[name];
        if (attr) attributes[name] = Array.from({ length: attr.itemSize }, (_, j) => {
          const av = attr.array[a * attr.itemSize + j], bv = attr.array[b * attr.itemSize + j];
          return av + (bv - av) * t;
        });
      }
      interpolated.set(id, attributes); intersections.set(key, id); return id;
    };
    for (let i = 0; i < count; i += 3) {
      const ids = [0, 1, 2].map(j => source.index ? source.index.getX(i + j) : i + j);
      if (!ids.some(id => selected.has(id))) continue;
      // Already severed regions must never be collected a second time.
      if (ids.some(id => !selected.has(id) && record.sever?.array[id] > .5)) continue;
      const polygon = [];
      for (let j = 0; j < 3; j++) {
        const a = ids[(j + 2) % 3], b = ids[j];
        const va = record.sever?.array[a] ?? (selected.has(a) ? 1 : 0);
        const vb = record.sever?.array[b] ?? (selected.has(b) ? 1 : 0);
        if ((va > .5) !== (vb > .5)) polygon.push(intersection(a, b, va, vb));
        if (vb > .5) polygon.push(b);
      }
      if (polygon.length < 3) continue;
      const material = source.groups.find(g => i >= g.start && i < g.start + g.count)?.materialIndex ?? 0;
      if (!buckets.has(material)) buckets.set(material, []);
      for (let j = 1; j < polygon.length - 1; j++) buckets.get(material).push(polygon[0], polygon[j], polygon[j + 1]);
    }
    if (!buckets.size) return null;
    const geometry = new THREE.BufferGeometry(), vertices = [], uvs = [], colors = [];
    for (const [material, ids] of buckets) {
      const start = vertices.length / 3;
      for (const id of ids) {
        const p = selected.get(id);
        vertices.push(p[0] - origin.x, p[1] - origin.y, p[2] - origin.z);
        const uv = source.attributes.uv, color = source.attributes.color;
        if (uv) uvs.push(...(interpolated.get(id)?.uv || [uv.getX(id), uv.getY(id)]));
        if (color) {
          // Trump's suit is authored as near-black vertex colour. On the body the
          // stage keys still lift it; on the ice the low slapshot light leaves
          // only the skin/hand verts readable, so the limb reads as red scraps.
          let [r, g, b] = interpolated.get(id)?.color || [color.getX(id), color.getY(id), color.getZ(id)];
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (luma < 0.08) {
            const t = (0.08 - luma) / 0.08;
            r += (0.14 - r) * t;
            g += (0.18 - g) * t;
            b += (0.32 - b) * t;
          }
          colors.push(r, g, b);
        }
      }
      geometry.addGroup(start, ids.length, material);
    }
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    if (uvs.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (colors.length) geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    // Fresh materials, not clones of the fighter's battle/sever shader. Cloned
    // onBeforeCompile still samples severMask/battleDamage, which this geometry
    // does not carry. The small unlit fill is applied from diffuseColor after
    // maps and vertex colours, so dark limbs remain readable on the ice without
    // a uniform white emissive term bleaching skin or blooming over the arms.
    const materials = (Array.isArray(record.mesh.material) ? record.mesh.material : [record.mesh.material])
      .map(material => this.surfaceMaterialFor(material, Boolean(geometry.attributes.color)));
    const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
    mesh.position.copy(origin); mesh.castShadow = true;
    this.owned.add(geometry);
    return this.add(mesh, { velocity, mass, wet: 1 });
  }

  addOrgan(kind, origin, velocity) {
    const spec = ORGANS[kind] || ORGANS.guts;
    const mesh = new THREE.Mesh(this.geometryFor(kind), this.materialFor(kind));
    mesh.position.copy(origin);
    mesh.castShadow = true;
    // A little variance so two hearts from two rounds are not the same object
    // twice, and a random start orientation so nothing spawns axis-aligned.
    mesh.scale.setScalar(0.85 + Math.random() * 0.35);
    mesh.rotation.set(Math.random() * 6.283, Math.random() * 6.283, Math.random() * 6.283);
    return this.add(mesh, { velocity, mass: spec.mass, wet: spec.wet, strand: spec.strand, pulse: spec.pulse });
  }

  update(dt, camera = null) {
    if (dt <= 0) return;
    for (const piece of this.pieces) {
      if (piece.scripted) continue;
      piece.age += dt;
      if (piece.settled) {
        if (piece.transient) {
          const fade = 1 - Math.max(0, piece.age - 0.7) / 0.8;
          if (fade <= 0) { piece.done = true; continue; }
          piece.mesh.material.opacity = Math.min(1, fade);
          piece.mesh.material.transparent = true;
          continue;
        }
        // A heart keeps going for a while after it is out. It is a small thing
        // that makes the floor feel alive rather than decorated.
        if (piece.pulse && piece.age < 9) {
          const beat = 1 + Math.sin(piece.age * 7.4) * 0.09 * Math.max(0, 1 - piece.age / 9);
          piece.mesh.scale.setScalar(piece.baseScale * beat);
        }
        continue;
      }
      piece.velocity.y -= GRAVITY * dt * (0.55 + piece.mass * 0.3);
      piece.mesh.position.addScaledVector(piece.velocity, dt);
      spin.copy(piece.spin).multiplyScalar(dt);
      piece.mesh.rotation.x += spin.x; piece.mesh.rotation.y += spin.y; piece.mesh.rotation.z += spin.z;

      // Bleeding in flight. A limb that only stains where it lands leaves a
      // clean floor between the body and the piece, which is the tell that the
      // two events are unrelated.
      piece.bled += dt;
      if (piece.bled > 0.045 && piece.wet > 0.3) {
        piece.bled = 0;
        this.stage?.splatBlood(piece.mesh.position.x, piece.mesh.position.z, 0.05 + piece.mass * 0.05, 1.4);
      }

      piece.mesh.updateWorldMatrix(true, false);
      floorBounds.setFromObject(piece.mesh);
      if (floorBounds.min.y <= FLOOR) {
        piece.mesh.position.y += FLOOR - floorBounds.min.y;
        // A boot or a rotating long limb can start against the floor. Clear
        // that penetration while it is rising; settling here cancelled the
        // launch and left detached limbs standing inside the body.
        if (piece.velocity.y > 0) continue;
        // One bounce, heavily damped, then it stays. Debris that skitters is
        // distracting during a round it is not part of any more.
        if (piece.velocity.y < -2.2 && !piece.bounced) {
          piece.bounced = true;
          piece.velocity.y *= -0.24;
          piece.velocity.x *= 0.5; piece.velocity.z *= 0.5;
          piece.spin.multiplyScalar(0.4);
        } else {
          piece.settled = true;
          piece.age = 0;
          piece.velocity.set(0, 0, 0);
          piece.mesh.rotation.x = Math.PI / 2 * (piece.strand ? 1 : 0.35 + Math.random() * 0.4);
          piece.mesh.updateWorldMatrix(true, false);
          floorBounds.setFromObject(piece.mesh);
          piece.mesh.position.y += FLOOR - floorBounds.min.y;
          this.stage?.splatBlood(piece.mesh.position.x, piece.mesh.position.z, 0.20 + piece.mass * 0.22, 4);
        }
      }
    }
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      if (!this.pieces[i].done) continue;
      this.retire(this.pieces[i]);
      this.pieces.splice(i, 1);
    }
    // Point clouds have no thickness, so a limb seen edge-on would disappear.
    // Facing them at the camera keeps the spray readable while it is in flight.
    if (camera) {
      camera.getWorldPosition(toCamera);
      for (const piece of this.pieces) if (piece.mesh.isPoints) piece.mesh.lookAt(toCamera);
    }
  }

  // Debris is per-round, like the blood on the fighters and the stains on the
  // floor. A new round starts on a clean stage.
  resetRound() {
    for (const piece of this.pieces) this.retire(piece);
    this.pieces.length = 0;
  }

  dispose() {
    this.resetRound();
    for (const geometry of this.organGeometries.values()) geometry.dispose();
    for (const material of this.organMaterials.values()) material.dispose();
    for (const geometry of this.library.values()) geometry.dispose();
    for (const material of this.libraryMaterials.values()) material.dispose();
    for (const material of this.surfaceMaterials.values()) material.dispose();
    this.organGeometries.clear(); this.organMaterials.clear();
    this.library.clear(); this.libraryMaterials.clear();
    this.surfaceMaterials.clear();
    this.scene.remove(this.root);
  }
}
