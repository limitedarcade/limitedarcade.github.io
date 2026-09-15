// Reuse measured, optimized meshes; no re-baking or decimation is necessary.
import { spawnSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_ROOT, GAME_ROOT } from './config.mjs';
import { CLIPS } from '../tools/fighterRig.mjs';

for (const id of ['trump', 'carney']) {
  const base = join(TOOL_ROOT, 'build', id, id);
  const result = spawnSync(process.execPath, [join(TOOL_ROOT, 'tools/rig.mjs'),
    `${base}_150k.glb`, `${base}_joints.json`, `${base}_rigged.glb`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
  const dest = join(GAME_ROOT, 'public/fighters', id);
  copyFileSync(`${base}_rigged.glb`, join(dest, `${id}-rigged.glb`));
  const assetPath = join(dest, 'asset.json');
  const asset = JSON.parse(readFileSync(assetPath));
  asset.clips = CLIPS.map(c => c.name);
  asset.runtimeUse = 'combat-prototype';
  writeFileSync(assetPath, JSON.stringify(asset, null, 2) + '\n');
}
