import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { MeshoptDecoder } from '../vendor/meshopt_decoder.module.js';

// Every runtime glTF goes through here. The build ships meshopt-compressed,
// WebP-textured copies (tools/optimize-glb.mjs, tools/asset-pipeline.json), and
// only a loader with the decoder attached can read them. A bare `new
// GLTFLoader()` works on the uncompressed masters and then fails in
// production, so don't construct one directly in game code.
export function createGltfLoader(manager) {
  return new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
}
