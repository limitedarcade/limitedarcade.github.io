import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, saveConfig, configPath, buildDir, writePoseSidecar, TOOL_ROOT } from './config.mjs';
import { evaluatePoseFile } from './gates.mjs';

export function meshForRig(id, cfg) {
  const dir = buildDir(id);
  const fists = join(dir, `${id}_fists.glb`);
  const decimated = join(dir, `${id}_150k.glb`);
  if (cfg.fists?.enabled !== false && existsSync(fists)) return fists;
  return decimated;
}

function runRig(mesh, joints, out) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(TOOL_ROOT, 'tools', 'rig.mjs'), mesh, joints, out], {
      cwd: TOOL_ROOT,
      env: process.env,
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(stderr.trim() || `rig.mjs exited ${code}`));
      else resolve();
    });
  });
}

export async function liveTune({ id, rig, rerig = false, fists }) {
  if (!id) throw new Error('id required');
  const path = configPath(id);
  const cfg = loadConfig(path);
  if (fists && typeof fists.enabled === 'boolean') cfg.fists = { ...cfg.fists, enabled: fists.enabled };
  if (rig) cfg.rig = { ...cfg.rig, ...rig };
  saveConfig(path, cfg);

  const dir = buildDir(id);
  const joints = join(dir, `${id}_joints.json`);
  if (!existsSync(joints)) throw new Error('No joints yet — run a build first.');
  writePoseSidecar(joints, cfg.rig);
  const pose = evaluatePoseFile(joints, cfg.gates);

  const output = join(dir, `${id}_rigged.glb`);
  if (rerig) {
    const mesh = meshForRig(id, cfg);
    if (!existsSync(mesh)) throw new Error(`Missing mesh ${mesh}`);
    await runRig(mesh, joints, output);
  }
  return { pose, output, config: cfg, rerig: !!rerig };
}
