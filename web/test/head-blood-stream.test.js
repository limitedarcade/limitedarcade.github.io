import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { HeadBloodStream } from '../game/src/render/headBloodStream.js';
import { TRIBUTE, tributeFlight } from '../game/src/engine/beaverTribute.js';
import { fatalityOf } from '../game/src/engine/fatalities.js';

test('Carney’s finisher uses the requested title without changing its command or identity', () => {
  const definition = fatalityOf('carney-cold-cut');
  assert.equal(definition.name, 'QUIET, PIGGY');
  assert.deepEqual(definition.command, ['down', 'back', 'down', 'hp']);
});

test('blood stream stays attached, reuses its buffers, and is deterministic when paused or scrubbed', () => {
  for (const facing of [-1, 1]) {
    const root = new THREE.Group(), stream = new HeadBloodStream(root);
    const sample = (t, out) => tributeFlight(t, [.58 * facing, 1.5, 0], [1.95 * facing, .175, .6], out);
    const options = { sample, radius: .15, land: TRIBUTE.land };
    const positions = stream.positions, matrices = stream.drops.instanceMatrix;
    stream.update(75, options);
    assert.equal(stream.root.visible, true); assert.equal(stream.drops.count, 48);
    assert.equal(stream.dropMaterial.vertexColors, false, 'droplets have no vertex-color attribute');
    const center = [0, 0, 0]; sample(75, center);
    for (let axis of [0, 2]) {
      const ringCenter = Array.from({ length: 8 }, (_, i) => positions[i * 3 + axis]).reduce((a,b) => a+b, 0) / 8;
      assert.ok(Math.abs(ringCenter - center[axis]) < 1e-6, 'top ring tracks the neck');
    }
    assert.ok(Math.abs(positions[1] - (center[1] - .15 + .025)) < 1e-6);
    assert.ok(positions[positions.length - 2] < center[1] - 2, 'stream extends below the head');
    const before = positions.slice(), drops = matrices.array.slice();
    stream.update(120, options); stream.update(75, options);
    assert.deepEqual(positions, before); assert.deepEqual(matrices.array, drops);
    assert.equal(stream.positions, positions); assert.equal(stream.drops.instanceMatrix, matrices);
    assert.ok([...positions, ...matrices.array].every(Number.isFinite));
    for (const settings of [{ enabled: false }, { reducedMotion: true }]) {
      stream.update(75, { ...options, ...settings }); assert.equal(stream.root.visible, false);
    }
    stream.update(TRIBUTE.land, options); assert.equal(stream.root.visible, false);
    stream.update(75, options); stream.hide(); assert.equal(stream.root.visible, false);
    stream.dispose(); assert.equal(root.children.length, 0);
  }
});
