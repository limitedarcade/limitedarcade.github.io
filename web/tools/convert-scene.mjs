// Lossless GLB -> native Three.js ObjectLoader asset, including textures and rigs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self = globalThis;
globalThis.HTMLImageElement = class { constructor(src) { this.src = src; } };
THREE.TextureLoader.prototype.load = function(url, onLoad, progress, onError) {
  const texture = new THREE.Texture();
  fetch(url).then(async response => {
    if (!response.ok) throw Error(`Image: ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    texture.image = new HTMLImageElement(`data:${response.headers.get('content-type') || 'image/png'};base64,${data.toString('base64')}`);
    onLoad(texture);
  }).catch(onError);
  return texture;
};

export async function readScene(path) {
  const bytes = await readFile(path);
  return new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
}

export async function saveScene(scene, path) {
  const json = scene.toJSON();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(json));
  let meshes = 0, triangles = 0, skins = 0;
  scene.traverse(node => { if (node.isMesh) { meshes++; triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; if (node.isSkinnedMesh) skins++; } });
  const report = { meshes, triangles, skins, clips: scene.animations.map(c => c.name), textures: json.textures?.length || 0, images: json.images?.length || 0 };
  await writeFile(path.replace(/\.json$/, '.report.json'), JSON.stringify(report, null, 2));
  console.log(path, JSON.stringify(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw Error('Usage: node tools/convert-scene.mjs input.glb output.json');
  const gltf = await readScene(input);
  gltf.scene.animations = gltf.animations;
  await saveScene(gltf.scene, output);
}
