// Storefront images, captured from the real game: the README screenshots, a
// short GIF and the social-preview card.
//
//   npm run capture-storefront
//
// Writes to game/public/storefront/ (shipped with the site, referenced by both
// READMEs and the OpenGraph tags in index.html). Re-run after visible changes
// to the select screen, the arena or Cold Cut, then look at every file before
// committing -- a capture is evidence, not a guarantee the frame is flattering.
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openGame } from './browser.mjs';

const out = new URL('../game/public/storefront/', import.meta.url);
mkdirSync(out, { recursive: true });
const save = async (name, png, { width = 1280, quality = 84 } = {}) => {
  const bytes = await sharp(png).resize({ width }).jpeg({ quality, mozjpeg: true }).toBuffer();
  writeFileSync(new URL(name, out), bytes);
  console.log(`storefront/${name}  ${(bytes.length / 1024).toFixed(0)} KB`);
};
const until = (page, test, timeout = 120000) => page.waitForFunction(test, null, { timeout, polling: 100 });

// 1-2. Select screen and a live fight, on the production-equivalent dev server.
{
  const session = await openGame({ mode: 'dev', gpu: true });
  const { page } = session;
  try {
    await page.goto(session.url);
    await page.waitForSelector('#screen-title.active #start-button');
    // The social card is the title screen itself: logo, menu, live exhibition.
    await page.setViewportSize({ width: 1200, height: 630 });
    await until(page, () => window.__FIGHT__?.snapshot()?.phase === 'fight');
    await page.waitForTimeout(2500);
    await save('social-card.jpg', await page.screenshot(), { width: 1200 });
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.click('#start-button');
    await page.waitForSelector('#screen-setup .roster-card.has-portrait');
    await page.hover('#screen-setup .roster-card:nth-child(2)').catch(() => {});
    await page.waitForTimeout(2500);
    await save('select.jpg', await page.screenshot());

    await page.evaluate(() => {
      const f = window.__FIGHT__; f.config.fighters = ['trump', 'carney']; f.config.control = ['cpu', 'cpu']; f.config.difficulty = ['hard', 'hard'];
      return f.start();
    });
    await until(page, () => window.__FIGHT__.snapshot()?.phase === 'fight');
    // Wait for the fighters to close in and trade, so the shot has contact in it.
    await until(page, () => { const s = window.__FIGHT__.snapshot(); return s.fighters.some(f => /stun|attack|juggle/i.test(f.state)) && Math.abs(s.fighters[0].x - s.fighters[1].x) < 1.6; }, 60000).catch(() => {});
    await page.waitForTimeout(120);
    await save('fight.jpg', await page.screenshot());

    // A short loop of the same fight: frames as fast as the renderer allows.
    // Small viewport + JPEG frames: the screenshot, not the game, is the
    // bottleneck, and 480 px is all a README GIF needs (400 px keeps it near 2 MB).
    await page.setViewportSize({ width: 640, height: 360 });
    await page.waitForTimeout(400);
    const frames = [];
    const started = Date.now();
    while (frames.length < 60 && Date.now() - started < 30000) frames.push(await page.screenshot({ type: 'jpeg', quality: 80 }));
    const scaled = await Promise.all(frames.map(frame => sharp(frame).resize({ width: 400 }).png().toBuffer()));
    const delay = Math.round((Date.now() - started) / frames.length);
    const gif = await sharp(scaled, { join: { animated: true } }).gif({ delay: Array(scaled.length).fill(delay), loop: 0, colours: 48, effort: 10, dither: 0.4, interFrameMaxError: 8 }).toBuffer();
    writeFileSync(new URL('fight.gif', out), gif);
    console.log(`storefront/fight.gif  ${(gif.length / 1024).toFixed(0)} KB (${frames.length} frames, ${delay} ms each)`);
    if (session.errors.length) console.warn('page errors:', session.errors);
  } finally { await session.close(); }
}

// 3. Cold Cut, through the dev finisher review: the real match and renderer,
// paused on an authored beat.
{
  const session = await openGame({ mode: 'dev', gpu: true, path: '?review=finisher' });
  const { page } = session;
  try {
    await page.goto(session.url);
    // Against Trump: the review defaults to Flock, whose armband texture is an
    // open content decision and doesn't belong on the storefront.
    await page.getByRole('button', { name: 'Opponent: Flock' }).click();
    await until(page, () => window.__FIGHT__?.snapshot()?.phase === 'finisher');
    await page.getByRole('button', { name: 'First slapshot' }).click();
    await page.waitForTimeout(500);
    await until(page, () => window.__FIGHT__?.snapshot()?.phase === 'finisher' && window.__FIGHT__.snapshot().phaseFrame >= 200);
    await page.waitForTimeout(1500);
    await page.evaluate(() => document.querySelectorAll('aside').forEach(panel => panel.remove()));
    await save('finisher.jpg', await page.screenshot());
  } finally { await session.close(); }
}
