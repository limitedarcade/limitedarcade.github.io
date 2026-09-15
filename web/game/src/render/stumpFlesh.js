import * as THREE from '../vendor/three.module.js';

// What is left on the body after a cut.
//
// The skinned surface is a hollow sleeve: discarding the severed vertices
// opens a tube. A meat plug and a lining fill that hole so the stump reads as
// a wound rather than a rendering artefact, and a few hanging strands of
// muscle and tendon swing from the rim so the cut keeps moving after the
// limb has gone.

const Y = new THREE.Vector3(0, 1, 0);
const GRAVITY = 14;
const DAMPING = 0.86;
const MAX_DT = 1 / 20;

const _world = new THREE.Vector3();
const _worldB = new THREE.Vector3();
const _local = new THREE.Vector3();
const _out = new THREE.Vector3();
const _outLocal = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _scale = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _g = new THREE.Vector3();
const _side = new THREE.Vector3();
const _up = new THREE.Vector3();
const _axis = new THREE.Vector3();

const RECIPE = Object.freeze({
  leftArm:  { radius: 0.085, lining: 0.16, hang: 0.28, flaps: 5, tendons: 3 },
  rightArm: { radius: 0.085, lining: 0.16, hang: 0.28, flaps: 5, tendons: 3 },
  leftLeg:  { radius: 0.11,  lining: 0.20, hang: 0.34, flaps: 5, tendons: 4 },
  rightLeg: { radius: 0.11,  lining: 0.20, hang: 0.34, flaps: 5, tendons: 4 },
  jaw:      { radius: 0.048, lining: 0.08, hang: 0.11, flaps: 3, tendons: 2 },
  head:     { radius: 0.08,  lining: 0.14, hang: 0.20, flaps: 4, tendons: 4 },
  torso:    { radius: 0.18,  lining: 0.24, hang: 0.55, flaps: 7, tendons: 5 },
});

function recipeFor(region) {
  return RECIPE[region.id] || RECIPE.leftArm;
}

function hash(x, y = 0, z = 0) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function seedFor(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function rng(seed) {
  let s = (seed * 4294967296 + 1) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function paint(geometry, { light, dark, seed = 1 }) {
  const pos = geometry.attributes.position;
  const color = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = hash(pos.getX(i) * 9 + seed, pos.getY(i) * 9, pos.getZ(i) * 9);
    color[i * 3]     = dark[0] + (light[0] - dark[0]) * t;
    color[i * 3 + 1] = dark[1] + (light[1] - dark[1]) * t;
    color[i * 3 + 2] = dark[2] + (light[2] - dark[2]) * t;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
}

function lump(geometry, { amp = 0.22, seed = 1, taper = 0 } = {}) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = hash(x * 5 + seed, y * 5, z * 5);
    const m = hash(z * 4 + seed, x * 6, y * 3);
    const pull = taper ? 1 - THREE.MathUtils.clamp((y + 0.5) * taper, 0, 0.55) : 1;
    const s = (1 + (n - 0.5) * 2 * amp) * pull;
    pos.setXYZ(i, x * s, y * (1 + (m - 0.5) * amp * 0.6), z * s);
  }
  geometry.computeVertexNormals();
}

function meatMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.32,
    metalness: 0,
    emissive: new THREE.Color(0.045, 0.003, 0.004),
    side: THREE.DoubleSide,
  });
}

function boneMaterial() {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    emissive: new THREE.Color(0.02, 0.012, 0.008),
  });
}

function unitPlug(seed) {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = hash(x * 3 + seed, y * 4, z * 3);
    // Cork: most of the volume sits inside the sleeve, with a torn face
    // pushing a little past the cut so the opening is never a clean disc.
    const along = y * 0.72 + (y > 0 ? 0.18 : -0.55);
    const radial = 1 + (n - 0.5) * 0.38 + Math.max(0, y) * 0.12;
    pos.setXYZ(i, x * radial, along, z * radial);
  }
  lump(geometry, { amp: 0.16, seed: seed + 2 });
  paint(geometry, {
    light: [0.46, 0.055, 0.05],
    dark:  [0.10, 0.008, 0.012],
    seed,
  });
  return geometry;
}

function unitLining(seed) {
  const geometry = new THREE.CylinderGeometry(0.96, 0.72, 1, 12, 4, true);
  lump(geometry, { amp: 0.10, seed, taper: 0.4 });
  paint(geometry, {
    light: [0.38, 0.04, 0.045],
    dark:  [0.08, 0.006, 0.01],
    seed: seed + 1,
  });
  return geometry;
}

