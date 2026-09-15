import { decodeModelPack } from './modelPack.js';
import { decodeModel } from '../fighters/_shared/meshCodec.js';
self.onmessage = async ({ data: url }) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw Error(`Fighter: ${response.status}`);
    const pack = decodeModelPack(await response.arrayBuffer());
    const decodedParts = decodeModel(pack.model, pack.stream);
    const transfers = new Set();
    for (const part of decodedParts) for (const item of Object.values(part)) if (ArrayBuffer.isView(item)) transfers.add(item.buffer);
    for (const clip of pack.rig.clips) for (const track of clip.tracks)
      for (const item of Object.values(track)) if (ArrayBuffer.isView(item)) transfers.add(item.buffer);
    self.postMessage({ model: pack.model, rig: pack.rig, decodedParts }, [...transfers]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
