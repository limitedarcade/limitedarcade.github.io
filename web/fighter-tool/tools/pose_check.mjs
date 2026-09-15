// Evaluate the authored clips on the measured skeleton and report where the
// joints actually end up -- without a browser.
//
// Authoring a stance is guesswork until you can see the result, and a
// screenshot round-trip per tweak is slow. This runs the same solve the
// exporter runs and prints the numbers that decide whether a guard is a guard:
// fist height against the chin, fist reach in front of the chest, whether the
// elbows are inside the silhouette, and whether anything went through the floor.
//
//   node tools/pose_check.mjs build/fighter_joints.json [clip]
import { readFileSync } from 'node:fs';
import { createRig, CLIPS, qConj, qRot } from './fighterRig.mjs';
import { loadPose } from './poseSidecar.mjs';

const [, , jointPath, only] = process.argv;
if (!jointPath) { console.error('usage: pose_check.mjs <joints.json> [clip]'); process.exit(1); }

const meas = JSON.parse(readFileSync(jointPath, 'utf8'));
const rig = createRig(meas.joints, meas.bounds, loadPose(jointPath));

// Report in viewer metres -- the same frame the wrist targets are authored in.
const toView = rig.toView;

// ---- trunk clearance ----------------------------------------------------
// "Tuck the elbow in" is advice for a normal figure. On a pear-shaped
// caricature 0.54 m wide at the belly, the tucked-in elbow is *inside* the
// belly, and nothing in a joint list says so. This tests each limb joint
// against the measured trunk silhouette and reports the clearance in metres.
//
// The point is inverse-skinned by whichever trunk bone covers its height, so
// the test works on a bladed stance and not only on the bind pose.
const TRUNK = ['hips', 'spine', 'chest'];
const trunk = meas.trunk;

function trunkRadius(y) {
  if (y <= trunk[0].y) return trunk[0];
  if (y >= trunk[trunk.length - 1].y) return trunk[trunk.length - 1];
  for (let i = 1; i < trunk.length; i++) {
    if (y > trunk[i].y) continue;
    const a = trunk[i - 1], b = trunk[i], t = (y - a.y) / (b.y - a.y);
    return { halfX: a.halfX + t * (b.halfX - a.halfX), halfZ: a.halfZ + t * (b.halfZ - a.halfZ) };
  }
  return trunk[trunk.length - 1];
}

// Signed distance from the trunk shell, in viewer metres. Negative = inside.
function clearance(st, pWorld) {
  let best = Infinity;
  for (const name of TRUNK) {
    const i = rig.boneIndex[name];
    const b = rig.bones[i], n = st.list[i];
    const d = [pWorld[0] - n.pos[0], pWorld[1] - n.pos[1], pWorld[2] - n.pos[2]];
    const local = qRot(qConj(n.q), d);
    const rest = [local[0] + b.world[0], local[1] + b.world[1], local[2] + b.world[2]];
    const R = trunkRadius(rest[1]);
    const r = Math.hypot(rest[0], rest[2]);
    if (r < 1e-6) return -R.halfX * rig.scale;
    const c = rest[0] / r, sn = rest[2] / r;
    const shell = 1 / Math.hypot(c / R.halfX, sn / R.halfZ);
    const gap = (r - shell) * rig.scale;
    if (Math.abs(gap) < Math.abs(best)) best = gap;
  }
  return best;
}

let bad = 0, buried = 0;
for (const clip of CLIPS) {
  if (only && clip.name !== only) continue;
  console.log(`\n=== ${clip.name} ===`);
  for (const [t, delta] of clip.keys) {
    const pose = rig.resolve(delta, { bind: clip.bind });
    const st = rig.fk(pose);
    const v = Object.fromEntries(rig.bones.map((b, i) => [b.name, toView(st.list[i].pos)]));
    const chin = v.head[1] - 0.10;                  // the jaw sits ~10 cm under the head pivot
    const lowest = Math.min(...Object.values(v).map((p) => p[1]));
    const f = (n) => `${n} [${v[n].map((x) => x.toFixed(2).padStart(6)).join(',')}]`;
    console.log(` t=${t.toFixed(2)}  ${f('handEndL')} ${f('handEndR')} ${f('head')}`);
    const reach = (side) => {
      const d = (a, b) => Math.hypot(...[0, 1, 2].map((k) => v[a][k] - v[b][k]));
      const U = 'upperArm' + side, F = 'forearm' + side, W = 'hand' + side;
      return (d(W, U) / (d(F, U) + d(W, F)) * 100).toFixed(0) + '%';
    };
    console.log(`         fistL ${(v.handEndL[1] - chin).toFixed(2)} vs chin, ${v.handEndL[2].toFixed(2)} m fwd,` +
                ` ${reach('L')} extended` +
                ` | fistR ${(v.handEndR[1] - chin).toFixed(2)}, ${v.handEndR[2].toFixed(2)} m,` +
                ` ${reach('R')}` +
                ` | elbowR [${v.forearmR.map((n) => n.toFixed(2)).join(',')}]` +
                ` | shoulders z ${v.upperArmL[2].toFixed(2)}/${v.upperArmR[2].toFixed(2)}` +
                ` | lowest ${lowest.toFixed(3)}`);
    const clr = {};
    for (const n of ['forearmL', 'forearmR', 'handL', 'handR'])
      clr[n] = clearance(st, st.list[rig.boneIndex[n]].pos);
    console.log('         trunk clearance  ' +
      Object.entries(clr).map(([k, c]) => `${k} ${c >= 0 ? '+' : ''}${c.toFixed(2)}`).join('  '));
    for (const [k, c] of Object.entries(clr))
      if (c < -0.03) { console.log(`         !! ${k} is ${(-c).toFixed(2)} m inside the trunk`); buried++; }
    if (lowest < -0.015) { console.log('         !! through the floor'); bad++; }
  }
}
if (bad) console.log(`\n${bad} key(s) put a joint through the floor`);
if (buried) console.log(`${buried} joint(s) buried in the trunk, elbow first`);
if (bad || buried) process.exit(1);
