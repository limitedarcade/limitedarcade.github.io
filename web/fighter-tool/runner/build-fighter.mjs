import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, TOOL_ROOT, buildDir, writePoseSidecar, ensureDir } from './config.mjs';
import { validatePair, checkEnvironment, formatCard } from './validate.mjs';
import { resolvePython } from './python.mjs';
import { bakeGates, measureGates, evaluatePoseFile } from './gates.mjs';
import { publishFighter } from './publish.mjs';
import { encodeFighter } from './encode.mjs';

const TOOLS = join(TOOL_ROOT, 'tools');

function emit(listener, ev) {
  if (listener) listener(ev);
  else {
    const tag = ev.status ? `[${ev.status}]` : '[info]';
    console.log(`${tag} ${ev.stage || ''} ${ev.message || ''}`.trim());
    if (ev.logLine) console.log(ev.logLine.replace(/\r?\n$/, ''));
  }
}

function runNode(script, args, listener, stage) {
  return new Promise((resolveP, reject) => {
    const child = spawn(process.execPath, [join(TOOLS, script), ...args], {
      cwd: TOOL_ROOT,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      for (const line of s.split(/\r?\n/).filter(Boolean)) {
        emit(listener, { stage, status: 'log', logLine: line });
      }
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      for (const line of s.split(/\r?\n/).filter(Boolean)) {
        emit(listener, { stage, status: 'log', logLine: line });
      }
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const err = new Error(`${script} exited ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.stage = stage;
        reject(err);
      } else resolveP({ stdout, stderr, code });
    });
  });
}

function runPython(args, listener, stage) {
  return new Promise((resolveP, reject) => {
    const py = resolvePython();
    const child = spawn(py, args, { cwd: TOOL_ROOT, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      for (const line of s.split(/\r?\n/).filter(Boolean)) {
        emit(listener, { stage, status: 'log', logLine: line });
      }
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      for (const line of s.split(/\r?\n/).filter(Boolean)) {
        emit(listener, { stage, status: 'log', logLine: line });
      }
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const err = new Error(`python exited ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        err.stage = stage;
        reject(err);
      } else resolveP({ stdout, stderr, code });
    });
  });
}

