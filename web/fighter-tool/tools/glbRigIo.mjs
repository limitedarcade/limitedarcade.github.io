// GLB writer for a rigged, skinned, animated fighter.
//
// `glbIo.mjs` writes static multipart meshes and is what the decimator uses;
// this is the same minimal-writer idea extended with the three things a rig
// needs and that one deliberately does not carry: a joint hierarchy, a skin
// with inverse bind matrices, and animation samplers.
//
// Conventions baked in here, because the rest of the pipeline depends on them:
//   - bind pose is the T-pose the sculpt was generated in, so every bone rest
//     rotation is identity and each inverse bind matrix is just a translation;
//   - joints are unsigned bytes (a fighter has ~21 bones, nowhere near 256);
//   - the skinned mesh nodes carry no transform of their own, per glTF, and sit
//     beside the skeleton root under one parent node.
import { writeFileSync } from 'node:fs';

const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const FLOAT = 5126, UBYTE = 5121, UINT = 5125;

export function writeRigged(path, { parts, bones, skinnedTo, animations, generator }) {
  const gj = {
    asset: { version: '2.0', generator: generator || 'fightere/tools/glbRigIo.mjs' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'fighter', children: [] }],
    meshes: [], materials: [], skins: [], animations: [],
    accessors: [], bufferViews: [], buffers: [],
  };

  const blobs = [];
  let byteLength = 0;
  const push = (ta, target) => {
    while (byteLength % 4) { blobs.push(Buffer.alloc(1)); byteLength += 1; }
    const off = byteLength;
    const b = Buffer.from(ta.buffer, ta.byteOffset, ta.byteLength);
    blobs.push(b); byteLength += b.length;
    const bv = { buffer: 0, byteOffset: off, byteLength: b.length };
    if (target !== undefined) bv.target = target;
    gj.bufferViews.push(bv);
    return gj.bufferViews.length - 1;
  };
  const acc = (ta, componentType, type, target, minmax) => {
    const bufferView = push(ta, target), n = NC[type];
    const a = { bufferView, componentType, count: ta.length / n, type };
    if (minmax) {
      const mn = new Array(n).fill(Infinity), mx = new Array(n).fill(-Infinity);
      for (let i = 0; i < ta.length; i++) {
        const k = i % n;
        if (ta[i] < mn[k]) mn[k] = ta[i];
        if (ta[i] > mx[k]) mx[k] = ta[i];
      }
      a.min = mn; a.max = mx;
    }
    gj.accessors.push(a);
    return gj.accessors.length - 1;
  };

  // ---- bones -------------------------------------------------------------
  // bones: [{ name, parent (index or -1), local: [x,y,z], world: [x,y,z] }]
  const boneNode = bones.map((b) => {
    gj.nodes.push({ name: b.name, translation: [b.local[0], b.local[1], b.local[2]] });
    return gj.nodes.length - 1;
  });
  bones.forEach((b, i) => {
    if (b.parent < 0) gj.nodes[0].children.push(boneNode[i]);
    else (gj.nodes[boneNode[b.parent]].children ||= []).push(boneNode[i]);
  });

  // Rest rotations are identity, so the inverse bind matrix of every bone is a
  // pure translation by minus its rest world position (column-major).
  const ibm = new Float32Array(bones.length * 16);
  bones.forEach((b, i) => {
    const m = ibm.subarray(i * 16, i * 16 + 16);
    m[0] = m[5] = m[10] = m[15] = 1;
    m[12] = -b.world[0]; m[13] = -b.world[1]; m[14] = -b.world[2];
  });
  gj.skins.push({
    name: 'fighterRig',
    joints: boneNode,
    skeleton: boneNode[bones.findIndex((b) => b.parent < 0)],
    inverseBindMatrices: acc(ibm, FLOAT, 'MAT4'),
  });

  // ---- meshes ------------------------------------------------------------
  for (const p of parts) {
    const attributes = { POSITION: acc(p.V, FLOAT, 'VEC3', 34962, true) };
    if (p.N) attributes.NORMAL = acc(p.N, FLOAT, 'VEC3', 34962);
    if (p.C) attributes.COLOR_0 = acc(p.C, FLOAT, 'VEC3', 34962);
    attributes.JOINTS_0 = acc(p.J, UBYTE, 'VEC4', 34962);
    attributes.WEIGHTS_0 = acc(p.W, FLOAT, 'VEC4', 34962);
    const indices = acc(p.I, UINT, 'SCALAR', 34963);
    const mi = gj.meshes.length;
    gj.materials.push({
      name: `${p.name}_mat`,
      pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.62 },
    });
    gj.meshes.push({ name: p.name, primitives: [{ attributes, indices, material: mi, mode: 4 }] });
    gj.nodes.push({ name: p.name, mesh: mi, skin: skinnedTo });
    gj.nodes[0].children.push(gj.nodes.length - 1);
  }

  // ---- animations --------------------------------------------------------
  // animations: [{ name, tracks: [{ bone, path, times: [], values: [] }] }]
  for (const clip of animations || []) {
    const samplers = [], channels = [];
    for (const t of clip.tracks) {
      const n = t.path === 'rotation' ? 4 : 3;
      const input = acc(Float32Array.from(t.times), FLOAT, 'SCALAR', undefined, true);
      const output = acc(Float32Array.from(t.values), FLOAT, n === 4 ? 'VEC4' : 'VEC3');
      samplers.push({ input, output, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: boneNode[t.bone], path: t.path } });
    }
    gj.animations.push({ name: clip.name, samplers, channels });
  }

  gj.buffers = [{ byteLength }];
  let json = Buffer.from(JSON.stringify(gj), 'utf8');
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  let blob = Buffer.concat(blobs);
  if (blob.length % 4) blob = Buffer.concat([blob, Buffer.alloc(4 - (blob.length % 4))]);
  const total = 12 + 8 + json.length + 8 + blob.length;
  const head = Buffer.alloc(12);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(blob.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  writeFileSync(path, Buffer.concat([head, jh, json, bh, blob]));
  return total;
}
