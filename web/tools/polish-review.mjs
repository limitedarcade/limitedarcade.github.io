// Reproducible presentation captures through the game's existing review API.
// Separate browser storage keeps player saves and normal options untouched.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openGame, WEB_DIR } from './browser.mjs';

const args = process.argv.slice(2);
const label = args.includes('--before') ? 'before' : 'after';
const out = resolve(WEB_DIR, 'artifacts/polish-2026-10-07', label);
mkdirSync(out, { recursive: true });
const session = await openGame({ mode: args.includes('--preview') ? 'preview' : 'dev', gpu: true, path: '?review=polish' });
const { page } = session;
const report = { label, samples: [], errors: session.errors };
try {
  await page.goto(session.url);
  await page.waitForFunction(() => window.__FIGHT__?.start);
  await page.addStyleTag({ content: '#screen-pause { visibility: hidden !important; }' });
  for (const pair of [['trump', 'carney'], ['officer_flock', 'lang']]) {
    await page.evaluate(async pair => {
      const api = window.__FIGHT__;
      api.config.fighters = pair; api.config.control = ['human', 'human'];
      api.config.stage = 'lake-america'; api.config.hazards = false;
      await api.start();
      const m = api.match();
      // Freeze only the review simulation. Rendering and camera settling remain live.
      m.step = () => []; m.setPhase('fight');
      m.fighters.forEach(f => { f.state = 'idle'; f.stateFrame = 0; });
    }, pair);
    const capture = async (name, state, viewport = { width: 1280, height: 720 }) => {
      await page.setViewportSize(viewport);
      await page.waitForFunction(() => Math.abs(window.__FIGHT__.camera.aspect - innerWidth / innerHeight) < 0.01);
      await page.evaluate(state => {
        const m = window.__FIGHT__.match();
        m.fighters.forEach((f, side) => {
          f.state = state.jump && side === 0 ? 'jump' : state.guard && side === 1 ? 'blockStand' : 'idle';
          f.stateFrame = 12; f.move = null; f.moveFrame = 0;
          f.x = state.edge !== undefined ? state.edge + (side ? 1 : -1) * state.gap / 2 : (side ? 1 : -1) * state.gap / 2;
          f.y = state.jump && side === 0 ? 1.8 : 0; f.airborne = Boolean(f.y);
          f.facing = side ? -1 : 1;
          if (state.mirror) { f.x = -f.x; f.facing = -f.facing; }
          if (state.move && side === state.side) { f.startMove(state.move); f.moveFrame = 0; }
        });
      }, state);
      await page.waitForTimeout(1100);
      await page.evaluate(() => {
        const api = window.__FIGHT__, rig = api.fightCamera;
        if (!rig) return;
        // Settle the real controller by frames rather than assuming this
        // machine can render 60 frames inside a fixed wall-clock timeout.
        rig.resetImpact(); rig.orbit = 0;
        for (let frame = 0; frame < 150; frame++) rig.update(1 / 60, api.snapshot());
      });
      if (state.move) {
        await page.evaluate(state => {
          const f = window.__FIGHT__.match().fighters[state.side];
          f.moveFrame = f.moveOf().startup + Math.min(1, f.moveOf().active - 1);
        }, state);
        await page.waitForTimeout(120);
      }
      const file = `${pair.join('-')}-${name}.png`;
      await page.screenshot({ path: resolve(out, file) });
      const metrics = await page.evaluate(() => {
        const api = window.__FIGHT__, camera = api.camera;
        return { camera: camera.position.toArray(), fov: camera.fov,
          fighters: api.snapshot().fighters.map((f, side) => ({ id: f.id, x: f.x, y: f.y, move: f.move,
            clip: api.views[side].current?.getClip().name, clipTime: api.views[side].current?.time,
            plantedFeet: api.views[side].strikePose.feet.length, recoilHead: api.views[side].recoil.bones?.head?.name })) };
      });
      report.samples.push({ file, viewport, state, ...metrics });
      console.log(`Captured ${label}/${file}`);
    };
    await capture('close', { gap: 1.6 });
    await capture('wide', { gap: 8 });
    await capture('jump', { gap: 2, jump: true });
    await capture('edge', { gap: 1.6, edge: 4.2 });
    for (const [side, id] of pair.entries()) for (const move of ['lightPunch', 'heavyPunch', 'lightKick', 'heavyKick']) {
      await capture(`${id}-${move}`, { gap: 1.35, side, move });
      if (args.includes('--both-facings')) await capture(`${id}-${move}-mirror`, { gap: 1.35, side, move, mirror: true });
    }
    await capture('phone', { gap: 1.6 }, { width: 844, height: 390 });
    await capture('portrait', { gap: 1.6 }, { width: 390, height: 844 });
    await capture('portrait-wide-jump', { gap: 6, jump: true }, { width: 390, height: 844 });
  }
  report.ok = !session.errors.length;
} finally {
  writeFileSync(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await session.close();
}
if (!report.ok) { console.error(session.errors); process.exitCode = 1; }
