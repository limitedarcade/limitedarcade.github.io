import { GLTFLoader } from '../vendor/GLTFLoader.js';

const cache = new Map();
export function loadMocapClips(path) {
  if (!path) return Promise.resolve([]);
  if (!cache.has(path)) cache.set(path, new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}${path}`)
    .then(gltf => {
      // Three r170 does not copy animation extras to AnimationClip.
      for (const [i,clip] of gltf.animations.entries()) clip.userData = gltf.parser.json.animations[i].extras || {};
      return gltf.animations;
    }).catch(error => { cache.delete(path); throw error; }));
  return cache.get(path);
}
