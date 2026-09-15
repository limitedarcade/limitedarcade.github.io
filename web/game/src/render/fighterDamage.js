import * as THREE from '../vendor/three.module.js';

const clamp = THREE.MathUtils.clamp;
const point = new THREE.Vector3(), posed = new THREE.Vector3(), worldScale = new THREE.Vector3();
const MAX_WOUNDS = 16;

// Bruising and deformation use vertices; blood uses continuous bind-space
// fields evaluated per fragment, so its edge never inherits the mesh triangles.
// The shared surface coordinates also keep wounds continuous across materials.
export class FighterDamage {
  constructor(model) {
    this.model = model;
    this.meshes = [];
    this.materialRecords = new Map();
    this.hits = 0;
    this.wounds = Array.from({ length: MAX_WOUNDS }, () => new THREE.Vector4());
    this.woundCount = { value: 0 };
    model.updateWorldMatrix(true, true);
    const modelInverse = model.matrixWorld.clone().invert();
    model.traverse(mesh => {
      if (!mesh.isMesh || !mesh.geometry?.attributes.position) return;
      const originalGeometry = mesh.geometry;
      const geometry = new THREE.BufferGeometry();
      for (const [key, attribute] of Object.entries(originalGeometry.attributes)) geometry.setAttribute(key, attribute);
      geometry.setIndex(originalGeometry.index);
      geometry.groups = originalGeometry.groups.map(group => ({ ...group }));
      geometry.morphAttributes = originalGeometry.morphAttributes;
      geometry.morphTargetsRelative = originalGeometry.morphTargetsRelative;
      geometry.boundingBox = originalGeometry.boundingBox?.clone() || null;
      geometry.boundingSphere = originalGeometry.boundingSphere?.clone() || null;
      const damage = new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 4), 4);
      damage.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('battleDamage', damage);
      const surface = new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count * 3), 3);
      const toModel = new THREE.Matrix4().multiplyMatrices(modelInverse, mesh.matrixWorld);
      for (let i = 0; i < surface.count; i++) {
        posed.fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(toModel);
        surface.setXYZ(i, posed.x, posed.y, posed.z);
      }
      geometry.setAttribute('battleSurfacePosition', surface);
      // Severed geometry is discarded in the fragment shader rather than
      // deleted from the buffer: the skinned mesh keeps one draw call and one
      // index buffer all round, and putting a limb back for the next round is
      // a memset instead of a rebuild.
      const sever = new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count), 1);
      sever.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('severMask', sever);
      mesh.geometry = geometry;
      const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => this.attachMaterial(material, geometry));
      const originalDepth = mesh.customDepthMaterial, originalDistance = mesh.customDistanceMaterial;
      const shadows = [new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), new THREE.MeshDistanceMaterial()];
      for (const shadow of shadows) {
        shadow.onBeforeCompile = shader => {
          shader.vertexShader = 'attribute float severMask; varying float vSeverMask;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeverMask = severMask;');
          shader.fragmentShader = 'varying float vSeverMask;\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vSeverMask > 0.94) discard;');
        };
        shadow.customProgramCacheKey = () => 'fighter-sever-shadow-v1';
      }
      [mesh.customDepthMaterial, mesh.customDistanceMaterial] = shadows;
      this.meshes.push({ mesh, originalGeometry, geometry, damage, sever, materials, originalDepth, originalDistance, shadows });
    });
  }

  attachMaterial(material, geometry) {
    if (this.materialRecords.has(material)) return this.materialRecords.get(material);
    const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
    geometry.computeBoundingBox();
    const size = geometry.boundingBox.getSize(new THREE.Vector3());
    const localHeight = Math.max(0.01, size.y);
    const wounds = this.wounds, woundCount = this.woundCount;
    material.onBeforeCompile = function (shader, renderer) {
      compile?.call(this, shader, renderer);
      shader.uniforms.uBattleWounds = { value: wounds };
      shader.uniforms.uBattleWoundCount = woundCount;
      shader.vertexShader = `attribute vec4 battleDamage;
        attribute vec3 battleSurfacePosition;
        varying vec3 vBattleSurfacePosition;
        attribute float severMask;
        varying vec4 vBattleDamage;
        varying vec3 vBattleDamagePosition;
        varying float vSeverMask;
      ` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vBattleDamage = battleDamage;
        vBattleSurfacePosition = battleSurfacePosition;
        vSeverMask = severMask;
        vBattleDamagePosition = position / ${localHeight.toFixed(8)};
        transformed += normal * battleDamage.w * ${(localHeight * 0.0035).toFixed(8)};
      `);
      shader.fragmentShader = `varying vec4 vBattleDamage;
        varying vec3 vBattleSurfacePosition;
        uniform vec4 uBattleWounds[${MAX_WOUNDS}];
        uniform int uBattleWoundCount;
        varying vec3 vBattleDamagePosition;
        varying float vSeverMask;
        float battleWetness;
        float battleNoise(vec3 p) {
          vec3 cell = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          vec3 axis = vec3(127.1, 311.7, 74.7);
          float n = dot(cell, axis);
          return mix(mix(mix(fract(sin(n) * 43758.5453), fract(sin(n + axis.x) * 43758.5453), f.x),
            mix(fract(sin(n + axis.y) * 43758.5453), fract(sin(n + axis.x + axis.y) * 43758.5453), f.x), f.y),
            mix(mix(fract(sin(n + axis.z) * 43758.5453), fract(sin(n + axis.x + axis.z) * 43758.5453), f.x),
            mix(fract(sin(n + axis.y + axis.z) * 43758.5453), fract(sin(n + axis.x + axis.y + axis.z) * 43758.5453), f.x), f.y), f.z);
        }
      ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        // Fully severed geometry is gone. The partial band left at the seam is
        // the cut face itself, which is raw meat rather than skin -- without it
        // a severed arm reads as a rendering glitch instead of a wound.
        if (vSeverMask > 0.94) discard;
        if (vSeverMask > 0.02) {
          float raw = smoothstep(0.02, 0.94, vSeverMask);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.135, 0.011, 0.014), raw * 0.96);
          diffuseColor.rgb += vec3(0.16, 0.02, 0.02) * raw * 0.35;
        }
        {
          float grain = fract(sin(dot(floor(vBattleDamagePosition * 640.0), vec3(12.9898, 78.233, 43.811))) * 43758.5453);
          float skin = smoothstep(0.03, 0.19, diffuseColor.r - diffuseColor.b)
            * smoothstep(0.09, 0.34, diffuseColor.r);
          float blood = 0.0;
          float body = 0.0;
          for (int i = 0; i < ${MAX_WOUNDS}; i++) {
            if (i >= uBattleWoundCount) break;
            vec4 wound = uBattleWounds[i];
            vec3 q = (vBattleSurfacePosition - wound.xyz) / wound.w;
            if (abs(q.x) > 1.5 || abs(q.z) > 1.5 || q.y > 1.5 || q.y < -3.5) continue;
            float noise = battleNoise(q * 5.5 + float(i) * 7.3);
            float edge = length(q * vec3(1.0, 1.22, 1.0)) + (noise - 0.5) * 0.42;
            float aa = max(0.025, fwidth(edge));
            float woundPatch = 1.0 - smoothstep(0.72 - aa, 0.92 + aa, edge);
            // Two slender rivulets taper down the bind surface with broken edges.
            float run = clamp(-q.y / 3.0, 0.0, 1.0);
            float lane = min(abs(q.x + 0.20 + sin(q.y * 4.0 + float(i)) * 0.045),
                             abs(q.x - 0.24 + sin(q.y * 3.0) * 0.035));
            float trickle = (1.0 - smoothstep(0.025, 0.09 * (1.0 - run) + 0.026, lane))
              * smoothstep(0.1, 0.45, -q.y) * (1.0 - smoothstep(1.1, 3.0, -q.y))
              * (1.0 - smoothstep(0.3, 0.65, abs(q.z))) * (0.65 + noise * 0.35);
            blood = max(blood, max(woundPatch, trickle));
            body = max(body, woundPatch * (1.0 - smoothstep(0.0, 0.85, edge)));
          }
          battleWetness = blood * (0.65 + body * 0.35);
          vec3 freshBlood = mix(vec3(0.17, 0.006, 0.012), vec3(0.035, 0.0015, 0.004), body);
          freshBlood *= 0.86 + battleNoise(vBattleDamagePosition * 180.0) * 0.28;
          blood *= 0.92;
          diffuseColor.rgb = mix(diffuseColor.rgb, freshBlood, blood);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.115, 0.028, 0.083), vBattleDamage.y * skin * 0.60);
          float threads = step(0.63, fract(vBattleDamagePosition.y * 430.0 + vBattleDamagePosition.x * 95.0));
          float wear = vBattleDamage.z * (1.0 - skin);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.008, 0.009, 0.014), wear * (0.44 + threads * 0.30));
          diffuseColor.rgb += vec3(0.20, 0.17, 0.15) * wear * step(0.92, grain) * (1.0 - threads);
        }
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.24, battleWetness * 0.88);
        roughnessFactor = mix(roughnessFactor, 0.28, clamp(vSeverMask, 0.0, 1.0) * 0.8);
      `);
    };
    material.customProgramCacheKey = function () { return `${cacheKey?.call(this) || ''}|fighter-damage-v3-${localHeight.toFixed(8)}`; };
    material.needsUpdate = true;
    const record = { material, compile, cacheKey };
    this.materialRecords.set(material, record);
    return record;
  }

  onHit(event, power = event?.bloodScale || 1) {
    if (!event || event.type === 'block' || !Number.isFinite(event.x) || !Number.isFinite(event.y)) return;
    const amount = clamp(Number(power) || 1, 0.1, 4);
    point.set(event.x, event.y, event.z || 0.04);
    this.model.updateWorldMatrix(true, true);
    let nearest = null, bestDistance = Infinity;
    // Sample the posed surface to locate the wound, then paint its bind-space
    // neighbourhood. This prevents a crouching fighter's head wound landing on
    // their jacket, which world-height-only decals would do.
    for (const record of this.meshes) {
      const mesh = record.mesh;
      mesh.skeleton?.update();
      const count = record.geometry.attributes.position.count;
      const stride = Math.max(1, Math.floor(count / 3500));
      for (let i = 0; i < count; i += stride) {
        mesh.getVertexPosition(i, posed).applyMatrix4(mesh.matrixWorld);
        const distance = posed.distanceToSquared(point);
        if (distance < bestDistance) { bestDistance = distance; nearest = { record, index: i }; }
      }
    }
    if (!nearest) return;
    const { record, index } = nearest, position = record.geometry.attributes.position;
    // Refine the nearest vertex onto its adjacent posed triangles. Barycentric
    // interpolation places even a tiny wound inside a large, low-poly face.
    const surface = record.geometry.attributes.battleSurfacePosition;
    const center = new THREE.Vector3().fromBufferAttribute(surface, index);
    const indices = record.geometry.index;
    const triangle = new THREE.Triangle(), closest = new THREE.Vector3(), bary = new THREE.Vector3();
    const vertexIds = [0, 0, 0], bind = new THREE.Vector3();
    for (let face = 0; face < (indices?.count ?? position.count); face += 3) {
      for (let j = 0; j < 3; j++) vertexIds[j] = indices ? indices.getX(face + j) : face + j;
      if (!vertexIds.includes(index)) continue;
      for (const [j, vertex] of [triangle.a, triangle.b, triangle.c].entries()) {
        record.mesh.getVertexPosition(vertexIds[j], vertex).applyMatrix4(record.mesh.matrixWorld);
      }
      triangle.closestPointToPoint(point, closest);
      const distance = closest.distanceToSquared(point);
      if (distance >= bestDistance || triangle.getArea() < 1e-10) continue;
      bestDistance = distance;
      triangle.getBarycoord(closest, bary);
      center.set(0, 0, 0);
      vertexIds.forEach((id, j) => center.addScaledVector(bind.fromBufferAttribute(surface, id), bary.getComponent(j)));
    }
    this.model.getWorldScale(worldScale);
    const modelScale = Math.max(0.001, Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
    const woundRadius = (0.035 + amount * 0.022) / modelScale;
    // Repeated strikes soak the same area; new contacts use a bounded ring.
    let slot = this.wounds.findIndex((w, i) => i < this.woundCount.value
      && center.distanceToSquared(new THREE.Vector3(w.x, w.y, w.z)) < woundRadius * woundRadius * 0.3);
    if (slot >= 0) this.wounds[slot].w = Math.min(woundRadius * 1.35, Math.max(woundRadius, this.wounds[slot].w * 1.08));
    else {
      slot = this.nextWound || 0;
      this.wounds[slot].set(center.x, center.y, center.z, woundRadius);
      this.nextWound = (slot + 1) % MAX_WOUNDS;
      this.woundCount.value = Math.min(MAX_WOUNDS, this.woundCount.value + 1);
    }
    const cx = position.getX(index), cy = position.getY(index), cz = position.getZ(index);
    record.mesh.getWorldScale(worldScale);
    const scale = Math.max(0.001, Math.abs(worldScale.x), Math.abs(worldScale.y), Math.abs(worldScale.z));
    const radius = (0.095 + amount * 0.045) / scale;
    const high = event.level === 'high';
    const data = record.damage.array;
    for (let i = 0; i < position.count; i++) {
      const dx = position.getX(i) - cx, dy = position.getY(i) - cy, dz = position.getZ(i) - cz;
      // A narrow downward tail reads as a trickle, rather than a perfectly round
      // paintbrush. It is still bound to the surface and cannot float off it.
      const drop = dy < 0 ? 0.40 : 1;
      const distance = Math.sqrt(dx * dx + dy * dy * drop + dz * dz) / radius;
      if (distance >= 1) continue;
      const noise = 0.72 + Math.sin(i * 12.9898 + this.hits * 3.21) * 0.18;
      const weight = (1 - distance) * noise;
      const offset = i * 4;
      data[offset] = clamp(data[offset] + weight * (0.7 + amount * 0.22), 0, 1);
      data[offset + 1] = clamp(data[offset + 1] + weight * (high ? 0.6 : 0.22), 0, 1);
      data[offset + 2] = clamp(data[offset + 2] + weight * amount * 0.30, 0, 1);
      data[offset + 3] = clamp(data[offset + 3] + weight * (high ? 0.38 : 0), 0, 1);
    }
    record.damage.needsUpdate = true;
    this.hits += 1;
  }

  // Cut everything weighted to `matchers` off the body.
  //
  // The mask is the vertex's total skin weight on the severed chain, which is
  // what makes the seam land in the right place for free: deep in the forearm
  // every weight belongs to the chain and the mask is 1, and across the elbow
  // it falls off exactly as the skinning blend does. The band where it sits
  // between the two is the cut face the shader paints raw.
  //
  // Returns the posed triangles that were removed, so the caller can build the
  // flying limb out of the same geometry the body just lost.
  severByBones(matchers, { collect = true, wholeMeshes = [] } = {}) {
    const removed = [];
    let cut = false;
    for (const record of this.meshes) {
      const skeleton = record.mesh.skeleton;
      const wholeMesh = wholeMeshes.some(m => m.test(record.mesh.name));
      if (wholeMesh || !skeleton) {
        // Helmets and heads can be rigid meshes parented to a bone. They must
        // leave with that bone just as skinned vertices do (Flock uses both).
        let parent = record.mesh.parent, attached = wholeMesh;
        while (!attached && parent && parent !== this.model.parent) {
          if (parent.isBone && matchers.some(m => m.test(parent.name))) { attached = true; break; }
          parent = parent.parent;
        }
        if (!attached) continue;
        const positions = [], mask = record.sever.array;
        record.mesh.updateWorldMatrix(true, false);
        skeleton?.update();
        for (let i = 0; i < mask.length; i++) {
          if (mask[i] > .5) continue;
          mask[i] = 1; cut = true;
          if (collect) {
            record.mesh.getVertexPosition(i, posed).applyMatrix4(record.mesh.matrixWorld);
            positions.push(posed.x, posed.y, posed.z, i);
          }
        }
        record.sever.needsUpdate = true;
        if (positions.length) removed.push({ record, positions });
        continue;
      }
      const severedBones = new Set();
      skeleton.bones.forEach((bone, index) => {
        if (matchers.some(m => m.test(bone.name))) severedBones.add(index);
      });
      if (!severedBones.size) continue;
      const geometry = record.geometry;
      const index = geometry.attributes.skinIndex, weight = geometry.attributes.skinWeight;
      if (!index || !weight) continue;
      const mask = record.sever.array;
      const positions = [];
      record.mesh.skeleton.update();
      record.mesh.updateWorldMatrix(true, false);
      for (let i = 0; i < index.count; i++) {
        let bound = 0;
        for (const component of ['x', 'y', 'z', 'w']) {
          if (severedBones.has(index[`get${component.toUpperCase()}`](i))) {
            bound += weight[`get${component.toUpperCase()}`](i);
          }
        }
        if (bound <= 0.02) continue;
        const alreadyRemoved = mask[i] > .5;
        // A region owning most of a vertex owns the vertex. Keeping a raw
        // 0.8 skin weight as opacity left almost the entire head behind.
        const value = clamp(Math.max(mask[i], bound >= 0.5 ? 1 : bound), 0, 1);
        if (value > mask[i]) { mask[i] = value; cut = true; }
        if (collect && bound >= 0.5 && !alreadyRemoved) {
          record.mesh.getVertexPosition(i, posed).applyMatrix4(record.mesh.matrixWorld);
          positions.push(posed.x, posed.y, posed.z, i);
        }
      }
      record.sever.needsUpdate = true;
      if (positions.length) removed.push({ record, positions });
    }
    return cut ? removed : null;
  }

  // Soak the stump. A cut that is not bleeding at its edge reads as plastic,
  // so severance always paints before the limb has finished leaving.
  bleedStump(worldPoint, amount = 2.6) {
    this.onHit({ x: worldPoint.x, y: worldPoint.y, z: worldPoint.z, level: 'high' }, amount);
  }

  resetRound() {
    this.hits = 0;
    this.nextWound = 0;
    this.woundCount.value = 0;
    this.wounds.forEach(wound => wound.set(0, 0, 0, 0));
    for (const { damage, sever } of this.meshes) {
      damage.array.fill(0); damage.needsUpdate = true;
      sever.array.fill(0); sever.needsUpdate = true;
    }
  }

  dispose() {
    for (const { mesh, originalGeometry, geometry, originalDepth, originalDistance, shadows } of this.meshes) {
      mesh.geometry = originalGeometry;
      mesh.customDepthMaterial = originalDepth; mesh.customDistanceMaterial = originalDistance;
      shadows.forEach(material => material.dispose());
      // The borrowed source buffers remain owned by the fighter. Only the new
      // damage attribute needs releasing when this helper is detached.
      for (const key of Object.keys(geometry.attributes)) if (!['battleDamage', 'severMask', 'battleSurfacePosition'].includes(key)) geometry.deleteAttribute(key);
      geometry.setIndex(null); geometry.dispose();
    }
    for (const { material, compile, cacheKey } of this.materialRecords.values()) {
      material.onBeforeCompile = compile; material.customProgramCacheKey = cacheKey; material.needsUpdate = true;
    }
    this.materialRecords.clear();
    this.meshes.length = 0;
  }
}
