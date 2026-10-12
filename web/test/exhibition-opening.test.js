import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { Match } from '../game/src/engine/match.js';
import { exhibitionOpening, ExhibitionProps } from '../game/src/render/exhibitionOpening.js';
import { REEL } from '../game/src/engine/reelTimeline.js';

const match = new Match({ left: { id: 'trump' }, right: { id: 'carney' }, roundsToWin: 1 });
const snapshot = match.snapshot();

test('cold open stages three readable prop actions without changing the simulation', () => {
  const before = structuredClone(snapshot);
  for (const [frame, kind, side, clip] of [[28, 'machine', 0, 'heavyPunch'], [113, 'paper', 0, 'heavyKick'], [190, 'bell', 1, 'heavyPunch']]) {
    for (const aspect of [.45, 1.1, 16 / 9, 2.35]) {
      const opening = exhibitionOpening({ ...snapshot, phaseFrame: frame }, { aspect });
      assert.equal(opening.cue.kind, kind);
      assert.equal(opening.actors[side].cinematicClip, clip);
      const camera = new THREE.PerspectiveCamera(opening.shot.fov, aspect, .05, 850);
      camera.position.fromArray(opening.shot.position); camera.lookAt(...opening.shot.target); camera.updateMatrixWorld(true);
      const actor = opening.actors[side];
      for (const y of [.1, 2.1]) {
        const projected = new THREE.Vector3(actor.x, y, actor.z).project(camera);
        assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1, `${kind}: featured fighter fits at aspect ${aspect}`);
      }
    }
  }
  assert.deepEqual(snapshot, before);
  assert.equal(exhibitionOpening({ ...snapshot, phase: 'fight' }), null);
  assert.equal(exhibitionOpening({ ...snapshot, stageId: 'capitol' }), null);
});

test('reveal eases into the home camera with stationary reduced-motion framing', () => {
  for (const aspect of [.45, .9, 1.1, 16 / 9]) {
    const shot = exhibitionOpening({ ...snapshot, phaseFrame: REEL.fightEnd }, { aspect }).shot;
    assert.deepEqual(shot.target, [0, 1.46, 0]);
    assert.equal(shot.fov, aspect < .75 ? 46 : aspect < 1.35 ? 39 : 33);
    const still = frame => exhibitionOpening({ ...snapshot, phaseFrame: frame }, { aspect, reducedMotion: true });
    assert.deepEqual(still(0).shot, still(400).shot);
    assert.equal(still(190).cue, undefined);
    assert.ok(still(190).actors.every(actor => actor.z === 0 && !actor.cinematicClip));
  }
});

test('stage reactions restore exactly on exit, pause/resample and stage change', () => {
  const group = new THREE.Group(), prop = new THREE.Group(); group.add(prop);
  prop.name = 'bell'; prop.position.set(3, .02, -4.6); prop.rotation.set(.1, -.1, .05);
  const position = prop.position.clone(), rotation = prop.rotation.clone();
  const director = new ExhibitionProps(), cue = { name: 'bell', kind: 'bell', frame: 6 };
  director.update(group, cue);
  const sampled = prop.rotation.clone(); assert.ok(!sampled.equals(rotation));
  director.update(group, cue); assert.ok(prop.rotation.equals(sampled), 'frozen frame never accumulates drift');
  director.update(group, null); assert.ok(prop.position.equals(position)); assert.ok(prop.rotation.equals(rotation));
  director.update(group, cue); director.update(new THREE.Group(), cue); assert.ok(prop.rotation.equals(rotation));
  director.update(group, cue, true); assert.ok(prop.rotation.equals(rotation));
});
