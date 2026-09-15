import * as THREE from '../vendor/three.module.js';
import { ORGANS } from './goreAtlas.js';

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
const VISCERA_URL = 'gore/viscera.json';

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
    this.owned = new Set();
  }

  // Fetch the baked viscera. Resolves either way: a missing or broken library is
  // a downgrade to procedural blobs, never a failed match.
  async load(loader = null) {
    if (this.loaded) return this.library.size;
    this.loaded = true;
    try {
      const url = new URL(`${this.assetBase}${VISCERA_URL}`, location.href).href;
      const response = await fetch(url);
      if (!response.ok) throw Error(`viscera: ${response.status}`);
      const parse = loader || new THREE.ObjectLoader();
      const group = parse.parse(await response.json());
      for (const child of group.children) {
        if (!child.isMesh || !child.name) continue;
        this.library.set(child.name, child.geometry);
        this.libraryMaterials.set(child.name, child.material);
      }
    } catch (error) {
      console.warn('Viscera library unavailable, using generated props.', error);
    }
    return this.library.size;
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
    if (this.owned.has(piece.mesh.geometry)) { piece.mesh.geometry.dispose(); this.owned.delete(piece.mesh.geometry); }
    for (const material of Array.isArray(piece.mesh.material) ? piece.mesh.material : [piece.mesh.material])
      if (this.owned.has(material)) { material.dispose(); this.owned.delete(material); }
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
    const source = record.geometry, selected = new Map();
    for (let i = 0; i < positions.length; i += 4)
      selected.set(positions[i + 3], positions.slice(i, i + 3));
    const buckets = new Map(), count = source.index?.count ?? source.attributes.position.count;
    for (let i = 0; i < count; i += 3) {
      const ids = [0, 1, 2].map(j => source.index ? source.index.getX(i + j) : i + j);
      if (!ids.every(id => selected.has(id))) continue;
      const material = source.groups.find(g => i >= g.start && i < g.start + g.count)?.materialIndex ?? 0;
      if (!buckets.has(material)) buckets.set(material, []);
      buckets.get(material).push(...ids);
    }
    if (!buckets.size) return null;
    const geometry = new THREE.BufferGeometry(), vertices = [], uvs = [], colors = [];
    for (const [material, ids] of buckets) {
      const start = vertices.length / 3;
      for (const id of ids) {
        const p = selected.get(id);
        vertices.push(p[0] - origin.x, p[1] - origin.y, p[2] - origin.z);
        const uv = source.attributes.uv, color = source.attributes.color;
        if (uv) uvs.push(uv.getX(id), uv.getY(id));
        if (color) {
          // Trump's suit is authored as near-black vertex colour. On the body the
          // stage keys still lift it; on the ice the low slapshot light leaves
          // only the skin/hand verts readable, so the limb reads as red scraps.
          let r = color.getX(id), g = color.getY(id), b = color.getZ(id);
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
    const materials = (Array.isArray(record.mesh.material) ? record.mesh.material : [record.mesh.material]).map(sourceMaterial => {
      const material = new THREE.MeshStandardMaterial({
        map: sourceMaterial.map || null,
        color: sourceMaterial.color?.clone?.() || new THREE.Color(0xffffff),
        alphaMap: sourceMaterial.alphaMap || null,
        normalMap: sourceMaterial.normalMap || null,
        normalScale: sourceMaterial.normalScale?.clone?.() || new THREE.Vector2(1, 1),
        roughnessMap: sourceMaterial.roughnessMap || null,
        metalnessMap: sourceMaterial.metalnessMap || null,
        roughness: Math.max(0.55, sourceMaterial.roughness ?? 0.85),
        metalness: Math.min(0.15, sourceMaterial.metalness ?? 0),
        vertexColors: Boolean(geometry.attributes.color) && !sourceMaterial.map,
        side: THREE.DoubleSide,
        transparent: sourceMaterial.transparent,
        opacity: sourceMaterial.opacity,
        alphaTest: sourceMaterial.alphaTest,
      });
      material.onBeforeCompile = shader => {
        shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>',
          '#include <lights_fragment_end>\n'
          + 'totalEmissiveRadiance += max(diffuseColor.rgb, vec3(0.04, 0.05, 0.08)) * 0.22;');
      };
      material.customProgramCacheKey = () => 'cinematic-surface-v2';
      this.owned.add(material); return material;
    });
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
    this.organGeometries.clear(); this.organMaterials.clear();
    this.library.clear(); this.libraryMaterials.clear();
    this.scene.remove(this.root);
  }
}
