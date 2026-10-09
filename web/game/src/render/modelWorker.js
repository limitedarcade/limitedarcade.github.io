import { decodeModelPack } from './modelPack.js';
import { decodeModel } from '../fighters/_shared/meshCodec.js';
self.onmessage = async ({ data: url }) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw Error(`Fighter: ${response.status}`);
    // Stream the body so the loading screen can show bytes, not just a spinner.
    const total = Number(response.headers.get('content-length')) || 0, chunks = [];
    let loaded = 0;
    for (const reader = response.body.getReader();;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.byteLength;
      self.postMessage({ progress: [loaded, total] });
    }
    const bytes = new Uint8Array(loaded);
    for (let offset = 0, i = 0; i < chunks.length; offset += chunks[i].byteLength, i++) bytes.set(chunks[i], offset);
    const pack = decodeModelPack(bytes.buffer);
    const decodedParts = decodeModel(pack.model, pack.stream);
    const transfers = new Set();
    for (const part of decodedParts) for (const item of Object.values(part)) if (ArrayBuffer.isView(item)) transfers.add(item.buffer);
    for (const clip of pack.rig.clips) for (const track of clip.tracks)
      for (const item of Object.values(track)) if (ArrayBuffer.isView(item)) transfers.add(item.buffer);
    self.postMessage({ model: pack.model, rig: pack.rig, decodedParts }, [...transfers]);
  } catch (error) { self.postMessage({ error: error.message }); }
};
