import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../game/src/vendor/three.module.js';
import { GLTFLoader } from '../game/src/vendor/GLTFLoader.js';
import { buildLakeOutcomeClips } from '../game/src/render/lakeOutcomeClips.js';
import { LakeOutcomeDirector, lakeOutcomeActors } from '../game/src/render/lakeOutcomeDirector.js';
import { lakeEntranceCamera, lakeOutcomeCamera, returnOrbit } from '../game/src/render/lakeCameraDirector.js';
import { LAKE_OUTCOMES, stageOutcome, resultDuration } from '../game/src/engine/stageOutcomes.js';
import { FightCamera } from '../game/src/render/camera.js';
import { CinematicGrip } from '../game/src/render/cinematicGrip.js';
import { decodeClips } from '../game/src/render/binaryClips.js';

const ids = Object.keys(LAKE_OUTCOMES);
const snapshot = (a = 'carney', b = 'trump', winner = 0) => ({ stageId: 'lake-america', phase: 'matchEnd',
  round: 1, winner, phaseFrame: 0, distance: 4, fighters: [a, b].map((id, i) => ({ id, x: i ? 2 : -2, y: 0, facing: i ? -1 : 1, state: i === winner ? 'victory' : 'defeat' })) });

test('every Lake fighter has win and lose choreography on either side; other stages and draws retain their timing', () => {
  for (const id of ids) for (const side of [0, 1]) {
    const s = snapshot(id, id, side), before = structuredClone(s);
    assert.ok(stageOutcome(s)); assert.equal(resultDuration(s), 600);
    for (const frame of [0, 120, 240, 450, 600]) {
      const actors = lakeOutcomeActors(s, s.fighters, frame);
      assert.equal(actors[side].cinematicClip, 'lakeAmericaWin');
      assert.equal(actors[1 - side].cinematicClip, 'lakeAmericaLose');
      assert.ok(actors.every(a => [a.x, a.y, a.z, a.clipTime].every(Number.isFinite)));
    }
    assert.deepEqual(s, before);
    assert.equal(stageOutcome({ ...s, stageId: 'capitol' }), null);
    assert.equal(stageOutcome({ ...s, phase: 'fight' }), null);
    assert.equal(resultDuration({ ...s, winner: null }), 210);
  }
});

test('finisher victims retain their final pose and submerged position', () => {
  const s = snapshot(); s.finisher = { kind: 'stage' };
  s.fighters[1] = { ...s.fighters[1], y: -2.8, cinematicClip: 'defeat', clipTime: 2, cinematicTurn: 1.2 };
  const actors = lakeOutcomeActors(s, s.fighters, 450);
  assert.deepEqual(actors[1], { ...s.fighters[1], z: 0 });
  assert.equal(actors[0].cinematicClip, 'lakeAmericaWin');
});

test('entrance and ending reach 180 degrees and return without crossing the orbit center', () => {
  const s = { ...snapshot(), phase: 'intro' };
  assert.equal(lakeEntranceCamera({ ...s, phaseFrame: 155 }).orbit, Math.PI);
  assert.equal(returnOrbit(335, 0, 155, 335), 0);
  assert.equal(lakeEntranceCamera({ ...s, phaseFrame: 335 }), null);
  assert.equal(lakeEntranceCamera(s, { reducedMotion: true }), null);
  const winner = { x: -2.2, z: -1.5 }, loser = { x: 2, z: 0 };
  const reverse = lakeOutcomeCamera(414, winner, loser), home = lakeOutcomeCamera(552, winner, loser);
  assert.ok(reverse.position[2] < winner.z - 6.9); assert.ok(home.position[2] > winner.z + 6.9);
  for (let frame = 0; frame <= 600; frame++) {
    const shot = lakeOutcomeCamera(frame, winner, loser);
    assert.ok([...shot.position, ...shot.target].every(Number.isFinite));
    assert.ok(shot.position[1] >= .75);
    if (frame >= 312) assert.ok(Math.abs(Math.hypot(shot.position[0] - winner.x, shot.position[2] - winner.z) - 7) < 1e-8);
    assert.deepEqual(lakeOutcomeCamera(frame, winner, loser, { reducedMotion: true }), lakeOutcomeCamera(0, winner, loser, { reducedMotion: true }));
  }
  const camera = new THREE.PerspectiveCamera(), rig = new FightCamera(camera); rig.setViewport(390, 844);
  const shot = lakeOutcomeCamera(400, winner, loser, { reducedMotion: true, aspect: camera.aspect });
  rig.update(0, snapshot(), { reducedMotion: true, shot });
  assert.deepEqual(camera.position.toArray(), shot.position);
});

