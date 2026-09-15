export { decodeModelPack } from './modelPack.js';

const cache = new Map();
export function loadBinaryModel(id) {
  if (!cache.has(id)) cache.set(id, new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./modelWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { worker.terminate(); data.error ? reject(Error(data.error)) : resolve(data); };
    worker.onerror = e => { worker.terminate(); reject(Error(e.message || 'Fighter worker failed')); };
    worker.postMessage(new URL(`${import.meta.env.BASE_URL}fighters/${id}/fighter.bin`, location.href).href);
  }).catch(error => { cache.delete(id); throw error; }));
  return cache.get(id);
}