function unitBone(seed) {
  const geometry = new THREE.CylinderGeometry(0.22, 0.16, 1.1, 7, 3);
  lump(geometry, { amp: 0.12, seed });
  paint(geometry, {
    light: [0.78, 0.68, 0.52],
    dark:  [0.42, 0.28, 0.18],
    seed,
  });
  return geometry;
}

function unitFlap(seed) {
  const geometry = new THREE.CylinderGeometry(0.28, 0.85, 1, 8, 5);
  lump(geometry, { amp: 0.28, seed, taper: 0.35 });
  paint(geometry, {
    light: [0.50, 0.06, 0.055],
    dark:  [0.12, 0.01, 0.014],
    seed,
  });
  return geometry;
}

function unitTendon(seed) {
  const geometry = new THREE.CylinderGeometry(0.16, 0.38, 1, 6, 4);
  lump(geometry, { amp: 0.18, seed });
  paint(geometry, {
    light: [0.55, 0.16, 0.12],
    dark:  [0.22, 0.04, 0.04],
    seed,
  });
  return geometry;
}

function unitChunk(seed) {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  lump(geometry, { amp: 0.45, seed });
  paint(geometry, {
    light: [0.44, 0.05, 0.048],
    dark:  [0.11, 0.01, 0.012],
    seed,
  });
  return geometry;
}

function alignTo(object, localOut) {
  if (localOut.lengthSq() < 1e-8) return;
  object.quaternion.setFromUnitVectors(Y, _out.copy(localOut).normalize());
}

function worldScaleOf(node) {
  node.getWorldScale(_scale);
  return Math.max(1e-4, Math.abs(_scale.x), Math.abs(_scale.y), Math.abs(_scale.z));
}

// Radial size of the remaining sleeve at the cut, from the posed seam the
// sever mask already painted. Falls back to the recipe if the model has no
// partial-weight band (a hard edge, or a region that owned every vertex).
export function measureCutRadius(damage, bone, outward, fallback) {
  if (!damage?.meshes?.length || !bone || !outward) return fallback;
  bone.updateWorldMatrix(true, false);
  _world.setFromMatrixPosition(bone.matrixWorld);
  const radii = [];
  for (const record of damage.meshes) {
    const mask = record.sever?.array;
    if (!mask) continue;
    record.mesh.skeleton?.update();
    const count = record.geometry.attributes.position.count;
    const stride = Math.max(1, Math.floor(count / 2200));
    for (let i = 0; i < count; i += stride) {
      const value = mask[i];
      if (value <= 0.04 || value >= 0.94) continue;
      record.mesh.getVertexPosition(i, _worldB).applyMatrix4(record.mesh.matrixWorld);
      _local.subVectors(_worldB, _world);
      const along = _local.dot(outward);
      // Other severed limbs share this mask. Only measure this cut's vicinity.
      if (Math.abs(along) > fallback * 1.5) continue;
      _local.addScaledVector(outward, -along);
      const radial = _local.length();
      if (radial > 0.01 && radial < fallback * 3.2) radii.push(radial);
    }
  }
  if (radii.length < 6) return fallback;
  radii.sort((a, b) => a - b);
  const picked = radii[Math.min(radii.length - 1, Math.floor(radii.length * 0.62))];
  return THREE.MathUtils.clamp(picked, fallback * 0.55, fallback * 1.2);
}

export class StumpFlesh {
  constructor(model, damage = null) {
    this.model = model;
    this.damage = damage;
    this.stumps = [];
    this.owned = new Set();
    this.meat = meatMaterial();
    this.boneMat = boneMaterial();
    this.hanging = new THREE.Group();
    this.hanging.name = 'stumpHanging';
    model.add(this.hanging);
  }

  get count() { return this.stumps.length; }

  stumpBone(region) {
    let found = null;
    this.model.traverse(node => {
      if (found || !node.isBone) return;
      if (region.stump.test(node.name)) found = node;
    });
    return found;
  }

