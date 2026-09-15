import { readFileSync } from 'node:fs';

const PART_NAMES = ['Head', 'Torso', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'];

export function readGlbChunks(path) {
  const buf = readFileSync(path);
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error(`not a GLB: ${path}`);
  const jsonLen = buf.readUInt32LE(12);
  const gj = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binOff = 20 + jsonLen;
  const binLen = buf.length > binOff + 8 ? buf.readUInt32LE(binOff) : 0;
  const bin = binLen ? buf.subarray(binOff + 8, binOff + 8 + binLen) : Buffer.alloc(0);
  return { gj, bin, byteLength: buf.length };
}

function imageSize(buf) {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      i += 2 + len;
    }
  }
  return { width: null, height: null };
}

function unionBounds(gj) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let missing = false;
  for (const mesh of gj.meshes || []) {
    const at = mesh.primitives?.[0]?.attributes;
    if (!at || at.POSITION === undefined) continue;
    const acc = gj.accessors[at.POSITION];
    if (!acc?.min || !acc?.max) { missing = true; continue; }
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], acc.min[k]);
      max[k] = Math.max(max[k], acc.max[k]);
    }
  }
  return { min, max, missing };
}

export function probeGlb(path) {
  const { gj, bin, byteLength } = readGlbChunks(path);
  const meshes = gj.meshes || [];
  const nodes = gj.nodes || [];
  const images = gj.images || [];
  const named = [];
  for (const n of nodes) if (n.mesh !== undefined) named.push(n.name || `mesh${n.mesh}`);

  let verts = 0;
  let tris = 0;
  let hasTexcoord = false;
  let hasColor = false;
  for (const mesh of meshes) {
    const pr = mesh.primitives?.[0] || {};
    const at = pr.attributes || {};
    if (at.TEXCOORD_0 !== undefined) hasTexcoord = true;
    if (at.COLOR_0 !== undefined) hasColor = true;
    if (at.POSITION !== undefined) verts += gj.accessors[at.POSITION].count;
    if (pr.indices !== undefined) tris += gj.accessors[pr.indices].count / 3;
    else if (at.POSITION !== undefined) tris += gj.accessors[at.POSITION].count / 3;
  }

  const imageInfo = images.map((img, i) => {
    const mime = img.mimeType || 'unknown';
    const bv = img.bufferView !== undefined ? gj.bufferViews[img.bufferView] : null;
    if (!bv) return { index: i, mime, bytes: 0, width: null, height: null };
    const off = bv.byteOffset || 0;
    const slice = bin.subarray(off, off + Math.min(bv.byteLength, 131072));
    const dim = imageSize(slice);
    return { index: i, mime, bytes: bv.byteLength, ...dim };
  });

  const bounds = unionBounds(gj);
  const size = bounds.min[0] === Infinity
    ? [0, 0, 0]
    : bounds.max.map((v, i) => v - bounds.min[i]);

  return {
    path,
    byteLength,
    meshCount: meshes.length,
    nodeNames: named,
    imageCount: images.length,
    images: imageInfo,
    hasTexcoord,
    hasColor,
    verts,
    tris,
    bounds: {
      min: bounds.min,
      max: bounds.max,
      missingMinMax: bounds.missing,
    },
    size,
  };
}

export function classifyProbe(probe) {
  const names = new Set(probe.nodeNames);
  const hasParts = PART_NAMES.every((n) => names.has(n));
  const looksParts = hasParts && probe.imageCount === 0;
  const looksTextured = probe.imageCount >= 1 && probe.hasTexcoord && !hasParts;
  if (looksParts && !looksTextured) return 'parts';
  if (looksTextured && !looksParts) return 'textured';
  if (looksParts && looksTextured) return 'ambiguous';
  if (hasParts && probe.imageCount >= 1) return 'parts-with-images';
  if (probe.imageCount === 0 && probe.meshCount >= 6) return 'parts-like';
  if (probe.hasTexcoord && probe.imageCount >= 1) return 'textured';
  return 'unknown';
}

export { PART_NAMES };
