import { writeFile, mkdir } from 'node:fs/promises';

for (const id of ['trump', 'carney']) {
  const { SPECIAL_CLIPS } = await import(`../game/src/fighters/${id}/specialClips.js`);
  const chunks = [], metadata = []; let cursor = 0;
  for (const clip of SPECIAL_CLIPS) {
    const tracks = clip.tracks.map(track => {
      const times = cursor; cursor += track.times.length;
      const values = cursor; cursor += track.values.length;
      chunks.push(Float32Array.from(track.times), Float32Array.from(track.values));
      return { name: track.name, type: track.type, count: track.times.length, times, values, interpolation: track.interpolation };
    });
    metadata.push({ name: clip.name, duration: clip.duration, tracks });
  }
  const json = Buffer.from(JSON.stringify(metadata));
  const headerSize = (8 + json.length + 3) & ~3;
  const buffer = Buffer.alloc(headerSize + cursor * 4);
  buffer.writeUInt32LE(0x31494642, 0); buffer.writeUInt32LE(json.length, 4); json.copy(buffer, 8);
  let pos = headerSize;
  for (const chunk of chunks) { Buffer.from(chunk.buffer).copy(buffer, pos); pos += chunk.byteLength; }
  const dir = new URL(`../game/public/fighters/${id}/`, import.meta.url);
  await mkdir(dir, { recursive: true }); await writeFile(new URL('combat.bin', dir), buffer);
  console.log(`${id}: ${SPECIAL_CLIPS.length} clips → ${(buffer.byteLength / 1024).toFixed(0)} KiB binary`);
  const { SURFACE_MODEL, SURFACE_STREAM } = await import(`../game/src/fighters/${id}/surfaceData.js`);
  const { RIG } = await import(`../game/src/fighters/${id}/rigData.js`);
  const surface = Buffer.from(SURFACE_STREAM, 'base64');
  const rig = structuredClone(RIG), pieces = [surface];
  let size = (surface.length + 3) & ~3;
  pieces.push(Buffer.alloc(size - surface.length));
  for (const clip of rig.clips) for (const track of clip.tracks) for (const key of ['times', 'position', 'quaternion', 'scale']) {
    if (!track[key]) continue;
    const bytes = Buffer.from(track[key], 'base64');
    track[key] = { offset: size, length: bytes.length / 4 }; size += bytes.length; pieces.push(bytes);
  }
  const directory = Buffer.from(JSON.stringify({ model: SURFACE_MODEL, rig, surfaceLength: surface.length }));
  const head = Buffer.alloc((8 + directory.length + 3) & ~3);
  head.writeUInt32LE(0x32494642, 0); head.writeUInt32LE(directory.length, 4); directory.copy(head, 8);
  const packed = Buffer.concat([head, ...pieces]);
  await writeFile(new URL('fighter.bin', dir), packed);
  console.log(`${id}: mesh + base clips → ${(packed.length / 1024 / 1024).toFixed(2)} MiB binary`);
}
