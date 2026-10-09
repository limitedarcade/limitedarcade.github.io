import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../game/src/vendor/three.module.js';
import { FightCamera } from '../game/src/render/camera.js';
import { impactProfile } from '../game/src/render/impact.js';
import { HitRecoil } from '../game/src/render/hitRecoil.js';
import { FightAudio } from '../game/src/game/fightAudio.js';
import { Match, PHASE, MATCH } from '../game/src/engine/match.js';
import { REEL, reelAt } from '../game/src/engine/reelTimeline.js';
import { lakeEntranceCamera } from '../game/src/render/lakeCameraDirector.js';

const snapshot = (a = { x: -0.8, y: 0 }, b = { x: 0.8, y: 0 }) => ({ distance: Math.abs(b.x - a.x), fighters: [a, b] });
const rigAt = (width = 1280, height = 720) => {
  const camera = new THREE.PerspectiveCamera(33, width / height, 0.05, 90);
  const rig = new FightCamera(camera); rig.setViewport(width, height);
  return { camera, rig };
};
const settle = (rig, state, hz = 60) => { for (let i = 0; i < hz * 2; i++) rig.update(1 / hz, state); };

for (const [width, height] of [[1280, 720], [844, 390], [390, 844], [320, 568]]) {
  test(`camera fits heads, feet, wide spacing, both edges and jumps at ${width}x${height}`, () => {
    const { rig, camera } = rigAt(width, height);
    for (const state of [snapshot(), snapshot({ x: -4.8, y: 0 }, { x: 4.8, y: 0 }),
      snapshot({ x: 3.6, y: 0 }, { x: 5, y: 0 }), snapshot({ x: -5, y: 0 }, { x: -3.6, y: 0 }),
      snapshot({ x: -1, y: 2.2 }, { x: 1, y: 0 })]) {
      settle(rig, state); camera.updateMatrixWorld();
      for (const fighter of state.fighters) for (const y of [fighter.y, fighter.y + 2.02]) for (const dx of [-0.55, 0.55]) {
        const p = new THREE.Vector3(fighter.x + dx, y, 0).project(camera);
        assert.ok(Math.abs(p.x) < 0.98, `horizontal crop ${p.x}`);
        assert.ok(p.y < 0.84 && p.y > -0.90, `vertical crop ${p.y}`);
        if (height < 500 && width > height) assert.ok(p.y > -0.58, 'feet stay above landscape touch controls');
      }
    }
  });
}

test('close-range desktop fighters occupy more than half the viewport without filling the HUD', () => {
  const { rig, camera } = rigAt(); settle(rig, snapshot()); camera.updateMatrixWorld();
  const head = new THREE.Vector3(-0.8, 1.92, 0).project(camera);
  const foot = new THREE.Vector3(-0.8, 0, 0).project(camera);
  const height = (head.y - foot.y) / 2;
  assert.ok(height > 0.50 && height < 0.72, `fighter height ${height}`);
});

test('a sudden leap and resize remain inside the viewport during camera easing', () => {
  const { rig, camera } = rigAt(); settle(rig, snapshot());
  const jumped = snapshot({ x: -1.2, y: 2.2 }, { x: 1.2, y: 0 });
  for (let i = 0; i < 30; i++) {
    rig.update(1 / 60, jumped); camera.updateMatrixWorld();
    const p = new THREE.Vector3(-1.2, 4.22, 0).project(camera);
    assert.ok(p.y < 0.95, `jump clipped while easing: ${p.y}`);
  }
  rig.setViewport(390, 844); rig.update(1 / 60, jumped); camera.updateMatrixWorld();
  for (const f of jumped.fighters) assert.ok(Math.abs(new THREE.Vector3(f.x, f.y + 1, 0).project(camera).x) < 0.95);
});

test('shake is directional, bounded and settles during simulation hitstop at 30/60/144 Hz', () => {
  const outcomes = [];
  for (const hz of [30, 60, 144]) {
    const { rig, camera } = rigAt(); settle(rig, snapshot());
    const original = camera.position.clone();
    for (let i = 0; i < 20; i++) rig.addShake(0.4, -1);
    assert.ok(rig.shake <= 0.75);
    rig.update(0, snapshot(), { impactDt: 1 / hz, frozen: true });
    assert.ok(camera.position.distanceTo(original) > 0.001);
    assert.ok(camera.position.distanceTo(original) < 0.07);
    for (let i = 1; i < hz / 2; i++) rig.update(0, snapshot(), { impactDt: 1 / hz, frozen: true });
    outcomes.push(camera.position.distanceTo(original));
    assert.ok(outcomes.at(-1) < 0.001, 'shake cannot hang through a freeze');
    rig.addShake(0.75); rig.update(0, snapshot(), { impactDt: 1 / hz, reducedMotion: true });
    assert.ok(camera.position.distanceTo(original) < 1e-8);
  }
});

test('paused camera does not advance shake; reset clears every contact impulse', () => {
  const { rig, camera } = rigAt(); settle(rig, snapshot()); rig.addShake(0.3);
  rig.update(1 / 60, snapshot()); const frozen = camera.position.clone(), age = rig.shakeAge;
  rig.update(0, snapshot(), { impactDt: 0 });
  assert.equal(rig.shakeAge, age); assert.ok(camera.position.distanceTo(frozen) < 1e-8);
  rig.hit({ x: 0, y: 1 }, impactProfile({ bloodScale: 2 })); rig.resetImpact();
  assert.equal(rig.impact, null); assert.equal(rig.shake, 0);
});

