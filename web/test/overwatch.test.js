import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE } from '../game/src/engine/match.js';
import { Fighter } from '../game/src/engine/fighter.js';
import { CpuController } from '../game/src/engine/ai.js';
import { BEAM, beamPhase, contactAt, muzzleAt, segmentHitsBox } from '../game/src/engine/overwatch.js';
import { combatKitFor } from '../game/src/fighters/combatKits.js';
import { directionalFor } from '../game/src/engine/moveList.js';
import { practiceMoves } from '../game/src/game/practice.js';
import { MATCH } from '../game/src/engine/frameData.js';

// Puts a Flock match in the fight phase with the two fighters placed by hand.
function fight({ left = -3, right = 2, guard = {} } = {}) {
  const m = new Match({ left: { id: 'officer_flock' }, right: { id: 'trump' }, roundsToWin: 1 });
  while (m.phase === PHASE.INTRO) m.step([{}, {}]);
  m.left.x = left; m.right.x = right;
  return { m, guard };
}

// Runs the summon and the whole drone timeline, returning the contact events.
function sweep({ m, guard }, frames = BEAM.total + 60) {
  assert.equal(m.left.startMove('droneSweep'), true);
  const seen = [];
  for (let f = 0; f < frames; f++) {
    for (const e of m.step([{}, guard])) {
      if (e.type === 'droneSummon' || e.type === 'droneBeat') seen.push(e.type === 'droneBeat' ? e.beat : 'summon');
      if ((e.type === 'hit' || e.type === 'block') && e.move === 'droneSweep') seen.push(e.type);
    }
  }
  return seen;
}

test('the summon outlives its own move and walks the drone through every beat', () => {
  const stage = fight();
  const beats = sweep(stage);
  assert.deepEqual(beats.filter(b => b !== 'hit' && b !== 'block'), ['summon', 'lock', 'fire', 'fade']);
  // The caster is standing again before the beam arrives. The drone's clock
  // starts at the summon frame, so what has to fit inside deploy-plus-lock is
  // the move's remainder after startup, not the whole move. That gap is the
  // move's real cost -- the recovery is punished long before the rake pays --
  // so it is worth asserting rather than assuming.
  const move = stage.m.left.moves.droneSweep;
  assert.ok(move.active + move.recovery < BEAM.deploy + BEAM.lock);
  assert.equal(stage.m.strike, null, 'the drone leaves when its timeline ends');
});

test('the rake is an overhead: standing guard chips, crouching guard eats it', () => {
  const standing = fight({ guard: { left: true, block: true } });
  assert.ok(sweep(standing).includes('block'));
  assert.equal(standing.m.right.health, MATCH.maxHealth - standing.m.left.moves.droneSweep.hit.chip);

  const crouching = fight({ guard: { left: true, down: true, block: true } });
  assert.ok(sweep(crouching).includes('hit'));
  assert.ok(crouching.m.right.health < MATCH.maxHealth - 100);
});

test('a fighter already on the floor passes under the rake', () => {
  // The one positional out. Everything standing is crossed by the diagonal
  // somewhere in the sweep, so if this stopped working the move would have no
  // answer at all except guard.
  const floored = fight();
  floored.m.right.enterHitStun(0, true);
  assert.ok(floored.m.right.isDowned());
  assert.ok(!sweep(floored, BEAM.total).some(b => b === 'hit' || b === 'block'));
  assert.equal(floored.m.right.health, MATCH.maxHealth);
});

test('the sweep runs from in front of the caster to the wall he is facing', () => {
  for (const [x, facing] of [[-3, 1], [3, -1]]) {
    const m = new Match({ left: { id: 'officer_flock' }, right: { id: 'trump' }, roundsToWin: 1 });
    while (m.phase === PHASE.INTRO) m.step([{}, {}]);
    m.left.x = x; m.right.x = x + facing * 4;
    // A fighter does not turn around mid-move, so the placement has to settle
    // through `faceOff` before the summon commits to a side.
    m.step([{}, {}]);
    assert.equal(m.left.facing, facing);
    m.left.startMove('droneSweep');
    for (let f = 0; f < BEAM.deploy + BEAM.lock + 2; f++) m.step([{}, {}]);
    const opening = m.snapshot().strike;
    assert.equal(opening.facing, facing);
    assert.ok(Math.abs(opening.contactX - (x + facing * 0.9)) < 0.2);
    // The muzzle trails the contact, and by little enough to stay on screen.
    assert.ok(Math.abs(opening.contactX - opening.muzzleX) < 1.4);
    for (let f = 0; f < BEAM.fire; f++) m.step([{}, {}]);
    const closing = m.snapshot().strike;
    assert.ok(closing === null || (closing.contactX - opening.contactX) * facing > 5);
  }
});

