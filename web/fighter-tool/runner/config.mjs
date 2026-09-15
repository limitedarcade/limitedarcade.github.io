import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WEB_ROOT = resolve(TOOL_ROOT, '..');
export const GAME_ROOT = join(WEB_ROOT, 'game');
export const DEFAULTS_PATH = join(TOOL_ROOT, 'configs', 'defaults.json');

export function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function loadDefaults() {
  return loadJson(DEFAULTS_PATH);
}

function deepMerge(base, over) {
  if (over === undefined || over === null) return base;
  if (Array.isArray(over) || Array.isArray(base) || typeof over !== 'object' || typeof base !== 'object') {
    return over;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

export function resolvePath(p, fromDir = TOOL_ROOT) {
  if (!p) return p;
  return isAbsolute(p) ? p : resolve(fromDir, p);
}

export function loadConfig(path) {
  const raw = loadJson(path);
  const defaults = loadDefaults();
  const cfg = deepMerge(defaults, raw);
  const fromDir = dirname(resolve(path));
  if (cfg.source?.textured) cfg.source.textured = resolvePath(cfg.source.textured, fromDir);
  if (cfg.source?.parts) cfg.source.parts = resolvePath(cfg.source.parts, fromDir);
  cfg._configPath = resolve(path);
  return cfg;
}

export function saveConfig(path, cfg) {
  const copy = { ...cfg };
  delete copy._configPath;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(copy, null, 2) + '\n');
}

export function listConfigs() {
  const dir = join(TOOL_ROOT, 'configs');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== 'defaults.json')
    .map((f) => f.replace(/\.json$/, ''));
}

export function configPath(id) {
  return join(TOOL_ROOT, 'configs', `${id}.json`);
}

export function buildDir(id) {
  return join(TOOL_ROOT, 'build', id);
}

export function writePoseSidecar(jointPath, rig) {
  if (!rig) return;
  const side = jointPath.replace(/_joints\.json$/, '_pose.json');
  if (side === jointPath) return;
  const body = {
    note: 'written by fighter-tool runner from the fighter config',
    aimOffset: rig.aimOffset || [0, 0, 0],
    elbowPole: rig.elbowPole,
    guard: rig.guard,
  };
  if (rig.sigma) body.sigma = rig.sigma;
  writeFileSync(side, JSON.stringify(body, null, 2) + '\n');
  return side;
}

export function ensureDir(p) {
  mkdirSync(p, { recursive: true });
  return p;
}

export { existsSync, join, resolve };
