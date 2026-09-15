// Measure a skeleton's joint positions from a 6-part fighter GLB.
//
// Hitem3D gives us named parts (Head/Torso/LeftArm/RightArm/LeftLeg/RightLeg)
// but no rig. The part cut planes are real measurements -- they are where the
// generator itself decided one limb stops -- so neck, shoulder and hip sockets
// come out of the bounds directly. Elbow, wrist, knee and ankle live inside a
// part and have to be found from its cross-section profile.
//
//   node tools/measure_joints.mjs build/fighter_150k.glb build/fighter_joints.json
//   node tools/measure_joints.mjs in.glb out.json --wrist-frac L=0.85
//
// `--wrist-frac` overrides the girth scan for one or both arms, as a share of
// arm length measured from the shoulder cut. Use it when the scan reports it
// guessed: a sculpt with *already-closed fists* has no knuckle bulge for the
// scan to find, so it falls back to 0.72 and the wrist lands inside the
// forearm. The other arm's measured value is the number to copy.
import { writeFileSync } from 'node:fs';
import { readParts } from './glbIo.mjs';

const argv = process.argv.slice(2);
const [inPath, outPath] = argv.filter((a) => !a.startsWith('--') && !/^[LR]=/.test(a));
if (!inPath || !outPath) {
  console.error('usage: measure_joints.mjs <in.glb> <out.json> [--wrist-frac L=0.85,R=0.85]');
  process.exit(1);
}
const wristFrac = {};
{
  const i = argv.indexOf('--wrist-frac');
  for (const pair of (i >= 0 ? String(argv[i + 1] || '') : '').split(',').filter(Boolean)) {
    const [side, value] = pair.split('=');
    const frac = Number(value);
    if (!['L', 'R'].includes(side) || !(frac > 0.4 && frac < 0.98)) {
      throw new Error(`--wrist-frac wants L=<0.4..0.98> and/or R=<...>, got "${pair}"`);
    }
    wristFrac[side] = frac;
  }
}

const parts = Object.fromEntries(readParts(inPath).map((p) => [p.name, p]));
for (const n of ['Head', 'Torso', 'LeftArm', 'RightArm', 'LeftLeg', 'RightLeg'])
  if (!parts[n]) throw new Error(`missing part "${n}" in ${inPath}`);

const bounds = (p) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.V.length; i += 3)
    for (let k = 0; k < 3; k++) { const v = p.V[i + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
  return { mn, mx };
};
const median = (a) => { const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };

// Slice a part along `ax`, reporting per-slice extents on the other two axes.
// Vertex density is meaningless after decimation (the hand carries far more
// vertices than the upper arm), so every statistic here is an extent or a
// median, never a count.
function profile(p, ax, nbins) {
  const n = p.V.length / 3, { mn, mx } = bounds(p);
  const lo = mn[ax], hi = mx[ax], o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
  const bins = Array.from({ length: nbins }, () => ({ a: [], b: [] }));
  for (let i = 0; i < n; i++) {
    let k = Math.floor((p.V[i * 3 + ax] - lo) / (hi - lo) * nbins);
    k = Math.max(0, Math.min(nbins - 1, k));
    bins[k].a.push(p.V[i * 3 + o1]); bins[k].b.push(p.V[i * 3 + o2]);
  }
  return bins.map((B, k) => {
    const pos = lo + (k + 0.5) * (hi - lo) / nbins;
    if (!B.a.length) return { pos, empty: true };
    const ext = (v) => Math.max(...v) - Math.min(...v);
    return {
      pos, ext1: ext(B.a), ext2: ext(B.b), cen1: median(B.a), cen2: median(B.b),
      girth: 0.5 * (ext(B.a) + ext(B.b)),
    };
  }).filter((s) => !s.empty);
}

const J = {};                       // joint name -> [x, y, z] in model space
const notes = {};                   // joint name -> how it was obtained

// Whole-figure bounds first, because every offset below is a FRACTION OF
// FIGURE HEIGHT rather than a length in model units. Hitem3D does not
// guarantee a scale, and the next fighter will not be 0.801 tall: "raise the
// neck joint 12 mm" is a Trump fact, "raise it 1.5% of height" is a rig fact.
const all = { mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity] };
for (const p of Object.values(parts)) {
  const b = bounds(p);
  for (let k = 0; k < 3; k++) { all.mn[k] = Math.min(all.mn[k], b.mn[k]); all.mx[k] = Math.max(all.mx[k], b.mx[k]); }
}
const H = all.mx[1] - all.mn[1];
const mm = (frac) => H * frac;      // named so the call sites read as proportions

