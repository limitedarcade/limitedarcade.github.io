import { writeFileSync } from 'node:fs';

// Same BFI2 layout as pack-runtime.mjs, reusable by an individual builder.
export function packFighterModel(path, model, stream, sourceRig) {
  const surface = Buffer.from(stream, 'base64'), rig = structuredClone(sourceRig);
  let size = (surface.length + 3) & ~3;
  const pieces = [surface, Buffer.alloc(size - surface.length)];
  for (const clip of rig.clips) for (const track of clip.tracks) {
    for (const key of ['times', 'position', 'quaternion', 'scale']) {
      if (!track[key]) continue;
      const bytes = Buffer.from(track[key], 'base64');
      track[key] = { offset: size, length: bytes.length / 4 };
      size += bytes.length; pieces.push(bytes);
    }
  }
  const metadata = Buffer.from(JSON.stringify({ model, rig, surfaceLength: surface.length }));
  const head = Buffer.alloc((8 + metadata.length + 3) & ~3);
  head.writeUInt32LE(0x32494642, 0); head.writeUInt32LE(metadata.length, 4); metadata.copy(head, 8);
  const packed = Buffer.concat([head, ...pieces]);
  writeFileSync(path, packed);
  return packed.length;
}
