// Search the wrist-target space for one arm and report what each candidate
// actually produces: where the fist lands, how much trunk clearance the wrist,
// fist and elbow get, and how extended the arm ends up.
//
// Authoring a guard is a constrained problem, not a taste problem. On this
// fighter the rear hand has to be beside the jaw AND outside a belly 0.54 m
// wide AND on an arm short enough that reaching the face nearly locks it
// straight -- and those three fight each other. Guessing one target at a time
// and rendering costs a browser round-trip per guess and still does not tell
// you whether a near miss was close. This prints the whole neighbourhood.
//
//   node tools/aim_sweep.mjs build/fighter_joints.json R
//   node tools/aim_sweep.mjs build/fighter_joints.json L --clip jab --key 2
//   node tools/aim_sweep.mjs build/fighter_joints.json R --x -0.36,-0.32,-0.28 --y 1.34,1.38 --z 0.22,0.26
//
// Targets and thresholds are in VIEWER METRES, like every other authored pose
// number. The one bug worth remembering: `rig.fk` returns MODEL units, so a
// position has to go through `rig.toView` before it is compared with anything
// here. Printing model units against metre thresholds silently reports every
// fist as being down by the ankles.
import { readFileSync } from 'node:fs';
import { createRig, CLIPS, qConj, qRot } from './fighterRig.mjs';
import { loadPose } from './poseSidecar.mjs';

const [, , jointPath, sideArg, ...rest] = process.argv;
if (!jointPath || !['L', 'R'].includes(sideArg)) {
  console.error('usage: aim_sweep.mjs <joints.json> <L|R> [--clip name] [--key i] [--x a,b] [--y a,b] [--z a,b]');
  process.exit(1);
}
const argOf = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const nums = (s) => s.split(',').map(Number);

const meas = JSON.parse(readFileSync(jointPath, 'utf8'));
const rig = createRig(meas.joints, meas.bounds, loadPose(jointPath));
const S = sideArg;

const clipName = argOf('--clip', 'guard');
const keyIdx = parseInt(argOf('--key', '0'), 10);
const clip = CLIPS.find((c) => c.name === clipName);
if (!clip) throw new Error(`no clip "${clipName}"`);
const baseKey = clip.keys[keyIdx]?.[1];
if (!baseKey) throw new Error(`clip "${clipName}" has no key ${keyIdx}`);

// Default neighbourhood: around whatever this key already aims at.
const seed = { ...(CLIPS[1].keys[0][1] || {}), ...baseKey }.aim?.[S]
          || rig.resolveAim?.(S)
          || [S === 'L' ? 0.32 : -0.32, 1.38, 0.30];
const span = (c, d) => [c - d, c - d / 2, c, c + d / 2, c + d];
const XS = argOf('--x') ? nums(argOf('--x')) : span(seed[0], 0.08);
const YS = argOf('--y') ? nums(argOf('--y')) : span(seed[1], 0.08);
const ZS = argOf('--z') ? nums(argOf('--z')) : span(seed[2], 0.08);

// ---- trunk clearance, same maths as pose_check --------------------------
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
function clearance(st, pModel) {
  let best = Infinity;
  for (const name of TRUNK) {
    const i = rig.boneIndex[name], b = rig.bones[i], n = st.list[i];
    const local = qRot(qConj(n.q), [pModel[0] - n.pos[0], pModel[1] - n.pos[1], pModel[2] - n.pos[2]]);
    const r0 = [local[0] + b.world[0], local[1] + b.world[1], local[2] + b.world[2]];
    const R = trunkRadius(r0[1]);
    const r = Math.hypot(r0[0], r0[2]);
    if (r < 1e-6) return -R.halfX * rig.scale;
    const shell = 1 / Math.hypot((r0[0] / r) / R.halfX, (r0[2] / r) / R.halfZ);
    const gap = (r - shell) * rig.scale;
    if (Math.abs(gap) < Math.abs(best)) best = gap;
  }
  return best;
}

const MIN_CLEAR = parseFloat(argOf('--min-clear', '0.03'));   // metres out of the trunk
const MAX_EXT = parseFloat(argOf('--max-ext', '88'));         // percent; 100 is a locked elbow

console.log(`sweep ${S} arm on clip "${clipName}" key ${keyIdx}  ` +
            `(${XS.length}x${YS.length}x${ZS.length} = ${XS.length * YS.length * ZS.length} candidates)`);
console.log(`pass = clearance > ${MIN_CLEAR} m everywhere and extension < ${MAX_EXT}%\n`);
console.log('  wrist target      ->  fist x,y,z            clear wrist/fist/elbow    ext%');

const hits = [];
for (const y of YS) for (const z of ZS) for (const x of XS) {
  const pose = rig.resolve({ ...baseKey, aim: { ...(baseKey.aim || {}), [S]: [x, y, z] } });
  const st = rig.fk(pose);
  const M = (n) => st.list[rig.boneIndex[n]].pos;                 // model units
  const V = (n) => rig.toView(M(n));                              // viewer metres
  const sh = V('upperArm' + S), el = V('forearm' + S), w = V('hand' + S), fist = V('handEnd' + S);
  const seg = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ext = seg(sh, w) / (seg(sh, el) + seg(el, w)) * 100;
  const cw = clearance(st, M('hand' + S)), cf = clearance(st, M('handEnd' + S)),
        ce = clearance(st, M('forearm' + S));
  const ok = cw > MIN_CLEAR && cf > MIN_CLEAR && ce > MIN_CLEAR && ext < MAX_EXT;
  const row = `${[x, y, z].map((v) => v.toFixed(2).padStart(6)).join('')}  ->  ` +
    `${fist.map((v) => v.toFixed(2).padStart(6)).join('')}      ` +
    `${[cw, cf, ce].map((v) => v.toFixed(2).padStart(7)).join('')}    ${ext.toFixed(0).padStart(4)}` +
    (ok ? '   PASS' : '');
  console.log(row);
  if (ok) hits.push({ target: [x, y, z], fist, clear: [cw, cf, ce], ext });
}

console.log(`\n${hits.length} of ${XS.length * YS.length * ZS.length} pass.`);
if (hits.length) {
  // Prefer the roomiest pose that is not straining: worst-case clearance first,
  // extension as the tie-break. A locked elbow reads as a reach, not a guard.
  hits.sort((a, b) => (Math.min(...b.clear) - Math.min(...a.clear)) || (a.ext - b.ext));
  const best = hits[0];
  console.log(`roomiest: aim ${S}: [${best.target.map((v) => v.toFixed(2)).join(', ')}]  ` +
              `-> fist [${best.fist.map((v) => v.toFixed(2)).join(', ')}], ` +
              `worst clearance ${Math.min(...best.clear).toFixed(2)} m, ${best.ext.toFixed(0)}% extended`);
} else {
  console.log('Nothing passes. Widen the range, or the stance itself is the problem: a deeper');
  console.log('blade puts the rear shoulder further back, which costs reach the arm does not have.');
}
