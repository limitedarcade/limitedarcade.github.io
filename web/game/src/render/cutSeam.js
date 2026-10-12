import * as THREE from '../vendor/three.module.js';

const a = new THREE.Vector3(), b = new THREE.Vector3();

export function createCutSeam(removed, bone, outward, fallback, cutDistance = 0) {
  let samples = removed.flatMap(chunk => chunk.seam || []);
  if (samples.length) {
    // Clothing/armour can have additional weight boundaries at a cuff or boot.
    // Those are not part of the joint's opening and would stretch the wound.
    const pivot = bone.getWorldPosition(new THREE.Vector3());
    const ranked = samples.map(sample => {
      const mesh = sample.record.mesh;
      mesh.getVertexPosition(sample.a, a); mesh.getVertexPosition(sample.b, b);
      a.lerp(b, sample.t).applyMatrix4(mesh.matrixWorld).sub(pivot);
      const error = Math.abs(a.dot(outward) - (cutDistance || 0));
      return { sample, error };
    });
    const best = Math.min(...ranked.map(item => item.error));
    const filtered = ranked.filter(item => item.error <= best + fallback * .65).map(item => item.sample);
    if (filtered.length >= 6) samples = filtered;
  }
  if (!samples.length) {
    // Named, separately authored limb meshes have no triangles crossing their
    // join. Use their proximal surface, rather than the skeleton's pivot.
    const pivot = bone.getWorldPosition(new THREE.Vector3()), candidates = [];
    for (const { record, positions } of removed) for (let i = 0; i < positions.length; i += 4) {
      a.fromArray(positions, i).sub(pivot);
      const along = a.dot(outward);
      if (a.addScaledVector(outward, -along).length() > fallback * 4) continue;
      candidates.push({ record, a: positions[i + 3], b: positions[i + 3], t: 0, along });
    }
    candidates.sort((x, y) => x.along - y.along);
    if (candidates.length) {
      const start = candidates[Math.floor(candidates.length * .025)].along;
      samples = candidates.filter(s => s.along >= start && s.along <= start + fallback * .32);
    }
  }
  // Bound per-frame skin evaluation independently of source mesh density.
  if (samples.length > 192) samples = Array.from({ length: 192 }, (_, i) => samples[Math.floor(i * samples.length / 192)]);
  return { samples, center: new THREE.Vector3(), points: [] };
}

export function updateCutSeam(seam, bone, outward, fallback) {
  const records = new Set(seam.samples.map(sample => sample.record));
  for (const record of records) {
    record.mesh.updateWorldMatrix(true, false);
    record.mesh.skeleton?.update();
  }
  const points = [], seen = new Set();
  for (const sample of seam.samples) {
    const mesh = sample.record.mesh;
    mesh.getVertexPosition(sample.a, a);
    mesh.getVertexPosition(sample.b, b);
    a.lerp(b, sample.t).applyMatrix4(mesh.matrixWorld);
    const key = `${Math.round(a.x * 10000)},${Math.round(a.y * 10000)},${Math.round(a.z * 10000)}`;
    if (seen.has(key)) continue;
    seen.add(key); points.push(a.clone());
  }
  seam.points = points;
  seam.center.set(0, 0, 0);
  if (points.length >= 3) {
    for (const point of points) seam.center.add(point);
    seam.center.multiplyScalar(1 / points.length);
  } else bone.getWorldPosition(seam.center);
  const radial = points.map(point => {
    a.subVectors(point, seam.center);
    return a.addScaledVector(outward, -a.dot(outward)).length();
  }).sort((x, y) => x - y);
  const radius = radial.length >= 3 ? radial[Math.floor((radial.length - 1) * .9)] : fallback;
  seam.radius = THREE.MathUtils.clamp(radius, fallback * .35, fallback * 2.5);
  return seam;
}