  // Direction the missing limb used to go, in world space: from the stump
  // toward the nearest bone the region still claims. That is the axis the
  // cork sits on, and the side the strands are allowed to hang into.
  cutAxis(region, bone, out) {
    bone.updateWorldMatrix(true, true);
    _world.setFromMatrixPosition(bone.matrixWorld);
    let best = null, bestDist = Infinity;
    this.model.traverse(node => {
      if (!node.isBone || node === bone) return;
      if (!region.chain.some(pattern => pattern.test(node.name))) return;
      node.updateWorldMatrix(true, false);
      const dist = _worldB.setFromMatrixPosition(node.matrixWorld).distanceToSquared(_world);
      if (dist < bestDist) { bestDist = dist; best = node; }
    });
    if (best) {
      _worldB.setFromMatrixPosition(best.matrixWorld);
      out.subVectors(_worldB, _world);
      if (out.lengthSq() > 1e-8) return out.normalize();
    }
    if (region.aim === 'low' || region.aim === 'mid') return out.set(0, -1, 0);
    if (region.aim === 'high') return out.set(0, 1, 0);
    return out.set(Math.sign(bone.getWorldPosition(_worldB).x) || 1, 0, 0);
  }

  attach(region, { force = 1.6, dx = 0, dy = 0, debris = null } = {}) {
    const bone = this.stumpBone(region);
    if (!bone) return null;
    this.retireMatching(region.chain);
    if (this.stumps.some(stump => stump.regionId === region.id)) return null;

    const recipe = recipeFor(region);
    const seed = seedFor(region.id);
    const random = rng(seed);
    const outward = this.cutAxis(region, bone, new THREE.Vector3());
    const worldRadius = measureCutRadius(this.damage, bone, outward, recipe.radius);
    const boneScale = worldScaleOf(bone);
    const modelScale = worldScaleOf(this.model);
    const localRadius = worldRadius / boneScale;
    const hangLocal = recipe.hang / modelScale;

    _inv.copy(bone.matrixWorld).invert();
    _outLocal.copy(outward).transformDirection(_inv).normalize();

    const cap = new THREE.Group();
    cap.name = `stumpCap:${region.id}`;
    alignTo(cap, _outLocal);
    cap.position.copy(_outLocal).multiplyScalar(localRadius * 0.12);
    bone.add(cap);

    const plugGeo = unitPlug(seed);
    this.owned.add(plugGeo);
    const plug = new THREE.Mesh(plugGeo, this.meat);
    plug.name = 'stumpPlug';
    plug.castShadow = true;
    plug.scale.setScalar(localRadius * 1.08);
    plug.frustumCulled = false;
    cap.add(plug);

    // Reuse the baked Gib flesh, fitted to the wound rather than prop scale.
    // Keep the cork behind it to close any holes in the imported torn surface.
    const kind = /Arm$/.test(region.id) ? 'armChunk' : /Leg$/.test(region.id) ? 'legChunk' : null;
    const tissue = kind && debris?.library.get(kind);
    if (tissue) {
      tissue.computeBoundingBox();
      const size = tissue.boundingBox.getSize(new THREE.Vector3());
      const flesh = new THREE.Mesh(tissue, debris.materialFor(kind));
      flesh.name = 'stumpGibFlesh';
      flesh.scale.set(localRadius * 1.8 / Math.max(size.x, 0.001),
        localRadius * 0.8 / Math.max(size.y, 0.001), localRadius * 1.8 / Math.max(size.z, 0.001));
      flesh.position.y = localRadius * 0.12;
      flesh.castShadow = true;
      cap.add(flesh);
      plug.scale.multiplyScalar(0.85);
    }

    const liningGeo = unitLining(seed + 0.13);
    this.owned.add(liningGeo);
    const lining = new THREE.Mesh(liningGeo, this.meat);
    lining.name = 'stumpLining';
    lining.castShadow = true;
    lining.scale.set(localRadius * 0.98, recipe.lining / boneScale, localRadius * 0.98);
    lining.position.y = -lining.scale.y * 0.48;
    lining.frustumCulled = false;
    cap.add(lining);

    const boneGeo = unitBone(seed + 0.29);
    this.owned.add(boneGeo);
    const chip = new THREE.Mesh(boneGeo, this.boneMat);
    chip.name = 'stumpBone';
    chip.castShadow = true;
    const boneLen = localRadius * (region.id === 'torso' ? 1.4 : 1.15);
    chip.scale.set(localRadius * 0.85, boneLen, localRadius * 0.85);
    chip.position.y = localRadius * 0.15;
    chip.frustumCulled = false;
    cap.add(chip);

    const rim = 6 + (region.id === 'torso' ? 3 : 0);
    for (let i = 0; i < rim; i++) {
      const chunkGeo = unitChunk(seed + i * 0.17);
      this.owned.add(chunkGeo);
      const chunk = new THREE.Mesh(chunkGeo, this.meat);
      chunk.name = 'stumpRim';
      chunk.castShadow = true;
      const angle = (i / rim) * Math.PI * 2 + random() * 0.4;
      const reach = localRadius * (0.78 + random() * 0.28);
      chunk.position.set(Math.cos(angle) * reach, (random() - 0.35) * localRadius * 0.35, Math.sin(angle) * reach);
      chunk.scale.setScalar(localRadius * (0.18 + random() * 0.22));
      chunk.rotation.set(random() * 6, random() * 6, random() * 6);
      chunk.frustumCulled = false;
      cap.add(chunk);
    }

    _inv.copy(this.model.matrixWorld).invert();
    const outModel = outward.clone().transformDirection(_inv).normalize();
    const impulse = new THREE.Vector3(dx, dy, 0).transformDirection(_inv);
    if (impulse.lengthSq() < 1e-6) impulse.copy(outModel);
    impulse.normalize().multiplyScalar((0.08 + force * 0.05) / modelScale);

    const strands = [];
    const addStrand = ({ kind, length, radius, segments, flatten, damp }) => {
      const geo = kind === 'tendon' ? unitTendon(seed + strands.length) : unitFlap(seed + strands.length);
      this.owned.add(geo);
      const angle = random() * Math.PI * 2;
      const ring = worldRadius * (0.55 + random() * 0.4);
      const pin = new THREE.Vector3();
      this.ringPin(bone, outward, angle, ring, worldRadius, pin);
      const hangDir = outModel.clone().multiplyScalar(0.12).add(_g.set(0, -1, 0)).normalize();
      const points = [];
      const prev = [];
      const rest = length / segments;
      for (let i = 0; i < segments + 1; i++) {
        const p = pin.clone().addScaledVector(hangDir, rest * i);
        points.push(p);
        prev.push(p.clone().addScaledVector(impulse, i === 0 ? 0 : -0.35 * i));
      }
      const meshes = [];
      for (let i = 0; i < segments; i++) {
        const mesh = new THREE.Mesh(geo, this.meat);
        mesh.name = kind === 'tendon' ? 'stumpTendon' : 'stumpFlap';
        mesh.castShadow = true;
        mesh.frustumCulled = false;
        const taper = 1 - i * 0.22;
        mesh.userData.radial = (radius / modelScale) * taper;
        mesh.userData.flatten = flatten;
        this.hanging.add(mesh);
        meshes.push(mesh);
      }
      strands.push({ points, prev, rest, meshes, damp, angle, ring });
    };

    const flapLen = hangLocal * (region.id === 'torso' ? 1 : 0.78);
    for (let i = 0; i < recipe.flaps; i++) {
      addStrand({
        kind: 'flap',
        length: flapLen * (0.55 + random() * 0.55),
        radius: worldRadius * (0.22 + random() * 0.16),
        segments: region.id === 'torso' ? 3 : 2,
        flatten: 0.42 + random() * 0.25,
        damp: DAMPING,
      });
    }
    for (let i = 0; i < recipe.tendons; i++) {
      addStrand({
        kind: 'tendon',
        length: hangLocal * (0.7 + random() * 0.55),
        radius: worldRadius * (0.07 + random() * 0.05),
        segments: 3,
        flatten: 0.85 + random() * 0.2,
        damp: 0.9,
      });
    }

    const stump = {
      regionId: region.id,
      region,
      bone,
      cap,
      outward,
      worldRadius,
      strands,
    };
    this.stumps.push(stump);
    this.placeStrands(stump);
    return stump;
  }

