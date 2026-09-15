// Build the viscera prop library the gore system throws around.
//
// Two source files, neither of which is a character:
//
//   organs.glb  is a genuine organ set -- brain, heart, eye, intestine, spine,
//               ribs -- authored as separate props. This is the good stuff.
//   gib2.glb    is a wound-overlay library for a base body that is not in the
//               file, so it cannot be a fighter. But the pieces it removes are
//               real geometry: every `_Inverse` mesh is the chunk that comes
//               OFF (the skull cap, the jaw, the ripped limb), and those are
//               exactly what a dismemberment system wants to throw.
//
// Everything here is baked to static geometry in its bind pose. These are
// tumbling props; nothing needs a skeleton, and stripping it drops the runtime
// cost to a plain Mesh.
//
// Scale is normalised per prop rather than by one file-wide ratio, because the
// two sources do not agree on units and neither states one. `span` in the atlas
// is the real-world size of the prop's longest axis, in metres, and is the
// single source of truth -- the same number the procedural fallback uses, so a
// real mesh and a generated blob are never different sizes.

import * as THREE from 'three';
import { fileURLToPath } from 'node:url';
import { readScene, saveScene } from './convert-scene.mjs';
import { PROP_SOURCES } from '../game/src/render/goreAtlas.js';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));

// Collect every mesh in a scene, keyed by the material name that identifies it.
// The node names in both files are `Object_N`, so the material is the only
// place the original part name survived the Sketchfab export.
function meshesByMaterial(scene) {
  const found = new Map();
  scene.traverse(node => {
    if (!node.isMesh || !node.geometry?.attributes?.position) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    const name = materials[0]?.name || '';
    if (!name) return;
    if (!found.has(name)) found.set(name, []);
    found.get(name).push(node);
  });
  return found;
}

// Bake one source mesh into a standalone prop: skinning dropped, geometry
// centred on its own bounds, and scaled so its longest axis matches `span`.
// ObjectLoader writes attribute arrays as JSON text, so every retained channel
// and every surplus digit is paid for in download size. These props are
// fist-sized, seen tumbling for under a second and then lying in a puddle:
// position and normal at a tenth of a millimetre is past the point where any
// of it is visible, and it takes the library from 13 MB to something a web
// build can carry.
function quantize(geometry, decimals) {
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const step = 10 ** (decimals[name] ?? 4);
    const rounded = new Float32Array(attribute.array.length);
    for (let i = 0; i < attribute.array.length; i++) {
      rounded[i] = Math.round(attribute.array[i] * step) / step;
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(rounded, attribute.itemSize));
  }
}

function bakeProp(source, { id, span, keepTexture }) {
  const geometry = source.geometry.clone();
  // Only position and normal survive. Skinning is meaningless on a loose prop,
  // and the UVs address a body atlas that these chunks no longer render with.
  for (const attribute of Object.keys(geometry.attributes)) {
    if (attribute !== 'position' && attribute !== 'normal') geometry.deleteAttribute(attribute);
  }
  if (keepTexture) geometry.setAttribute('uv', source.geometry.attributes.uv);
  geometry.morphAttributes = {};
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const centre = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);
  const longest = Math.max(size.x, size.y, size.z);
  if (longest > 0) geometry.scale(span / longest, span / longest, span / longest);
  geometry.computeVertexNormals();
  quantize(geometry, { position: 4, normal: 3 });
  geometry.computeBoundingSphere();

  const from = Array.isArray(source.material) ? source.material[0] : source.material;
  // The source textures are body skin atlases: on a fist-sized chunk they read
  // as noise, and they carry the whole 20 MB of image payload into the asset.
  // A wet flesh material is both smaller and more legible at prop size.
  const material = keepTexture && from?.map
    ? new THREE.MeshStandardMaterial({ map: from.map, roughness: 0.34, metalness: 0 })
    : new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.30, 0.028, 0.034),
      roughness: 0.24, metalness: 0,
      emissive: new THREE.Color(0.045, 0.002, 0.004),
    });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = id;
  return mesh;
}

const scenes = new Map();
async function sceneFor(file) {
  if (!scenes.has(file)) scenes.set(file, (await readScene(path(`../fighters/Gib/${file}`))).scene);
  return scenes.get(file);
}

const library = new THREE.Group();
library.name = 'viscera';
const report = [];
const missing = [];

for (const spec of PROP_SOURCES) {
  const scene = await sceneFor(spec.file);
  const byMaterial = meshesByMaterial(scene);
  const candidates = byMaterial.get(spec.material);
  if (!candidates?.length) { missing.push(`${spec.id}: no mesh with material ${spec.material}`); continue; }
  // Where a material covers several meshes, `pick` selects by triangle order:
  // the variants are near-duplicates and the largest is the complete piece.
  const sorted = candidates.slice().sort((a, b) =>
    b.geometry.attributes.position.count - a.geometry.attributes.position.count);
  const source = sorted[Math.min(spec.pick ?? 0, sorted.length - 1)];
  const prop = bakeProp(source, spec);
  library.add(prop);
  report.push({ id: spec.id, span: spec.span, from: spec.file, material: spec.material,
    triangles: Math.round(prop.geometry.attributes.position.count / 3) });
}

if (missing.length) {
  console.error('Missing source meshes:\n  ' + missing.join('\n  '));
  process.exit(1);
}

await saveScene(library, path('../game/public/gore/viscera.json'));
console.table(report);
console.log(`${report.length} viscera props written to game/public/gore/viscera.json`);