// ---- torso / head -------------------------------------------------------
const bH = bounds(parts.Head);
const bLL = bounds(parts.LeftLeg), bRL = bounds(parts.RightLeg);

// The head part's cut plane is the neck base: the generator's own decision
// about where the head stops. The slice median gives the neck axis in z.
const headProf = profile(parts.Head, 1, 24);
const neckSlice = headProf[0];
const neckY = bH.mn[1];
J.neck = [0, neckY + mm(0.015), neckSlice.cen1];   // cen1 is z when slicing on y
notes.neck = `head part cut plane y=${neckY.toFixed(4)}, raised 1.5% of height; z from that slice's median`;

// Head pivot sits at the top of the neck, not at the skull centroid: rotating
// about the centroid of a 4.2-head caricature swings the jaw through the chest.
J.head = [0, neckY + mm(0.069), neckSlice.cen1];
notes.head = 'neck base + 6.9% of height; pivot at the atlas, not the skull centroid';

// Leg tops are the hip sockets; the torso continues below them (crotch).
const hipY = 0.5 * (bLL.mx[1] + bRL.mx[1]);
const legMedX = (p) => { const a = []; for (let i = 0; i < p.V.length; i += 3) a.push(p.V[i]); return median(a); };
J.hips = [0, hipY - mm(0.019), 0];
notes.hips = `leg part tops y=${hipY.toFixed(4)}, dropped 1.9% of height to the pelvis centre`;

J.upLegL = [legMedX(parts.LeftLeg) * 0.62, hipY - mm(0.015), 0];
J.upLegR = [legMedX(parts.RightLeg) * 0.62, hipY - mm(0.015), 0];
notes.upLegL = notes.upLegR = 'hip socket at 62% of the leg part median x (sockets sit inboard of the thigh axis)';

// ---- spine chain --------------------------------------------------------
J.spine = [0, J.hips[1] + 0.36 * (neckY - J.hips[1]), mm(0.005)];
J.chest = [0, J.hips[1] + 0.74 * (neckY - J.hips[1]), mm(0.005)];
notes.spine = notes.chest = 'split of pelvis to neck base; chest set high so the belly bends and the ribs do not';

