// Skin a decimated multipart fighter to the canonical skeleton and write a
// rigged, animated GLB.
//
//   node tools/rig.mjs build/fighter_150k.glb build/fighter_joints.json \
//        build/fighter_rigged.glb
//
// Weights are a closed-form field, not a solve: a Gaussian on the distance to
// each bone *segment*, gated by which bones a part is allowed to use. That is
// only defensible because the source is segmented -- see PART_BONES in
// fighterRig.mjs for why the gate is what stops the armpit collapsing.
import { readFileSync, writeFileSync } from 'node:fs';
import { readParts } from './glbIo.mjs';
import { writeRigged } from './glbRigIo.mjs';
import { createRig, SIGMA, PART_BONES, ARM_FADE, LEG_SIDE_FADE, MAX_INFLUENCES, CLIPS, buildTracks }
  from './fighterRig.mjs';
import { loadPose } from './poseSidecar.mjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const [, , meshPath, jointPath, outPath] = process.argv;
if (!meshPath || !jointPath || !outPath) {
  console.error('usage: rig.mjs <parts.glb> <joints.json> <out.glb>');
  process.exit(1);
}

const parts = readParts(meshPath);
const meas = JSON.parse(readFileSync(jointPath, 'utf8'));
const poseOpts = loadPose(jointPath);
const rig = createRig(meas.joints, meas.bounds, poseOpts);
const { bones, boneIndex } = rig;

// SIGMA, ARM_FADE and LEG_SIDE_FADE are fractions of figure height, so a
// fighter exported at any scale gets the same falloff in body terms.
const H = meas.height ?? (meas.bounds.max[1] - meas.bounds.min[1]);
const sigmaSrc = poseOpts.sigma || SIGMA;
const sigma = Object.fromEntries(Object.entries(sigmaSrc).map(([k, v]) => [k, v * H]));
const armFade = ARM_FADE * H;
const legFade = LEG_SIDE_FADE.map((v) => v * H);

