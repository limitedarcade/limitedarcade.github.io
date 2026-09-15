import { readFileSync, existsSync } from 'node:fs';

export function loadPose(jointPath) {
  const side = jointPath.replace(/_joints\.json$/, '_pose.json');
  if (side === jointPath || !existsSync(side)) return {};
  const o = JSON.parse(readFileSync(side, 'utf8'));
  console.log(`pose overrides: ${side}` + (o.note ? `  (${o.note})` : ''));
  return o;
}