// ---- arms ---------------------------------------------------------------
// Each arm is one part running along +/- x. Walk it from the shoulder cut out
// to the fingertips and read girth: the wrist is the profile minimum just
// before the hand's knuckle bulge.
function arm(name, sign) {
  const p = parts[name], b = bounds(p);
  const inner = sign > 0 ? b.mn[0] : b.mx[0];      // the cut plane against the torso
  const outer = sign > 0 ? b.mx[0] : b.mn[0];      // fingertips
  const len = Math.abs(outer - inner);
  const prof = profile(p, 0, 30).sort((u, v) => (u.pos - v.pos) * sign);
  // Axis: median y/z over the middle of the arm, clear of both caps.
  const mid = prof.filter((s) => { const t = Math.abs(s.pos - inner) / len; return t > 0.25 && t < 0.65; });
  const axisY = median(mid.map((s) => s.cen1));    // slicing on x -> cen1 is y
  const axisZ = median(mid.map((s) => s.cen2));    // cen2 is z
  // Wrist: the FIRST local girth minimum walking outward, not the smallest one.
  //
  // The obvious version -- smallest girth in the outer half -- is wrong, and was
  // wrong here for a whole session: this hand tapers all the way to the
  // fingertips instead of bulging at the knuckles, so the global minimum is the
  // END of the fingers and the landmark lands at the finger base. What actually
  // marks a wrist is girth stopping its decline: it thins into the wrist, then
  // holds or widens across the palm. So walk out from mid-forearm and take the
  // first slice whose successor is at least 1% fatter.
  // Smooth first. 30 bins of a decimated surface are noisy enough that a single
  // bin can dip 3% and read as a wrist: unsmoothed, the two arms of this
  // near-symmetric sculpt disagreed by 9 cm, the right one latching onto a dip
  // at 65% of arm length. A 3-tap mean plus a 2% rise threshold puts both at 78%.
  const raw = prof.filter((s) => { const t = Math.abs(s.pos - inner) / len; return t > 0.45 && t < 0.95; });
  const scan = raw.map((s, i) => ({
    ...s,
    girth: (raw[Math.max(0, i - 1)].girth + s.girth + raw[Math.min(raw.length - 1, i + 1)].girth) / 3,
  }));
  let wristSlice = null;
  for (let i = 1; i < scan.length - 1; i++) {
    if (scan[i].girth <= scan[i - 1].girth && scan[i + 1].girth > scan[i].girth * 1.02) { wristSlice = scan[i]; break; }
  }
  let wristHow = 'first girth minimum followed by a widening palm';
  const S0 = name === 'LeftArm' ? 'L' : 'R';
  if (wristFrac[S0] !== undefined) {
    // An authored landmark beats a scan, and beats a fallback by a mile. Placed
    // exactly, not snapped to the nearest bin, so the two arms of a symmetric
    // sculpt can be given the same number and actually land in the same place.
    const at = inner + sign * len * wristFrac[S0];
    wristSlice = { pos: at, girth: NaN };
    wristHow = `authored --wrist-frac ${S0}=${wristFrac[S0]} (${(wristFrac[S0] * 100).toFixed(0)}% of arm length)`;
    console.warn(`  * ${name}: ${wristHow}`);
  } else if (!wristSlice) {
    // A hand with no palm flare at all. Fall back to a proportion and say so --
    // this is a guess, and anything keying off the palm/knuckle boundary (fists)
    // needs to know it is one.
    wristSlice = scan.reduce((a, s) => (Math.abs(Math.abs(s.pos - inner) / len - 0.72) <
                                        Math.abs(Math.abs(a.pos - inner) / len - 0.72) ? s : a));
    wristHow = 'NO palm flare found: fell back to 72% of arm length (a guess, not a measurement)';
    console.warn(`  ! ${name}: ${wristHow}`);
  }
  const wristX = wristSlice.pos;
  const shoulderX = inner + sign * len * 0.145;    // pivot inside the deltoid cap, as a share of arm length
  const elbowX = shoulderX + 0.5 * (wristX - shoulderX);
  const S = name === 'LeftArm' ? 'L' : 'R';
  J['shoulder' + S] = [inner * 0.42, axisY + mm(0.035), axisZ * 0.6];
  J['upperArm' + S] = [shoulderX, axisY, axisZ];
  J['forearm' + S] = [elbowX, axisY, axisZ];
  J['hand' + S] = [wristX, axisY, axisZ];
  J['handEnd' + S] = [outer, axisY, axisZ];
  notes['shoulder' + S] = 'clavicle root: 42% out to the arm cut, 3.5% of height above the arm axis';
  notes['upperArm' + S] = `part cut x=${inner.toFixed(4)}, moved 14.5% of arm length into the deltoid`;
  notes['forearm' + S] = 'midpoint shoulder to wrist (upper arm and forearm are near equal here)';
  notes['hand' + S] = `${wristHow}: x=${wristX.toFixed(4)}` +
    (Number.isFinite(wristSlice.girth) ? `, girth ${wristSlice.girth.toFixed(4)}` : '');
  return { inner, outer, len, axisY, axisZ, shoulderX, elbowX, wristX,
           girthAtWrist: wristSlice.girth, wristHow,
           palmLength: Math.abs(outer - wristX), palmFrac: +(Math.abs(outer - wristX) / len).toFixed(3) };
}
const armL = arm('LeftArm', +1), armR = arm('RightArm', -1);

