import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvePython } from './python.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'compare_shots.py');

export function compareShots(pathA, pathB, thresholds = {}) {
  const py = resolvePython();
  const proc = spawnSync(py, [SCRIPT, pathA, pathB], { encoding: 'utf8', timeout: 30000 });
  if (proc.status !== 0) {
    return {
      ok: false,
      error: (proc.stderr || proc.stdout || 'compare_shots.py failed').trim(),
      gates: [],
    };
  }
  const report = JSON.parse(proc.stdout);
  const gates = [
    {
      name: 'silhouetteIoU',
      value: report.iou,
      threshold: thresholds.minIoU ?? 0.985,
      cmp: '>=',
      status: report.iou >= (thresholds.minIoU ?? 0.985) ? 'pass' : 'flag',
      fix: report.iou >= (thresholds.minIoU ?? 0.985) ? null
        : 'Silhouette drifted. Check framing (viewport must match canvas w/h) and that vertexColors keys off !material.map — the clay bug was ΔE 104 from a viewer preset.',
    },
    {
      name: 'headDE50',
      value: report.headDE50,
      threshold: thresholds.maxDE50 ?? 4.0,
      cmp: '<=',
      status: report.headDE50 != null && report.headDE50 <= (thresholds.maxDE50 ?? 4.0) ? 'pass' : 'flag',
      fix: 'Head median colour delta is over 4. Spend the triangle budget on the head; body is already converged by ~120k.',
    },
    {
      name: 'headDE95',
      value: report.headDE95,
      threshold: thresholds.maxDE95 ?? 25.0,
      cmp: '<=',
      status: report.headDE95 != null && report.headDE95 <= (thresholds.maxDE95 ?? 25.0) ? 'pass' : 'flag',
      fix: 'Head p95 colour delta is over 25. Face quality tracks the head’s own triangle count, not the total.',
    },
  ];
  return { ok: true, report, gates };
}
