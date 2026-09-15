import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeGlb, classifyProbe, PART_NAMES } from './glbMeta.mjs';
import { checkPython } from './python.mjs';
import { TOOL_ROOT } from './config.mjs';

const require = createRequire(import.meta.url);

function check(id, ok, message, fix = null, extra = {}) {
  return { id, ok, message, fix, ...extra };
}

export async function checkEnvironment() {
  const py = checkPython();
  const toolsDir = join(TOOL_ROOT, 'tools');
  const needed = [
    'bake_atlas_to_parts.py', 'textured_to_parts.py', 'glb_io.py', 'decimate.mjs', 'measure_joints.mjs',
    'pose_check.mjs', 'rig.mjs', 'aim_sweep.mjs', 'fighterRig.mjs', 'glbIo.mjs', 'glbRigIo.mjs',
    'make_fists.mjs',
  ];
  const missingTools = needed.filter((f) => !existsSync(join(toolsDir, f)));
  let meshoptimizer = false;
  let meshoptimizerError = null;
  try {
    require.resolve('meshoptimizer', { paths: [TOOL_ROOT] });
    meshoptimizer = true;
  } catch (err) {
    meshoptimizerError = err.message;
  }
  const checks = [
    check('python', py.exists, py.exists ? `Python ${py.python}` : 'Skill venv python is missing', py.error),
    check('numpy', py.numpy, py.numpy ? `numpy ${py.numpyVersion}` : 'numpy is missing', py.error),
    check('pil', py.pil, py.pil ? `PIL ${py.pilVersion}` : 'Pillow is missing', py.error),
    check('meshoptimizer', meshoptimizer, meshoptimizer ? 'meshoptimizer is installed' : 'meshoptimizer is not installed',
      meshoptimizer ? null : `Run npm install in ${TOOL_ROOT}. ${meshoptimizerError || ''}`),
    check('tools', missingTools.length === 0, missingTools.length === 0 ? `tools/ is present (${needed.length} files)` : `Missing tools: ${missingTools.join(', ')}`,
      missingTools.length ? `Copy the playbook kernels into ${toolsDir}` : null),
  ];
  return { python: py, meshoptimizer, toolsDir, missingTools, checks, ok: checks.every((c) => c.ok) };
}

function pairBounds(a, b) {
  const da = a.size.map((v, i) => Math.abs(v - b.size[i]));
  const height = Math.max(a.size[1], b.size[1], 1e-6);
  const maxDelta = Math.max(...da);
  const mmPerM = (maxDelta / height) * 1000;
  return { maxDelta, height, mmPerM, sizeA: a.size, sizeB: b.size };
}

export async function validateSolo(path, opts = {}) {
  const checks = [];
  const env = opts.env || await checkEnvironment();
  if (!opts.skipEnv) {
    for (const c of env.checks) checks.push(c);
  }
  if (!path || !existsSync(path)) {
    checks.push(check('files', false, 'No GLB to read',
      'Drop a textured .glb (atlas + UVs). The two-file Hitem3D pair is optional.'));
    return failCard(checks, { a: path, route: 'solo' });
  }
  let probe;
  try {
    probe = probeGlb(path);
  } catch (err) {
    checks.push(check('glb', false, `Could not read a GLB JSON chunk: ${err.message}`,
      'Export again as binary glTF (.glb), not .gltf + .bin.'));
    return failCard(checks, { a: path, route: 'solo' });
  }
  const kind = classifyProbe(probe);
  const names = new Set(probe.nodeNames);
  const hasParts = PART_NAMES.every((n) => names.has(n));
  const hasAtlas = probe.imageCount >= 1 && (probe.hasTexcoord || probe.hasColor);
  if (hasParts && hasAtlas) {
    checks.push(check('identify', true,
      `Solo GLB already has the six named parts and an atlas (${probe.meshCount} meshes, ${probe.imageCount} image(s)).`,
      null, { kind }));
  } else if (hasParts && probe.hasColor && probe.imageCount === 0) {
    checks.push(check('identify', true,
      `Six named parts with vertex colour and no atlas. If this is a Hitem3D parts export, those colours are segmentation tints — add the textured file for real paint.`,
      null, { kind, warnPartsOnly: true }));
  } else if (hasAtlas) {
    checks.push(check('identify', true,
      `Solo textured GLB: ${probe.meshCount} mesh(es), ${probe.verts.toLocaleString()} verts, ${probe.imageCount} image(s). The tool will split Head / Torso / arms / legs from the T-pose.`,
      null, { kind }));
  } else {
    checks.push(check('identify', false,
      `Saw a ${kind} GLB with ${probe.meshCount} mesh(es), ${probe.imageCount} image(s). Need an atlas + UVs.`,
      'Drop a textured .glb (base-colour JPEG/PNG + UVs). The six-part Hitem3D file is optional.'));
  }

  if (probe.imageCount >= 1) {
    const imgs = probe.images;
    const okMime = imgs.some((im) => im.mime === 'image/jpeg' || im.mime === 'image/png');
    const largest = imgs.reduce((a, im) => Math.max(a, im.width || 0, im.height || 0), 0);
    const decoded = imgs.some((im) => im.width && im.height);
    let ok = okMime && decoded;
    let fix = null;
    let message = `Atlas: ${imgs.map((im) => `${im.mime} ${im.width || '?'}×${im.height || '?'} (${(im.bytes / 1e6).toFixed(1)} MB)`).join(', ') || 'none'}.`;
    if (!okMime && !probe.hasColor) {
      ok = false;
      fix = 'Need image/jpeg or image/png, or vertex colours.';
    } else if (!decoded && !probe.hasColor) {
      ok = false;
      fix = 'An image chunk is present but did not decode as JPEG or PNG.';
    } else if (largest > 0 && largest < 2048) {
      message += ' Warning: under 2048².';
    }
    if (probe.hasColor && !okMime) ok = true;
    checks.push(check('atlas', ok, message, fix, { images: imgs, warnSmall: largest > 0 && largest < 2048 }));
  } else if (probe.hasColor) {
    checks.push(check('atlas', true, 'No atlas; vertex colours will be kept.'));
  }

  const trisOk = probe.tris >= 10000;
  checks.push(check('tris', trisOk,
    `${Math.round(probe.tris).toLocaleString()} triangles.`,
    trisOk ? null : 'Mesh is too small to be a fighter sculpt.'));

  const hardOk = checks.every((c) => c.ok);
  const route = hasParts ? 'solo-named' : 'solo-textured';
  return {
    ok: hardOk,
    flagged: false,
    checks,
    env,
    route,
    textured: path,
    parts: hasParts ? path : null,
    probes: { a: probe },
  };
}