function readJson(p) {
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export async function buildFighter(cfg, opts = {}) {
  const listener = opts.onEvent;
  const t0 = Date.now();
  const id = cfg.id;
  if (!id) throw new Error('config.id is required');
  const dir = ensureDir(buildDir(id));
  const gatesAll = [];
  const stages = [];
  const manifest = {
    kind: 'fighter-run',
    id,
    displayName: cfg.displayName || id,
    startedAt: new Date().toISOString(),
    config: cfg,
    toolRoot: TOOL_ROOT,
    node: process.version,
    stages: [],
    gates: [],
  };

  const skip = new Set(opts.skip || []);
  const from = opts.from || 'validate';
  const order = ['validate', 'bake', 'decimate', 'fists', 'measure', 'pose', 'rig', 'encode', 'publish'];
  const startAt = Math.max(0, order.indexOf(from));

  function want(stage) {
    return order.indexOf(stage) >= startAt && !skip.has(stage);
  }

  const painted = join(dir, `${id}_painted.glb`);
  const decimated = join(dir, `${id}_150k.glb`);
  const fists = join(dir, `${id}_fists.glb`);
  const joints = join(dir, `${id}_joints.json`);
  const rigged = join(dir, `${id}_rigged.glb`);
  const budgetPath = join(dir, `${id}_budget.json`);

  // ---- validate ----
  emit(listener, { stage: 'validate', status: 'start', message: 'Checking the export(s) and the environment' });
  const env = await checkEnvironment();
  if (!env.ok) {
    const fail = env.checks.filter((c) => !c.ok);
    throw new Error(fail.map((c) => c.fix || c.message).join('\n'));
  }
  const val = await validatePair(cfg.source.textured, cfg.source.parts, { env });
  emit(listener, { stage: 'validate', status: val.ok ? 'pass' : 'fail', message: formatCard(val), result: val });
  if (!val.ok) throw new Error('Validator failed — not starting a bake against a file that cannot run.\n' + formatCard(val));
  const textured = val.textured;
  const parts = val.parts;
  const solo = (val.route || 'pair') !== 'pair';
  stages.push({ name: 'validate', ok: true, ms: Date.now() - t0, route: val.route || 'pair' });

  if (want('bake')) {
    const s0 = Date.now();
    if (solo) {
      emit(listener, { stage: 'bake', status: 'start', message: 'Splitting the textured GLB into Head / Torso / arms / legs and sampling the atlas' });
      await runPython(
        [join(TOOLS, 'textured_to_parts.py'), textured, painted],
        listener, 'bake',
      );
    } else {
      emit(listener, { stage: 'bake', status: 'start', message: 'Painting the parts mesh from the atlas — about 4 minutes' });
      await runPython(
        [join(TOOLS, 'bake_atlas_to_parts.py'), textured, parts, painted],
        listener, 'bake',
      );
    }
    const bakeReport = readJson(painted.replace(/\.glb$/, '-bake.json'));
    const g = bakeReport && bakeReport.kind === 'atlas-bake-report' ? bakeGates(bakeReport, cfg.gates) : [];
    gatesAll.push(...g);
    emit(listener, { stage: 'bake', status: 'pass', message: `wrote ${painted}`, gates: g, ms: Date.now() - s0 });
    stages.push({ name: 'bake', ok: true, ms: Date.now() - s0, report: bakeReport, route: val.route });
  }

  if (want('decimate')) {
    const s0 = Date.now();
    emit(listener, { stage: 'decimate', status: 'start', message: `Decimate to ${cfg.decimate.total} tris, head ${(cfg.decimate.budget.Head * 100).toFixed(0)}%` });
    writeFileSync(budgetPath, JSON.stringify(cfg.decimate.budget, null, 2));
    await runNode('decimate.mjs', [
      painted, decimated,
      '--total', String(cfg.decimate.total),
      '--budget', budgetPath,
    ], listener, 'decimate');
    const decReport = readJson(decimated.replace(/\.glb$/, '-decimate.json'));
    emit(listener, { stage: 'decimate', status: 'pass', message: `wrote ${decimated}`, ms: Date.now() - s0, report: decReport });
    stages.push({ name: 'decimate', ok: true, ms: Date.now() - s0, report: decReport });
  }

  let meshForMeasure = decimated;
  if (want('fists') && cfg.fists?.enabled !== false) {
    const s0 = Date.now();
    emit(listener, { stage: 'fists', status: 'start', message: 'Baking open hands into fists (route B)' });
    await runNode('make_fists.mjs', [decimated, fists], listener, 'fists');
    meshForMeasure = fists;
    const fistReport = readJson(fists.replace(/\.glb$/, '-fists.json'));
    emit(listener, { stage: 'fists', status: 'pass', message: `wrote ${fists}`, ms: Date.now() - s0, report: fistReport });
    stages.push({ name: 'fists', ok: true, ms: Date.now() - s0, report: fistReport });
  }

  if (want('measure')) {
    const s0 = Date.now();
    emit(listener, { stage: 'measure', status: 'start', message: 'Measuring joints from part bounds' });
    // A sculpt delivered with closed fists has no knuckle bulge, so the wrist
    // girth scan finds nothing and falls back to a guess. `measure.wristFrac`
    // in the config replaces the guess with the other arm's measured value.
    const wristArgs = [];
    const fracs = Object.entries(cfg.measure?.wristFrac || {}).map(([s, v]) => `${s}=${v}`);
    if (fracs.length) wristArgs.push('--wrist-frac', fracs.join(','));
    await runNode('measure_joints.mjs', [meshForMeasure, joints, ...wristArgs], listener, 'measure');
    writePoseSidecar(joints, cfg.rig);
    const meas = readJson(joints);
    const g = measureGates(meas, cfg.gates);
    gatesAll.push(...g);
    const guessed = g.some((x) => x.guessed);
    emit(listener, {
      stage: 'measure', status: guessed ? 'flag' : 'pass',
      message: guessed
        ? 'Wrist fell back to 72% of arm length — a guess, not a measurement. Aim targets are downstream of this landmark.'
        : `wristSkew ${(meas.wristSkew * 100).toFixed(2)}% of arm length (limit 3%)`,
      gates: g, ms: Date.now() - s0,
    });
    stages.push({ name: 'measure', ok: true, ms: Date.now() - s0, wristSkew: meas.wristSkew });
  }

  if (want('pose')) {
    const s0 = Date.now();
    emit(listener, { stage: 'pose', status: 'start', message: 'Pose check in viewer metres' });
    const pose = evaluatePoseFile(joints, cfg.gates);
    gatesAll.push(...pose.gates);
    const flagged = pose.gates.filter((g) => g.status === 'flag');
    emit(listener, {
      stage: 'pose',
      status: flagged.length ? 'flag' : 'pass',
      message: flagged.length
        ? flagged.map((g) => g.fix).join(' ')
        : `worst trunk clearance ${pose.worstClear.toFixed(3)} m, lowest joint ${pose.lowestY.toFixed(3)} m`,
      gates: pose.gates,
      rows: pose.rows,
      ms: Date.now() - s0,
    });
    stages.push({ name: 'pose', ok: true, ms: Date.now() - s0, worstClear: pose.worstClear });
  }

  if (want('rig')) {
    const s0 = Date.now();
    emit(listener, { stage: 'rig', status: 'start', message: 'Skinning the canonical 25-bone tree' });
    await runNode('rig.mjs', [meshForMeasure, joints, rigged], listener, 'rig');
    const rigReport = readJson(rigged.replace(/\.glb$/, '-rig.json'));
    emit(listener, { stage: 'rig', status: 'pass', message: `wrote ${rigged}`, ms: Date.now() - s0, report: rigReport });
    stages.push({ name: 'rig', ok: true, ms: Date.now() - s0, report: rigReport });
  }

  let encoded = null;
  if (want('encode') && (opts.encode || opts.publish)) {
    const s0 = Date.now();
    emit(listener, { stage: 'encode', status: 'start', message: 'Packing the measured surface into a Three.js factory' });
    encoded = encodeFighter(cfg, rigged, { onEvent: listener });
    emit(listener, {
      stage: 'encode',
      status: encoded.ok ? 'pass' : 'flag',
      message: encoded.ok
        ? `${encoded.verts} verts / ${encoded.tris} tris → ${(encoded.surfaceJsBytes / 1e6).toFixed(2)} MB JS`
        : `packed with flags: ${encoded.gates.filter((g) => g.status !== 'pass').map((g) => g.name).join(', ')}`,
      parity: encoded,
      ms: Date.now() - s0,
    });
    stages.push({ name: 'encode', ok: encoded.ok, ms: Date.now() - s0, verts: encoded.verts });
  }

  let published = null;
  if (want('publish') && opts.publish) {
    const s0 = Date.now();
    emit(listener, { stage: 'publish', status: 'start', message: `Registering ${id} in the practice build` });
    const meas = readJson(joints);
    published = publishFighter(cfg, rigged, meas);
    emit(listener, { stage: 'publish', status: 'pass', message: published.practiceUrl, result: published, ms: Date.now() - s0 });
    stages.push({ name: 'publish', ok: true, ms: Date.now() - s0 });
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.ms = Date.now() - t0;
  manifest.stages = stages;
  manifest.gates = gatesAll;
  manifest.outputs = { painted, decimated, fists, joints, rigged, encoded, published };
  const manPath = join(dir, `${id}-run.json`);
  writeFileSync(manPath, JSON.stringify(manifest, null, 2) + '\n');
  emit(listener, { stage: 'done', status: 'pass', message: `manifest ${manPath}`, manifest });
  return manifest;
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const args = process.argv.slice(2);
  const cfgArg = args.find((a, i) => args[i - 1] === '--config') || args.find((a) => a.endsWith('.json'));
  if (!cfgArg) {
    console.error('usage: node runner/build-fighter.mjs --config configs/trump.json [--from bake] [--skip fists] [--encode] [--publish]');
    process.exit(2);
  }
  const cfg = loadConfig(resolve(cfgArg));
  const from = args.includes('--from') ? args[args.indexOf('--from') + 1] : 'validate';
  const skip = [];
  if (args.includes('--skip')) skip.push(...String(args[args.indexOf('--skip') + 1]).split(','));
  if (args.includes('--no-fists')) skip.push('fists');
  try {
    await buildFighter(cfg, { from, skip, encode: args.includes('--encode'), publish: args.includes('--publish') });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
