// Bake open, fanned hands into fists on a decimated multipart fighter.
//
// Playbook route B. Runs between decimate and measure: it moves the wrist
// landmark, and every authored aim target is downstream of that landmark.
//
//   node tools/make_fists.mjs <in.glb> <out.glb>
//
// Palm start is probed with the same 3-tap girth walk as measure_joints.
// A detected palm shorter than 20% of the arm is clamped to 22% — on an open
// fan the first girth flare is often a finger gap, and curling only the tips
// makes the crumpled nubs that read as broken hands.
//
// Curl is a chained two-bone arc (knuckle, then mid-phalanx). A single hinge
// is a bent paddle. Fan is closed in Y and Z; these caricature hands are not
// Trump's flat 5 cm paddle.
import { writeFileSync } from 'node:fs';
import { readParts, writeParts, recomputeNormals } from './glbIo.mjs';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: make_fists.mjs <in.glb> <out.glb>');
  process.exit(1);
}

function bounds(p) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.V.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = p.V[i + k];
      if (v < mn[k]) mn[k] = v;
      if (v > mx[k]) mx[k] = v;
    }
  return { mn, mx };
}
const median = (a) => { const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };

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

function palmProbe(p, sign) {
  const b = bounds(p);
  const inner = sign > 0 ? b.mn[0] : b.mx[0];
  const outer = sign > 0 ? b.mx[0] : b.mn[0];
  const len = Math.abs(outer - inner);
  const prof = profile(p, 0, 30).sort((u, v) => (u.pos - v.pos) * sign);
  const mid = prof.filter((s) => {
    const t = Math.abs(s.pos - inner) / len;
    return t > 0.25 && t < 0.65;
  });
  const axisY = median(mid.map((s) => s.cen1));
  const axisZ = median(mid.map((s) => s.cen2));
  const raw = prof.filter((s) => {
    const t = Math.abs(s.pos - inner) / len;
    return t > 0.45 && t < 0.95;
  });
  const scan = raw.map((s, i) => ({
    ...s,
    girth: (raw[Math.max(0, i - 1)].girth + s.girth + raw[Math.min(raw.length - 1, i + 1)].girth) / 3,
  }));
  let wristSlice = null;
  for (let i = 1; i < scan.length - 1; i++) {
    if (scan[i].girth <= scan[i - 1].girth && scan[i + 1].girth > scan[i].girth * 1.02) {
      wristSlice = scan[i];
      break;
    }
  }
  let wristHow = 'first girth minimum followed by a widening palm';
  if (!wristSlice) {
    wristSlice = scan.reduce((a, s) => (
      Math.abs(Math.abs(s.pos - inner) / len - 0.72) <
      Math.abs(Math.abs(a.pos - inner) / len - 0.72) ? s : a
    ));
    wristHow = 'NO palm flare found: fell back to 72% of arm length (a guess)';
    console.warn(`  ! ${p.name}: ${wristHow}`);
  }
  let wristX = wristSlice.pos;
  let palmLength = Math.abs(outer - wristX);
  let palmFrac = palmLength / len;
  // Open fingers make a girth flare at the crotch. That is distal of the real
  // wrist, so the deform region becomes "fingertips only" and curls into nubs.
  // Trump's measured hand is 21.7% of arm length; keep us in that neighbourhood.
  if (palmFrac < 0.20) {
    palmFrac = 0.22;
    palmLength = palmFrac * len;
    wristX = outer - sign * palmLength;
    wristHow += '; clamped palm to 22% of arm (detected flare was too distal)';
  }
  return {
    inner, outer, len, axisY, axisZ, wristX, palmLength,
    palmFrac: +palmFrac.toFixed(3), wristHow, sign,
  };
}

function rotXY(x, y, px, py, ang) {
  const dx = x - px, dy = y - py;
  const c = Math.cos(ang), s = Math.sin(ang);
  return [px + dx * c - dy * s, py + dx * s + dy * c];
}

function smooth(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function fistArm(p, probe) {
  const { sign, wristX, axisY, axisZ, palmLength } = probe;
  const n = p.V.length / 3;

  let zMaxPalm = -Infinity;
  const verts = [];
  for (let i = 0; i < n; i++) {
    const x = p.V[i * 3], y = p.V[i * 3 + 1], z = p.V[i * 3 + 2];
    const along = (x - wristX) * sign;
    if (along <= 0) continue;
    const u = Math.min(1, along / (palmLength || 1e-6));
    verts.push({ i, u, x, y, z });
    if (u < 0.55 && z > zMaxPalm) zMaxPalm = z;
  }

  // Thumb is the +Z (forward) lobe of the proximal hand, not the +Z fingertips.
  const thumbZ = axisZ + 0.45 * Math.max(0, zMaxPalm - axisZ);

  const knuckleX = wristX + sign * palmLength * 0.22;
  const midX0 = wristX + sign * palmLength * 0.55;
  let fingerN = 0, thumbN = 0;

  for (const v of verts) {
    const isThumb = v.u < 0.58 && v.z >= thumbZ;
    // Close the fan in both Y and Z. These hands are a volume, not a 5 cm paddle.
    const close = 0.52 * v.u * v.u;
    let x = v.x;
    let y = axisY + (v.y - axisY) * (1 - close);
    let z = axisZ + (v.z - axisZ) * (1 - close);

    if (isThumb) {
      const t = 0.85 * smooth(v.u / 0.55);
      z = axisZ + (z - axisZ) * (1 - 0.40 * t);
      y -= 0.012 * t;
      x -= sign * 0.010 * t;
      thumbN += 1;
    } else {
      const kAng = -sign * (0.95 * smooth((v.u - 0.14) / 0.36));
      const mAng = -sign * (0.90 * smooth((v.u - 0.48) / 0.40));
      let midX = midX0, midY = axisY;
      [midX, midY] = rotXY(midX, midY, knuckleX, axisY, kAng);
      [x, y] = rotXY(x, y, knuckleX, axisY, kAng);
      [x, y] = rotXY(x, y, midX, midY, mAng);
      fingerN += 1;
    }

    p.V[v.i * 3] = x;
    p.V[v.i * 3 + 1] = y;
    p.V[v.i * 3 + 2] = z;
  }
  return { fingerN, thumbN, thumbZ };
}

const parts = readParts(inPath);
const report = { kind: 'fist-bake-report', input: inPath, output: outPath, arms: [] };

for (const p of parts) {
  if (p.name !== 'LeftArm' && p.name !== 'RightArm') continue;
  const sign = p.name === 'LeftArm' ? +1 : -1;
  const probe = palmProbe(p, sign);
  const counts = fistArm(p, probe);
  p.N = recomputeNormals(p.V, p.I);
  report.arms.push({ part: p.name, ...probe, ...counts });
  console.log(`  ${p.name.padEnd(9)} palmFrac ${probe.palmFrac}  ${probe.wristHow}`);
  console.log(`           fingers ${counts.fingerN}  thumb ${counts.thumbN}`);
}

const bytes = writeParts(outPath, parts);
writeFileSync(outPath.replace(/\.glb$/, '-fists.json'), JSON.stringify(report, null, 1));
console.log(`\nwrote ${outPath}  (${(bytes / 1e6).toFixed(2)} MB)`);
