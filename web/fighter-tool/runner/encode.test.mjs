import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeRigged } from '../tools/glbRigIo.mjs';
import { encodeForceMeasured, readRigged } from '../tools/encode_force_measured.mjs';
import { decodeModel } from '../runtime/meshCodec.js';

const root = dirname(fileURLToPath(import.meta.url));
const trumpGlb = join(root, '../build/trump/trump_rigged.glb');

function tinyRigged(path) {
  const V = new Float32Array([0, 0, 0,  0.1, 0, 0,  0, 0.2, 0,  0, 0, 0.1]);
  const N = new Float32Array([0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 1, 0]);
  const C = new Float32Array([0.8, 0.1, 0.1,  0.1, 0.8, 0.1,  0.1, 0.1, 0.8,  1, 1, 1]);
  const J = new Uint8Array([0, 1, 0, 0,  0, 1, 0, 0,  1, 0, 0, 0,  0, 0, 0, 0]);
  const W = new Float32Array([0.7, 0.3, 0, 0,  0.5, 0.5, 0, 0,  1, 0, 0, 0,  1, 0, 0, 0]);
  const I = new Uint32Array([0, 1, 2, 0, 2, 3]);
  const bones = [
    { name: 'root', parent: -1, local: [0, 0, 0], world: [0, 0, 0] },
    { name: 'hips', parent: 0, local: [0, 0.1, 0], world: [0, 0.1, 0] },
  ];
  writeRigged(path, {
    parts: [{ name: 'Torso', V, N, C, J, W, I }],
    bones,
    skinnedTo: 0,
    animations: [{
      name: 'tpose',
      tracks: [{ bone: 0, path: 'rotation', times: [0, 0.5], values: [0, 0, 0, 1, 0, 0, 0, 1] }],
    }],
    generator: 'encode.test',
  });
}

test('tiny rigged GLB round-trips vertex, triangle, bone and clip counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fighter-encode-'));
  try {
    const glb = join(dir, 'tiny.glb');
    tinyRigged(glb);
    const src = readRigged(glb);
    assert.equal(src.parts.length, 1);
    assert.equal(src.bones.length, 2);
    assert.equal(src.animations[0].name, 'tpose');

    const out = join(dir, 'threejs');
    const parity = encodeForceMeasured(glb, out, { id: 'tiny', displayName: 'Tiny', canonical: false });
    assert.equal(parity.verts, 4);
    assert.equal(parity.tris, 2);
    assert.equal(parity.bones, 2);
    assert.deepEqual(parity.clips, ['tpose']);
    assert.equal(parity.ok, true, JSON.stringify(parity.gates, null, 2));
    assert.ok(existsSync(join(out, 'createFighterModel.js')));
    assert.ok(existsSync(join(out, 'surfaceData.js')));
    assert.ok(existsSync(join(out, 'rigData.js')));
    assert.ok(existsSync(join(out, 'meshCodec.js')));

    const model = JSON.parse(readFileSync(join(out, 'parity.json'), 'utf8'));
    assert.equal(model.verts, 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('decoded tiny positions stay inside one quantisation step', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fighter-encode-q-'));
  try {
    const glb = join(dir, 'tiny.glb');
    tinyRigged(glb);
    const measured = readRigged(glb);
    const parity = encodeForceMeasured(glb, join(dir, 'threejs'), { id: 'tiny', canonical: false });
    const mod = await import(pathToFileURL(join(dir, 'threejs/surfaceData.js')).href);
    const decoded = decodeModel(mod.SURFACE_MODEL, mod.SURFACE_STREAM);
    const src = measured.parts[0];
    const dst = decoded[0];
    const step = Math.max(...parity.quantization.step);
    for (let i = 0; i < src.V.length; i += 1) {
      assert.ok(Math.abs(dst.position[i] - src.V[i]) <= step * 1.5 + 1e-9);
    }
    assert.equal(dst.index.length, src.I.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Trump rigged GLB encodes with matching counts', { timeout: 60000 }, (t) => {
  if (!existsSync(trumpGlb)) {
    t.skip('trump_rigged.glb not built');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'fighter-encode-trump-'));
  try {
    const parity = encodeForceMeasured(trumpGlb, dir, { id: 'trump', displayName: 'Trump' });
    assert.equal(parity.bones, 25);
    assert.ok(parity.clips.includes('tpose'));
    assert.ok(parity.clips.includes('guard'));
    assert.ok(parity.clips.includes('idle'));
    assert.ok(parity.clips.includes('jab'));
    assert.equal(parity.ok, true, JSON.stringify(parity.gates.filter((g) => g.status !== 'pass'), null, 2));
    const vertGate = parity.gates.find((g) => g.name === 'vertexCount');
    assert.equal(vertGate.value, vertGate.measured);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