// The two arms are independently tessellated but the sculpt is near-symmetric,
// so the two wrist landmarks are a free cross-check on the heuristic. They are
// the only landmark found by searching rather than read off a bound, and a
// disagreement means the search latched onto noise on one side.
const wristSkew = Math.abs(Math.abs(armL.wristX - armL.inner) - Math.abs(armR.wristX - armR.inner)) / armL.len;
if (wristSkew > 0.03)
  console.warn(`  ! wrist landmarks disagree across the body by ${(wristSkew * 100).toFixed(1)}% of arm length ` +
               `(L ${armL.wristX.toFixed(4)}, R ${armR.wristX.toFixed(4)}) -- suspect the girth scan`);

// ---- legs ---------------------------------------------------------------
// The ankle is where the foot's z extent takes off. The knee is not a
// narrowing on a caricature this soft, so it is placed proportionally and
// checked in the viewer.
function leg(name) {
  const p = parts[name], b = bounds(p);
  const prof = profile(p, 1, 30).sort((u, v) => u.pos - v.pos);   // bottom -> top
  const footZ = Math.max(...prof.slice(0, 4).map((s) => s.ext1)); // ext1 is z here
  let ankleY = b.mn[1] + mm(0.075);
  for (const s of prof) if (s.ext1 < 0.62 * footZ) { ankleY = s.pos; break; }
  const shaft = prof.filter((s) => s.pos > b.mn[1] + mm(0.15) && s.pos < b.mx[1] - mm(0.075));
  const axisX = median(shaft.map((s) => s.cen2));                 // cen2 is x here
  const S = name === 'LeftLeg' ? 'L' : 'R';
  const hip = J['upLeg' + S];
  const kneeY = hip[1] + 0.52 * (ankleY - hip[1]);
  J['leg' + S] = [axisX, kneeY, 0.004];
  J['foot' + S] = [axisX, ankleY, prof.find((s) => s.pos >= ankleY).cen1 * 0.5];
  J['toe' + S] = [axisX, b.mn[1] + mm(0.015), Math.max(...prof.slice(0, 3).map((s) => s.cen1)) + mm(0.069)];
  notes['leg' + S] = 'knee at 52% hip to ankle (proportional: this sculpt has no girth minimum there)';
  notes['foot' + S] = `ankle where the foot's z extent passes 62% of its maximum: y=${ankleY.toFixed(4)}`;
  return { ankleY, kneeY, axisX, footZ };
}
const legL = leg('LeftLeg'), legR = leg('RightLeg');

// Trunk silhouette: half-width (x) and half-depth (z) of the Torso part in
// horizontal bands. This is what a pose is checked against -- an elbow tucked
// "in" on a normal figure is an elbow buried in the belly on this one, and the
// only way to know which is to have the belly's actual radius to hand.
const trunkProf = profile(parts.Torso, 1, 22).map((s) => ({
  y: +s.pos.toFixed(4),
  halfX: +(s.ext2 / 2).toFixed(4),      // slicing on y: ext2 is x, ext1 is z
  halfZ: +(s.ext1 / 2).toFixed(4),
}));

const out = {
  kind: 'fighter-joint-measurement',
  source: inPath,
  space: 'model space of the source GLB: +Y up, +Z front, +X toward the figure LeftArm part',
  bounds: { min: all.mn.map((v) => +v.toFixed(5)), max: all.mx.map((v) => +v.toFixed(5)) },
  height: +H.toFixed(5),
  wristSkew: +wristSkew.toFixed(4),
  measured: { armL, armR, legL, legR, hipY, neckY },
  trunk: trunkProf,
  joints: J,
  notes,
};
writeFileSync(outPath, JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(J))
  console.log(k.padEnd(11), '[' + v.map((x) => x.toFixed(4).padStart(8)).join(', ') + ']  ' + (notes[k] || ''));
console.log('\n->', outPath);
