// The build-time asset pipeline described in tools/asset-pipeline.json.
//
// Each entry turns a master under game/public into a smaller runtime file:
//   glb        -> tools/optimize-glb.mjs (meshopt + WebP textures), same path;
//   scenePack  -> tools/pack-scene.mjs (ObjectLoader JSON -> BFS1 binary);
//   image      -> sharp re-encode (PNG -> WebP);
//   audio      -> ffmpeg re-encode to a lower MP3 bitrate, metadata stripped,
//                 same path. Without ffmpeg on PATH the master ships as-is.
// Results are cached in web/.asset-cache keyed by the master's bytes, the
// entry's options and the tools' own source, so only a changed input rebuilds.
//
// Used by game/vite.config.js (dev middleware + build output) and runnable on
// its own to warm the cache or report sizes:  node tools/asset-pipeline.mjs
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
export const PUBLIC_DIR = resolve(here, '../game/public');
export const CACHE_DIR = resolve(here, '../.asset-cache');
export const MANIFEST = JSON.parse(readFileSync(resolve(here, 'asset-pipeline.json'), 'utf8'));

// Every URL path the pipeline produces, mapped to the job that makes it.
export function jobs(manifest = MANIFEST) {
  const list = [];
  for (const { path, options = {} } of manifest.glb || []) list.push({ kind: 'glb', source: path, output: path, options });
  for (const { source, output, options = {} } of manifest.scenePack || []) list.push({ kind: 'scenePack', source, output, options });
  for (const { source, output, options = {} } of manifest.image || []) list.push({ kind: 'image', source, output, options });
  for (const { path, options = {} } of manifest.audio || []) list.push({ kind: 'audio', source: path, output: path, options });
  return list;
}

const toolHash = createHash('sha1')
  .update(['optimize-glb.mjs', 'pack-scene.mjs', 'asset-pipeline.mjs'].map(f => readFileSync(resolve(here, f))).join('\0'))
  .digest('hex').slice(0, 10);
const hashes = new Map();
function cacheKey(job) {
  const source = resolve(PUBLIC_DIR, job.source), { mtimeMs, size } = statSync(source);
  const memo = `${source}:${mtimeMs}:${size}`;
  if (!hashes.has(memo)) hashes.set(memo, createHash('sha1').update(readFileSync(source)).digest('hex'));
  return createHash('sha1').update(`${hashes.get(memo)}|${job.kind}|${JSON.stringify(job.options)}|${toolHash}`).digest('hex').slice(0, 20);
}

// MP3 in, MP3 out: every browser plays it and the filename doesn't change.
// `-map_metadata -1` drops ID3 tags (generated music can carry its prompt).
function encodeAudio(source, { bitrate = '96k', sampleRate = 44100 } = {}, log) {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', source, '-vn', '-map_metadata', '-1', '-ac', '2',
    '-ar', String(sampleRate), '-codec:a', 'libmp3lame', '-b:a', bitrate, '-f', 'mp3', 'pipe:1'], { maxBuffer: 1 << 28 });
  if (result.error?.code === 'ENOENT') {
    log(`asset-pipeline: ffmpeg not found; shipping ${source} unchanged`);
    return readFileSync(source);
  }
  if (result.status !== 0) throw new Error(`ffmpeg failed on ${source}: ${result.stderr}`);
  return result.stdout;
}

const inflight = new Map();
// Path to the cached output for `job`, building it first if needed.
export async function build(job, { log = () => {} } = {}) {
  const key = cacheKey(job), extension = job.output.slice(job.output.lastIndexOf('.'));
  const file = resolve(CACHE_DIR, `${key}${extension}`);
  if (existsSync(file)) return file;
  if (inflight.has(file)) return inflight.get(file);
  const task = (async () => {
    mkdirSync(CACHE_DIR, { recursive: true });
    const source = resolve(PUBLIC_DIR, job.source), started = Date.now();
    let bytes;
    if (job.kind === 'glb') {
      const { optimizeGlb } = await import('./optimize-glb.mjs');
      bytes = (await optimizeGlb(source, null, job.options)).bytes;
    } else if (job.kind === 'scenePack') {
      const { packScene } = await import('./pack-scene.mjs');
      bytes = (await packScene(JSON.parse(readFileSync(source, 'utf8')), job.options)).bytes;
    } else if (job.kind === 'image') {
      const sharp = (await import('sharp')).default;
      bytes = await sharp(source).webp({ quality: job.options.quality ?? 82 }).toBuffer();
    } else if (job.kind === 'audio') {
      bytes = encodeAudio(source, job.options, log);
    } else throw new Error(`Unknown asset job ${job.kind}`);
    writeFileSync(file, bytes);
    log(`asset-pipeline: ${job.output} ${(statSync(source).size / 1048576).toFixed(2)} MB -> ${(bytes.byteLength / 1048576).toFixed(2)} MB (${Date.now() - started} ms)`);
    return file;
  })().finally(() => inflight.delete(file));
  inflight.set(file, task);
  return task;
}

export async function buildAll({ log = console.log } = {}) {
  const results = [];
  // Sequential: texture encoding is memory-heavy and sharp already threads.
  for (const job of jobs()) results.push({ job, file: await build(job, { log }) });
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let before = 0, after = 0;
  for (const { job, file } of await buildAll()) {
    const a = statSync(resolve(PUBLIC_DIR, job.source)).size, b = statSync(file).size;
    before += a; after += b;
    console.log(`${job.output.padEnd(44)} ${(a / 1048576).toFixed(2).padStart(7)} MB -> ${(b / 1048576).toFixed(2).padStart(6)} MB`);
  }
  console.log(`${'total'.padEnd(44)} ${(before / 1048576).toFixed(2).padStart(7)} MB -> ${(after / 1048576).toFixed(2).padStart(6)} MB`);
}
