export { decodeModelPack } from './modelPack.js';
import { loadProgress } from './loadProgress.js';

const cache = new Map();
export function loadBinaryModel(id) {
  if (!cache.has(id)) cache.set(id, new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./modelWorker.js', import.meta.url), { type: 'module' });
    const url = new URL(`${import.meta.env.BASE_URL}fighters/${id}/fighter.bin`, location.href).href;
    const tracker = loadProgress.track(url);
    worker.onmessage = ({ data }) => {
      if (data.progress) { tracker.update(...data.progress); return; }
      tracker.done(); worker.terminate(); data.error ? reject(Error(data.error)) : resolve(data);
    };
    worker.onerror = e => { tracker.done(); worker.terminate(); reject(Error(e.message || 'Fighter worker failed')); };
    worker.postMessage(url);
  }).catch(error => { cache.delete(id); throw error; }));
  return cache.get(id);
}
