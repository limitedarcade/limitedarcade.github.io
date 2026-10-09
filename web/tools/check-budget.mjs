// Download budget gate, the size counterpart of check-vfx.
//
//   npm run check-budget                  # static checks on dist/ + a browser measurement
//   npm run check-budget -- --static      # dist/ file sizes only (no browser)
//
// Static: no single file in dist/ over `perAssetMB`, and dist/ as a whole under
// `distMB`. Measured: the real game in headless Chrome, served from dist/,
// must reach the title under `titleMB` and start the first fight under
// `firstFightMB`. Caps live in tools/budget.json. Run `npm run build` first.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { WEB_DIR } from './browser.mjs';

const budget = JSON.parse(readFileSync(resolve(WEB_DIR, 'tools/budget.json'), 'utf8'));
const dist = resolve(WEB_DIR, 'dist'), MB = 1048576, failures = [];
const fmt = bytes => `${(bytes / MB).toFixed(2)} MB`;
if (!existsSync(dist)) { console.error('dist/ is missing. Run `npm run build` first.'); process.exit(1); }

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(path); else files.push({ path: relative(dist, path).replaceAll('\\', '/'), bytes: statSync(path).size });
  }
})(dist);
files.sort((a, b) => b.bytes - a.bytes);
const total = files.reduce((sum, f) => sum + f.bytes, 0);
console.log(`dist/: ${files.length} files, ${fmt(total)} (cap ${budget.distMB} MB)`);
if (total > budget.distMB * MB) failures.push(`dist/ is ${fmt(total)}, over ${budget.distMB} MB`);
for (const file of files) {
  const cap = (budget.perAssetExceptions[file.path] ?? budget.perAssetMB) * MB;
  if (file.bytes > cap) failures.push(`${file.path} is ${fmt(file.bytes)}, over its ${fmt(cap)} cap (add it to tools/asset-pipeline.json)`);
}
console.log('  largest: ' + files.slice(0, 5).map(f => `${f.path} ${fmt(f.bytes)}`).join(', '));

if (!process.argv.includes('--static')) {
  const { runSmoke } = await import('./smoke-test.mjs');
  console.log('Measuring in the browser (title and first fight, served from dist/)...');
  const report = await runSmoke({ screenshots: false, until: 'fight', outDir: resolve(WEB_DIR, 'artifacts/budget'), log: () => {} });
  if (!report.ok) failures.push(`browser measurement failed: ${report.steps.find(s => !s.ok)?.error || report.errors.join('; ')}`);
  const { title = 0, firstFight = 0 } = report.bytes;
  console.log(`  title ${fmt(title)} (cap ${budget.titleMB} MB), first fight ${fmt(firstFight)} (cap ${budget.firstFightMB} MB)`);
  if (title > budget.titleMB * MB) failures.push(`title needs ${fmt(title)}, over ${budget.titleMB} MB`);
  if (firstFight > budget.firstFightMB * MB) failures.push(`first fight needs ${fmt(firstFight)}, over ${budget.firstFightMB} MB`);
}

if (failures.length) { console.error('\nBudget exceeded:\n  ' + failures.join('\n  ')); process.exit(1); }
console.log('Budget OK');