test('narrow preview panes retain full entrance and ending orbits in the actual camera rig', () => {
  for (const [width, height] of [[360, 800], [600, 900], [960, 900], [1440, 900]]) {
    const camera = new THREE.PerspectiveCamera(), rig = new FightCamera(camera); rig.setViewport(width, height);
    const options = { portrait: rig.portrait, aspect: camera.aspect };
    const s = { ...snapshot(), phase: 'intro' };
    const entrance = frame => {
      const shot = lakeEntranceCamera({ ...s, phaseFrame: frame }, options);
      assert.ok(shot, `${width}px must retain the entrance camera`);
      rig.update(1 / 60, s, { shot }); return camera.position.clone();
    };
    const front = entrance(0), reverse = entrance(155), home = entrance(334);
    assert.ok(front.z > 7 && reverse.z < -7 && home.z > 7);
    assert.ok(front.distanceTo(reverse) > 16);
    const winner = { x: -2.2, z: -1.5 }, loser = { x: 2, z: 0 };
    const ending = frame => {
      const shot = lakeOutcomeCamera(frame, winner, loser, options);
      assert.ok(!shot.static);
      rig.update(0, snapshot(), { shot }); return camera.position.clone();
    };
    assert.ok(ending(0).distanceTo(ending(107)) > 4, 'defeat shot visibly arcs immediately');
    assert.ok(ending(108).distanceTo(ending(251)) > 8, 'winner shot sweeps and cranes before the sign reveal');
    assert.ok(ending(414).z < winner.z - 6.9);
    assert.ok(ending(552).z > winner.z + 6.9);
    // The nameplate still fits horizontally during the insert on a phone.
    ending(300); camera.updateMatrixWorld(true);
    for (const x of [-8.2, -4.8]) {
      const point = new THREE.Vector3(x, 1.45, -11.2).project(camera);
      assert.ok(Math.abs(point.x) < 1, `${width}px crops the sign`);
    }
  }
});

const flock = readFile(new URL('../game/public/fighters/officer_flock/model.json', import.meta.url), 'utf8').then(JSON.parse);
test('all six outcome clips have finite, normalized skeletal tracks and distinct authored motion', async () => {
  const data = await flock;
  const signatures = new Set();
  for (const id of ids) {
    let clips, built;
    if (id === 'officer_flock') clips = Object.fromEntries(data.animations.map(c => [c.name, THREE.AnimationClip.parse(c)]));
    else {
      const factory = await import(`../game/src/fighters/${id}/createFighterModel.js`);
      await factory.prewarm(); built = factory.createFighter(); clips = { ...built.clipMap };
      for (const file of ['combat.bin', ...(id === 'carney' ? ['motion.bin'] : [])]) {
        const bytes = await readFile(new URL(`../game/public/fighters/${id}/${file}`, import.meta.url));
        for (const clip of decodeClips(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))) clips[clip.name] = clip;
      }
      const bytes = await readFile(new URL(`../game/public/fighters/${id}/mocap.glb`, import.meta.url));
      const mocap = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
      for (const clip of mocap.animations) clips[clip.name] = clip;
    }
    const result = buildLakeOutcomeClips(id, clips);
    assert.deepEqual(result.map(c => c.name), ['lakeAmericaWin', 'lakeAmericaLose']);
    for (const clip of result) {
      assert.equal(clip.duration, 10); assert.ok(clip.tracks.length > 10);
      assert.ok(clip.validate());
      for (const track of clip.tracks) {
        if (built) assert.ok(built.group.getObjectByName(THREE.PropertyBinding.parseTrackName(track.name).nodeName), `missing ${id} binding ${track.name}`);
        assert.ok([...track.values].every(Number.isFinite));
        if (track.ValueTypeName === 'quaternion') for (let i = 0; i < track.values.length; i += 4)
          assert.ok(Math.abs(Math.hypot(...track.values.slice(i, i + 4)) - 1) < .00001);
      }
      signatures.add(JSON.stringify(clip.tracks.map(track => [...track.values])));
    }
    built?.dispose();
  }
  assert.equal(signatures.size, 6);
});

test('Flock salute reaches his own head with reversible arm constraints', async () => {
  const data = structuredClone(await flock);
  for (const image of data.images || []) image.url = { data: [255,255,255,255], width: 1, height: 1, type: 'Uint8Array' };
  const model = new THREE.ObjectLoader().parse(data), grip = new CinematicGrip(); model.updateMatrixWorld(true);
  let hand, head, upper;
  model.traverse(o => { if (/RightHand_/.test(o.name) && o.isBone) hand = o; if (/Head_/.test(o.name) && o.isBone) head = o; if (/RightArm_/.test(o.name) && o.isBone) upper = o; });
  assert.ok(hand && head && upper);
  const before = upper.quaternion.clone(), target = head.getWorldPosition(new THREE.Vector3());
  assert.ok(grip.apply(model, target, target.clone().add(new THREE.Vector3(50,-40,0)), 'R'));
  assert.ok(hand.getWorldPosition(new THREE.Vector3()).distanceTo(target) < .01);
  grip.restore(); assert.ok(upper.quaternion.equals(before));
});

test('the real Blender sign changes, scrubs backward, and restores on rematch without accumulating props', async () => {
  const bytes = await readFile(new URL('../game/public/stages/lake-america-3d/lake-america.glb', import.meta.url));
  const { scene: group } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  const previousDocument = globalThis.document;
  const context = { fillRect(){}, strokeRect(){}, fillText(){} };
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const scene = new THREE.Scene(), stage = { group, generation: 1 };
    const director = new LakeOutcomeDirector(scene, stage), sign = group.getObjectByName('lake-america-trail-sign');
    const original = sign.rotation.clone(), count = sign.children.length;
    for (const id of ids) {
      const s = snapshot(id); s.phaseFrame = 300;
      director.update(s, s.fighters);
      assert.equal(sign.children.length, count + 1); assert.equal(director.plate.visible, true);
      assert.equal(director.labels.length, 2); assert.ok(director.labels.every(([o]) => !o.visible));
      s.phaseFrame = 0; director.update(s, s.fighters);
      assert.equal(director.plate.visible, false); assert.ok(director.labels.every(([o, visible]) => o.visible === visible));
      director.update({ ...s, phase: 'intro' }, s.fighters);
      assert.equal(sign.children.length, count); assert.deepEqual(sign.rotation.toArray(), original.toArray()); assert.equal(scene.children.length, 0);
    }
  } finally { globalThis.document = previousDocument; }
});
