// The BFS1 scene-pack reader, with no imports of its own: the game passes its
// vendored three and meshopt decoder (render/scenePack.js), and made.html --
// which runs outside the bundle -- passes the copies vite emits to
// assets/vendor/. One reader, so the two can never disagree about the format.
//
// Format written by tools/pack-scene.mjs: a Three.js ObjectLoader JSON whose
// vertex arrays live in meshopt-compressed binary blocks and whose textures are
// WebP. Returns exactly what ObjectLoader would have built from the original.
const MAGIC = 0x31534642; // "BFS1"
const TYPES = { Float32Array, Uint32Array, Uint16Array, Int16Array, Uint8Array, Int8Array };

export async function parseScenePack(buffer, { ObjectLoader, MeshoptDecoder }) {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== MAGIC) throw new Error('Not a BFS1 scene pack');
  const jsonBytes = view.getUint32(4, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, jsonBytes)));
  const base = (8 + jsonBytes + 3) & ~3;
  await MeshoptDecoder.ready;
  const unpack = attribute => {
    const ref = attribute.array?.$bin;
    if (!ref) return;
    const [offset, byteLength, count, stride, mode] = ref, Type = TYPES[attribute.type];
    const source = new Uint8Array(buffer, base + offset, byteLength);
    const target = new Uint8Array(mode === 'RAW' ? byteLength : count * stride);
    if (mode === 'RAW') target.set(source);
    else MeshoptDecoder.decodeGltfBuffer(target, count, stride, source, mode);
    attribute.array = new Type(target.buffer);
  };
  for (const geometry of json.geometries || []) {
    const data = geometry.data || {};
    for (const attribute of Object.values(data.attributes || {})) unpack(attribute);
    for (const list of Object.values(data.morphAttributes || {})) for (const attribute of list) unpack(attribute);
    if (data.index) unpack(data.index);
  }
  const urls = [];
  for (const image of json.images || []) {
    const ref = image.url?.$img;
    if (!ref) continue;
    const [offset, byteLength, mime] = ref;
    image.url = URL.createObjectURL(new Blob([new Uint8Array(buffer, base + offset, byteLength)], { type: mime }));
    urls.push(image.url);
  }
  // parseAsync waits for every image to decode, so the blob URLs can go after.
  try { return await new ObjectLoader().parseAsync(json); }
  finally { for (const url of urls) URL.revokeObjectURL(url); }
}
