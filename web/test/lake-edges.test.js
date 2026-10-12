import test from 'node:test';
import assert from 'node:assert/strict';
import { PostFx } from '../game/src/render/postfx.js';

function makeFx({ lowPower = false, maxSamples = 4, grade = 'lakeAmerica' } = {}) {
  const renderer = {
    capabilities: { maxSamples },
    getPixelRatio: () => 1,
    getSize: target => target.set(640, 360),
    getDrawingBufferSize: target => target.set(640, 360),
  };
  const fx = new PostFx(renderer, null, null, { lowPower, grade });
  const targets = [fx.composer.renderTarget1, fx.composer.renderTarget2];
  return { fx, targets, close() { fx.bloom.dispose(); fx.gradePass.dispose(); fx.dispose(); } };
}

test('Lake America resolves both HDR targets with multisampling, including after resize', () => {
  const state = makeFx();
  try {
    assert.deepEqual(state.targets.map(t => t.samples), [4, 4]);
    state.fx.setSize(960, 540);
    assert.deepEqual(state.targets.map(t => [t.samples, t.width, t.height]), [[4, 960, 540], [4, 960, 540]]);
  } finally { state.close(); }
});

test('Lake edge sampling honors low power mode and the hardware limit', () => {
  for (const [options, expected] of [
    [{ lowPower: true }, 2],
    [{ maxSamples: 2 }, 2],
    [{ maxSamples: 0 }, 0],
  ]) {
    const state = makeFx(options);
    try { assert.deepEqual(state.targets.map(t => t.samples), [expected, expected]); }
    finally { state.close(); }
  }
});

test('stage changes reallocate sample buffers once and restore other stages', () => {
  const state = makeFx({ grade: 'capitol' });
  try {
    const disposed = [0, 0];
    state.targets.forEach((target, i) => target.addEventListener('dispose', () => disposed[i]++));
    state.fx.setGrade('lakeAmerica');
    assert.deepEqual(state.targets.map(t => t.samples), [4, 4]);
    assert.deepEqual(disposed, [1, 1]);
    state.fx.setGrade('lakeAmerica');
    assert.deepEqual(disposed, [1, 1]);
    state.fx.setGrade('palms');
    assert.deepEqual(state.targets.map(t => t.samples), [0, 0]);
    assert.deepEqual(disposed, [2, 2]);
  } finally { state.close(); }
});