test('authored finisher camera positions remain exact with contact shake pending', () => {
  const { rig, camera } = rigAt(); rig.addShake(0.6);
  const shot = { authored: true, position: [1.9, 1.25, 4], target: [0.3, 1.05, 0], fov: 38 };
  rig.update(1 / 60, snapshot(), { shot }); assert.deepEqual(camera.position.toArray(), shot.position);
});

test('weak, light, heavy, counter and KO contacts have a clear impact hierarchy', () => {
  const profiles = [{ bloodScale: 0.12, damage: 8 }, { bloodScale: 0.8, damage: 40 },
    { bloodScale: 1.5, damage: 100 }, { bloodScale: 1.5, counter: true }, { ko: true }].map(impactProfile);
  for (let i = 1; i < profiles.length; i++) assert.ok(profiles[i].shake > profiles[i - 1].shake);
  assert.ok(profiles[0].recoil < profiles[1].recoil);
  const block = impactProfile({ type: 'block', damage: 9, moveData: { hit: { damage: 104 } } });
  assert.equal(block.guardHeavy, true); assert.equal(block.type, 'block');
  assert.ok(block.shake < profiles[1].shake); assert.ok(block.recoil < profiles[1].recoil);
});

test('impact audio uses the same heavy/light/guard classification as visible reactions', () => {
  const calls = [], audio = { effect: (...args) => calls.push(args) };
  for (const event of [{ type: 'hit', bloodScale: 0.12, damage: 8, y: 1.3 },
    { type: 'hit', bloodScale: 1.5, damage: 100, y: 1.3 },
    { type: 'block', damage: 9, moveData: { hit: { damage: 104 } } }]) FightAudio.prototype.event.call(audio, event);
  assert.equal(calls[0][0], 'face_hit_small'); assert.equal(calls[1][0], 'face_hit_large');
  assert.equal(calls[2][0], 'block_large');
  assert.ok(calls[0][1].gain < calls[1][1].gain); assert.ok(calls[0][1].rate > calls[1][1].rate);
});

test('Mixamo hit recoil bends the imported rig and restores it without accumulating drift', () => {
  const model = new THREE.Group(), pivot = new THREE.Group(); pivot.add(model);
  let parent = model; const bones = [];
  for (const name of ['Hips', 'Spine', 'Spine2', 'Neck', 'Head']) {
    const bone = new THREE.Bone(); bone.name = `mixamorig${name}_1`; bone.position.y = 0.25;
    parent.add(bone); parent = bone; bones.push(bone);
  }
  const originals = bones.map(b => b.quaternion.clone()), recoil = new HitRecoil(model, pivot);
  recoil.hit({ type: 'hit', facing: -1, level: 'high' }, impactProfile({ damage: 104, bloodScale: 1.5 }));
  recoil.apply(0); assert.ok(bones.some((b, i) => b.quaternion.angleTo(originals[i]) > 0.001));
  for (let i = 0; i < 40; i++) { recoil.restore(); recoil.apply(1 / 60); }
  recoil.restore(); bones.forEach((b, i) => assert.ok(b.quaternion.angleTo(originals[i]) < 1e-6));
});

test('short entrances lock input, announce Round/Fight and leave timer and combat state fresh', () => {
  const match = new Match({ quickIntro: true }); const stages = new Set();
  for (let i = 0; i < REEL.quickFightEnd; i++) {
    stages.add(reelAt(match.snapshot()).stage);
    assert.deepEqual(match.inputGate().allowInput, [false, false]);
    match.step([{ right: true, hp: true }, { left: true, lp: true }]);
    assert.ok(match.fighters.every(f => f.health === f.maxHealth));
  }
  assert.equal(match.phase, PHASE.FIGHT); assert.equal(match.timer, MATCH.timerTicks);
  assert.deepEqual([...stages], ['round', 'fight']);
  assert.equal(lakeEntranceCamera({ ...match.snapshot(), phase: 'intro' }), null);
});

test('first encounter keeps its full entrance; only opted-in repeat rounds are shortened', () => {
  const ordinary = new Match(), fastRounds = new Match({ quickRounds: true });
  assert.equal(fastRounds.snapshot().quickIntro, false);
  ordinary.startRound(); fastRounds.startRound();
  assert.equal(ordinary.snapshot().quickIntro, false); assert.equal(fastRounds.snapshot().quickIntro, true);
  fastRounds.fighters.forEach(f => { f.roundsWon = fastRounds.roundsToWin - 1; });
  assert.equal(reelAt(fastRounds.snapshot()).text, 'FINAL ROUND');
});

test('full and short entrances produce identical combat outcomes for the same subsequent inputs', () => {
  const full = new Match(), short = new Match({ quickIntro: true });
  for (const m of [full, short]) while (m.phase === PHASE.INTRO) m.step([{}, {}]);
  for (let frame = 0; frame < 180; frame++) {
    const inputs = [{ right: frame < 20, lp: frame >= 22 && frame % 25 < 4 }, { block: frame >= 55 && frame < 90 }];
    assert.deepEqual(full.step(inputs), short.step(inputs));
    const a = full.snapshot(), b = short.snapshot(); delete a.quickIntro; delete b.quickIntro;
    assert.deepEqual(a, b);
  }
});
