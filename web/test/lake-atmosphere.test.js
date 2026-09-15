import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { LakeAtmosphere } from '../game/src/render/lakeAtmosphere.js';

test('shore spindrift uses one bounded draw and follows elapsed scene time at 30/60/144 Hz', () => {
  const snapshots = [];
  for (const hz of [30, 60, 144]) {
    const group = new THREE.Group(), weather = new LakeAtmosphere(group);
    const positions = weather.positions, geometry = weather.points.geometry;
    for (let frame = 0; frame < hz * 10; frame++) weather.update(1 / hz, false);
    assert.equal(group.children.length, 1);
    assert.equal(weather.positions, positions);
    assert.equal(weather.points.geometry, geometry);
    assert.equal(geometry.attributes.position.count, 160);
    assert.ok(positions.every(Number.isFinite));
    snapshots.push(positions.slice());
    geometry.dispose(); weather.points.material.dispose();
  }
  snapshots[0].forEach((value, i) => {
    assert.ok(Math.abs(value - snapshots[1][i]) < 1e-5);
    assert.ok(Math.abs(value - snapshots[2][i]) < 1e-5);
  });
});

test('powder reacts locally, freezes on pause, disappears for reduced motion and clears on round reset', () => {
  const weather = new LakeAtmosphere(new THREE.Group());
  weather.impact(-5, 1); weather.update(.1, false);
  assert.ok(weather.alpha.slice(112).some(a => a > 0));
  const burst = weather.positions.slice(112 * 3);
  for (let i = 0; i < burst.length; i += 3) assert.ok(Math.abs(burst[i] + 5) < .3);
  weather.update(0, false); assert.deepEqual(weather.positions.slice(112 * 3), burst);
  const before = weather.positions.slice(), time = weather.time;
  weather.update(3, true);
  assert.equal(weather.points.visible, false); assert.equal(weather.time, time);
  assert.deepEqual(weather.positions, before);
  weather.resetRound(); weather.update(0, false);
  assert.equal(weather.points.visible, true);
  assert.ok(weather.alpha.slice(112).every(a => a === 0));
  weather.impact(NaN, Infinity); weather.update(3, false);
  assert.ok(weather.positions.every(Number.isFinite));
  assert.ok(weather.alpha.slice(112).every(a => a === 0));
});
