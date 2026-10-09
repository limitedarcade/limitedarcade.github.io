// Render every roster portrait once, with the game's own PortraitStudio, and
// save them to game/public/portraits/<id>.webp. The select screen and HUD use
// these files instead of downloading every fighter just to draw a face.
//
//   npm run render-portraits
//
// Re-run after changing a fighter's model, materials or the studio lighting.
// A fighter with no file still works: the game captures it live, slower.
import { mkdirSync, writeFileSync } from 'node:fs';
import { openGame } from './browser.mjs';

const out = new URL('../game/public/portraits/', import.meta.url);
mkdirSync(out, { recursive: true });
const session = await openGame({ mode: 'dev', path: '?review=portraits' });
try {
  await session.page.goto(session.url);
  await session.page.waitForFunction(() => window.__FIGHT__?.renderPortraits, null, { timeout: 60000 });
  const portraits = await session.page.evaluate(() => window.__FIGHT__.renderPortraits());
  for (const [id, url] of Object.entries(portraits)) {
    if (!url.startsWith('data:image/webp')) throw new Error(`${id}: expected a WebP capture, got ${url.slice(0, 30)}`);
    const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    writeFileSync(new URL(`${id}.webp`, out), bytes);
    console.log(`portraits/${id}.webp  ${(bytes.length / 1024).toFixed(0)} KB`);
  }
  if (session.errors.length) console.warn('Page errors:\n  ' + session.errors.join('\n  '));
} finally { await session.close(); }
