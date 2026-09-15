import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Keep the existing made-page source shared with the standalone site.
const site = fileURLToPath(new URL('../site/', import.meta.url));
// The base is relative in the build so dist works from any folder, not just a domain root.
const made = (base = '/') => readFileSync(`${site}made.html`, 'utf8').replace('<head>', `<head><base href="${base}">`).replaceAll('href="../dist/index.html"', 'href="./"');
const vendorFiles = ['three.module.js', 'GLTFLoader.js', 'BufferGeometryUtils.js'];
export default {
  build: { rollupOptions: { input: {
    game: fileURLToPath(new URL('./index.html', import.meta.url)),
    fighterLab: fileURLToPath(new URL('./fighter-lab.html', import.meta.url)),
    motionStudio: fileURLToPath(new URL('./motion-studio.html', import.meta.url)),
    vfxStudio: fileURLToPath(new URL('./vfx-studio.html', import.meta.url)),
  } } },
  plugins: [{
    name: 'made-page',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0];
        if (['/made', '/made/', '/made.html'].includes(path)) {
          res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(made()); return;
        }
        const vendor = vendorFiles.find(name => path === `/assets/vendor/${name}`);
        if (vendor) { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(`${site}assets/vendor/${vendor}`)); return; }
        next();
      });
    },
    generateBundle() {
      for (const [fileName, base] of [['made.html', './'], ['made/index.html', '../']]) this.emitFile({ type: 'asset', fileName, source: made(base) });
      for (const name of vendorFiles) this.emitFile({ type: 'asset', fileName: `assets/vendor/${name}`, source: readFileSync(`${site}assets/vendor/${name}`) });
    },
  }],
};
