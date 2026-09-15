// Curvature- and colour-aware decimation of a painted multipart fighter.
//
// Hitem3D tessellates uniformly: the same ~0.4 mm vertex spacing on a flat
// trouser leg as on an eyelid. Most of those triangles encode nothing, so the
// job is not "make it smaller" but "spend the budget where curvature lives".
//
//   - Quadric error metrics collapse flat regions hard and refuse to move
//     creases (lapel edge, tie knot, knuckles, nostrils).
//   - Colour rides in the error term, so a collapse that would smear the red
//     tie into the white shirt is rejected even though it is geometrically free.
//   - Each named part gets its own budget, and part borders are locked so the
//     pieces stay aligned and separable for rigging.
//
//   node tools/decimate.mjs <in.glb> <out.glb> [--budget budget.json] [--total 120000]
import { MeshoptSimplifier } from 'meshoptimizer';
import { writeFileSync, readFileSync } from 'node:fs';
import { readParts, writeParts, recomputeNormals } from './glbIo.mjs';

// Share of the triangle budget per part. The head carries the likeness and gets
// a share far above its surface area; trousers are near-developable and get the
// least. Tuned on the Trump caricature -- retune per fighter, do not assume.
const DEFAULT_BUDGET = {
  Head: 0.28, Torso: 0.25, LeftArm: 0.115, RightArm: 0.115, LeftLeg: 0.12, RightLeg: 0.12,
};
// Weight applied to each linear-RGB channel inside the quadric.
const COLOUR_WEIGHT = 0.8;

const [, , inPath, outPath, ...rest] = process.argv;
if (!inPath || !outPath) { console.error('usage: decimate.mjs <in.glb> <out.glb> [--total N] [--budget f.json]'); process.exit(1); }
const argOf = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d; };
const TOTAL = parseInt(argOf('--total', '120000'), 10);
const budget = argOf('--budget') ? JSON.parse(readFileSync(argOf('--budget'), 'utf8')) : DEFAULT_BUDGET;

await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true;

const parts = readParts(inPath);
const report = [];
let inTris = 0, outTris = 0;

for (const p of parts) {
  const share = budget[p.name];
  if (share === undefined) throw new Error(`no budget entry for part "${p.name}"`);
  const srcTris = p.I.length / 3;
  const targetTris = Math.max(64, Math.round(TOTAL * share));
  inTris += srcTris;

  let indices, error;
  if (p.C) {
    [indices, error] = MeshoptSimplifier.simplifyWithAttributes(
      p.I, p.V, 3, p.C, 3,
      [COLOUR_WEIGHT, COLOUR_WEIGHT, COLOUR_WEIGHT],
      null, targetTris * 3, 1.0, ['LockBorder']);
  } else {
    [indices, error] = MeshoptSimplifier.simplify(p.I, p.V, 3, targetTris * 3, 1.0, ['LockBorder']);
  }

  // Drop vertices the collapse orphaned, keeping attributes in step.
  const used = new Uint32Array(p.V.length / 3).fill(0xffffffff);
  let n = 0;
  for (const i of indices) if (used[i] === 0xffffffff) used[i] = n++;
  const V = new Float32Array(n * 3), C = p.C ? new Float32Array(n * 3) : null;
  for (let i = 0; i < used.length; i++) {
    const j = used[i];
    if (j === 0xffffffff) continue;
    V[j * 3] = p.V[i * 3]; V[j * 3 + 1] = p.V[i * 3 + 1]; V[j * 3 + 2] = p.V[i * 3 + 2];
    if (C) { C[j * 3] = p.C[i * 3]; C[j * 3 + 1] = p.C[i * 3 + 1]; C[j * 3 + 2] = p.C[i * 3 + 2]; }
  }
  const I = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) I[i] = used[indices[i]];

  p.V = V; p.C = C; p.I = I; p.N = recomputeNormals(V, I);
  const got = I.length / 3;
  outTris += got;
  report.push({ part: p.name, srcTris, targetTris, tris: got, verts: n,
                keptPct: +(got / srcTris * 100).toFixed(2), relError: +error.toFixed(5) });
  console.log(`  ${p.name.padEnd(9)} ${String(srcTris).padStart(7)} -> ${String(got).padStart(6)} tris ` +
              `(${(got / srcTris * 100).toFixed(2)}% kept, ${n.toLocaleString()} verts, err ${error.toFixed(5)})`);
}

const bytes = writeParts(outPath, parts);
console.log(`\n${inTris.toLocaleString()} -> ${outTris.toLocaleString()} tris ` +
            `(${(outTris / inTris * 100).toFixed(2)}%), ${(bytes / 1e6).toFixed(2)} MB -> ${outPath}`);
writeFileSync(outPath.replace(/\.glb$/, '-decimate.json'), JSON.stringify(
  { kind: 'decimation-report', input: inPath, output: outPath, targetTotal: TOTAL,
    colourWeight: COLOUR_WEIGHT, flags: ['LockBorder'], inTris, outTris, parts: report }, null, 1));
