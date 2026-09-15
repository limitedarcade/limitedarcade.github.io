import { readFileSync } from 'node:fs';
import { createRig, CLIPS, qConj, qRot } from '../tools/fighterRig.mjs';
import { loadPose } from '../tools/poseSidecar.mjs';

function trunkRadius(trunk, y) {
  if (y <= trunk[0].y) return trunk[0];
  if (y >= trunk[trunk.length - 1].y) return trunk[trunk.length - 1];
  for (let i = 1; i < trunk.length; i++) {
    if (y > trunk[i].y) continue;
    const a = trunk[i - 1], b = trunk[i], t = (y - a.y) / (b.y - a.y);
    return { halfX: a.halfX + t * (b.halfX - a.halfX), halfZ: a.halfZ + t * (b.halfZ - a.halfZ) };
  }
  return trunk[trunk.length - 1];
}

function clearance(rig, trunk, st, pModel) {
  let best = Infinity;
  for (const name of ['hips', 'spine', 'chest']) {
    const i = rig.boneIndex[name], b = rig.bones[i], n = st.list[i];
    const local = qRot(qConj(n.q), [pModel[0] - n.pos[0], pModel[1] - n.pos[1], pModel[2] - n.pos[2]]);
    const r0 = [local[0] + b.world[0], local[1] + b.world[1], local[2] + b.world[2]];
    const R = trunkRadius(trunk, r0[1]);
    const r = Math.hypot(r0[0], r0[2]);
    if (r < 1e-6) return -R.halfX * rig.scale;
    const shell = 1 / Math.hypot((r0[0] / r) / R.halfX, (r0[2] / r) / R.halfZ);
    const gap = (r - shell) * rig.scale;
    if (Math.abs(gap) < Math.abs(best)) best = gap;
  }
  return best;
}

const span = (c, d) => [c - d, c - d / 2, c, c + d / 2, c + d];

export function sweepAim(jointPath, side, opts = {}) {
  const meas = JSON.parse(readFileSync(jointPath, 'utf8'));
  const poseOpts = loadPose(jointPath);
  const rig = createRig(meas.joints, meas.bounds, poseOpts);
  const S = side;
  const clipName = opts.clip || 'guard';
  const keyIdx = opts.key ?? 0;
  const clip = CLIPS.find((c) => c.name === clipName);
  if (!clip) throw new Error(`no clip "${clipName}"`);
  const baseKey = clip.keys[keyIdx]?.[1];
  if (!baseKey) throw new Error(`clip "${clipName}" has no key ${keyIdx}`);
  const seed = (opts.seed
    || { ...(CLIPS[1].keys[0][1] || {}), ...baseKey }.aim?.[S]
    || [S === 'L' ? 0.32 : -0.32, 1.38, 0.30]);
  const XS = opts.x || span(seed[0], 0.08);
  const YS = opts.y || span(seed[1], 0.08);
  const ZS = opts.z || span(seed[2], 0.08);
  const MIN_CLEAR = opts.minClear ?? 0.03;
  const MAX_EXT = opts.maxExt ?? 88;

  const hits = [];
  const all = [];
  for (const y of YS) for (const z of ZS) for (const x of XS) {
    const pose = rig.resolve({ ...baseKey, aim: { ...(baseKey.aim || {}), [S]: [x, y, z] } });
    const st = rig.fk(pose);
    const M = (n) => st.list[rig.boneIndex[n]].pos;
    const V = (n) => rig.toView(M(n));
    const sh = V('upperArm' + S), el = V('forearm' + S), w = V('hand' + S), fist = V('handEnd' + S);
    const seg = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ext = seg(sh, w) / (seg(sh, el) + seg(el, w)) * 100;
    const cw = clearance(rig, meas.trunk, st, M('hand' + S));
    const cf = clearance(rig, meas.trunk, st, M('handEnd' + S));
    const ce = clearance(rig, meas.trunk, st, M('forearm' + S));
    const ok = cw > MIN_CLEAR && cf > MIN_CLEAR && ce > MIN_CLEAR && ext < MAX_EXT;
    const row = { target: [x, y, z], fist, clear: [cw, cf, ce], ext, ok };
    all.push(row);
    if (ok) hits.push(row);
  }
  hits.sort((a, b) => (Math.min(...b.clear) - Math.min(...a.clear)) || (a.ext - b.ext));
  return {
    side: S, clip: clipName, key: keyIdx, seed,
    pass: hits.length, total: all.length,
    roomiest: hits[0] || null,
    hits: hits.slice(0, 12),
  };
}