test('one drone at a time, and its cooldown is its own', () => {
  const { m } = fight();
  m.left.startMove('droneSweep');
  for (let f = 0; f < 20; f++) m.step([{}, {}]);
  const first = m.strike;
  m.left.cooldowns.overwatch = 0;
  m.left.startMove('droneSweep');
  for (let f = 0; f < 4; f++) m.step([{}, {}]);
  assert.equal(m.strike, first, 'a second summon does not stack a second rake');

  // Spending Overwatch must not cost a shuriken, and vice versa.
  const fresh = new Fighter({ id: 'officer_flock', side: 0 });
  fresh.state = 'idle';
  assert.equal(fresh.startMove('droneSweep'), true);
  assert.ok(fresh.cooldowns.overwatch > fresh.moves.lungePunch.cooldown);
  fresh.state = 'idle';
  assert.equal(fresh.startMove('lungePunch'), true);
});

test('Forward + LK reaches the summon for Flock and nobody else', () => {
  for (const [side, direction] of [[0, 'right'], [1, 'left']]) {
    const flock = new Fighter({ id: 'officer_flock', side });
    flock.state = 'idle';
    for (let f = 0; f < 4; f++) flock.step({ input: { [direction]: true, lk: true }, allowInput: true, allowFinisher: false, events: [] });
    assert.equal(flock.move, 'droneSweep', `side ${side}`);
  }
  // The shared tables must never hand a fighter a move its kit cannot answer.
  for (const id of ['trump', 'carney']) {
    const other = new Fighter({ id, side: 0 });
    other.state = 'idle';
    for (let f = 0; f < 4; f++) other.step({ input: { right: true, lk: true }, allowInput: true, allowFinisher: false, events: [] });
    assert.equal(other.move, 'lightKick', id);
  }
});

test('the kit command reaches the command list and the practice menu', () => {
  const officer = combatKitFor('officer_flock');
  assert.ok(directionalFor(officer).some(c => c.move === 'droneSweep'));
  assert.equal(directionalFor(combatKitFor('trump')).some(c => c.move === 'droneSweep'), false);
  const entry = practiceMoves({ id: 'officer_flock', kit: officer, moves: officer.moves }, 'capitol')
    .find(m => m.id === 'droneSweep');
  assert.deepEqual(entry.keys, ['forward', 'lk']);
  assert.equal(entry.group, 'Specials');
});

test('the CPU can call the drone, and only from zoning range', () => {
  let summons = 0;
  for (const seed of [11, 42, 99]) {
    const m = new Match({ left: { id: 'officer_flock' }, right: { id: 'carney' }, roundsToWin: 1 });
    const cpus = [0, 1].map(side => new CpuController({ side, difficulty: 'hard', seed }));
    for (let f = 0; f < 12000 && m.phase !== PHASE.MATCH_END; f++)
      for (const e of m.step([cpus[0].poll(m), cpus[1].poll(m)])) if (e.type === 'droneSummon') summons += 1;
  }
  assert.ok(summons > 0, 'the officer CPU never summoned');
});

test('beam geometry agrees with itself across the timeline', () => {
  assert.equal(BEAM.total, BEAM.deploy + BEAM.lock + BEAM.fire + BEAM.fade);
  assert.deepEqual(beamPhase(0).phase, 'deploy');
  assert.deepEqual(beamPhase(BEAM.deploy).phase, 'lock');
  assert.deepEqual(beamPhase(BEAM.deploy + BEAM.lock).phase, 'fire');
  assert.deepEqual(beamPhase(BEAM.total - 1).phase, 'fade');

  const strike = { fromX: -2, toX: 6, facing: 1 };
  assert.equal(contactAt(strike, 0), -2);
  assert.equal(contactAt(strike, 1), 6);
  // Eased, so the far half of the arena gets a readable beat of warning.
  assert.ok(contactAt(strike, 0.5) > (strike.fromX + strike.toX) / 2);

  const muzzle = muzzleAt(strike, 0);
  assert.ok(Math.abs(muzzle.x + BEAM.lead) < 1e-9);
  assert.equal(muzzle.y, BEAM.droneHeight);
  // Straight down the diagonal hits; a body a stride past the contact does not.
  assert.equal(segmentHitsBox(muzzle.x, muzzle.y, 0, 0, { xMin: -0.3, xMax: 0.3, yMin: 0, yMax: 1.86 }), true);
  assert.equal(segmentHitsBox(muzzle.x, muzzle.y, 0, 0, { xMin: 2, xMax: 2.6, yMin: 0, yMax: 1.86 }), false);
});
