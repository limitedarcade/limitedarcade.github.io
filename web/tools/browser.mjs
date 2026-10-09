// Shared browser harness for the scripted checks: portrait rendering, the
// smoke test and the download budget. Uses playwright-core with the Chrome or
// Edge already installed on the machine, so there is no browser download.
//
//   const session = await openGame({ mode: 'preview' });   // or 'dev'
//   await session.page.goto(session.url);
//   ...
//   await session.close();
import { chromium } from 'playwright-core';
import { createServer, preview } from 'vite';
import { fileURLToPath } from 'node:url';

export const WEB_DIR = fileURLToPath(new URL('..', import.meta.url));
export const GAME_DIR = fileURLToPath(new URL('../game/', import.meta.url));

// `gpu: false` (the default) renders WebGL on SwiftShader: slow, but
// deterministic and present on every machine -- right for correctness and byte
// counts. `gpu: true` uses the real graphics card, for captures that need
// frame rate (the storefront GIF).
export async function launchBrowser({ headless = true, gpu = false } = {}) {
  const args = [...(gpu ? ['--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--autoplay-policy=no-user-gesture-required'];
  let lastError;
  for (const channel of [process.env.BROWSER_CHANNEL, 'chrome', 'msedge'].filter(Boolean)) {
    try { return await chromium.launch({ channel, headless, args }); } catch (error) { lastError = error; }
  }
  throw new Error(`No Chrome or Edge found for playwright-core (${lastError?.message.split('\n')[0]}). Set BROWSER_CHANNEL.`);
}

// mode 'dev' serves source through Vite (with the asset pipeline); 'preview'
// serves the built dist/ exactly as it would be published.
export async function startServer({ mode = 'preview', port = 0 } = {}) {
  if (mode === 'dev') {
    const server = await createServer({ root: GAME_DIR, configFile: `${GAME_DIR}vite.config.js`, logLevel: 'warn',
      server: { host: '127.0.0.1', port: port || 5190, strictPort: false } });
    await server.listen();
    return { url: server.resolvedUrls.local[0], close: () => server.close() };
  }
  const server = await preview({ root: WEB_DIR, configFile: false, logLevel: 'warn',
    preview: { host: '127.0.0.1', port: port || 4190, strictPort: false } });
  return { url: server.resolvedUrls.local[0], close: () => new Promise(resolve => server.httpServer.close(resolve)) };
}

// Every response body the page receives, for byte budgets.
export function recordNetwork(target) {
  const entries = [];
  target.on('requestfinished', async request => {
    try {
      const sizes = await request.sizes();
      entries.push({ url: request.url(), bytes: sizes.responseBodySize, at: Date.now() });
    } catch { /* page closed */ }
  });
  return {
    entries,
    bytes: (filter = () => true) => entries.filter(filter).reduce((sum, e) => sum + e.bytes, 0),
    mark: () => Date.now(),
  };
}

// `phone: true` emulates a landscape phone: touch, coarse pointer, DPR 2.
export async function openGame({ mode = 'preview', headless = true, gpu = false, phone = false, viewport = phone ? { width: 740, height: 360 } : { width: 1280, height: 720 }, path = '' } = {}) {
  const server = await startServer({ mode });
  const browser = await launchBrowser({ headless, gpu });
  const context = await browser.newContext(phone ? { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Resource failures are reported by URL; Chrome's console line for them has none.
  page.on('console', message => { if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) errors.push(message.text()); });
  context.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
  // Context-level, so the fighter worker's fetches count too.
  const network = recordNetwork(context);
  const url = new URL(path, server.url).href;
  return {
    server, browser, context, page, errors, network, url,
    close: async () => { await browser.close().catch(() => {}); await server.close(); },
  };
}
