// One-command release to limitedarcade.github.io.
//
//   npm run release                 # dry run: gates + what would change. Publishes nothing.
//   npm run release -- --publish    # the same, then commits and pushes both branches
//
// Steps, in order; any failure stops the release:
//   1. tests (`npm test`), build, download budget (static), smoke test on dist/;
//   2. stage the site: dist/ with PNG text metadata stripped;
//   3. stage the source: the committed HEAD (exported by git, never the working
//      tree, so uncommitted work can't leak), PNG metadata stripped;
//   4. scan both for machine paths and personal identifiers -- a hit blocks the
//      release and lists the files; fix them in the repo, commit, re-run;
//   5. diff each against its live branch (limitedarcade/main, limitedarcade/source).
// With --publish it then commits on top of each live branch and pushes as a
// fast-forward. It never force-pushes.
//
// Flags: --skip-smoke (gates 1 without the browser pass), --keep (leave the
// staging folders for inspection).
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { WEB_DIR } from './browser.mjs';
import { stripPngText } from './sanitize-png-metadata.mjs';

const REPO = resolve(WEB_DIR, '..'), REMOTE = 'limitedarcade';
const args = new Set(process.argv.slice(2));
const publish = args.has('--publish');
const TEXT = /\.(html?|js|mjs|cjs|css|json|md|txt|svg|py|sh|bat|cmd|ps1|yml|yaml|toml|glsl|xml|csv|tsv|ini|cfg)$/i;

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { cwd: REPO, encoding: 'utf8', shell: process.platform === 'win32' && command === 'npm', maxBuffer: 1 << 28, ...options });
  if (result.error) throw result.error;
  return result;
};
const git = (...gitArgs) => {
  const result = run('git', gitArgs);
  if (result.status !== 0) throw new Error(`git ${gitArgs.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
};
const step = title => console.log(`\n== ${title}`);
const fail = message => { console.error(`\nRELEASE STOPPED: ${message}`); process.exit(1); };

function walk(dir, visit, base = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, visit, base); else visit(path, relative(base, path).replaceAll('\\', '/'));
  }
}

// What must never ship: this machine's paths and this user's identifiers.
function leakPatterns() {
  const words = new Set([userInfo().username]);
  for (const key of ['user.email']) {
    const value = run('git', ['config', key]).stdout.trim();
    // This is the intentional public release identity, not a private address.
    if (value && value !== 'limitedarcade@users.noreply.github.com') words.add(value);
  }
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    { name: 'Windows user path', regex: /[A-Za-z]:[\\/]{1,2}Users[\\/]{1,2}(?!Public\b)[^\\/\s"'`]+/g },
    { name: 'WSL user path', regex: /\/mnt\/[a-z]\/Users\/[^/\s"'`]+/gi },
    { name: 'macOS user path', regex: /\/Users\/(?!Shared\b)[A-Za-z0-9._-]+\//g },
    { name: 'Linux home path', regex: /\/home\/(?!user\b|runner\b)[a-z0-9._-]+\//g },
    // Whole words only: a short username is also a substring of code (fillText).
    ...[...words].filter(w => w && w.length > 3).map(w => ({ name: `identifier "${w}"`, regex: new RegExp(`(?<![A-Za-z0-9])${escape(w)}(?![A-Za-z0-9])`, 'gi') })),
  ];
}

// Strips PNG text chunks in place and scans text files. Returns findings.
function sanitize(dir, label) {
  const patterns = leakPatterns(), findings = [];
  let pngs = 0, stripped = 0;
  walk(dir, (path, rel) => {
    if (/\.png$/i.test(path)) {
      pngs++;
      const { buffer, removed } = stripPngText(readFileSync(path), rel);
      if (removed.length) { writeFileSync(path, buffer); stripped++; }
      return;
    }
    if (!TEXT.test(path) || statSync(path).size > 8 << 20) return;
    const text = readFileSync(path, 'utf8');
    for (const { name, regex } of patterns) {
      regex.lastIndex = 0;
      const match = regex.exec(text);
      if (match) {
        const line = text.slice(0, match.index).split('\n').length;
        findings.push(`${label}/${rel}:${line}  ${name}: ${match[0].slice(0, 60)}`);
      }
    }
  });
  console.log(`  ${label}: ${pngs} PNGs checked, ${stripped} had text metadata stripped`);
  return findings;
}

// Replace a worktree's content with `stagedDir`, stage it, and report the diff.
function prepareBranch(branch, stagedDir, message) {
  const tree = mkdtempSync(join(tmpdir(), `bfi-release-${branch}-`));
  git('worktree', 'add', '--detach', tree, `${REMOTE}/${branch}`);
  for (const entry of readdirSync(tree)) if (entry !== '.git') rmSync(join(tree, entry), { recursive: true, force: true });
  cpSync(stagedDir, tree, { recursive: true });
  const inTree = (...gitArgs) => { const r = run('git', gitArgs, { cwd: tree }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); };
  inTree('add', '-A');
  const stat = inTree('diff', '--cached', '--shortstat');
  const names = inTree('diff', '--cached', '--name-status').split('\n').filter(Boolean);
  console.log(`  ${REMOTE}/${branch}: ${stat || 'no changes'}`);
  for (const line of names.slice(0, 25)) console.log(`    ${line}`);
  if (names.length > 25) console.log(`    ... and ${names.length - 25} more`);
  return {
    changed: names.length > 0,
    commit: () => {
      inTree('-c', 'user.name=limitedarcade', '-c', 'user.email=limitedarcade@users.noreply.github.com', 'commit', '-m', message);
      return inTree('rev-parse', '--short', 'HEAD');
    },
    push: () => inTree('push', REMOTE, `HEAD:refs/heads/${branch}`),
    remove: () => { run('git', ['worktree', 'remove', '--force', tree]); rmSync(tree, { recursive: true, force: true }); },
  };
}

// ---------------------------------------------------------------------------
console.log(publish ? 'Release: PUBLISH mode' : 'Release: dry run (nothing will be published; add --publish to publish)');
if (publish) {
  const account = run('gh', ['api', 'user', '--jq', '.login']);
  if (account.status !== 0 || account.stdout.trim() !== 'limitedarcade')
    fail('authenticate GitHub CLI as limitedarcade before publishing.');
  if (git('remote', 'get-url', '--push', REMOTE) !== 'https://github.com/limitedarcade/limitedarcade.github.io.git')
    fail('the limitedarcade remote does not point at the expected Pages repository.');
  console.log('  authenticated as limitedarcade; public commits use its no-reply identity');
}
const head = git('rev-parse', '--short', 'HEAD'), dirty = git('status', '--porcelain');
console.log(`  source commit ${head}`);
if (dirty) console.log('  uncommitted changes: the dry run builds them into the site preview; --publish refuses until they are committed');
if (publish && dirty) fail('commit or stash your changes first, so what ships is exactly what is committed.');

step('Gates');
const gate = (label, command, commandArgs) => {
  process.stdout.write(`  ${label}... `);
  const result = run(command, commandArgs, { cwd: WEB_DIR });
  const ok = result.status === 0;
  console.log(ok ? 'ok' : 'FAILED');
  if (!ok) {
    const output = `${result.stdout}\n${result.stderr}`;
    const summary = output.split('\n').filter(l => /^(ℹ (tests|pass|fail)|✖ |FAIL|Budget exceeded|  [a-z/].* over)/.test(l)).slice(0, 12).join('\n    ');
    console.log(`    ${summary || output.slice(-1500)}`);
  }
  return ok;
};
const gates = [
  gate('tests', 'npm', ['test']),
  gate('build', 'npm', ['run', 'build']),
  gate('budget (static)', 'node', ['tools/check-budget.mjs', '--static']),
];
if (!args.has('--skip-smoke')) gates.push(gate('smoke test', 'node', [
  'tools/smoke-test.mjs', '--out-dir', join(REPO, '.verification', 'release-smoke'),
]));
const gatesOk = gates.every(Boolean);
if (!gatesOk && publish) fail('a gate failed (see above).');

step('Staging');
git('fetch', REMOTE, 'main', 'source');
const staging = mkdtempSync(join(tmpdir(), 'bfi-release-'));
const site = join(staging, 'site'), source = join(staging, 'source');
cpSync(resolve(WEB_DIR, 'dist'), site, { recursive: true });
mkdirSync(source);
// Export the committed tree through a throwaway index, so neither the real
// index nor the working tree is touched (and no tar dialect is involved).
{
  const env = { ...process.env, GIT_INDEX_FILE: join(staging, 'export.index') };
  for (const gitArgs of [['read-tree', 'HEAD'], [`--work-tree=${source}`, 'checkout-index', '-a', '-f']]) {
    const result = run('git', gitArgs, { env });
    if (result.status !== 0) fail(`could not export HEAD: ${result.stderr}`);
  }
  rmSync(env.GIT_INDEX_FILE, { force: true });
}

step('Sanitize');
const findings = [...sanitize(site, 'site'), ...sanitize(source, 'source')];
if (findings.length) {
  console.log(`  ${findings.length} leak(s) found:`);
  for (const finding of findings.slice(0, 40)) console.log(`    ${finding}`);
  if (findings.length > 40) console.log(`    ... and ${findings.length - 40} more`);
}

step('Changes against the live site');
const branches = [
  prepareBranch('main', site, `Publish build of ${head}`),
  prepareBranch('source', source, `Publish source snapshot of ${head}`),
];

try {
  const blocked = [!gatesOk && 'a gate failed', findings.length && 'leaks were found'].filter(Boolean);
  if (!publish) {
    console.log(`\nDry run complete.${blocked.length ? ` Not publishable yet: ${blocked.join(', ')}.` : ' Everything passed; run `npm run release -- --publish` to publish.'}`);
  } else {
    if (blocked.length) throw new Error(blocked.join(', '));
    step('Publishing');
    for (const [index, branch] of branches.entries()) {
      const name = index ? 'source' : 'main';
      if (!branch.changed) { console.log(`  ${name}: nothing to publish`); continue; }
      console.log(`  ${name}: committed ${branch.commit()}`);
      branch.push();
      console.log(`  ${name}: pushed to ${REMOTE}/${name}`);
    }
    console.log('\nPublished. GitHub Pages usually updates within a minute or two.');
  }
} catch (error) {
  // Not fail(): process.exit would skip the worktree cleanup below.
  console.error(`
RELEASE STOPPED: ${error.message}`); process.exitCode = 1;
} finally {
  for (const branch of branches) branch.remove();
  if (args.has('--keep')) console.log(`\nStaging kept at ${staging}`); else rmSync(staging, { recursive: true, force: true });
}
