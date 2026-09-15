import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../game/src/vendor/three.module.js';
import { getFighter } from '../game/src/fighters/catalog.js';
import { Fighter } from '../game/src/engine/fighter.js';
import { Match, PHASE } from '../game/src/engine/match.js';
import { CpuController } from '../game/src/engine/ai.js';
import { practiceMoves } from '../game/src/game/practice.js';
import { decodeModelPack } from '../game/src/render/modelPack.js';
import { decodeModel, buildFighter } from '../game/src/fighters/_shared/meshCodec.js';

test('Lang has no inherited heavy hits, grabs, chip, launches or damaging dodges', () => {
  const { combat } = getFighter('lang');
  assert.equal(combat.id, 'flincher');
  for (const move of Object.values(combat.moves)) {
    assert.ok(move.hit.damage <= 28, move.id);
    assert.equal(move.hit.chip, 0);
    assert.equal(move.hit.knockdown, false);
    assert.equal(move.hit.launch, 0);
    assert.notEqual(move.hit.level, 'throw');
    if (move.travel < 0 || move.guardWindow) {
      assert.equal(move.active, 0); assert.equal(move.hit.damage, 0);
    }
  }
});

test('panic block is late, brief, level-specific, and cannot protect an airborne fighter', () => {
  const f = new Fighter({ id: 'lang', side: 0 });
  f.state = 'attack'; f.move = 'powerStrike';
  f.moveFrame = 13; assert.equal(f.blockStance(), null);
  f.moveFrame = 14; assert.equal(f.blockStance(), 'stand');
  f.moveFrame = 23; assert.equal(f.blockStance(), null);
  f.move = 'cyclone'; f.moveFrame = 16; assert.equal(f.blockStance(), 'crouch');
  f.airborne = true; assert.equal(f.blockStance(), null);
  f.airborne = false; f.move = 'retreatKick'; assert.equal(f.isStrikeInvulnerable(), false);
});

test('Personal Space swats without entering the universal damaging clinch', () => {
  const match = new Match({ left: { id: 'lang' } });
  match.phase = PHASE.FIGHT;
  const [a, b] = match.fighters;
  a.x = -0.31; b.x = 0.31; a.facing = 1; b.facing = -1;
  a.state = 'attack'; a.move = 'grab'; a.moveFrame = a.moveOf().startup;
  b.state = 'idle'; match.resolveHits();
  assert.equal(b.health, b.maxHealth - a.moves.grab.hit.damage);
  assert.notEqual(a.state, 'grabbing'); assert.notEqual(b.state, 'grabbed');
});

test('Lang cannot turn his tiny uppercut into the universal brutality', () => {
  const match = new Match({ left: { id: 'lang' }, roundsToWin: 1 });
  match.phase = PHASE.FIGHT;
  const [a, b] = match.fighters;
  a.x = -0.31; b.x = 0.31; a.facing = 1;
  a.state = 'attack'; a.move = 'uppercut'; a.moveFrame = a.moveOf().startup;
  b.state = 'idle'; b.health = 1; b.comboCount = 2;
  match.resolveHits();
  assert.equal(b.health, 0); assert.equal(match.pendingBrutality, null);
  assert.ok(!practiceMoves(a, 'lake-america').some(move => move.kind === 'brutality'));
});

test('shipped Lang pack has valid bespoke motion for every move and preserves its costume', () => {
  const bytes = readFileSync(new URL('../game/public/fighters/lang/fighter.bin', import.meta.url));
  const pack = decodeModelPack(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
  const parts = decodeModel(pack.model, pack.stream);
  assert.equal(parts.length, 6);
  assert.equal(parts.reduce((n, p) => n + p.index.length / 3, 0), 150000);
  const built = buildFighter(THREE, pack.model, null, pack.rig, { decodedParts: parts });
  for (const clip of built.clips) assert.ok(clip.validate(), clip.name);
  for (const move of Object.values(getFighter('lang').combat.moves)) {
    const clip = built.clipMap[move.clip];
    assert.ok(clip, move.clip);
    assert.ok(Math.abs(clip.duration - (move.startup + move.active + move.recovery) / 60) < 0.001);
    built.mixer.stopAllAction(); built.mixer.clipAction(clip).play();
    built.mixer.update(move.startup / 60); built.group.updateMatrixWorld(true);
    const wrist = built.group.getObjectByName('handL');
    assert.ok(wrist.getWorldPosition(new THREE.Vector3()).toArray().every(Number.isFinite));
  }
  // Marker-color exports have effectively one color per part. The costume
  // should have many sampled shades even after binary quantization.
  for (const part of parts) {
    const shades = new Set();
    for (let i = 0; i < part.colour.length; i += 30) shades.add(part.colour.slice(i, i + 3).join(','));
    assert.ok(shades.size > 30);
  }
  built.dispose();
});

test('Lang can complete a CPU match without invalid combat states', () => {
  const match = new Match({ left: { id: 'lang' }, right: { id: 'carney' }, roundsToWin: 1 });
  const cpus = [0, 1].map(side => new CpuController({ side, difficulty: 'normal', seed: 123 + side }));
  for (let i = 0; i < 18000 && match.phase !== PHASE.MATCH_END; i++) {
    match.step(cpus.map(cpu => cpu.poll(match)));
    for (const f of match.fighters) assert.ok(Number.isFinite(f.x) && Number.isFinite(f.health));
  }
  assert.equal(match.phase, PHASE.MATCH_END);
});
