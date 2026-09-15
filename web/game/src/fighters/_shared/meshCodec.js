// Force-measured fighter codec. Rebuilds the six named parts, the canonical
// skeleton, and the authored clips from the packed stream that ships beside
// the factory. Nothing is fetched at runtime.
//
// Stream layout, per part, in order:
//   positions  3 x uint16 LE, quantised over the figure's own bounding box
//   normals    16-bit octahedral (~1°)
//   colours    8-bit sRGB, converted to linear when the geometry is built
//   joints     4 x uint8 skin indices
//   weights    4 x uint16, 0..65535, renormalised on decode
//   indices    varint zigzag deltas, three per triangle
//
// Pass the Three.js namespace in — the pack uses `three`, the game uses its
// vendored copy. This file itself does not import Three.js.

export const CODEC_VERSION = 2;
export const PART_ORDER = ['Head', 'Torso', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'];

function decodeBase64(text) {
  if (text instanceof Uint8Array) return text;
  if (typeof atob === 'function') {
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }
  return Buffer.from(text, 'base64');
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function decodeOctNormal(packed, out, at) {
  let x = ((packed & 0xff) / 255) * 2 - 1;
  let y = ((packed >> 8) / 255) * 2 - 1;
  const z = 1 - Math.abs(x) - Math.abs(y);
  if (z < 0) {
    const ox = x;
    x = (1 - Math.abs(y)) * (ox >= 0 ? 1 : -1);
    y = (1 - Math.abs(ox)) * (y >= 0 ? 1 : -1);
  }
  const len = Math.hypot(x, y, z) || 1;
  out[at] = x / len;
  out[at + 1] = y / len;
  out[at + 2] = z / len;
}

function decodeFloats(text) {
  if (text instanceof Float32Array) return text;
  const bytes = decodeBase64(text);
  const out = new Float32Array(bytes.length / 4);
  new Uint8Array(out.buffer).set(bytes);
  return out;
}

export function* decodeParts(model, base64) {
  if (model.version !== CODEC_VERSION) {
    throw new Error(`unsupported fighter stream version ${String(model.version)}`);
  }
  const stream = decodeBase64(base64);
  const { origin, extent } = model.quantization;
  let at = 0;

  const readVarint = () => {
    let value = 0;
    let shift = 1;
    for (;;) {
      if (at >= stream.length) throw new Error('surface stream: truncated varint');
      const byte = stream[at];
      at += 1;
      value += (byte & 0x7f) * shift;
      if ((byte & 0x80) === 0) return value;
      shift *= 128;
    }
  };

  for (const meta of model.parts) {
    const n = meta.vertexCount;
    const t = meta.triangleCount;
    const b = meta.bytes;
    if (b.positions !== n * 6 || b.normals !== n * 2 || b.colours !== n * 3
        || b.joints !== n * 4 || b.weights !== n * 8) {
      throw new Error(`part ${meta.id}: section sizes disagree with the vertex count`);
    }

    const position = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 1) {
      const q = stream[at] | (stream[at + 1] << 8);
      at += 2;
      position[i] = origin[i % 3] + (q / 65535) * extent[i % 3];
    }

    const normal = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      const packed = stream[at] | (stream[at + 1] << 8);
      at += 2;
      decodeOctNormal(packed, normal, i * 3);
    }

    const colour = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i += 1) {
      colour[i] = srgbToLinear(stream[at] / 255);
      at += 1;
    }

    const joints = new Uint8Array(n * 4);
    joints.set(stream.subarray(at, at + n * 4));
    at += n * 4;

    const weights = new Float32Array(n * 4);
    for (let i = 0; i < n; i += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        const q = stream[at] | (stream[at + 1] << 8);
        at += 2;
        weights[i * 4 + k] = q / 65535;
        sum += q / 65535;
      }
      if (sum > 0) {
        for (let k = 0; k < 4; k += 1) weights[i * 4 + k] /= sum;
      }
    }

    const indicesAt = at;
    const index = new Uint32Array(t * 3);
    let previous = 0;
    for (let i = 0; i < t * 3; i += 1) {
      const raw = readVarint();
      previous += raw % 2 === 0 ? raw / 2 : -(raw + 1) / 2;
      if (previous < 0 || previous >= n) {
        throw new Error(`part ${meta.id}: index ${previous} out of range for ${n} vertices`);
      }
      index[i] = previous;
    }
    if (at - indicesAt !== b.indices) {
      throw new Error(`part ${meta.id}: index section ${at - indicesAt} bytes, expected ${b.indices}`);
    }

    yield { meta, position, normal, colour, joints, weights, index };
  }

  if (at !== stream.length) {
    throw new Error(`surface stream: consumed ${at} of ${stream.length} bytes`);
  }
}

export function decodeModel(model, base64) {
  return [...decodeParts(model, base64)];
}

function makeMaterial(THREE, roughness) {
  return new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: 0,
    roughness: roughness ?? 0.62,
    side: THREE.FrontSide,
  });
}