export async function validatePair(pathA, pathB, opts = {}) {
  const checks = [];
  const env = opts.env || await checkEnvironment();
  if (!opts.skipEnv) {
    for (const c of env.checks) checks.push(c);
  }

  const solo = !pathB;
  if (solo) return validateSolo(pathA, { ...opts, env, skipEnv: opts.skipEnv });

  if (!existsSync(pathA) || !existsSync(pathB)) {
    checks.push(check('files', false, 'One or both files are missing',
      'Drop one textured GLB, or the textured export plus the six-part export from the same Hitem3D sculpt.'));
    return failCard(checks, { a: pathA, b: pathB });
  }

  let probeA, probeB;
  try {
    probeA = probeGlb(pathA);
    probeB = probeGlb(pathB);
  } catch (err) {
    checks.push(check('glb', false, `Could not read a GLB JSON chunk: ${err.message}`,
      'Export again as binary glTF (.glb), not .gltf + .bin.'));
    return failCard(checks, { a: pathA, b: pathB });
  }

  const kindA = classifyProbe(probeA);
  const kindB = classifyProbe(probeB);
  let textured = null;
  let parts = null;
  if (kindA === 'textured' && (kindB === 'parts' || kindB === 'parts-like')) {
    textured = probeA; parts = probeB;
  } else if (kindB === 'textured' && (kindA === 'parts' || kindA === 'parts-like')) {
    textured = probeB; parts = probeA;
  }

  const bothParts = (kindA === 'parts' || kindA === 'parts-like') && (kindB === 'parts' || kindB === 'parts-like');
  const bothTex = kindA === 'textured' && kindB === 'textured';

  if (bothParts) {
    checks.push(check('identify', false,
      'Both files look like the parts export (six named meshes, no atlas).',
      'Missing the textured export — the one named after your prompt, carrying the atlases. Re-export it from the same sculpt.'));
  } else if (bothTex) {
    checks.push(check('identify', false,
      'Both files look like the textured export (atlas + UVs, no Head/Torso/arm/leg names).',
      'Missing the parts export — six named nodes Head, Torso, LeftArm, RightArm, LeftLeg, RightLeg. Re-export parts from the same sculpt.'));
  } else if (!textured || !parts) {
    checks.push(check('identify', false,
      `Could not tell the files apart (saw ${kindA} and ${kindB}). Filenames are ignored on purpose — allparts appears on both Hitem3D exports and means nothing.`,
      'You need one textured GLB (UVs + JPEG/PNG atlas) and one parts GLB (six named meshes, COLOR_0, no images).'));
  } else {
    checks.push(check('identify', true,
      `Textured =  ${textured.meshCount} mesh(es), ${textured.imageCount} image(s), TEXCOORD_0. Parts = ${parts.meshCount} meshes, ${parts.nodeNames.join(', ')}.`,
      null, { textured: textured.path, parts: parts.path, kindA, kindB }));
  }

  if (parts) {
    const names = new Set(parts.nodeNames);
    const missing = PART_NAMES.filter((n) => !names.has(n));
    checks.push(check('names', missing.length === 0,
      missing.length === 0
        ? 'Six semantic node names are present and exact.'
        : `Parts file is missing: ${missing.join(', ')}.`,
      missing.length ? 'Re-export the parts GLB. Names must be exactly Head, Torso, LeftArm, RightArm, LeftLeg, RightLeg.' : null));
  }

  if (textured && parts && !textured.bounds.missingMinMax && !parts.bounds.missingMinMax) {
    const b = pairBounds(textured, parts);
    const ok = b.mmPerM <= 1.0;
    checks.push(check('bounds', ok,
      `Bounds agree to ${b.mmPerM.toFixed(2)} mm per metre of height (limit 1.00). Trump shipped at 0.24, Carney at 0.00.`,
      ok ? null : 'These two files are different sculpts. The spatial paint join will be garbage. Re-export both from the same Hitem3D result.',
      b));
  } else if (textured && parts) {
    checks.push(check('bounds', false, 'POSITION accessors are missing min/max, so bounds cannot be checked from JSON alone.',
      'Re-export; a valid glTF POSITION accessor always carries min and max.'));
  }

  if (textured) {
    const imgs = textured.images;
    const okMime = imgs.some((im) => im.mime === 'image/jpeg' || im.mime === 'image/png');
    const largest = imgs.reduce((a, im) => Math.max(a, im.width || 0, im.height || 0), 0);
    const decoded = imgs.some((im) => im.width && im.height);
    let ok = okMime && decoded;
    let fix = null;
    let message = `Atlas: ${imgs.map((im) => `${im.mime} ${im.width || '?'}×${im.height || '?'} (${(im.bytes / 1e6).toFixed(1)} MB)`).join(', ') || 'none'}.`;
    if (!okMime) {
      ok = false;
      fix = 'The textured export must carry image/jpeg or image/png. Re-export with the atlas embedded.';
    } else if (!decoded) {
      ok = false;
      fix = 'An image chunk is present but did not decode as JPEG or PNG.';
    } else if (largest < 2048) {
      message += ` Warning: under 2048² (shipped fighters are ~8192²). Likeness will suffer.`;
      fix = 'Re-export at the generator’s full atlas size if you still have the sculpt.';
    }
    checks.push(check('atlas', ok, message, fix, { images: imgs, warnSmall: largest > 0 && largest < 2048 }));
  }

  if (textured && parts) {
    const texTris = textured.tris;
    const partTris = parts.tris;
    const extra = texTris > 0 ? (partTris - texTris) / texTris : 0;
    const texOk = texTris > 1.5e6 && texTris < 2.6e6;
    const extraOk = extra >= -0.02 && extra <= 0.08;
    const ok = texOk && extraOk;
    checks.push(check('tris', ok,
      `Textured ${Math.round(texTris).toLocaleString()} tris (expect ~2.0 M). Parts ${Math.round(partTris).toLocaleString()} (${(extra * 100).toFixed(1)}% more — interior caps of 1–6% are expected, not a bug).`,
      ok ? null : 'Triangle counts are off the Hitem3D two-file pattern. Confirm both exports came from the same sculpt at faceLimit 2.0 M.',
      { texTris, partTris, extra }));
  }

  const ok = checks.every((c) => c.ok || c.id === 'atlas' && c.warnSmall);
  const hardOk = checks.every((c) => c.ok);
  return {
    ok: hardOk,
    flagged: ok && !hardOk,
    checks,
    env,
    route: 'pair',
    textured: textured?.path || null,
    parts: parts?.path || null,
    probes: { a: probeA, b: probeB },
  };
}

function failCard(checks, extra) {
  return { ok: false, flagged: false, checks, ...extra };
}

export function formatCard(result) {
  const lines = [];
  lines.push(result.ok ? 'PASS' : 'FAIL');
  for (const c of result.checks) {
    lines.push(`${c.ok ? '  ok ' : ' FAIL'}  ${c.id.padEnd(14)} ${c.message}`);
    if (!c.ok && c.fix) lines.push(`         → ${c.fix}`);
  }
  if (result.textured) lines.push(`textured: ${result.textured}`);
  if (result.parts) lines.push(`parts:    ${result.parts}`);
  return lines.join('\n');
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === new URL('file:///' + resolve(process.argv[1]).replace(/\\/g, '/')).href;
if (invoked || process.argv[1]?.replace(/\\/g, '/').endsWith('runner/validate.mjs')) {
  const a = process.argv[2], b = process.argv[3];
  if (!a) {
    console.error('usage: node runner/validate.mjs <textured.glb> [parts.glb]');
    process.exit(2);
  }
  const result = await validatePair(a, b);
  console.log(formatCard(result));
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
