import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE } from '../game/src/engine/match.js';
import { Fighter } from '../game/src/engine/fighter.js';
import { CommandResolver } from '../game/src/engine/commands.js';
import { CHORDS, DIRECTIONAL } from '../game/src/engine/moveList.js';
import { MOVES, MATCH } from '../game/src/engine/frameData.js';
import { REEL, reelAt, endCard } from '../game/src/engine/reelTimeline.js';
import { AUDIO_FILES } from '../game/src/game/audioManifest.js';
import { MUSIC_TRACKS } from '../game/src/game/fightAudio.js';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from '../game/src/vendor/three.module.js';
import { GLTFLoader } from '../game/src/vendor/GLTFLoader.js';
import { createRig, sampleClip } from '../fighter-tool/tools/fighterRig.mjs';
import { loadPose } from '../fighter-tool/tools/poseSidecar.mjs';
import { SPECIAL_CLIPS } from '../fighter-tool/tools/specialClips.mjs';

const stepF = (fighter, input = {}) => fighter.step({ input, allowInput: true, allowFinisher: false, events: [] });
const fighter = (side = 0) => { const f = new Fighter({ id: 'test', side }); f.state = 'idle'; return f; };

test('all eleven chords resolve identically, simultaneous or rolled, without stray singles', () => {
  assert.equal(CHORDS.length, 11);
  for (const c of CHORDS) for (const rolled of [false, true]) {
    const resolver = new CommandResolver(), input = {}, moves = [];
    for (let tick = 0; tick < 9; tick++) {
      for (let j = 0; j < c.buttons.length; j++) if (!rolled || tick >= j) input[c.buttons[j]] = true;
      const command = resolver.step(input);
      if (command.macro) moves.push(command.macro);
      assert.equal(command.attack, null, c.move);
    }
    assert.deepEqual(moves, [c.move]);
    assert.ok(MOVES[c.move]);
  }
});

test('both fighters can retreat, advance, crouch and jump in either world direction', () => {
  for (const side of [0, 1]) for (const direction of ['left', 'right']) {
    const f = fighter(side), x = f.x;
    stepF(f, { [direction]: true });
    assert.ok(direction === 'left' ? f.x < x : f.x > x);
    const air = fighter(side), start = air.x;
    stepF(air, { [direction]: true, up: true });
    assert.ok(air.y > 0);
    assert.ok(direction === 'left' ? air.x < start : air.x > start);
  }
  const f = fighter(); stepF(f, { down: true }); assert.equal(f.state, 'crouch');
  const x = f.x; stepF(f, { left: true, block: true }); assert.equal(f.x, x);
});

test('directional commands mirror with facing and select documented moves', () => {
  for (const side of [0, 1]) for (const c of DIRECTIONAL) {
    const f = fighter(side);
    const dir = c.direction === 'down' ? 'down' : ((c.direction === 'forward') === (f.facing > 0) ? 'right' : 'left');
    for (let i = 0; i < 4; i++) stepF(f, { [dir]: true, [c.button]: true });
    assert.equal(f.move, c.move);
  }
});

test('meter chords reject insufficient meter and debit only a successful start', () => {
  const f = fighter(); assert.equal(f.startMove('burstStrike'), false); assert.equal(f.move, null);
  f.meter = MATCH.meterUnitsPerStock * 2;
  assert.equal(f.startMove('burstStrike'), true); assert.equal(f.meter, 0);
});

test('pre-fight reel remains locked through the Fight slam and leaves timer untouched', () => {
  const m = new Match();
  const seen = new Set();
  for (let i = 0; i < MATCH.introFrames; i++) {
    seen.add(reelAt(m.snapshot()).stage);
    assert.deepEqual(m.inputGate().allowInput, [false, false]);
    m.step([{ hp: true, right: true }, { lp: true, left: true }]);
  }
  assert.equal(m.phase, PHASE.FIGHT); assert.equal(m.timer, MATCH.timerTicks);
  assert.deepEqual([...seen], ['versus', 'walkout', 'round', 'fight']);
});