  ringPin(bone, outward, angle, ring, worldRadius, target) {
    bone.updateWorldMatrix(true, false);
    _world.setFromMatrixPosition(bone.matrixWorld);
    _side.set(1, 0, 0);
    if (Math.abs(outward.dot(_side)) > 0.92) _side.set(0, 0, 1);
    _side.crossVectors(outward, _side).normalize();
    _up.crossVectors(outward, _side).normalize();
    _world.addScaledVector(outward, worldRadius * 0.08)
      .addScaledVector(_side, Math.cos(angle) * ring)
      .addScaledVector(_up, Math.sin(angle) * ring);
    return target.copy(this.model.worldToLocal(_world));
  }

  pinOf(stump, strand, target) {
    _inv.copy(this.model.matrixWorld).invert();
    const outModel = _outLocal.copy(stump.outward).transformDirection(_inv).normalize();
    this.ringPin(stump.bone, stump.outward, strand.angle, strand.ring, stump.worldRadius, target);
    return outModel;
  }

  placeStrands(stump) {
    for (const strand of stump.strands) {
      for (let i = 0; i < strand.meshes.length; i++) {
        const a = strand.points[i], b = strand.points[i + 1];
        _mid.addVectors(a, b).multiplyScalar(0.5);
        _dir.subVectors(b, a);
        const length = _dir.length();
        if (length < 1e-5) continue;
        _dir.multiplyScalar(1 / length);
        const mesh = strand.meshes[i];
        mesh.position.copy(_mid);
        mesh.quaternion.setFromUnitVectors(Y, _dir);
        const radial = mesh.userData.radial;
        const flatten = mesh.userData.flatten;
        mesh.scale.set(radial * flatten, length, radial / flatten);
      }
    }
  }

