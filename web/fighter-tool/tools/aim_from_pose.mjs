// Given a clip key, print the `da` that would put each fist at a chosen offset
// from where that key actually leaves the shoulder.
//
// Authoring `da` by hand works while the body stays upright, because the
// shoulders barely move. It stops working the moment a clip puts the fighter on
// the floor: a knockdown swings the shoulders 0.6 m backward and 0.6 m down, so
// a wrist target authored against the standing guard is suddenly outside the
// arm's reach and the IK locks it straight. Rather than guess and re-run, this
// solves the body first, reads the shoulder, and reports the number.
//
//   node tools/aim_from_pose.mjs build/trump/trump_joints.json knockdown 3 \
//        --L 0.34,-0.16,-0.26 --R -0.34,-0.16,-0.22
//
// The two offsets are metres FROM THE SHOULDER, in viewer axes. The script
// reports the resulting extension so an offset outside the arm's own reach is
// visible immediately rather than as a warning three commands later.
import { readFileSync } from 'node:fs';
import { createRig, CLIPS } from './fighterRig.mjs';
import { loadPose } from './poseSidecar.mjs';

const [, , jointPath, clipName, keyArg, ...rest] = process.argv;
if (!jointPath || !clipName) {
  console.error('usage: aim_from_pose.mjs <joints.json> <clip> [keyIndex|all] [--L x,y,z] [--R x,y,z]');
  process.exit(1);
}
const argOf = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const vec = (s) => s.split(',').map(Number);

const meas = JSON.parse(readFileSync(jointPath, 'utf8'));
const pose = loadPose(jointPath);
const rig = createRig(meas.joints, meas.bounds, pose);
const clip = CLIPS.find((c) => c.name === clipName);
if (!clip) throw new Error(`no clip "${clipName}"`);

const want = { L: vec(argOf('--L', '0.30,-0.10,-0.20')), R: vec(argOf('--R', '-0.30,-0.10,-0.18')) };
const guardAim = { L: pose.guard.aim.L, R: pose.guard.aim.R };

const indices = keyArg === undefined || keyArg === 'all'
  ? clip.keys.map((_, i) => i)
  : [parseInt(keyArg, 10)];

for (const index of indices) {
  const [t, delta] = clip.keys[index];
  // Strip the authored wrist motion: we want where the BODY puts the shoulder,
  // not where a previous guess put the hand.
  const bare = { ...delta };
  delete bare.da;
  delete bare.aim;
  const resolved = rig.resolve(bare, { bind: clip.bind, quiet: true });
  const st = rig.fk(resolved);
  const at = (name) => rig.toView(st.list[rig.boneIndex[name]].pos);

  const out = {};
  for (const side of ['L', 'R']) {
    const shoulder = at(`upperArm${side}`);
    const elbow = at(`forearm${side}`);
    const wrist = at(`hand${side}`);
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const span = d(elbow, shoulder) + d(wrist, elbow);
    const target = [0, 1, 2].map((k) => shoulder[k] + want[side][k]);
    const reach = Math.hypot(...[0, 1, 2].map((k) => target[k] - shoulder[k]));
    const da = [0, 1, 2].map((k) => +(target[k] - guardAim[side][k]).toFixed(3));
    out[side] = { da, pct: Math.round((reach / span) * 100), span: +span.toFixed(3) };
  }
  console.log(
    `${clipName}[${index}] t=${t.toFixed(2)}  ` +
    `da: { L: [${out.L.da.join(', ')}], R: [${out.R.da.join(', ')}] }   ` +
    `-> L ${out.L.pct}%  R ${out.R.pct}%  (span ${out.L.span}/${out.R.span} m)`,
  );
}
