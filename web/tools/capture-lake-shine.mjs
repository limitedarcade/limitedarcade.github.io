// Local, repeatable art comparison. Captures never run during frame profiling.
import fs from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser } from './browser.mjs';

const label = process.argv[2] || 'after';
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple capture label');
const out = resolve('artifacts/lake-america/shine-2026-10-12');
fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ gpu: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
try {
  await page.goto('http://127.0.0.1:5176/lake-america.html', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__LAKE_REVIEW__, null, { timeout: 90000 });
  await page.locator('#pause').click();
  await page.locator('#hide-controls').click();
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(() => {
    const api = window.__LAKE_REVIEW__;
    api.stage.reducedMotion = true;
    api.stage.environment.update(0);
    document.querySelectorAll('header,.view-caption,aside,#show-controls').forEach(o => { o.style.visibility = 'hidden'; });
    // Keep precisely the same canvas size and framing for both versions.
  });
  for (const preset of ['combat', 'orbit', 'axe', 'liberty', 'freedom', 'aerial']) {
    await page.evaluate(id => window.__LAKE_REVIEW__.selectPreset(id), preset);
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.screenshot({ path: resolve(out, `${label}-${preset}.png`) });
  }
  const stats = await page.evaluate(() => {
    const api = window.__LAKE_REVIEW__, mats = new Set(), textures = new Set();
    api.stage.group.traverse(o => {
      for (const m of (Array.isArray(o.material) ? o.material : [o.material]).filter(Boolean)) {
        mats.add(m);
        for (const k of ['map', 'normalMap', 'roughnessMap']) if (m[k]) textures.add(m[k]);
      }
    });
    return { calls: api.renderer.info.render.calls, triangles: api.renderer.info.render.triangles,
      materials: mats.size, textures: textures.size, programs: api.renderer.info.programs.length };
  });
  // Exercise the actual gameplay-backed weapon preview and round restoration.
  await page.evaluate(() => { document.querySelector('#pause').click(); document.querySelector('#throw-axe').click(); });
  await page.waitForFunction(() => window.__LAKE_REVIEW__.match().axeUsed, null, { timeout: 10000 });
  await page.evaluate(() => window.__LAKE_REVIEW__.resetRound());
  const restored = await page.evaluate(() => !window.__LAKE_REVIEW__.match().axeUsed && window.__LAKE_REVIEW__.stage.group.getObjectByName('lake-america-axe').visible);
  const report = { label, stats, axeReset: restored, errors };
  fs.writeFileSync(resolve(out, `${label}-review.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (errors.length || !restored) process.exitCode = 1;
} finally { await browser.close(); }