  update(dt) {
    if (!this.stumps.length) return;
    this.model.updateWorldMatrix(true, true);
    const step = Math.min(Math.max(dt, 0), MAX_DT);
    // transformDirection normalises, which would turn 14 m/s² into a unit
    // vector and leave the strands sticking straight out of the cut.
    _g.set(0, -GRAVITY, 0);
    _inv.copy(this.model.matrixWorld).invert();
    const e = _inv.elements;
    const gx = _g.x, gy = _g.y, gz = _g.z;
    _g.set(e[0] * gx + e[4] * gy + e[8] * gz, e[1] * gx + e[5] * gy + e[9] * gz, e[2] * gx + e[6] * gy + e[10] * gz);

    for (const stump of this.stumps) {
      this.cutAxis(stump.region, stump.bone, stump.outward);

      for (const strand of stump.strands) {
        _axis.copy(this.pinOf(stump, strand, strand.points[0]));
        strand.prev[0].copy(strand.points[0]);
        if (step > 0) {
          for (let i = 1; i < strand.points.length; i++) {
            const p = strand.points[i];
            const prev = strand.prev[i];
            const vx = (p.x - prev.x) * strand.damp;
            const vy = (p.y - prev.y) * strand.damp;
            const vz = (p.z - prev.z) * strand.damp;
            prev.copy(p);
            p.x += vx;
            p.y += vy + _g.y * step * step;
            p.z += vz;
            p.x += _g.x * step * step;
            p.z += _g.z * step * step;
          }
          for (let pass = 0; pass < 5; pass++) {
            strand.points[0].copy(strand.prev[0]);
            for (let i = 1; i < strand.points.length; i++) {
              const a = strand.points[i - 1], b = strand.points[i];
              _dir.subVectors(b, a);
              const dist = _dir.length() || 1e-6;
              // Only the hanging point moves. Letting both ends share the
              // correction let the tip fold back over the pin and sit inside
              // the sleeve.
              b.addScaledVector(_dir, (strand.rest - dist) / dist);
            }
          }
          const pin = strand.points[0];
          for (let i = 1; i < strand.points.length; i++) {
            const p = strand.points[i];
            _dir.subVectors(p, pin);
            const into = _dir.dot(_axis);
            // Cap the push so a fast stump (or a test teleport) cannot slam
            // every strand onto the cut plane in a single frame.
            if (into < 0.012) p.addScaledVector(_axis, Math.min(0.012 - into, 0.035));
          }
        }
      }
      this.placeStrands(stump);
    }
  }

  retireMatching(matchers) {
    for (let i = this.stumps.length - 1; i >= 0; i--) {
      const stump = this.stumps[i];
      if (!matchers.some(pattern => pattern.test(stump.bone.name))) continue;
      this.retire(stump);
      this.stumps.splice(i, 1);
    }
  }

  retire(stump) {
    for (const strand of stump.strands) {
      for (const mesh of strand.meshes) this.hanging.remove(mesh);
    }
    stump.bone.remove(stump.cap);
  }

  reset() {
    for (const stump of this.stumps) this.retire(stump);
    this.stumps.length = 0;
    for (const geometry of this.owned) geometry.dispose();
    this.owned.clear();
  }

  dispose() {
    this.reset();
    this.model.remove(this.hanging);
    this.meat.dispose();
    this.boneMat.dispose();
  }
}
