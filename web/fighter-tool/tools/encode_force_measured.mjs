// Pack a Route C rigged GLB into a Three.js factory. The GLB is the
// measurement instrument; the deliverable is TypeScript-shaped JS that
// rebuilds the same verts, weights, bones and clips. Nothing is fetched.
//
//   node tools/encode_force_measured.mjs <rigged.glb> <outDir> --id trump --name Trump
import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { accessor, readGlb } from './glbIo.mjs';
import { decodeModel, CODEC_VERSION, PART_ORDER } from '../runtime/meshCodec.js';

const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CODEC_SRC = join(TOOL_ROOT, 'runtime', 'meshCodec.js');

function emit(listener, ev) {
  if (listener) listener(ev);
}

function floatsToB64(arr) {
  const src = arr instanceof Float32Array ? arr : Float32Array.from(arr);
  return Buffer.from(src.buffer, src.byteOffset, src.byteLength).toString('base64');
}

function linearToSrgb(c) {
  const x = Math.min(1, Math.max(0, c));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
}

function encodeOctNormal(x, y, z) {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l;
  let v = y / l;
  if (z < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
    v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
  }
  const px = Math.max(0, Math.min(255, Math.round((u * 0.5 + 0.5) * 255)));
  const py = Math.max(0, Math.min(255, Math.round((v * 0.5 + 0.5) * 255)));
  return px | (py << 8);
}

function writeVarint(out, value) {
  let v = value;
  while (v >= 128) {
    out.push((v & 127) | 128);
    v = Math.floor(v / 128);
  }
  out.push(v);
}

function asVec3(arr, i, nComp) {
  return [arr[i * nComp], arr[i * nComp + 1], arr[i * nComp + 2]];
}

export function readRigged(path) {
  const { gj, bin } = readGlb(path);
  if (!gj.skins?.length) throw new Error(`${path} has no skin — encode the rigged GLB, not the static mesh`);
  const skin = gj.skins[0];
  const jointNodes = skin.joints;
  const ibmRaw = accessor(gj, bin, skin.inverseBindMatrices);

  const bones = jointNodes.map((ni, i) => {
    const n = gj.nodes[ni];
    const parentNode = gj.nodes.findIndex((p) => (p.children || []).includes(ni));
    const parent = jointNodes.indexOf(parentNode);
    const ibm = [];
    for (let k = 0; k < 16; k += 1) ibm.push(ibmRaw[i * 16 + k]);
    return {
      name: n.name || `bone${i}`,
      parent,
      position: n.translation ? [...n.translation] : [0, 0, 0],
      quaternion: n.rotation ? [...n.rotation] : [0, 0, 0, 1],
      scale: n.scale ? [...n.scale] : [1, 1, 1],
      inverseBind: ibm,
    };
  });

  const parts = [];
  for (const node of gj.nodes) {
    if (node.mesh === undefined || node.skin === undefined) continue;
    const mesh = gj.meshes[node.mesh];
    const prim = mesh.primitives[0];
    const at = prim.attributes;
    if (at.POSITION === undefined || at.JOINTS_0 === undefined || at.WEIGHTS_0 === undefined) {
      throw new Error(`mesh ${node.name || node.mesh} is missing POSITION/JOINTS_0/WEIGHTS_0`);
    }
    const V = accessor(gj, bin, at.POSITION);
    const N = at.NORMAL !== undefined ? accessor(gj, bin, at.NORMAL) : null;
    const C = at.COLOR_0 !== undefined ? accessor(gj, bin, at.COLOR_0) : null;
    const J = accessor(gj, bin, at.JOINTS_0);
    const W = accessor(gj, bin, at.WEIGHTS_0);
    const I = Uint32Array.from(accessor(gj, bin, prim.indices));
    const colourComp = C ? C.length / (V.length / 3) : 0;
    parts.push({
      name: node.name || mesh.name || `mesh${node.mesh}`,
      V, N, C, J, W, I, colourComp,
    });
  }
  if (!parts.length) throw new Error(`${path} has no skinned meshes`);

  const rank = (name) => {
    const i = PART_ORDER.indexOf(name);
    return i < 0 ? PART_ORDER.length + name.charCodeAt(0) : i;
  };
  parts.sort((a, b) => rank(a.name) - rank(b.name));

  const animations = (gj.animations || []).map((clip) => {
    const tracks = [];
    for (const ch of clip.channels) {
      const bone = jointNodes.indexOf(ch.target.node);
      if (bone < 0) continue;
      const sampler = clip.samplers[ch.sampler];
      const path = ch.target.path;
      tracks.push({
        bone,
        path,
        times: Array.from(accessor(gj, bin, sampler.input)),
        values: Array.from(accessor(gj, bin, sampler.output)),
      });
    }
    const duration = tracks.reduce((m, t) => Math.max(m, t.times[t.times.length - 1] || 0), 0);
    return { name: clip.name, duration, tracks };
  });

  return { parts, bones, animations, generator: gj.asset?.generator || '' };
}

