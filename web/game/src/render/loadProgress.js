import * as THREE from '../vendor/three.module.js';

// Byte-level download progress for the loading screen.
//
// Every asset request reports here: three's FileLoader (glTF, ObjectLoader) is
// patched once by installFileLoaderProgress(), and the game's own fetches go
// through fetchBytes(). The total grows as responses announce their size, which
// for a match load happens within the first few hundred milliseconds -- the
// requests all start together.
const items = new Map();
let serial = 0;

export const loadProgress = {
  track(url) {
    const id = ++serial, item = { url, loaded: 0, total: 0, done: false };
    items.set(id, item);
    return {
      update(loaded, total) { item.loaded = loaded; if (total) item.total = total; },
      done() { item.done = true; if (item.total) item.loaded = item.total; else item.total = item.loaded; },
    };
  },
  // Only the requests since the last reset count toward the bar.
  reset() { for (const [id, item] of items) if (item.done) items.delete(id); },
  snapshot() {
    let loaded = 0, total = 0, pending = 0;
    for (const item of items.values()) {
      loaded += Math.min(item.loaded, item.total || item.loaded);
      total += Math.max(item.total, item.loaded);
      if (!item.done) pending++;
    }
    return { loaded, total, pending };
  },
};

export function formatProgress({ loaded, total }) {
  if (!total) return '';
  const mb = n => (n / 1048576).toFixed(1);
  return `${mb(loaded)} of ${mb(total)} MB`;
}

// fetch() with progress, returning the whole body as an ArrayBuffer.
export async function fetchBytes(url, init) {
  const tracker = loadProgress.track(url);
  try {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const total = Number(response.headers.get('content-length')) || 0;
    if (!response.body?.getReader) { const buffer = await response.arrayBuffer(); return buffer; }
    const reader = response.body.getReader(), chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); loaded += value.byteLength; tracker.update(loaded, total);
    }
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } finally { tracker.done(); }
}

let installed = false;
export function installFileLoaderProgress() {
  if (installed) return;
  installed = true;
  const load = THREE.FileLoader.prototype.load;
  THREE.FileLoader.prototype.load = function(url, onLoad, onProgress, onError) {
    const tracker = loadProgress.track(url);
    return load.call(this, url,
      data => { tracker.done(); onLoad?.(data); },
      event => { tracker.update(event.loaded, event.lengthComputable ? event.total : 0); onProgress?.(event); },
      error => { tracker.done(); onError?.(error); });
  };
}
