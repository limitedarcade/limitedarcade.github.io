// Minimal GLB read/write for the fighter pipeline. Mirrors tools/glb_io.py.
import { readFileSync, writeFileSync } from 'node:fs';

const CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error(`not a GLB: ${path}`);
  let off = 12; const chunks = [];
  while (off < buf.length) {
    const len = buf.readUInt32LE(off), type = buf.readUInt32LE(off + 4);
    chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len) });
    off += 8 + len;
  }
  return { gj: JSON.parse(chunks[0].data.toString('utf8')), bin: chunks[1].data };
}

export function accessor(gj, bin, i) {
  const a = gj.accessors[i], bv = gj.bufferViews[a.bufferView];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  const n = NC[a.type], T = CT[a.componentType];
  return new T(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * T.BYTES_PER_ELEMENT));
}

export function readParts(path) {
  const { gj, bin } = readGlb(path);
  const named = {};
  for (const n of gj.nodes) if (n.mesh !== undefined) named[n.mesh] = n.name || `mesh${n.mesh}`;
  return gj.meshes.map((m, mi) => {
    const at = m.primitives[0].attributes;
    return {
      name: named[mi] || `mesh${mi}`,
      V: accessor(gj, bin, at.POSITION),
      N: at.NORMAL !== undefined ? accessor(gj, bin, at.NORMAL) : null,
      C: at.COLOR_0 !== undefined ? accessor(gj, bin, at.COLOR_0) : null,
      I: new Uint32Array(accessor(gj, bin, m.primitives[0].indices)),
    };
  });
}

export function writeParts(path, parts) {
  const gj = {
    asset: { version: '2.0', generator: 'fightere/tools/glbIo.mjs' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'world', children: [] }],
    meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [],
  };
  const blobs = []; let byteLength = 0;
  const push = (ta, target) => {
    while (byteLength % 4) { blobs.push(Buffer.alloc(1)); byteLength += 1; }
    const off = byteLength, b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength);
    blobs.push(b); byteLength += b.length;
    gj.bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length, target });
    return gj.bufferViews.length - 1;
  };
  const acc = (ta, componentType, type, target, minmax) => {
    const bufferView = push(ta, target), n = NC[type];
    const a = { bufferView, componentType, count: ta.length / n, type };
    if (minmax) {
      const mn = new Array(n).fill(Infinity), mx = new Array(n).fill(-Infinity);
      for (let i = 0; i < ta.length; i++) { const k = i % n; if (ta[i] < mn[k]) mn[k] = ta[i]; if (ta[i] > mx[k]) mx[k] = ta[i]; }
      a.min = mn; a.max = mx;
    }
    gj.accessors.push(a); return gj.accessors.length - 1;
  };
  for (const p of parts) {
    const attributes = { POSITION: acc(p.V, 5126, 'VEC3', 34962, true) };
    if (p.N) attributes.NORMAL = acc(p.N, 5126, 'VEC3', 34962);
    if (p.C) attributes.COLOR_0 = acc(p.C, 5126, 'VEC3', 34962);
    const indices = acc(p.I, 5125, 'SCALAR', 34963);
    const mi = gj.meshes.length;
    gj.materials.push({ name: `${p.name}_mat`, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.62 } });
    gj.meshes.push({ name: p.name, primitives: [{ attributes, indices, material: mi, mode: 4 }] });
    gj.nodes.push({ name: p.name, mesh: mi });
    gj.nodes[0].children.push(gj.nodes.length - 1);
  }
  gj.buffers = [{ byteLength }];
  let json = Buffer.from(JSON.stringify(gj), 'utf8');
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  let blob = Buffer.concat(blobs);
  if (blob.length % 4) blob = Buffer.concat([blob, Buffer.alloc(4 - (blob.length % 4))]);
  const total = 12 + 8 + json.length + 8 + blob.length;
  const head = Buffer.alloc(12); head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(blob.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  writeFileSync(path, Buffer.concat([head, jh, json, bh, blob]));
  return total;
}

export function recomputeNormals(V, I) {
  const N = new Float32Array(V.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = V[b] - V[a], ay = V[b + 1] - V[a + 1], az = V[b + 2] - V[a + 2];
    const bx = V[c] - V[a], by = V[c + 1] - V[a + 1], bz = V[c + 2] - V[a + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    for (const o of [a, b, c]) { N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.hypot(N[i], N[i + 1], N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  return N;
}