function boundsOf(V) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < V.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const v = V[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

function packPart(part, origin, extent, boneCount) {
  const n = part.V.length / 3;
  const t = part.I.length / 3;
  const positions = new Uint8Array(n * 6);
  const normals = new Uint8Array(n * 2);
  const colours = new Uint8Array(n * 3);
  const joints = new Uint8Array(n * 4);
  const weights = new Uint8Array(n * 8);
  let maxQErr = 0;
  let maxWErr = 0;
  let maxWSumDev = 0;
  let maxJoint = 0;

  for (let i = 0; i < n; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      const v = part.V[i * 3 + k];
      const e = extent[k] || 1;
      const q = Math.max(0, Math.min(65535, Math.round(((v - origin[k]) / e) * 65535)));
      const decoded = origin[k] + (q / 65535) * e;
      maxQErr = Math.max(maxQErr, Math.abs(decoded - v));
      const at = (i * 3 + k) * 2;
      positions[at] = q & 255;
      positions[at + 1] = q >> 8;
    }

    let nx = 0, ny = 1, nz = 0;
    if (part.N) {
      nx = part.N[i * 3]; ny = part.N[i * 3 + 1]; nz = part.N[i * 3 + 2];
    }
    const packed = encodeOctNormal(nx, ny, nz);
    normals[i * 2] = packed & 255;
    normals[i * 2 + 1] = packed >> 8;

    if (part.C) {
      const cc = part.colourComp || 3;
      colours[i * 3] = Math.max(0, Math.min(255, Math.round(linearToSrgb(part.C[i * cc]) * 255)));
      colours[i * 3 + 1] = Math.max(0, Math.min(255, Math.round(linearToSrgb(part.C[i * cc + 1]) * 255)));
      colours[i * 3 + 2] = Math.max(0, Math.min(255, Math.round(linearToSrgb(part.C[i * cc + 2]) * 255)));
    } else {
      colours[i * 3] = colours[i * 3 + 1] = colours[i * 3 + 2] = 180;
    }

    let wsum = 0;
    for (let k = 0; k < 4; k += 1) {
      const j = part.J[i * 4 + k];
      if (j >= boneCount) throw new Error(`part ${part.name}: skinIndex ${j} >= ${boneCount} bones`);
      joints[i * 4 + k] = j;
      if (j > maxJoint) maxJoint = j;
      const w = part.W[i * 4 + k];
      wsum += w;
      const q = Math.max(0, Math.min(65535, Math.round(w * 65535)));
      maxWErr = Math.max(maxWErr, Math.abs(q / 65535 - w));
      weights[(i * 4 + k) * 2] = q & 255;
      weights[(i * 4 + k) * 2 + 1] = q >> 8;
    }
    maxWSumDev = Math.max(maxWSumDev, Math.abs(wsum - 1));
  }

  const indexBytes = [];
  let previous = 0;
  for (let i = 0; i < part.I.length; i += 1) {
    const idx = part.I[i];
    if (idx < 0 || idx >= n) throw new Error(`part ${part.name}: index ${idx} out of range`);
    const delta = idx - previous;
    const zig = delta >= 0 ? delta * 2 : -delta * 2 - 1;
    writeVarint(indexBytes, zig);
    previous = idx;
  }

  const chunks = [positions, normals, colours, joints, weights, Uint8Array.from(indexBytes)];
  return {
    meta: {
      id: part.name,
      vertexCount: n,
      triangleCount: t,
      bounds: boundsOf(part.V),
      roughness: 0.62,
      bytes: {
        positions: positions.length,
        normals: normals.length,
        colours: colours.length,
        joints: joints.length,
        weights: weights.length,
        indices: indexBytes.length,
      },
    },
    chunks,
    maxQErr,
    maxWErr,
    maxWSumDev,
    maxJoint,
  };
}

