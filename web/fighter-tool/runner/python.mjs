import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DEFAULT_VENV = join(
  homedir(),
  '.claude/skills/img2threejs/integrations/glb_character_pipeline/.venv/Scripts/python.exe',
);

export function resolvePython() {
  return process.env.FIGHTER_PYTHON || DEFAULT_VENV;
}

export function checkPython() {
  const python = resolvePython();
  const result = {
    python,
    exists: existsSync(python),
    numpy: false,
    pil: false,
    numpyVersion: null,
    pilVersion: null,
    error: null,
  };
  if (!result.exists) {
    result.error = `Python venv not found at ${python}. Set FIGHTER_PYTHON to the skill venv python.exe. System python has no numpy and the bake exits 0 writing nothing.`;
    return result;
  }
  const probe = spawnSync(
    python,
    ['-c', 'import numpy; from PIL import Image; print(numpy.__version__); print(Image.__version__)'],
    { encoding: 'utf8', timeout: 15000 },
  );
  if (probe.status !== 0) {
    const err = (probe.stderr || probe.stdout || 'import failed').trim();
    result.error = `Python at ${python} could not import numpy + PIL. ${err} The bake must hard-fail here rather than exit 0 writing nothing.`;
    return result;
  }
  const [numpyVersion, pilVersion] = probe.stdout.trim().split(/\r?\n/);
  result.numpy = true;
  result.pil = true;
  result.numpyVersion = numpyVersion;
  result.pilVersion = pilVersion;
  return result;
}
