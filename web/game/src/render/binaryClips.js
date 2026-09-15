import * as THREE from '../vendor/three.module.js';

// Tiny JSON directory followed by aligned float tracks. No numeric JS literals
// to compile, and tracks are views into the fetched buffer rather than copies.
export function decodeClips(buffer) {
  const header = new DataView(buffer);
  if (header.byteLength < 8 || header.getUint32(0, true) !== 0x31494642) throw new Error('Invalid animation pack');
  const length = header.getUint32(4, true), offset = (8 + length + 3) & ~3;
  if (offset > buffer.byteLength) throw new Error('Truncated animation pack');
  const metadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length)));
  return metadata.map(data => {
    const clip = new THREE.AnimationClip(data.name, data.duration, data.tracks.map(t => {
    const Track = t.type === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new Track(t.name, new Float32Array(buffer, offset + t.times * 4, t.count),
      new Float32Array(buffer, offset + t.values * 4, t.count * (t.type === 'quaternion' ? 4 : 3)), t.interpolation);
    }));
    clip.userData = data.userData || {};
    return clip;
  });
}

const cache = new Map();
export async function loadBinaryClips(id) {
  return loadClipAsset(`fighters/${id}/combat.bin`);
}
export async function loadClipAsset(path) {
  if (!cache.has(path)) cache.set(path, fetch(`${import.meta.env.BASE_URL}${path}`)
    .then(response => { if (!response.ok) throw Error(`Animations: ${response.status}`); return response.arrayBuffer(); })
    .then(decodeClips).catch(error => { cache.delete(path); throw error; }));
  return cache.get(path);
}