function bindDelta(part) {
  // Bind pose rest rotation is identity and IBM is a pure translation by
  // -world, so world * IBM = I. A skinned vertex must reconstruct itself
  // from its weights; anything else is a weight-sum bug.
  const n = part.V.length / 3;
  const step = Math.max(1, Math.floor(n / 2048));
  let max = 0;
  for (let i = 0; i < n; i += step) {
    let x = 0, y = 0, z = 0;
    const px = part.V[i * 3], py = part.V[i * 3 + 1], pz = part.V[i * 3 + 2];
    for (let k = 0; k < 4; k += 1) {
      const w = part.W[i * 4 + k];
      if (w === 0) continue;
      x += w * px;
      y += w * py;
      z += w * pz;
    }
    max = Math.max(max, Math.hypot(x - px, y - py, z - pz));
  }
  return max;
}

function packClips(animations) {
  return animations.map((clip) => {
    const tracks = [];
    for (const t of clip.tracks) {
      const rec = { bone: t.bone, times: floatsToB64(t.times) };
      if (t.path === 'translation' || t.path === 'position') rec.position = floatsToB64(t.values);
      else if (t.path === 'rotation' || t.path === 'quaternion') rec.quaternion = floatsToB64(t.values);
      else if (t.path === 'scale') rec.scale = floatsToB64(t.values);
      else continue;
      tracks.push(rec);
    }
    return { name: clip.name, duration: clip.duration, tracks };
  });
}

function factorySource({ id, displayName, threeImport, codecImport, parts, clips, height }) {
  return `import * as THREE from ${JSON.stringify(threeImport)};
import { buildFighter } from ${JSON.stringify(codecImport)};

let cache = null;

export const FIGHTER_ID = ${JSON.stringify(id)};
export const FIGHTER_NAME = ${JSON.stringify(displayName)};
export const PARTS = ${JSON.stringify(parts)};
export const CLIPS = ${JSON.stringify(clips)};
export const HEIGHT = ${Number(height.toFixed(6))};

/** Load the packed surface and rig. Cheap to call twice. */
export async function prewarm() {
  if (cache) return cache;
  const [surface, rig] = await Promise.all([
    import('./surfaceData.js'),
    import('./rigData.js'),
  ]);
  cache = { model: surface.SURFACE_MODEL, stream: surface.SURFACE_STREAM, rig: rig.RIG };
  return cache;
}

/**
 * Rebuild the fighter as a Three.js group. Await prewarm() first.
 *
 *   const { group, play, update, explode } = createFighter();
 *   scene.add(group);
 *   play('idle');
 */
export function createFighter(options = {}) {
  if (!cache) {
    throw new Error('call prewarm() and await it before createFighter() — the packed surface loads on demand');
  }
  return buildFighter(THREE, cache.model, cache.stream, cache.rig, {
    castShadow: true,
    receiveShadow: true,
    ...options,
  });
}
`;
}

function gate(name, value, ok, extra = {}) {
  return { name, value, status: ok ? 'pass' : 'flag', ...extra };
}