function buildSkeleton(THREE, rig) {
  const bones = rig.bones.map((b) => {
    const bone = new THREE.Bone();
    bone.name = b.name;
    bone.position.set(b.position[0], b.position[1], b.position[2]);
    bone.quaternion.set(b.quaternion[0], b.quaternion[1], b.quaternion[2], b.quaternion[3]);
    bone.scale.set(b.scale[0], b.scale[1], b.scale[2]);
    return bone;
  });
  let root = null;
  rig.bones.forEach((b, i) => {
    if (b.parent >= 0) bones[b.parent].add(bones[i]);
    else if (!root) root = bones[i];
  });
  const inverses = rig.bones.map((b) => new THREE.Matrix4().fromArray(b.inverseBind));
  const skeleton = new THREE.Skeleton(bones, inverses);
  return { bones, skeleton, root: root ?? bones[0] };
}

function buildClips(THREE, rig) {
  return rig.clips.map((clip) => {
    const tracks = [];
    for (const track of clip.tracks) {
      const name = rig.bones[track.bone]?.name;
      if (!name) continue;
      const times = decodeFloats(track.times);
      if (track.position) {
        tracks.push(new THREE.VectorKeyframeTrack(
          `${name}.position`, times, decodeFloats(track.position),
        ));
      }
      if (track.quaternion) {
        tracks.push(new THREE.QuaternionKeyframeTrack(
          `${name}.quaternion`, times, decodeFloats(track.quaternion),
        ));
      }
      if (track.scale) {
        tracks.push(new THREE.VectorKeyframeTrack(
          `${name}.scale`, times, decodeFloats(track.scale),
        ));
      }
    }
    return new THREE.AnimationClip(clip.name, clip.duration, tracks);
  });
}

const LOOPING = new Set(['tpose', 'guard', 'idle']);

export function buildFighter(THREE, model, base64, rig, options = {}) {
  const decoded = options.decodedParts || decodeModel(model, base64);
  const group = new THREE.Group();
  group.name = model.id || 'fighter';

  const { skeleton, root } = buildSkeleton(THREE, rig);
  group.add(root);
  root.updateMatrixWorld(true);

  const parts = [];
  const figure = { x: 0, y: 0, z: 0, n: 0 };
  for (const part of decoded) {
    const { min, max } = part.meta.bounds;
    figure.x += (min[0] + max[0]) * 0.5;
    figure.y += (min[1] + max[1]) * 0.5;
    figure.z += (min[2] + max[2]) * 0.5;
    figure.n += 1;
  }
  figure.x /= figure.n || 1;
  figure.y /= figure.n || 1;
  figure.z /= figure.n || 1;

  for (const part of decoded) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(part.normal, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(part.colour, 3));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(part.joints, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(part.weights, 4));
    const index = part.position.length / 3 <= 65535 ? new Uint16Array(part.index) : part.index;
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mesh = new THREE.SkinnedMesh(geometry, makeMaterial(THREE, part.meta.roughness));
    mesh.name = part.meta.id;
    mesh.castShadow = options.castShadow ?? true;
    mesh.receiveShadow = options.receiveShadow ?? true;
    mesh.frustumCulled = false;
    mesh.bind(skeleton);
    mesh.userData.part = {
      id: part.meta.id,
      triangles: part.meta.triangleCount,
      vertices: part.meta.vertexCount,
    };
    const { min, max } = part.meta.bounds;
    const cx = (min[0] + max[0]) * 0.5 - figure.x;
    const cy = (min[1] + max[1]) * 0.5 - figure.y;
    const cz = (min[2] + max[2]) * 0.5 - figure.z;
    const len = Math.hypot(cx, cy, cz) || 1;
    const dist = (model.height || 1) * 0.42;
    mesh.userData.explode = [cx / len * dist, cy / len * dist, cz / len * dist];
    group.add(mesh);
    parts.push({ id: part.meta.id, mesh });
  }

  const mixer = new THREE.AnimationMixer(group);
  const clips = buildClips(THREE, rig);
  const clipMap = Object.fromEntries(clips.map((c) => [c.name, c]));
  let current = null;

  const play = (which, fadeSeconds = 0.12) => {
    const clip = typeof which === 'number' ? clips[which] : clipMap[which];
    if (!clip) return false;
    const next = mixer.clipAction(clip);
    const loop = LOOPING.has(clip.name);
    next.reset();
    next.enabled = true;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    if (current && current !== next && fadeSeconds > 0) {
      next.crossFadeFrom(current, fadeSeconds, false).play();
    } else {
      current?.stop();
      next.play();
    }
    current = next;
    return true;
  };

  const explode = (t) => {
    const k = Math.min(1, Math.max(0, t));
    for (const { mesh } of parts) {
      const d = mesh.userData.explode;
      mesh.position.set(d[0] * k, d[1] * k, d[2] * k);
    }
  };

  if (clipMap.guard) play('guard', 0);
  else if (clips.length) play(0, 0);

  const built = {
    group,
    mixer,
    clips,
    clipMap,
    parts,
    skeleton,
    play,
    explode,
    update: (dt) => mixer.update(dt),
    dispose: () => {
      mixer.stopAllAction();
      group.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) node.material.dispose();
      });
    },
  };
  group.userData.fighter = built;
  group.userData.height = model.height;
  group.userData.sculptRuntime = {
    route: 'force-measured encode of a Route C rigged GLB',
    exactnessTier: 'measured-surface',
    skeleton: 'canonical-fighter-v1',
  };
  return built;
}
