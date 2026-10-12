// Replace only the parchment's embedded image. Preserve all stage geometry,
// materials, compression and the other in-progress environment edits.
import fs from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const folder = resolve(root, 'stages/lake_america/blender/textures');
const recipe = fs.readFileSync(resolve(root, 'tools/props-lake-america-mcp.py'), 'utf8');
const designsPath = resolve(folder, 'satire-designs.json');
const designs = JSON.parse(fs.readFileSync(designsPath, 'utf8'));
const defs = recipe.match(/<defs><radialGradient id="paper"[\s\S]*?<\/mask><\/defs>/)?.[0];
if (!defs) throw new Error('Parchment design not found in authoring recipe');
designs['rights-scroll'] = designs['rights-scroll'].replace(/<defs>[\s\S]*?<\/defs>/, defs)
  .replace('opacity=".84" mask="url(#treadCuts)"', 'opacity=".78" mask="url(#treadCuts)"')
  .replace('stroke-width="8" opacity=".66"', 'stroke-width="5" opacity=".44"');
const png = await sharp(Buffer.from(designs['rights-scroll'])).png().toBuffer();
const path = resolve(root, 'game/public/stages/lake-america-3d/lake-america.glb');
const original = fs.readFileSync(path);
const jsonLength = original.readUInt32LE(12);
const gltf = JSON.parse(original.subarray(20, 20 + jsonLength).toString());
const image = gltf.images.find(entry => entry.name === 'rights-scroll_albedo');
if (!image) throw new Error('Parchment image missing from stage');
const view = gltf.bufferViews[image.bufferView];
const align = value => (value + 3) & ~3;
const bin = original.subarray(28 + jsonLength);
const start = view.byteOffset || 0, oldEnd = start + align(view.byteLength);
const padded = Buffer.alloc(align(png.length)); png.copy(padded);
const delta = padded.length - (oldEnd - start);
const updated = Buffer.concat([bin.subarray(0, start), padded, bin.subarray(oldEnd)]);
for (const other of gltf.bufferViews) if ((other.byteOffset || 0) >= oldEnd) other.byteOffset += delta;
view.byteLength = png.length;
gltf.buffers[0].byteLength += delta;
const json = Buffer.from(JSON.stringify(gltf));
const jsonPadded = Buffer.alloc(align(json.length), 32); json.copy(jsonPadded);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonPadded.length + updated.length, 8);
header.writeUInt32LE(jsonPadded.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(updated.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
fs.writeFileSync(path, Buffer.concat([header, jsonPadded, binHeader, updated]));
fs.writeFileSync(designsPath, `${JSON.stringify(designs)}\n`);
fs.writeFileSync(resolve(folder, 'rights-scroll_albedo.png'), png);
fs.writeFileSync(resolve(folder, 'rights-scroll.svg'), designs['rights-scroll']);
const manifestPath = resolve(root, 'game/public/stages/lake-america-3d/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.satireProps.footprint = 'Asymmetric muddy boot impression with broad toe, inset arch, separated heel and worn block lugs';
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Updated parchment image (${png.length} bytes); retained ${gltf.nodes.length} stage nodes.`);
