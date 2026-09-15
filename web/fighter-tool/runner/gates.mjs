import { readFileSync } from 'node:fs';
import { createRig, CLIPS, qConj, qRot } from '../tools/fighterRig.mjs';
import { loadPose } from '../tools/poseSidecar.mjs';

function gate(name, value, threshold, cmp, fix, extra = {}) {
  const passed = cmp === '<=' ? value <= threshold
    : cmp === '>=' ? value >= threshold
    : cmp === '<' ? value < threshold
    : value > threshold;
  return {
    name, value, threshold, cmp, status: passed ? 'pass' : 'flag',
    fix: passed ? null : fix, ...extra,
  };
}

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

function clearance(rig, trunk, st, pWorld) {
  const TRUNK = ['hips', 'spine', 'chest'];
  let best = Infinity;
  for (const name of TRUNK) {
    const i = rig.boneIndex[name];
    const b = rig.bones[i], n = st.list[i];
    const d = [pWorld[0] - n.pos[0], pWorld[1] - n.pos[1], pWorld[2] - n.pos[2]];
    const local = qRot(qConj(n.q), d);
    const rest = [local[0] + b.world[0], local[1] + b.world[1], local[2] + b.world[2]];
    const R = trunkRadius(trunk, rest[1]);
    const r = Math.hypot(rest[0], rest[2]);
    if (r < 1e-6) return -R.halfX * rig.scale;
    const c = rest[0] / r, sn = rest[2] / r;
    const shell = 1 / Math.hypot(c / R.halfX, sn / R.halfZ);
    const gap = (r - shell) * rig.scale;
    if (Math.abs(gap) < Math.abs(best)) best = gap;
  }
  return best;
}

export function evaluatePose(meas, poseOpts, thresholds) {
  const rig = createRig(meas.joints, meas.bounds, poseOpts || {});
  const toView = rig.toView;
  const minClear = thresholds.minTrunkClearance ?? -0.03;
  const maxFloor = thresholds.maxFloor ?? -0.015;
  const rows = [];
  let buried = 0;
  let throughFloor = 0;
  let worstClear = Infinity;
  let lowestY = Infinity;

  for (const clip of CLIPS) {
    for (const [t, delta] of clip.keys) {
      const pose = rig.resolve(delta, { bind: clip.bind });
      const st = rig.fk(pose);
      const v = Object.fromEntries(rig.bones.map((b, i) => [b.name, toView(st.list[i].pos)]));
      const lowest = Math.min(...Object.values(v).map((p) => p[1]));
      lowestY = Math.min(lowestY, lowest);
      if (lowest < maxFloor) throughFloor += 1;
      const clr = {};
      for (const n of ['forearmL', 'forearmR', 'handL', 'handR']) {
        clr[n] = clearance(rig, meas.trunk, st, st.list[rig.boneIndex[n]].pos);
        worstClear = Math.min(worstClear, clr[n]);
        if (clr[n] < minClear) buried += 1;
      }
      const chin = v.head[1] - 0.10;
      // Fraction of THIS arm's span, not the left arm's: the two are close on a
      // symmetric sculpt but nothing guarantees it, and a rear-arm number quoted
      // against the lead arm's span is not a measurement.
      const reach = (side) => {
        const U = 'upperArm' + side, F = 'forearm' + side, W = 'hand' + side;
        const d = (a, b) => Math.hypot(...[0, 1, 2].map((k) => v[a][k] - v[b][k]));
        return d(W, U) / (d(F, U) + d(W, F));
      };
      rows.push({
        clip: clip.name, t,
        fistL: { vsChin: v.handEndL[1] - chin, fwd: v.handEndL[2], pos: v.handEndL },
        fistR: { vsChin: v.handEndR[1] - chin, fwd: v.handEndR[2], pos: v.handEndR },
        clearance: clr,
        lowest,
        extendL: reach('L'),
        extendR: reach('R'),
      });
    }
  }

  return {
    rows,
    gates: [
      gate('trunkClearance', worstClear, minClear, '>=',
        'An elbow or wrist is inside the trunk. Push the rear elbow pole outboard (more negative x on R) and take the clearance — 7 cm of elbow height bought the whole margin on Trump.',
        { buried }),
      gate('floor', lowestY, maxFloor, '>=',
        'A joint went through the floor. Sink the hips less, or check the figure was normalised feet-down.'),
    ],
    worstClear, lowestY, buried, throughFloor,
  };
}

export function bakeGates(report, thresholds) {
  const medians = (report.parts || []).map((p) => p.medianMm);
  const worst = medians.length ? Math.max(...medians) : Infinity;
  const interiors = (report.parts || []).map((p) => p.interiorPct);
  return [
    gate('bakeMedianMm', worst, thresholds.maxBakeMedianMm ?? 0.5, '<=',
      'Paint match is coarser than 0.5 mm. Confirm the two exports are the same sculpt (bounds gate) and that V was not flipped.'),
    {
      name: 'bakeInteriorPct',
      value: interiors.length ? Math.max(...interiors) : 0,
      threshold: 6,
      cmp: '<=',
      status: 'info',
      fix: null,
      note: 'Interior verts from part caps are expected at 1–2%. Not a fail.',
    },
  ];
}

export function measureGates(meas, thresholds) {
  const skew = meas.wristSkew ?? 0;
  const howL = meas.measured?.armL?.wristHow || '';
  const howR = meas.measured?.armR?.wristHow || '';
  const guessed = /guess/i.test(howL) || /guess/i.test(howR);
  const g = gate('wristAgreement', skew, thresholds.maxWristDisagreement ?? 0.03, '<=',
    'Left and right wrists disagree by more than 3% of arm length. The girth scan latched onto noise. Check the 3-tap smooth; a 9 cm disagreement on a symmetric sculpt is the unsmoothed-bin bug.');
  g.wristHowL = howL;
  g.wristHowR = howR;
  g.guessed = guessed;
  if (guessed) {
    g.status = 'flag';
    g.fix = 'NO palm flare found — wrist fell back to 72% of arm length (a guess, not a measurement). Aim targets are downstream of this landmark.';
  }
  return [g];
}

export function evaluatePoseFile(jointPath, thresholds) {
  const meas = JSON.parse(readFileSync(jointPath, 'utf8'));
  return evaluatePose(meas, loadPose(jointPath), thresholds);
}
