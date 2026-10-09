// One scripted pass through the real game: title -> select -> fight -> KO ->
// results, with a screenshot at each step as evidence and the bytes downloaded
// to reach the title and the first fight.
//
//   npm run smoke            # against the built dist/ (run `npm run build` first)
//   npm run smoke -- --dev   # against the Vite dev server
//   npm run smoke -- --headed
//   npm run smoke -- --phone    # landscape phone: touch input, coarse pointer
//   npm run smoke -- --gore-off # with the Blood/gore option off
//
// Evidence lands in artifacts/smoke/: 01-title.png ... 05-results.png and
// report.json. Exit code 1 on any failed step or page error. This catches "it
// builds, but the menu is broken" -- it is not a substitute for looking at the
// screenshots.
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { openGame, WEB_DIR } from './browser.mjs';

export const SMOKE_DIR = resolve(WEB_DIR, 'artifacts/smoke');
const MB = bytes => Math.round(bytes / 10485.76) / 100;
// 3D fight assets. The title's live exhibition streams these in the background
// while the menu is already usable, so they count toward the first fight, not
// toward reaching the title.
export const MATCH_ASSET = /\/(stages|fighters|props|vfx|gore|weapons|fx)\//;

// `until: 'fight'` stops once the first fight starts (check-budget uses that).
// `settings` pre-seeds saved Options (e.g. { gore: false }) before the game boots.
export async function runSmoke({ mode = 'preview', headless = true, phone = false, settings = null, screenshots = true, until = 'results', outDir = SMOKE_DIR, log = console.log } = {}) {
  mkdirSync(outDir, { recursive: true });
  const session = await openGame({ mode, headless, phone });
  if (settings) await session.context.addInitScript(s => localStorage.setItem('bfi.options.v1', JSON.stringify({ settings: s })), settings);
  const { page, network } = session, report = { mode, phone, steps: [], bytes: {}, errors: session.errors };
  const tap = selector => phone ? page.tap(selector) : page.click(selector);
  const shot = async name => { if (screenshots) await page.screenshot({ path: resolve(outDir, `${name}.png`) }); };
  const step = async (name, run) => {
    const started = Date.now();
    try { await run(); report.steps.push({ name, ok: true, ms: Date.now() - started }); log(`  ok   ${name} (${Date.now() - started} ms)`); }
    catch (error) {
      report.steps.push({ name, ok: false, ms: Date.now() - started, error: error.message });
      log(`  FAIL ${name}: ${error.message.split('\n')[0]}`);
      await shot(`failed-${name.replace(/\W+/g, '-')}`).catch(() => {});
      throw error;
    }
  };
  const phase = () => page.evaluate(() => window.__FIGHT__?.snapshot()?.phase || null);
  try {
    await step('title', async () => {
      await page.goto(session.url, { waitUntil: 'load' });
      await page.waitForSelector('#screen-title.active #start-button', { state: 'visible' });
      report.bytes.title = network.bytes(entry => !MATCH_ASSET.test(new URL(entry.url).pathname));
      await page.waitForTimeout(1500); await shot('01-title');
    });
    await step('select', async () => {
      await tap('#start-button');
      await page.waitForSelector('#screen-setup.active');
      await page.waitForSelector('#screen-setup .roster-card.has-portrait', { timeout: 15000 });
      await page.waitForTimeout(800); await shot('02-select');
    });
    await step('fight', async () => {
      for (const label of ['Confirm Player 1', 'Confirm Player 2', 'Enter the arena']) {
        const button = page.getByRole('button', { name: label });
        if (phone) await button.tap(); else await button.click();
        await page.waitForTimeout(300);
      }
      await page.waitForFunction(() => window.__FIGHT__?.snapshot()?.phase === 'fight', null, { timeout: 120000 });
      report.bytes.firstFight = network.bytes();
      report.fighters = await page.evaluate(() => window.__FIGHT__.config.fighters);
      if (phone) await page.waitForSelector('#touch-root .touch-controls:not(.hidden)', { timeout: 10000 });
      await page.waitForTimeout(1000); await shot('03-fight');
    });
    if (until === 'fight') return report;
    await step('ko', async () => {
      // A KO on demand: the player (P1, idle) is one hit from losing, and the
      // CPU needs only this round for the match. The CPU still has to land a
      // real hit through the real sim.
      await page.evaluate(() => {
        const match = window.__FIGHT__.match();
        match.fighters[0].health = 1;
        match.fighters[1].roundsWon = match.roundsToWin - 1;
      });
      await page.waitForFunction(() => ['roundEnd', 'finisherWindow', 'finisher', 'matchEnd'].includes(window.__FIGHT__?.snapshot()?.phase), null, { timeout: 90000 });
      await page.waitForTimeout(700); await shot('04-ko');
    });
    await step('results', async () => {
      await page.waitForSelector('#screen-result.active', { timeout: 120000 });
      await page.waitForTimeout(800); await shot('05-results');
    });
  } catch { /* recorded in report.steps */ } finally {
    report.finalPhase = await phase().catch(() => null);
    report.ok = report.steps.length === (until === 'fight' ? 3 : 5) && report.steps.every(s => s.ok) && !session.errors.length;
    report.summary = { titleMB: MB(report.bytes.title || 0), firstFightMB: MB(report.bytes.firstFight || 0) };
    report.largest = [...network.entries].sort((a, b) => b.bytes - a.bytes).slice(0, 12)
      .map(e => ({ path: new URL(e.url).pathname, MB: MB(e.bytes) }));
    writeFileSync(resolve(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await session.close();
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  console.log(`Smoke test (${args.includes('--dev') ? 'dev server' : 'dist/'})`);
  const phone = args.includes('--phone'), goreOff = args.includes('--gore-off');
  const outputIndex = args.indexOf('--out-dir');
  if (outputIndex >= 0 && (!args[outputIndex + 1] || args[outputIndex + 1].startsWith('--')))
    throw new Error('--out-dir requires a directory path');
  const outDir = outputIndex >= 0 ? resolve(args[outputIndex + 1])
    : resolve(SMOKE_DIR, [phone && 'phone', goreOff && 'gore-off'].filter(Boolean).join('-') || '.');
  const report = await runSmoke({ mode: args.includes('--dev') ? 'dev' : 'preview', headless: !args.includes('--headed'), phone,
    settings: goreOff ? { gore: false } : null,
    outDir });
  console.log(`  title ${report.summary.titleMB} MB, first fight ${report.summary.firstFightMB} MB`);
  if (report.errors.length) console.log(`  page errors:\n    ${report.errors.join('\n    ')}`);
  console.log(report.ok ? `PASS - evidence in ${outDir}` : 'FAIL');
  process.exit(report.ok ? 0 : 1);
}
