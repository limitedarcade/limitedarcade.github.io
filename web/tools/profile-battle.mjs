import fs from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';
import { launchBrowser, GAME_DIR } from './browser.mjs';

const label = process.argv[2] || 'before';
const out = resolve('artifacts/performance-2026-10-12');
fs.mkdirSync(out, { recursive: true });
let baselineServer = null;
let url = 'http://127.0.0.1:5176/';
const baselineFlag = process.argv.find(arg => arg.startsWith('--baseline='));
const baseline = process.argv.includes('--baseline') || baselineFlag
  ? execFileSync('git', ['rev-parse', baselineFlag?.slice('--baseline='.length) || 'HEAD'], { encoding: 'utf8' }).trim() : null;
if (baseline || process.argv.includes('--isolated')) {
  const paths = ['main.js', 'render/fighterDamage.js', 'render/goreProps.js', 'render/stumpFlesh.js', 'render/cutSeam.js', 'render/dismemberment.js'];
  const key = path => path.replaceAll('\\', '/').split('?')[0].toLowerCase();
  const sources = baseline ? new Map(paths.map(path => [key(resolve(GAME_DIR, 'src', path)),
    execFileSync('git', ['show', `${baseline}:web/game/src/${path}`], { encoding: 'utf8' })])) : new Map();
  baselineServer = await createServer({ root: GAME_DIR, configFile: resolve(GAME_DIR, 'vite.config.js'), logLevel: 'warn',
    plugins: [{ name: 'severance-baseline', enforce: 'pre', load: id => sources.get(key(id)) }],
    server: { host: '127.0.0.1', port: 5197, strictPort: true } });
  await baselineServer.listen(); url = baselineServer.resolvedUrls.local[0];
}
const browser = await launchBrowser({ gpu: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [], warnings = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'warning') warnings.push(m.text()); });
try {
  await page.addInitScript(() => {
    window.perfReport = { frames: [], costs: [], gl: [] };
    for (const method of ['compileShader', 'linkProgram', 'getProgramParameter']) {
      const prototype = WebGL2RenderingContext.prototype, original = prototype[method];
      prototype[method] = function (...args) {
        const begin = performance.now(), result = original.apply(this, args), ms = performance.now() - begin;
        if (method !== 'getProgramParameter' || ms > 2) window.perfReport.gl.push({ method, ms, at: begin,
          phase: window.__FIGHT__?.match()?.phase, frame: window.__FIGHT__?.match()?.phaseFrame });
        return result;
      };
    }
  });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__FIGHT__?.match() && window.__FIGHT__.views.length === 2, null, { timeout: 90000 });
  await page.evaluate(() => {
    const api = window.__FIGHT__, report = window.perfReport;
    const wrap = (object, method, name) => {
      if (!object?.[method]) return;
      const original = object[method];
      object[method] = function (...args) {
        const begin = performance.now(), value = original.apply(this, args), ms = performance.now() - begin;
        if (ms > .1) report.costs.push({ name, ms, at: begin, phase: api.match()?.phase, frame: api.match()?.phaseFrame });
        return value;
      };
    };
    for (const view of api.views) {
      for (const method of ['apply', 'flinch']) wrap(view, method, `${view.definition.id}.${method}`);
      for (const method of ['onHit', 'severByBones']) wrap(view.damage, method, `${view.definition.id}.damage.${method}`);
      wrap(view.gore, 'sever', `${view.definition.id}.sever`);
      wrap(view.gore?.flesh, 'attach', `${view.definition.id}.stump`);
      for (const method of ['update', 'fitSurface', 'placeStrands', 'cutAxis']) wrap(view.gore?.flesh, method, `${view.definition.id}.flesh.${method}`);
    }
    wrap(api.match(), 'step', 'simulation');
    wrap(api.gore, 'addSurfaceLimb', 'detachedSurface');
    wrap(window.postfx, 'render', 'render');
    const gl = api.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
    report.device = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    report.viewport = [innerWidth, innerHeight, devicePixelRatio, api.renderer.getPixelRatio()];
    let last = null;
    const sample = now => {
      const m = api.match();
      if (last !== null) report.frames.push({ ms: now - last, at: now, phase: m?.phase, frame: m?.phaseFrame,
        programs: api.renderer.info.programs.length });
      if (report.programs?.length !== api.renderer.info.programs.length)
        report.programs = api.renderer.info.programs.map(p => ({ name: p.name, key: p.cacheKey, phase: m?.phase, frame: m?.phaseFrame }));
      last = now;
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
    const render = window.postfx.render;
    api.renderer.info.autoReset = false;
    window.postfx.render = function () {
      api.renderer.info.reset(); const result = render.call(this);
      const frame = report.frames.at(-1);
      if (frame) { frame.calls = api.renderer.info.render.calls; frame.triangles = api.renderer.info.render.triangles; }
      return result;
    };
  });
  console.log(`Profiling ${label}: complete exhibition at 1280 x 720 on the graphics card.`);
  if (process.argv.includes('--finisher')) await page.evaluate(async () => {
    const api = window.__FIGHT__, side = api.views.findIndex(v => v.definition.id === 'carney');
    const { fatalityOf } = await import('/src/engine/fatalities.js');
    api.match().startFinisher(fatalityOf('carney-cold-cut'), side); api.match().phaseFrame = 48;
  });
  await page.waitForFunction(() => window.__FIGHT__?.match()?.phase === 'finisher', null, { timeout: 120000 });
  if (process.argv.includes('--capture')) await page.screenshot({ path: resolve(out, `${label}-entry.png`) });
  console.log('Finisher entered.');
  if (process.argv.includes('--capture')) {
    await page.waitForFunction(() => window.__FIGHT__?.match()?.phaseFrame >= 225, null, { timeout: 90000 });
    await page.screenshot({ path: resolve(out, `${label}-cut.png`) });
  }
  await page.waitForFunction(() => window.__FIGHT__?.match()?.phase === 'matchEnd', null, { timeout: 90000 });
  if (process.argv.includes('--capture')) await page.screenshot({ path: resolve(out, `${label}-final.png`) });
} catch (error) { errors.push(error.stack); process.exitCode = 1; }
const report = await page.evaluate(() => window.perfReport).catch(() => ({}));
report.errors = errors; report.warnings = warnings;
report.baseline = baseline;
const percentile = (values, p) => [...values].sort((a,b) => a-b)[Math.min(values.length - 1, Math.floor(values.length * p))];
report.summary = Object.fromEntries(['intro', 'fight', 'finisher'].map(phase => {
  const frames = report.frames?.filter(f => f.phase === phase) || [], ms = frames.map(f => f.ms);
  return [phase, { frames: frames.length, median: percentile(ms, .5), p95: percentile(ms, .95), max: Math.max(...ms),
    over50: ms.filter(n => n > 50).length, over100: ms.filter(n => n > 100).length,
    calls: percentile(frames.map(f => f.calls || 0), .5), triangles: percentile(frames.map(f => f.triangles || 0), .5) }];
}));
report.worstCosts = [...(report.costs || [])].sort((a,b) => b.ms-a.ms).slice(0, 35);
fs.writeFileSync(resolve(out, `${label}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ device: report.device, summary: report.summary, worstCosts: report.worstCosts.slice(0,12), errors }, null, 2));
await browser.close();
await baselineServer?.close();