test('simultaneous lethal active hits produce a real Double KO and retain impact state', () => {
  const m = new Match({ roundsToWin: 1 }); m.setPhase(PHASE.FIGHT);
  m.fighters.forEach((f, side) => { f.x = side ? 0.4 : -0.4; f.health = 1; f.startMove('lightPunch'); f.moveFrame = 3; });
  m.step([{}, {}]);
  assert.equal(m.roundReason, 'double'); assert.equal(m.phase, PHASE.ROUND_END);
  assert.ok(m.fighters.every(f => f.health === 0));
  assert.equal(endCard(m.snapshot()).kind, 'double');
  assert.ok(m.fighters.every(f => f.state !== 'victory'));
});

test('KO has 32 slow frames, a freeze, KO plate, then victory; pause is external', () => {
  const m = new Match(); m.fighters[0].state = 'attack'; m.fighters[0].move = 'heavyPunch';
  m.fighters[1].enterHitStun(24, false); m.fighters[1].health = 0; m.endRound(0, 'ko');
  for (const [frame, stage, scale] of [[0, 'slowmo', 0.2], [32, 'freeze', 0], [52, 'ko', 0], [100, 'roundVictory', undefined]]) {
    m.phaseFrame = frame; const edit = reelAt(m.snapshot()); assert.equal(edit.stage, stage); assert.equal(edit.scale, scale);
  }
  m.phaseFrame = REEL.koEnd - 1; m.step([{}, {}]); assert.equal(m.fighters[0].state, 'victory');
});

test('flawless and fatality end cards stay distinct, with fatality taking priority', () => {
  const m = new Match(); m.endRound(0, 'ko'); assert.equal(endCard(m.snapshot()).kind, 'flawless');
  m.fatality = true; assert.equal(endCard(m.snapshot()).kind, 'fatality');
});

test('successful finisher enters its locked cinematic immediately, without waiting for recovery', () => {
  const m = new Match(); m.roundWinner = 0; m.setPhase(PHASE.FINISHER_WINDOW);
  m.fighters[0].state = 'attack'; m.fighters[0].move = 'finisher';
  m.fighters[1].state = 'finished'; m.advancePhase();
  assert.equal(m.phase, PHASE.FINISHER); assert.deepEqual(m.inputGate().allowInput, [false, false]);
});

test('every audio manifest entry and requested music track exists in the runtime', () => {
  assert.equal(Object.keys(AUDIO_FILES).length, 77);
  for (const file of Object.values(AUDIO_FILES)) assert.ok(existsSync(new URL(`../game/public/audio/${file}`, import.meta.url)), file);
  for (const file of new Set(Object.values(MUSIC_TRACKS).map(track => track.file)))
    assert.ok(existsSync(new URL(`../game/public/music/${file}`, import.meta.url)), file);
});

for (const id of ['trump', 'carney']) test(`${id}: both model formats bind the full move supplement and keep its joints floor-safe`, async () => {
  const factory = await import(`../game/src/fighters/${id}/createFighterModel.js`);
  await factory.prewarm(); const packed = factory.createFighter();
  const buffer = readFileSync(new URL(`../game/public/fighters/${id}/${id}-rigged.glb`, import.meta.url));
  const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '', resolve, reject));
  const extras = await import(`../game/src/fighters/${id}/specialClips.js`);
  assert.equal(extras.SPECIAL_CLIPS.length, 12);
  const warning = console.warn; const warnings = []; console.warn = (...args) => warnings.push(args.join(' '));
  try {
    for (const root of [packed.group, gltf.scene]) {
      const mixer = new THREE.AnimationMixer(root);
      for (const data of extras.SPECIAL_CLIPS) {
        const clip = THREE.AnimationClip.parse(data);
        assert.ok(clip.validate(), data.name);
        const action = mixer.clipAction(clip); action.play(); mixer.update(MOVES[data.name].startup / 60);
        mixer.stopAllAction();
      }
    }
  } finally { console.warn = warning; packed.dispose(); }
  assert.deepEqual(warnings, []);
  const path = fileURLToPath(new URL(`../fighter-tool/build/${id}/${id}_joints.json`, import.meta.url));
  const measured = JSON.parse(readFileSync(path));
  const rig = createRig(measured.joints, measured.bounds, loadPose(path));
  for (const clip of SPECIAL_CLIPS) for (const [t, pose] of sampleClip(clip, rig))
    for (const joint of rig.fk(pose).list.slice(1)) assert.ok(rig.toView(joint.pos)[1] >= 0.0139, `${clip.name} at ${t}`);
});
