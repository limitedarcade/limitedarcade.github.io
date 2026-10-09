// Shrink a runtime GLB without changing what the game can see in it.
//
//   node tools/optimize-glb.mjs in.glb out.glb [--texture-size 1024]
//       [--texture-quality 85] [--simplify 0.1] [--simplify-error 0.001]
//       [--quantize safe|all|none] [--no-meshopt]
//
// The build runs this for every entry in tools/asset-pipeline.json; you only
// call it directly to try settings on one file. The masters in game/public are
// never touched -- tests read them, and the optimised copy is a build output.
//
// What is kept on purpose, because game code looks things up by name:
//   - empty nodes (stage markers such as `lake-america-axe`), via keepLeaves;
//   - differently named but identical materials, via keepUniqueNames;
//   - every vertex attribute, via keepAttributes (uv1 feeds light maps).
//
// Quantize modes. `safe` (the default) packs normals, UVs, colours and skin
// weights into small integers and leaves POSITION as float, so geometry stays
// in authored space and code reading bounds or vertices gets the numbers it
// always did. `all` also quantizes positions, which rewrites node transforms;
// use it only for assets nothing inspects (weapons, props). `none` skips it.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, quantize, reorder, resample, simplify, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const DEFAULTS = Object.freeze({
  textureSize: 2048, textureQuality: 85, normalQuality: 92,
  simplify: null, simplifyError: 0.001, quantize: 'safe', meshopt: true,
});

const SAFE_ATTRIBUTES = /^(NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+|WEIGHTS_\d+)$/;

async function io() {
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
}

function stats(document) {
  const root = document.getRoot();
  let triangles = 0;
  for (const mesh of root.listMeshes()) for (const primitive of mesh.listPrimitives()) {
    const indices = primitive.getIndices();
    triangles += (indices ? indices.getCount() : primitive.getAttribute('POSITION')?.getCount() || 0) / 3;
  }
  return { triangles: Math.round(triangles), textures: root.listTextures().length,
    nodes: root.listNodes().length, animations: root.listAnimations().length };
}

export async function optimizeGlb(input, output, options = {}) {
  const settings = { ...DEFAULTS, ...options };
  const reader = await io();
  const document = await reader.read(input);
  const before = stats(document);
  const names = new Set(document.getRoot().listNodes().map(node => node.getName()).filter(Boolean));

  const steps = [
    dedup({ keepUniqueNames: true }),
    prune({ keepLeaves: true, keepAttributes: true, keepIndices: true, keepExtras: true }),
    resample(),
  ];
  if (settings.simplify) {
    await MeshoptSimplifier.ready;
    steps.push(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: settings.simplify, error: settings.simplifyError }));
  }
  if (settings.textureSize || settings.textureQuality) {
    const resize = settings.textureSize ? [settings.textureSize, settings.textureSize] : undefined;
    steps.push(
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize, quality: settings.normalQuality, slots: /^normalTexture$/ }),
      textureCompress({ encoder: sharp, targetFormat: 'webp', resize, quality: settings.textureQuality, slots: /^(?!normalTexture$).*/ }),
    );
  }
  if (settings.meshopt) steps.push(reorder({ encoder: MeshoptEncoder }));
  if (settings.quantize === 'safe') steps.push(quantize({ pattern: SAFE_ATTRIBUTES }));
  else if (settings.quantize === 'all') steps.push(quantize());
  await document.transform(...steps);

  if (settings.meshopt) {
    document.createExtension(EXTMeshoptCompression).setRequired(true)
      .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  }
  // A name the game looks up must survive. prune/dedup are configured to keep
  // them; this is the tripwire if a future gltf-transform changes a default.
  const kept = new Set(document.getRoot().listNodes().map(node => node.getName()));
  const lost = [...names].filter(name => !kept.has(name));
  if (lost.length) throw new Error(`optimize-glb dropped named nodes from ${input}: ${lost.slice(0, 8).join(', ')}`);

  const bytes = await reader.writeBinary(document);
  if (output) { const { writeFile } = await import('node:fs/promises'); await writeFile(output, bytes); }
  return { bytes, before, after: stats(document) };
}

function parseArgs(argv) {
  const [input, output, ...rest] = argv, options = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i], value = rest[i + 1];
    if (flag === '--texture-size') { options.textureSize = Number(value); i++; }
    else if (flag === '--texture-quality') { options.textureQuality = Number(value); i++; }
    else if (flag === '--simplify') { options.simplify = Number(value); i++; }
    else if (flag === '--simplify-error') { options.simplifyError = Number(value); i++; }
    else if (flag === '--quantize') { options.quantize = value; i++; }
    else if (flag === '--no-meshopt') options.meshopt = false;
    else throw new Error(`Unknown option ${flag}`);
  }
  return { input, output, options };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { input, output, options } = parseArgs(process.argv.slice(2));
  if (!input || !output) throw new Error('Usage: node tools/optimize-glb.mjs in.glb out.glb [options]');
  const { statSync } = await import('node:fs');
  const { bytes, before, after } = await optimizeGlb(input, output, options);
  const mb = n => `${(n / 1048576).toFixed(2)} MB`;
  console.log(`${input}: ${mb(statSync(input).size)} -> ${mb(bytes.byteLength)}`);
  console.log(`  triangles ${before.triangles} -> ${after.triangles}, textures ${before.textures} -> ${after.textures}`);
}
