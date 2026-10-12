import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openGame, WEB_DIR } from './browser.mjs';

const label = process.argv[2] || 'before';
const out = resolve(WEB_DIR, 'artifacts/gore-2026-10-10', label);
mkdirSync(out, { recursive: true });
const session = await openGame({ mode: 'dev', gpu: true, viewport: { width: 1440, height: 900 }, path: '?review=finisher' });
const report = { errors: session.errors, samples: [] };
try {
  await session.page.goto(session.url);
  await session.page.getByRole('button', { name: 'Arms down', exact: true }).click();
  await session.page.waitForFunction(() => window.__FIGHT__?.match()?.phaseFrame >= 160, null, { timeout: 120000 });
  await session.page.screenshot({ path: resolve(out, 'finisher.png') });
  await session.page.evaluate(() => {
    for (const id of ['leftArm', 'rightArm']) window.__FIGHT__.views[0].gore.sever(id);
    for (let i = 0; i < 150; i++) window.__FIGHT__.gore.update(1 / 60);
  });
  for (const frame of [160, 196, 234]) {
    await session.page.evaluate(frame => { window.__FIGHT__.match().phaseFrame = frame; }, frame);
    await session.page.waitForTimeout(200);
    await session.page.screenshot({ path: resolve(out, `carney-finisher-arms-${frame}.png`) });
  }
  await session.page.goto(new URL('?review=gore', session.url).href);
  for (const fighter of ['carney', 'trump', 'officer_flock', 'lang']) {
    await session.page.getByRole('combobox', { name: 'Fighter' }).selectOption(fighter);
    for (const [label, region] of [['Left arm', 'leftArm'], ['Left leg', 'leftLeg'], ['Torso', 'torso']]) {
    await session.page.getByRole('button', { name: label, exact: true }).click();
    await session.page.waitForFunction(({fighter, region}) => window.__FIGHT__?.config.fighters[0] === fighter && window.__FIGHT__?.views[0]?.gore?.flesh.stumps.some(s => s.regionId === region) && document.querySelector('aside strong')?.textContent.endsWith(`· ${region}`), {fighter, region}, { timeout: 60000 });
    const result = await session.page.evaluate(fighter => {
      const f = window.__FIGHT__;
      const view = f.views[0];
      const cuts = view.gore.flesh.stumps.map(stump => ({ id: stump.regionId, bone: stump.bone.name, capPosition: stump.cap.position.toArray(), radius: stump.worldRadius, authored: stump.cap.getObjectByName('stumpPlug').userData.authoredCut, seamSamples: stump.seam.samples.length }));
      return { fighter, cuts, library: [...f.gore.library.keys()] };
    }, fighter);
    await session.page.waitForTimeout(150);
    await session.page.screenshot({ path: resolve(out, `${fighter}-${region}.png`) });
    report.samples.push(result);
    }
  }
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2));
  await session.close();
}
console.log(JSON.stringify(report, null, 2));
