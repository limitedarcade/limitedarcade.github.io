export function decodeModelPack(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || view.getUint32(0, true) !== 0x32494642) throw Error('Invalid fighter pack');
  const length = view.getUint32(4, true), start = (8 + length + 3) & ~3;
  const { model, rig, surfaceLength } = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 8, length)));
  for (const clip of rig.clips) for (const track of clip.tracks) {
    for (const key of ['times', 'position', 'quaternion', 'scale']) {
      if (track[key]) track[key] = new Float32Array(buffer, start + track[key].offset, track[key].length);
    }
  }
  return { model, rig, stream: new Uint8Array(buffer, start, surfaceLength) };
}