export function encodeForceMeasured(glbPath, outDir, opts = {}) {
  const id = opts.id || 'fighter';
  const displayName = opts.displayName || id;
  const listener = opts.onEvent;
  const t0 = Date.now();

  emit(listener, { stage: 'encode', status: 'start', message: `Reading ${glbPath}` });
  const measured = readRigged(glbPath);

  const allV = [];
  for (const p of measured.parts) {
    for (let i = 0; i < p.V.length; i += 1) allV.push(p.V[i]);
  }
  const box = boundsOf(allV);
  const origin = box.min;
  const extent = box.max.map((v, k) => {
    const e = v - box.min[k];
    return e > 1e-12 ? e : 1;
  });
  const height = box.max[1] - box.min[1];
  const step = extent.map((e) => e / 65535);

  emit(listener, {
    stage: 'encode', status: 'log',
    message: `${measured.parts.length} parts, ${measured.parts.reduce((s, p) => s + p.V.length / 3, 0) | 0} verts, ${measured.bones.length} bones, ${measured.animations.length} clips`,
  });

  const packed = [];
  let maxQErr = 0, maxWErr = 0, maxWSumDev = 0, maxBind = 0;
  for (const part of measured.parts) {
    const rec = packPart(part, origin, extent, measured.bones.length);
    packed.push(rec);
    maxQErr = Math.max(maxQErr, rec.maxQErr);
    maxWErr = Math.max(maxWErr, rec.maxWErr);
    maxWSumDev = Math.max(maxWSumDev, rec.maxWSumDev);
    maxBind = Math.max(maxBind, bindDelta(part));
    emit(listener, {
      stage: 'encode', status: 'log',
      message: `${part.name}  ${rec.meta.vertexCount} verts  ${rec.meta.triangleCount} tris`,
    });
  }

  const stream = Buffer.concat(packed.flatMap((p) => p.chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))));
  const base64 = stream.toString('base64');

  const model = {
    version: CODEC_VERSION,
    kind: 'canonical-fighter-v1',
    id,
    displayName,
    quantization: { origin, extent },
    height,
    parts: packed.map((p) => p.meta),
  };
  const rig = {
    bones: measured.bones,
    clips: packClips(measured.animations),
  };

  emit(listener, { stage: 'encode', status: 'log', message: 'Round-tripping the stream against the measurement' });
  const decoded = decodeModel(model, base64);
  const measuredVerts = measured.parts.reduce((s, p) => s + p.V.length / 3, 0);
  const measuredTris = measured.parts.reduce((s, p) => s + p.I.length / 3, 0);
  const emittedVerts = decoded.reduce((s, p) => s + p.position.length / 3, 0);
  const emittedTris = decoded.reduce((s, p) => s + p.index.length / 3, 0);
  if (emittedVerts !== measuredVerts) {
    throw new Error(`vertex count ${emittedVerts} !== measured ${measuredVerts}`);
  }
  if (emittedTris !== measuredTris) {
    throw new Error(`triangle count ${emittedTris} !== measured ${measuredTris}`);
  }
  if (decoded.length !== measured.parts.length) {
    throw new Error(`part count ${decoded.length} !== measured ${measured.parts.length}`);
  }
  for (let i = 0; i < decoded.length; i += 1) {
    if (decoded[i].meta.id !== measured.parts[i].name) {
      throw new Error(`part order drifted: ${decoded[i].meta.id} vs ${measured.parts[i].name}`);
    }
  }

  const clipNames = measured.animations.map((c) => c.name);
  const qLimit = Math.max(step[0], step[1], step[2]) * 1.5;
  const canonical = opts.canonical !== false;
  const gates = [
    gate('vertexCount', emittedVerts, emittedVerts === measuredVerts, { measured: measuredVerts }),
    gate('triangleCount', emittedTris, emittedTris === measuredTris, { measured: measuredTris }),
    gate('boneCount', measured.bones.length, canonical ? measured.bones.length === 25 : measured.bones.length > 0, { measured: canonical ? 25 : measured.bones.length }),
    gate('clipCount', clipNames.length, canonical ? clipNames.length >= 4 : clipNames.length > 0, { measured: clipNames }),
    gate('quantizationError', maxQErr, maxQErr <= qLimit, { threshold: qLimit, step }),
    gate('weightError', maxWErr, maxWErr <= 2 / 65535 + 1e-12, { threshold: 2 / 65535 }),
    gate('weightSum', maxWSumDev, maxWSumDev < 1e-5, { threshold: 1e-5 }),
    gate('bindDelta', maxBind, maxBind < 1e-5, { threshold: 1e-5 }),
  ];
  for (const clip of measured.animations) {
    const packedClip = rig.clips.find((c) => c.name === clip.name);
    const durOk = packedClip && Math.abs(packedClip.duration - clip.duration) < 1e-6;
    gates.push(gate(`clip:${clip.name}`, clip.duration, Boolean(durOk)));
  }

  mkdirSync(outDir, { recursive: true });
  copyFileSync(CODEC_SRC, join(outDir, 'meshCodec.js'));

  const surfaceJs =
    `/** GENERATED by encode_force_measured.mjs — do not edit.\n` +
    ` * ${id}: ${emittedVerts} verts, ${emittedTris} tris, stream ${(stream.length / 1e6).toFixed(2)} MB.\n` +
    ` */\n` +
    `export const SURFACE_MODEL = ${JSON.stringify(model, null, 2)};\n\n` +
    `export const SURFACE_STREAM =\n  '${base64}';\n`;
  writeFileSync(join(outDir, 'surfaceData.js'), surfaceJs);

  const rigJs =
    `/** GENERATED by encode_force_measured.mjs — skeleton + clips for ${id}. */\n` +
    `export const RIG = ${JSON.stringify(rig)};\n`;
  writeFileSync(join(outDir, 'rigData.js'), rigJs);

  const threeImport = opts.threeImport || 'three';
  const codecImport = opts.codecImport || './meshCodec.js';
  writeFileSync(join(outDir, 'createFighterModel.js'), factorySource({
    id, displayName, threeImport, codecImport,
    parts: packed.map((p) => p.meta.id),
    clips: clipNames,
    height,
  }));

  const flagged = gates.filter((g) => g.status !== 'pass');
  const parity = {
    kind: 'force-measured-parity',
    id,
    displayName,
    source: resolve(glbPath),
    outDir: resolve(outDir),
    ms: Date.now() - t0,
    verts: emittedVerts,
    tris: emittedTris,
    bones: measured.bones.length,
    clips: clipNames,
    streamBytes: stream.length,
    surfaceJsBytes: surfaceJs.length,
    height,
    quantization: { origin, extent, step },
    gates,
    ok: flagged.length === 0,
  };
  writeFileSync(join(outDir, 'parity.json'), JSON.stringify(parity, null, 2) + '\n');

  emit(listener, {
    stage: 'encode',
    status: parity.ok ? 'pass' : 'flag',
    message: parity.ok
      ? `Packed ${emittedVerts} verts / ${emittedTris} tris into ${(surfaceJs.length / 1e6).toFixed(2)} MB of JS`
      : `Packed with flags: ${flagged.map((g) => g.name).join(', ')}`,
    parity,
    ms: parity.ms,
  });
  return parity;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const args = process.argv.slice(2);
  const glb = args.find((a) => a.endsWith('.glb'));
  const out = args.find((a, i) => args[i - 1] !== '--id' && args[i - 1] !== '--name' && args[i - 1] !== '--three' && args[i - 1] !== '--codec' && a !== glb && !a.startsWith('--'));
  const id = args.includes('--id') ? args[args.indexOf('--id') + 1] : 'fighter';
  const name = args.includes('--name') ? args[args.indexOf('--name') + 1] : id;
  if (!glb || !out) {
    console.error('usage: node tools/encode_force_measured.mjs <rigged.glb> <outDir> --id trump --name Trump');
    process.exit(2);
  }
  try {
    const log = (ev) => { if (ev.message) console.log(ev.message); };
    const parity = encodeForceMeasured(resolve(glb), resolve(out), { id, displayName: name, onEvent: log });
    if (!parity.ok) process.exitCode = 1;
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
