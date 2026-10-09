// Pack a Three.js ObjectLoader JSON (model.json, gore/viscera.json) into one
// compact binary the game reads with render/scenePack.js.
//
//   node tools/pack-scene.mjs in.json out.bin [--image-quality 88]
//
// The JSON form spends ~10 characters per float and base64-inflates every
// texture. The pack keeps the exact same scene description, but moves each
// vertex/index array out into a meshopt-compressed binary block (lossless: the
// decoded floats are bit-identical) and re-encodes embedded PNG textures as
// WebP. Nothing else changes, so ObjectLoader builds the same object graph.
//
// Layout ("BFS1"):  u32 magic | u32 jsonBytes | json | pad to 4 | blocks...
// In the JSON, arrays become {"$bin":[offset, byteLength, count, stride, mode]}
// and images become {"$img":[offset, byteLength, mime]}; offsets are relative
// to the first block.
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

export const MAGIC = 0x31534642; // "BFS1"
const TYPES = { Float32Array: [Float32Array, 4], Uint32Array: [Uint32Array, 4], Uint16Array: [Uint16Array, 2],
  Int16Array: [Int16Array, 2], Uint8Array: [Uint8Array, 1], Int8Array: [Int8Array, 1] };

export async function packScene(json, { imageQuality = 88 } = {}) {
  await MeshoptEncoder.ready;
  const blocks = []; let cursor = 0;
  const push = bytes => {
    const offset = cursor; blocks.push(bytes);
    const padded = (bytes.byteLength + 3) & ~3;
    if (padded !== bytes.byteLength) blocks.push(new Uint8Array(padded - bytes.byteLength));
    cursor += padded; return offset;
  };
  const scene = structuredClone(json);
  let rawBytes = 0;
  const packArray = (attribute, isIndex) => {
    const [Type, bytesPer] = TYPES[attribute.type] || [];
    if (!Type) return;
    const values = Type.from(attribute.array);
    rawBytes += values.byteLength;
    // meshopt needs a 4-byte-multiple stride. Indices use its order-preserving
    // sequence codec, not the triangle codec, which rotates vertices within a
    // triangle -- same picture, but no longer bit-identical to the master, and
    // code that walks raw indices would see a different order.
    // Anything that doesn't fit is stored raw (mode 'RAW').
    let mode = 'RAW', count = values.length, stride = bytesPer, data = new Uint8Array(values.buffer);
    if (isIndex && bytesPer >= 2) { mode = 'INDICES'; }
    else if (!isIndex && (attribute.itemSize * bytesPer) % 4 === 0 && attribute.itemSize * bytesPer <= 256) {
      mode = 'ATTRIBUTES'; stride = attribute.itemSize * bytesPer; count = values.length / attribute.itemSize;
    }
    if (mode !== 'RAW') data = MeshoptEncoder.encodeGltfBuffer(data, count, stride, mode);
    attribute.array = { $bin: [push(data), data.byteLength, count, stride, mode] };
  };
  for (const geometry of scene.geometries || []) {
    const data = geometry.data || {};
    for (const attribute of Object.values(data.attributes || {})) packArray(attribute, false);
    for (const list of Object.values(data.morphAttributes || {})) for (const attribute of list) packArray(attribute, false);
    if (data.index) packArray(data.index, true);
  }
  for (const image of scene.images || []) {
    if (typeof image.url !== 'string' || !image.url.startsWith('data:')) continue;
    const source = Buffer.from(image.url.slice(image.url.indexOf(',') + 1), 'base64');
    const webp = await sharp(source).webp({ quality: imageQuality }).toBuffer();
    const [bytes, mime] = webp.byteLength < source.byteLength ? [webp, 'image/webp'] : [source, image.url.slice(5, image.url.indexOf(';'))];
    image.url = { $img: [push(new Uint8Array(bytes)), bytes.byteLength, mime] };
  }
  const header = Buffer.from(JSON.stringify(scene));
  const head = Buffer.alloc((8 + header.length + 3) & ~3);
  head.writeUInt32LE(MAGIC, 0); head.writeUInt32LE(header.length, 4); header.copy(head, 8);
  return { bytes: Buffer.concat([head, ...blocks.map(b => Buffer.from(b.buffer, b.byteOffset, b.byteLength))]), rawBytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, output, flag, value] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node tools/pack-scene.mjs in.json out.bin [--image-quality 88]');
  const source = await readFile(input);
  const { bytes } = await packScene(JSON.parse(source), flag === '--image-quality' ? { imageQuality: Number(value) } : {});
  await writeFile(output, bytes);
  console.log(`${input}: ${(source.length / 1048576).toFixed(2)} MB -> ${(bytes.length / 1048576).toFixed(2)} MB`);
}
