import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { validatePair, checkEnvironment } from './validate.mjs';
import { classifyProbe, probeGlb } from './glbMeta.mjs';

const web = join(dirname(fileURLToPath(import.meta.url)), '../..');
const trumpTex = join(web, 'trump 3D Model_allparts_20260903_235636.glb');
const trumpParts = join(web, 'trump_allparts_20260904_002203.glb');
const carneyTex = join(web, 'carney_Stylized Cel-Shaded Businessman 3D Model_allparts_20260904_123033.glb');
const carneyParts = join(web, 'carney_allparts_20260904_122231.glb');

test('environment has python+numpy or explains the miss', async () => {
  const env = await checkEnvironment();
  assert.equal(typeof env.ok, 'boolean');
  assert.ok(env.checks.length >= 4);
});

test('classifies Trump pair without using filenames', async (t) => {
  if (!existsSync(trumpTex) || !existsSync(trumpParts)) {
    t.skip('Trump GLBs not in web/');
    return;
  }
  const a = probeGlb(trumpTex);
  const b = probeGlb(trumpParts);
  const kinds = [classifyProbe(a), classifyProbe(b)].sort();
  assert.deepEqual(kinds, ['parts', 'textured']);
});

test('Trump pair PASSES the validator', async (t) => {
  if (!existsSync(trumpTex) || !existsSync(trumpParts)) {
    t.skip('Trump GLBs not in web/');
    return;
  }
  const result = await validatePair(trumpTex, trumpParts);
  assert.equal(result.ok, true, result.checks.filter((c) => !c.ok).map((c) => c.message).join('; '));
  assert.ok(result.textured);
  assert.ok(result.parts);
});

test('Carney pair PASSES the validator', async (t) => {
  if (!existsSync(carneyTex) || !existsSync(carneyParts)) {
    t.skip('Carney GLBs not in web/');
    return;
  }
  const result = await validatePair(carneyTex, carneyParts);
  assert.equal(result.ok, true, result.checks.filter((c) => !c.ok).map((c) => c.message).join('; '));
});

test('a single textured Trump GLB PASSES solo validate', async (t) => {
  if (!existsSync(trumpTex)) {
    t.skip('Trump textured GLB not in web/');
    return;
  }
  const result = await validatePair(trumpTex);
  assert.equal(result.ok, true, result.checks.filter((c) => !c.ok).map((c) => c.message).join('; '));
  assert.equal(result.route, 'solo-textured');
  assert.equal(result.textured, trumpTex);
  assert.equal(result.parts, null);
});

test('two parts files FAIL with the textured-missing message', async (t) => {
  if (!existsSync(carneyParts)) {
    t.skip('Carney parts GLB not in web/');
    return;
  }
  const result = await validatePair(carneyParts, carneyParts);
  assert.equal(result.ok, false);
  const ident = result.checks.find((c) => c.id === 'identify');
  assert.ok(ident && /textured export/i.test(ident.fix || ident.message));
});
