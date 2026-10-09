import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildAsset, jobs as assetJobs, MANIFEST as ASSETS } from '../tools/asset-pipeline.mjs';

// Keep the existing made-page source shared with the standalone site.
const site = fileURLToPath(new URL('../site/', import.meta.url));
// The base is relative in the build so dist works from any folder, not just a domain root.
const made = (base = '/') => readFileSync(`${site}made.html`, 'utf8').replace('<head>', `<head><base href="${base}">`).replaceAll('href="../dist/index.html"', 'href="./"');
const vendorFiles = ['three.module.js', 'GLTFLoader.js', 'BufferGeometryUtils.js'];
// Game modules made.html imports directly (it runs outside the bundle): the
// meshopt decoder for the optimised GLBs and the scene-pack reader for Flock.
const src = fileURLToPath(new URL('./src/', import.meta.url));
const sharedFiles = { 'meshopt_decoder.module.js': 'vendor/meshopt_decoder.module.js', 'scenePackFormat.js': 'render/scenePackFormat.js' };
const vendorSource = name => sharedFiles[name] ? `${src}${sharedFiles[name]}` : `${site}assets/vendor/${name}`;
const madeVendor = [...vendorFiles, ...Object.keys(sharedFiles)];
// Serve and ship the optimised copies from tools/asset-pipeline.json. Dev gets
// the same bytes production does (built on first request, then cached), so a
// meshopt or WebP problem shows up locally rather than after a publish.
const assetPipeline = () => {
  let outDir = null;
  const byUrl = new Map(assetJobs().map(job => [`/${job.output}`, job]));
  const devOnly = new Set((ASSETS.devOnly || []).map(path => `/${path}`));
  return {
    name: 'asset-pipeline',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = decodeURIComponent(req.url?.split('?')[0] || '');
        const job = byUrl.get(path);
        if (!job) { next(); return; }
        try {
          const file = await buildAsset(job, { log: message => server.config.logger.info(message) });
          const type = { '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.mp3': 'audio/mpeg' }[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream';
          let bytes = readFileSync(file);
          res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'no-cache'); res.setHeader('Accept-Ranges', 'bytes');
          // <audio> streams with Range requests, and Safari refuses media
          // from a server that ignores them.
          const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
          if (range) {
            const size = bytes.length, start = range[1] ? Number(range[1]) : size - Number(range[2]);
            const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
            bytes = bytes.subarray(start, end + 1);
          }
          res.setHeader('Content-Length', bytes.length);
          res.end(bytes);
        } catch (error) { next(error); }
      });
    },
    async writeBundle() {
      for (const job of assetJobs()) {
        const target = resolve(outDir, job.output);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(await buildAsset(job, { log: message => this.info?.(message) }), target);
      }
      for (const path of devOnly) rmSync(resolve(outDir, `.${path}`), { force: true });
    },
  };
};

export default {
  build: { rollupOptions: { input: {
    game: fileURLToPath(new URL('./index.html', import.meta.url)),
    fighterLab: fileURLToPath(new URL('./fighter-lab.html', import.meta.url)),
    motionStudio: fileURLToPath(new URL('./motion-studio.html', import.meta.url)),
    vfxStudio: fileURLToPath(new URL('./vfx-studio.html', import.meta.url)),
  } } },
  plugins: [assetPipeline(), {
    name: 'made-page',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (['/made', '/made/', '/made.html'].includes(path)) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(made()); return;
        }
        const vendor = madeVendor.find(name => path === `/assets/vendor/${name}`);
        if (vendor) { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(vendorSource(vendor))); return; }
        next();
      });
    },
    generateBundle() {
      for (const [fileName, base] of [['made.html', './'], ['made/index.html', '../']]) this.emitFile({ type: 'asset', fileName, source: made(base) });
      for (const name of madeVendor) this.emitFile({ type: 'asset', fileName: `assets/vendor/${name}`, source: readFileSync(vendorSource(name)) });
    },
  }],
};