// Each deforming bone is a segment from its own joint to the first child's, so
// distance-to-bone means distance to the limb axis rather than to a point.
const childOf = {};
for (const b of bones) if (b.parent >= 0 && !childOf[bones[b.parent].name]) childOf[bones[b.parent].name] = b.name;
const SEG = {};
for (const b of bones) {
  if (!(b.name in SIGMA)) continue;
  const c = childOf[b.name];
  if (!c) throw new Error(`deforming bone "${b.name}" has no child to point at`);
  SEG[b.name] = { a: b.world, b: bones[boneIndex[c]].world, s: sigma[b.name] };
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
function distToSeg(px, py, pz, a, b) {
  const ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
  const wx = px - a[0], wy = py - a[1], wz = pz - a[2];
  const dd = ax * ax + ay * ay + az * az;
  let t = dd > 0 ? (wx * ax + wy * ay + wz * az) / dd : 0;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(wx - ax * t, wy - ay * t, wz - az * t);
}

// The shoulder cut plane of each arm part: the arm chain fades in from zero
// here so an arm vertex at the seam carries exactly the {chest, shoulder}
// blend the torso vertex beside it carries.
const armCut = {};
for (const p of parts) {
  if (p.name !== 'LeftArm' && p.name !== 'RightArm') continue;
  let cut = p.name === 'LeftArm' ? Infinity : -Infinity;
  for (let i = 0; i < p.V.length; i += 3)
    cut = p.name === 'LeftArm' ? Math.min(cut, p.V[i]) : Math.max(cut, p.V[i]);
  armCut[p.name] = cut;
}

const report = { kind: 'fighter-rig-report', mesh: meshPath, joints: jointPath, output: outPath,
                 bones: bones.length, deforming: Object.keys(SIGMA).length, maxInfluences: MAX_INFLUENCES,
                 figureHeight: +H.toFixed(5),
                 sigmaModelUnits: Object.fromEntries(Object.entries(sigma).map(([k, v]) => [k, +v.toFixed(5)])),
                 parts: [], clips: [] };

for (const p of parts) {
  const allowed = PART_BONES[p.name];
  if (!allowed) throw new Error(`no PART_BONES entry for part "${p.name}"`);
  const n = p.V.length / 3;
  p.J = new Uint8Array(n * 4);
  p.W = new Float32Array(n * 4);

  const side = p.name.startsWith('Left') ? +1 : -1;
  const isArm = p.name.endsWith('Arm');
  const isLeg = p.name.endsWith('Leg');
  let minTop = 1;                       // smallest dominant weight, a tell for a bad field
  const histo = new Array(MAX_INFLUENCES + 1).fill(0);

  for (let i = 0; i < n; i++) {
    const x = p.V[i * 3], y = p.V[i * 3 + 1], z = p.V[i * 3 + 2];
    const cand = [];
    for (const name of allowed) {
      const s = SEG[name];
      let g = 1;
      // Arm chain: fade in outboard of the shoulder cut.
      if (isArm && /^(upperArm|forearm|hand)/.test(name))
        g = smoothstep(0, armFade, side * (x - armCut[p.name]));
      // Leg chain: fade out across the crotch so a thigh cannot grab its twin.
      if (/^(upLeg|leg|foot)/.test(name)) {
        const legSide = name.endsWith('L') ? +1 : -1;
        g *= smoothstep(legFade[0], legFade[1], legSide * x);
      }
      if (g <= 0) continue;
      const d = distToSeg(x, y, z, s.a, s.b);
      const w = g * Math.exp(-(d / s.s) * (d / s.s));
      if (w > 1e-4) cand.push([boneIndex[name], w]);
    }
    if (!cand.length) {
      // Nothing in range (deep interior vertices from the part caps land here).
      // Fall back to the nearest allowed bone: it is never visible, but it must
      // still travel with the body.
      let best = allowed[0], bd = Infinity;
      for (const name of allowed) {
        const d = distToSeg(x, y, z, SEG[name].a, SEG[name].b);
        if (d < bd) { bd = d; best = name; }
      }
      cand.push([boneIndex[best], 1]);
    }
    cand.sort((a, b) => b[1] - a[1]);
    const keep = cand.slice(0, MAX_INFLUENCES);
    const sum = keep.reduce((a, c) => a + c[1], 0);
    histo[keep.length]++;
    if (keep[0][1] / sum < minTop) minTop = keep[0][1] / sum;
    for (let k = 0; k < keep.length; k++) {
      p.J[i * 4 + k] = keep[k][0];
      p.W[i * 4 + k] = keep[k][1] / sum;
    }
  }
  report.parts.push({ part: p.name, verts: n, allowed, influenceHistogram: histo,
                      minDominantWeight: +minTop.toFixed(4) });
  console.log(`  ${p.name.padEnd(9)} ${String(n).padStart(6)} verts  influences ${histo.slice(1).join('/')}` +
              `  min dominant ${minTop.toFixed(3)}`);
}

// ---- clips --------------------------------------------------------------
const animations = [];
// Optional complete clip library for fighters with a bespoke performance.
const clipLibrary = process.argv[5]
  ? (await import(pathToFileURL(resolve(process.argv[5])).href)).CLIPS : CLIPS;
for (const clip of clipLibrary) {
  const tracks = buildTracks(clip, rig);
  for (const t of tracks) {
    if (t.path !== 'translation' || !t.additive) continue;
    const rest = bones[t.bone].local;               // glTF translation is absolute
    for (let i = 0; i < t.values.length; i += 3) {
      t.values[i] += rest[0]; t.values[i + 1] += rest[1]; t.values[i + 2] += rest[2];
    }
  }
  animations.push({ name: clip.name, tracks });
  const dur = Math.max(...clip.keys.map(([t]) => t));
  report.clips.push({ name: clip.name, seconds: dur, keys: clip.keys.length, tracks: tracks.length,
                      loop: !!clip.loop });
  console.log(`  clip ${clip.name.padEnd(6)} ${dur.toFixed(2)}s  ${clip.keys.length} keys  ${tracks.length} tracks`);
}

const bytes = writeRigged(outPath, {
  parts, bones, skinnedTo: 0, animations,
  generator: 'fightere/tools/rig.mjs (Route C, canonical fighter tree)',
});
report.bytes = bytes;
report.skeleton = bones.map((b) => ({ name: b.name, parent: b.parent < 0 ? null : bones[b.parent].name,
                                      rest: b.world.map((v) => +v.toFixed(5)) }));
writeFileSync(outPath.replace(/\.glb$/, '-rig.json'), JSON.stringify(report, null, 1));
console.log(`\n${bones.length} bones, ${animations.length} clips, ${(bytes / 1e6).toFixed(2)} MB -> ${outPath}`);
