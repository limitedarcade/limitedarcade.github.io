import * as THREE from '../vendor/three.module.js';

// Same face accumulation and Float32 rounding as computeVertexNormals, without
// repeatedly routing every component through Vector3/BufferAttribute methods.
// Flat detached triangles also share one normalisation per face.
export function surfaceNormals(geometry) {
  const position = geometry.attributes.position;
  if (position.isInterleavedBufferAttribute || position.normalized || position.itemSize !== 3) {
    geometry.computeVertexNormals(); return;
  }
  let normal = geometry.attributes.normal;
  if (!normal) {
    normal = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
    geometry.setAttribute('normal', normal);
  }
  if (normal.isInterleavedBufferAttribute || normal.normalized || !(normal.array instanceof Float32Array)) {
    geometry.computeVertexNormals(); return;
  }
  const p = position.array, n = normal.array, index = geometry.index;
  if (index) n.fill(0);
  const count = index?.count ?? position.count;
  for (let i = 0; i < count; i += 3) {
    const a = (index ? index.getX(i) : i) * 3, b = (index ? index.getX(i + 1) : i + 1) * 3,
      c = (index ? index.getX(i + 2) : i + 2) * 3;
    const cx = p[c] - p[b], cy = p[c + 1] - p[b + 1], cz = p[c + 2] - p[b + 2];
    const ax = p[a] - p[b], ay = p[a + 1] - p[b + 1], az = p[a + 2] - p[b + 2];
    let x = cy * az - cz * ay, y = cz * ax - cx * az, z = cx * ay - cy * ax;
    if (index) {
      n[a] += x; n[a + 1] += y; n[a + 2] += z;
      n[b] += x; n[b + 1] += y; n[b + 2] += z;
      n[c] += x; n[c + 1] += y; n[c + 2] += z;
    } else {
      x = Math.fround(x); y = Math.fround(y); z = Math.fround(z);
      const scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
      x *= scale; y *= scale; z *= scale;
      n[a] = n[b] = n[c] = x; n[a + 1] = n[b + 1] = n[c + 1] = y; n[a + 2] = n[b + 2] = n[c + 2] = z;
    }
  }
  if (index) for (let i = 0; i < n.length; i += 3) {
    const x = n[i], y = n[i + 1], z = n[i + 2], scale = 1 / (Math.sqrt(x * x + y * y + z * z) || 1);
    n[i] = x * scale; n[i + 1] = y * scale; n[i + 2] = z * scale;
  }
  normal.needsUpdate = true;
}
