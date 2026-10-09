// Real menu, keyboard/touch, hit/block, KO and rematch regression on dist/.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openGame, WEB_DIR } from './browser.mjs';

const phone = process.argv.includes('--phone'), reduced = process.argv.includes('--reduced');
const out = resolve(WEB_DIR, 'artifacts/polish-2026-10-07', phone ? 'flow-phone' : reduced ? 'flow-reduced' : 'flow-desktop');
mkdirSync(out, { recursive: true });
const session = await openGame({ mode: 'preview', gpu: true, phone });
const { page } = session, report = { phone, reduced, steps: [], errors: session.errors };
const touchSession = phone ? await session.context.newCDPSession(page) : null;
if (reduced) await session.context.addInitScript(() => localStorage.setItem('bfi.options.v1', JSON.stringify({ settings: { motion: 'reduced' } })));
const click = async locator => phone ? locator.tap() : locator.click();
const punch = async () => {
  if (!phone) { await page.keyboard.press('u', { delay: 120 }); return; }
  const box = await page.locator('#touch-root [data-button="lp"]').boundingBox();
  assert.ok(box, 'touch punch is visible');
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await page.waitForTimeout(120);
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};
const step = async (name, work) => {
  const began = Date.now(); await work(); report.steps.push({ name, ms: Date.now() - began }); console.log(`PASS ${name}`);
};
const prepareContact = async () => page.evaluate(() => {
  const m = window.__FIGHT__.match();
  m.fighters.forEach((f, side) => { f.x = side ? 0.4 : -0.4; f.y = 0; f.airborne = false;
    f.state = 'idle'; f.stateFrame = 0; f.move = null; f.moveFrame = 0; f.pushX = 0; f.commands.reset(); });
});
try {
  await step('title and selection', async () => {
    await page.goto(session.url); await page.waitForSelector('#screen-title.active #start-button');
    if (reduced) assert.equal(await page.evaluate(() => document.body.classList.contains('reduce-motion')), true, 'reduced-motion preference is applied');
    // Test fixture: two human seats keeps the opponent from randomly guarding
    // or attacking while we verify individual inputs. Selection still runs normally.
    await page.evaluate(() => { window.__FIGHT__.config.control = ['human', 'human']; window.__FIGHT__.config.hazards = false; });
    await click(page.locator('#start-button')); await page.waitForSelector('#screen-setup.active');
    for (const name of ['Confirm Player 1', 'Confirm Player 2', 'Enter the arena']) await click(page.getByRole('button', { name }));
  });
  await step('full first entrance and fresh round', async () => {
    await page.waitForFunction(() => window.__FIGHT__?.snapshot()?.phase === 'intro', null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__FIGHT__.snapshot().quickIntro), false);
    await page.waitForFunction(() => window.__FIGHT__?.snapshot()?.phase === 'fight', null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__FIGHT__.snapshot().timer), 99);
    await page.evaluate(() => {
      const m = window.__FIGHT__.match(), original = m.step;
      window.__polishEvents = [];
      m.step = function (inputs) {
        const events = original.call(this, inputs);
        window.__polishEvents.push(...events.map(e => ({ type: e.type, move: e.move, attacker: e.attacker, defender: e.defender, damage: e.damage })));
        return events;
      };
    });
    await page.screenshot({ path: resolve(out, '01-fight.png') });
  });
  await step(phone ? 'touch punch lands through real input' : 'keyboard punch lands through real input', async () => {
    await prepareContact();
    await punch();
    await page.waitForFunction(() => window.__polishEvents.some(e => e.type === 'hit' && e.move === 'lightPunch' && e.attacker === 0));
    if (reduced) {
      report.shakeAfterContact = await page.evaluate(() => window.__FIGHT__.fightCamera.shake);
      assert.equal(report.shakeAfterContact, 0, 'real contact does not trigger shake in reduced motion');
    }
  });
  if (!phone) await step('guard absorbs a real opposing heavy punch', async () => {
    await page.waitForTimeout(700); await prepareContact();
    await page.keyboard.down('Space'); await page.keyboard.press('Numpad5', { delay: 120 });
    await page.waitForFunction(() => window.__polishEvents.some(e => e.type === 'block' && e.attacker === 1));
    await page.keyboard.up('Space');
  });
  await step('real KO reaches results', async () => {
    await page.waitForTimeout(700); await prepareContact();
    await page.evaluate(() => {
      const m = window.__FIGHT__.match(); m.fighters[1].health = 1;
      m.fighters[0].roundsWon = m.roundsToWin - 1; m.fighters[0].meter = 0;
    });
    await punch();
    await page.waitForSelector('#screen-result.active', { timeout: 120000 });
    report.contactEvents = await page.evaluate(() => window.__polishEvents);
    await page.screenshot({ path: resolve(out, '02-results.png') });
  });
  await step('rematch uses short entrance and restores a fresh playable match', async () => {
    const setup = await page.evaluate(() => ({ fighters: [...window.__FIGHT__.config.fighters], stage: window.__FIGHT__.config.stage }));
    await click(page.locator('#rematch-button'));
    await page.waitForFunction(() => window.__FIGHT__?.snapshot()?.phase === 'intro');
    assert.equal(await page.evaluate(() => window.__FIGHT__.snapshot().quickIntro), true);
    await page.waitForFunction(() => window.__FIGHT__?.snapshot()?.phase === 'fight');
    const state = await page.evaluate(() => ({ fighters: [...window.__FIGHT__.config.fighters], stage: window.__FIGHT__.config.stage,
      timer: window.__FIGHT__.snapshot().timer, health: window.__FIGHT__.snapshot().fighters.map(f => f.healthPct),
      rounds: window.__FIGHT__.snapshot().fighters.map(f => f.roundsWon),
      camera: window.__FIGHT__.camera.position.toArray() }));
    assert.deepEqual(state.fighters, setup.fighters); assert.equal(state.stage, setup.stage);
    assert.deepEqual(state.rounds, [0, 0]); assert.equal(state.timer, 99);
    assert.deepEqual(state.health, [1, 1]); assert.ok(state.camera.every(Number.isFinite));
    report.rematch = state;
    await page.screenshot({ path: resolve(out, '03-rematch.png') });
  });
  if (!phone && !reduced) {
    await step('all other arenas retain readable fight framing', async () => {
      for (const stage of ['capitol', 'palm-resort', 'executive-lawn']) {
        await page.evaluate(async stage => { window.__FIGHT__.config.stage = stage; await window.__FIGHT__.start({ quickIntro: true }); }, stage);
        await page.waitForFunction(() => window.__FIGHT__?.snapshot()?.phase === 'fight');
        await page.screenshot({ path: resolve(out, `arena-${stage}.png`) });
      }
    });
  }
  assert.deepEqual(session.errors, []); report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error.message;
  await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
  console.error(error.message); process.exitCode = 1;
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await session.close();
}
