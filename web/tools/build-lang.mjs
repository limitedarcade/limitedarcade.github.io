import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolvePython } from '../fighter-tool/runner/python.mjs';
import { encodeForceMeasured } from '../fighter-tool/tools/encode_force_measured.mjs';
import { packFighterModel } from './pack-fighter-model.mjs';

const path = p => fileURLToPath(new URL(p, import.meta.url));
const build = path('../fighter-tool/build/lang/'), output = path('../game/public/fighters/lang/');
mkdirSync(build, { recursive: true }); mkdirSync(output, { recursive: true });
const file = suffix => `${build}lang_${suffix}`;
function run(executable, args) {
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Build step failed (${result.status}): ${args[0]}`);
}
function node(script, ...args) { run(process.execPath, [path(`../fighter-tool/tools/${script}`), ...args]); }

// --from-rig is for animation iterations. A full build always rebakes the
// textured/segmented pair, keeping the original source GLBs untouched.
if (!process.argv.includes('--from-rig')) {
  run(resolvePython(), [path('../fighter-tool/tools/bake_atlas_to_parts.py'),
    path('../fighters/lang/lang_stylized.glb'), path('../fighters/lang/lang.glb'), file('painted.glb')]);
  if (!existsSync(file('painted.glb'))) throw new Error('Texture bake wrote no model');
  node('decimate.mjs', file('painted.glb'), file('150k.glb'), '--total', '150000');
  node('measure_joints.mjs', file('150k.glb'), file('joints.json'));
}
node('rig.mjs', file('150k.glb'), file('joints.json'), file('rigged.glb'), path('../fighter-tool/tools/langClips.mjs'));
const parity = encodeForceMeasured(file('rigged.glb'), `${build}threejs`, { id: 'lang', displayName: 'Jake Lang' });
if (!parity.ok) throw new Error('Lang model failed packed geometry parity');
const { SURFACE_MODEL, SURFACE_STREAM } = await import(pathToFileURL(`${build}threejs/surfaceData.js`).href);
const { RIG } = await import(pathToFileURL(`${build}threejs/rigData.js`).href);
const bytes = packFighterModel(`${output}fighter.bin`, SURFACE_MODEL, SURFACE_STREAM, RIG);
writeFileSync(`${output}asset.json`, JSON.stringify({ id: 'lang', displayName: 'Jake Lang',
  runtime: 'threejs', skeleton: 'canonical-fighter-v1', clips: RIG.clips.map(c => c.name),
  triangles: parity.tris, bytes, source: 'lang_stylized.glb + lang.glb',
  build: 'node web/tools/build-lang.mjs',
}, null, 2) + '\n');
writeFileSync(`${output}parity.json`, JSON.stringify(parity, null, 2) + '\n');
console.log(`Jake Lang: ${parity.tris} triangles, ${RIG.clips.length} clips, ${(bytes / 1048576).toFixed(2)} MiB`);
