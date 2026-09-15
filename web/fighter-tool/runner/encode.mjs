import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeForceMeasured } from '../tools/encode_force_measured.mjs';
import { loadConfig, configPath, buildDir } from './config.mjs';

export function threejsDir(id) {
  return join(buildDir(id), 'threejs');
}

export function encodeFighter(cfg, riggedGlb, opts = {}) {
  const id = cfg.id;
  const outDir = opts.outDir || threejsDir(id);
  return encodeForceMeasured(riggedGlb, outDir, {
    id,
    displayName: cfg.displayName || id,
    threeImport: opts.threeImport || 'three',
    codecImport: opts.codecImport || './meshCodec.js',
    onEvent: opts.onEvent,
  });
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === thisFile) {
  const args = process.argv.slice(2);
  const cfgArg = args.find((a, i) => args[i - 1] === '--config') || args.find((a) => a.endsWith('.json'));
  const idArg = args.includes('--id') ? args[args.indexOf('--id') + 1] : null;
  const cfg = cfgArg ? loadConfig(resolve(cfgArg)) : loadConfig(configPath(idArg || 'trump'));
  const rigged = join(buildDir(cfg.id), `${cfg.id}_rigged.glb`);
  if (!existsSync(rigged)) {
    console.error(`missing ${rigged} — build the fighter first`);
    process.exit(2);
  }
  try {
    const parity = encodeFighter(cfg, rigged);
    console.log(`ok=${parity.ok}  ${parity.verts} verts  ${parity.tris} tris  ${(parity.surfaceJsBytes / 1e6).toFixed(2)} MB`);
    if (!parity.ok) process.exitCode = 1;
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
