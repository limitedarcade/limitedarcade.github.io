import * as THREE from '../vendor/three.module.js';
import { MeshoptDecoder } from '../vendor/meshopt_decoder.module.js';
import { fetchBytes } from './loadProgress.js';
import { parseScenePack as parse } from './scenePackFormat.js';

// The game's entry point for BFS1 scene packs (tools/pack-scene.mjs). The
// format itself lives in scenePackFormat.js, shared with made.html.
export const parseScenePack = buffer => parse(buffer, { ObjectLoader: THREE.ObjectLoader, MeshoptDecoder });

export async function loadScenePack(url) {
  return parseScenePack(await fetchBytes(url));
}
