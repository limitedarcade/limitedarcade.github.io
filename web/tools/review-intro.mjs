import fs from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser } from './browser.mjs';

const flowOnly = process.argv.includes('--flow');
const out = resolve(flowOnly ? 'artifacts/intro-2026-10-11' : 'artifacts/intro-2026-10-10'); fs.mkdirSync(out, { recursive: true });
const browser = await launchBrowser({ gpu: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
const errors = [], report = { errors, captures: [], events: [] };
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const shot = async name => { await page.screenshot({ path: resolve(out, `${name}.png`) }); report.captures.push(name); console.log(`Captured ${name}`); };
try {
  await page.goto('http://127.0.0.1:5176/', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__FIGHT__?.demo().mode && window.__FIGHT__.match(), null, { timeout: 60000 });
  if (!flowOnly) {
  await page.evaluate(() => {
    const m = window.__FIGHT__.match(); window.originalStep = m.step;
    m.step = () => []; m.phase = 'intro';
  });
  for (const [name, frame] of [['01-machine', 28], ['02-rights', 113], ['03-bell', 190], ['04-world', 270], ['05-ready', 405]]) {
    await page.evaluate(f => window.__FIGHT__.match().phaseFrame = f, frame);
    await page.waitForTimeout(250); await shot(name);
  }
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => window.__FIGHT__.match().phaseFrame = 113);
  await page.waitForTimeout(400); await shot('06-phone-portrait');
  report.portraitOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(400); await shot('07-phone-landscape');
  report.landscapeOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.waitForFunction(() => window.__FIGHT__?.match(), null, { timeout: 60000 });
  await page.evaluate(() => {
    const m = window.__FIGHT__.match(); m.step = () => []; m.phase = 'intro'; m.phaseFrame = 190;
  });
  await page.waitForTimeout(350); await shot('08-reduced-motion');
  }
  if (!process.argv.includes('--stills')) {
  if (!flowOnly) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.reload();
  await page.waitForFunction(() => window.__FIGHT__?.match(), null, { timeout: 60000 });
  }
  await page.evaluate(() => {
    const m = window.__FIGHT__.match(), step = m.step;
    window.exhibitionEvents = []; window.exhibitionPhases = []; window.visiblePhases = [];
    const sample = () => {
      const s = window.__FIGHT__.snapshot();
      if (s && window.visiblePhases.at(-1)?.phase !== s.phase)
        window.visiblePhases.push({ phase: s.phase, frame: s.phaseFrame, at: performance.now() });
      window.phaseSampler = requestAnimationFrame(sample);
    }; sample();
    const startFinisher = m.startFinisher;
    m.startFinisher = function (definition, side) {
      window.exhibitionHandoff = { phase: this.phase, frame: this.phaseFrame, reason: this.roundReason };
      startFinisher.call(this, definition, side);
      window.exhibitionEvents.push({ type: 'finisherStart', finisherId: definition.id });
    };
    m.step = function (inputs) {
      const before = this.phase, events = step.call(this, inputs);
      for (const e of events) if (['finisherStart', 'roundEnd', 'matchEnd'].includes(e.type)
        || (['hit', 'block'].includes(e.type) && ['stageAxe', 'stageRing'].includes(e.move)))
        window.exhibitionEvents.push({ type: e.type, move: e.move, attacker: e.attacker, defender: e.defender, finisherId: e.finisherId, winner: e.winner });
      if (this.phase !== before) window.exhibitionPhases.push({ phase: this.phase, at: performance.now() });
      return events;
    };
  });
  await page.waitForFunction(() => window.__FIGHT__.snapshot()?.projectiles?.some(p => p.kind === 'axe'), null, { timeout: 40000 });
  await shot('09-axe-flight');
  await page.waitForFunction(() => window.__FIGHT__.views.find(v => v.definition.id === 'trump')?.gore.has('leftArm'), null, { timeout: 10000 });
  report.axeCut = await page.evaluate(() => ({
    severed: [...window.__FIGHT__.views.find(v => v.definition.id === 'trump').gore.severed],
    beat: window.__FIGHT__.demo().beat,
  }));
  await shot('09b-axe-arm-cut');
  await page.waitForFunction(() => window.__FIGHT__.snapshot()?.projectiles?.some(p => p.kind === 'rescueRing'), null, { timeout: 30000 });
  await shot('10-ring-flight');
  await page.waitForFunction(() => window.__FIGHT__.snapshot()?.phase === 'finisher', null, { timeout: 90000 });
  report.finisher = await page.evaluate(() => window.__FIGHT__.snapshot().finisher);
  report.preFinisherCuts = await page.evaluate(() => window.__FIGHT__.views.map(view => ({
    id: view.definition.id, severed: [...view.gore.severed],
  })));
  if (report.preFinisherCuts.find(view => view.id === 'carney').severed.length) throw new Error('Carney lost his stick hand before the finale');
  if (report.preFinisherCuts.find(view => view.id === 'trump').severed.join(',') !== 'leftArm') throw new Error('Axe arm cut did not persist into the finale');
  report.handoff = await page.evaluate(() => window.exhibitionHandoff);
  if (report.handoff.phase !== 'roundEnd' || report.handoff.frame !== 0) throw new Error('Victory did not go straight into the finisher');
  await shot('11-cold-cut');
  await page.waitForFunction(() => window.__FIGHT__.snapshot()?.phase === 'matchEnd', null, { timeout: 90000 });
  report.events = await page.evaluate(() => window.exhibitionEvents);
  report.phases = await page.evaluate(() => window.exhibitionPhases);
  report.visiblePhases = await page.evaluate(() => { cancelAnimationFrame(window.phaseSampler); return window.visiblePhases; });
  if (report.visiblePhases.some(s => ['roundEnd', 'finisherWindow'].includes(s.phase))) throw new Error('Visible wait before finisher');
  report.final = await page.evaluate(() => ({ snapshot: window.__FIGHT__.snapshot(), demo: window.__FIGHT__.demo() }));
  await shot('12-finale');
  if (!report.events.some(e => e.move === 'stageAxe') || !report.events.some(e => e.move === 'stageRing')) throw new Error('Missing real prop contact');
  if (report.finisher.id !== 'carney-cold-cut' || report.final.snapshot.fighters[report.finisher.defender].id !== 'trump') throw new Error('Wrong finale');
  if (errors.length || report.portraitOverflow || report.landscapeOverflow) throw new Error('Browser errors or menu overflow');
  console.log('Verified title opening, both prop contacts, and Carney Cold Cut on Trump.');
  }
} catch (error) {
  report.failure = error.stack; await shot('failure').catch(() => {}); process.exitCode = 1;
} finally {
  fs.writeFileSync(resolve(out, process.argv.includes('--stills') ? 'stills-report.json' : 'browser-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
