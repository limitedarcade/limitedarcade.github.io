import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE, PHYSICS } from '../game/src/engine/match.js';

function ready() {
  const match = new Match();
  match.phase = PHASE.FIGHT;
  match.left.state = match.right.state = 'idle';
  match.left.x = -0.35;
  match.right.x = 0.35;
  return match;
}

function tick(match, side = 0, input = {}, opponentInput = {}) {
  const inputs = [{}, {}];
  inputs[side] = input;
  inputs[1 - side] = opponentInput;
  return [...match.step(inputs)];
}

function until(match, predicate, { side = 0, input = {}, opponentInput = {}, limit = 200 } = {}) {
  const events = [];
  for (let frame = 0; frame < limit; frame++) {
    const next = tick(match, side, input, opponentInput);
    events.push(...next);
    if (predicate(next)) return events;
  }
  assert.fail(`Condition did not occur within ${limit} frames`);
}

function launch(match, side = 0, input = { down: true, hp: true }) {
  const events = until(match, events => events.some(e => e.type === 'hit'), { side, input });
  const hit = events.find(e => e.type === 'hit');
  assert.equal(hit.launched, true);
  assert.equal(match.fighters[1 - side].state, 'juggle');
  assert.equal(match.fighters[1 - side].juggleHits, 1);
  return hit;
}

function meleeAtContact(match, moveId, attackerSide = 0) {
  const attacker = match.fighters[attackerSide], defender = match.fighters[1 - attackerSide];
  attacker.x = defender.x - attacker.facing * 0.7;
  attacker.meter = 3 * 320;
  assert.equal(attacker.startMove(moveId), true);
  attacker.moveFrame = attacker.moveOf().startup;
  match.events.length = 0;
  match.resolveHits();
  return [...match.events];
}

function projectileAtContact(match, defender, { groundHit = false, count = 1, facing } = {}) {
  const attacker = match.opponentOf(defender);
  const move = attacker.moveOf('lightPunch');
  for (let i = 0; i < count; i++) match.projectiles.push({ id: ++match.nextProjectileId, owner: attacker.side,
    kind: 'testProjectile', x: defender.x, y: defender.y + 0.25,
    facing: facing ?? attacker.facing, speed: 0, radius: 0.1, life: 100, age: 0,
    move: { ...move, id: 'testProjectile', hit: { ...move.hit, groundHit } } });
  match.events.length = 0;
  match.stepWeapons();
  return [...match.events];
}

for (const side of [0, 1]) {
  test(`raw uppercut into jab creates a real airborne combo from side ${side}`, () => {
    const match = ready(), attacker = match.fighters[side], defender = match.fighters[1 - side];
    const first = launch(match, side);
    assert.equal(first.move, 'uppercut');
    until(match, () => attacker.isActionable(), { side });
    assert.equal(defender.airborne, true, 'launcher recovery must leave a follow-up window');
    const events = until(match, events => events.some(e => e.type === 'hit'), {
      side, input: { lp: true }, limit: 20,
    });
    const followup = events.find(e => e.type === 'hit');
    assert.equal(followup.move, 'lightPunch');
    assert.equal(followup.combo, 2);
    assert.equal(followup.juggleHits, 2);
    assert.equal(followup.juggle, true);
    assert.ok(followup.damage < attacker.moveOf('lightPunch').hit.damage);
    assert.ok(defender.vy > 0, 'a follow-up visibly pops the victim back up');
    assert.ok(defender.juggleGravity > PHYSICS.gravity);
    assert.equal(Math.sign(defender.jumpVX), attacker.facing);
    const finish = until(match, () => defender.isDowned(), { side });
    assert.equal(finish.filter(e => e.type === 'comboEnd').length, 1);
    assert.equal(finish.find(e => e.type === 'comboEnd').combo, 2);
    assert.equal(defender.comboCount, 0);
    assert.equal(defender.airborne, false);
  });
}

test('rising knee launches through the normal chord input', () => {
  const match = ready();
  const hit = launch(match, 0, { hp: true, lk: true });
  assert.equal(hit.move, 'risingKnee');
  assert.ok(match.right.vy > 0);
});

test('juggled fighters cannot attack, block, move, or jump free before landing', () => {
  const match = ready();
  launch(match);
  for (let frame = 0; frame < 150 && !match.right.isDowned(); frame++) {
    const input = frame % 8 < 4
      ? { up: true, right: true, lp: true, block: true }
      : { down: true, left: true, hp: true, lk: true };
    const events = tick(match, 0, {}, input);
    assert.equal(events.some(e => e.side === 1 && ['attack', 'jump'].includes(e.type)), false);
    assert.equal(match.right.blockStance(), null);
    if (match.right.airborne) assert.equal(match.right.state, 'juggle');
  }
  assert.equal(match.right.isDowned(), true);
  assert.equal(match.right.y, 0);
});

test('airborne hits gain less lift and stop connecting at the juggle cap', () => {
  const match = ready();
  match.right.enterJuggle({ velocity: PHYSICS.juggleLaunch, fresh: true });
  let previousLift = match.right.vy;
  for (let count = 2; count <= PHYSICS.maxJuggleHits; count++) {
    match.right.y = 0.5;
    const events = meleeAtContact(match, 'lightPunch');
    assert.equal(events.filter(e => e.type === 'hit').length, 1);
    assert.equal(match.right.juggleHits, count);
    assert.ok(match.right.vy < previousLift);
    previousLift = match.right.vy;
  }
  const health = match.right.health;
  assert.equal(meleeAtContact(match, 'uppercut').some(e => e.type === 'hit'), false);
  assert.equal(projectileAtContact(match, match.right).some(e => e.type === 'hit'), false);
  assert.equal(match.right.health, health);
  until(match, () => match.right.isDowned());
  assert.equal(match.right.juggleHits, 0);
  assert.equal(match.right.airborne, false);
});

test('floor strikes require an explicit ground hit and do not reset the recovery timer', () => {
  const match = ready(), defender = match.right;
  defender.enterHitStun(22, true);
  assert.equal(meleeAtContact(match, 'crouchKick').some(e => e.type === 'hit'), false,
    'initial knockdown protection prevents instant floor hits');
  defender.stateFrame = PHYSICS.knockdownProtectionFrames;
  const before = defender.health;
  // Ground Breaker overlaps the floor but is not a designated ground strike.
  assert.equal(meleeAtContact(match, 'groundBreaker').some(e => e.type === 'hit'), false);
  assert.equal(meleeAtContact(match, 'throw').some(e => e.type === 'hit'), false);
  const events = meleeAtContact(match, 'crouchKick');
  const hit = events.find(e => e.type === 'hit');
  assert.ok(hit);
  assert.equal(hit.damage, Math.round(match.left.moveOf('crouchKick').hit.damage * 0.45));
  assert.equal(defender.health, before - hit.damage);
  assert.equal(defender.stateFrame, PHYSICS.knockdownProtectionFrames);
  assert.equal(defender.state, 'knockdown');
  assert.equal(defender.airborne, false);
  assert.equal(hit.juggle, false);
  match.decayCombos();
  assert.equal(defender.comboCount, 0);
  defender.state = 'downed';
  defender.recovery = 'back';
  const second = meleeAtContact(match, 'crouchKick').find(e => e.type === 'hit');
  assert.equal(second.damage, hit.damage, 'waiting on the floor does not accumulate combo scaling');
  assert.equal(defender.state, 'downed');
  assert.equal(defender.recovery, 'back');
});

test('wake protection is bounded for strikes while throws cannot grab the recovery', () => {
  const match = ready(), defender = match.right;
  defender.state = 'getUp';
  defender.stateFrame = PHYSICS.wakeInvulnerableFrames - 1;
  assert.equal(meleeAtContact(match, 'lightPunch').some(e => e.type === 'hit'), false);
  assert.equal(projectileAtContact(match, defender).some(e => e.type === 'hit'), false);
  defender.stateFrame = PHYSICS.wakeInvulnerableFrames;
  assert.equal(meleeAtContact(match, 'grab').some(e => e.type === 'hit'), false);
  assert.equal(meleeAtContact(match, 'throw').some(e => e.type === 'hit'), false);
  assert.equal(meleeAtContact(match, 'lightPunch').some(e => e.type === 'hit'), true);
});

test('projectiles share floor eligibility and interrupt only unprotected recovery frames', () => {
  const match = ready(), defender = match.right;
  defender.enterHitStun(22, true);
  defender.stateFrame = PHYSICS.knockdownProtectionFrames;
  assert.equal(projectileAtContact(match, defender).some(e => e.type === 'hit'), false);
  const floorHit = projectileAtContact(match, defender, { groundHit: true }).find(e => e.type === 'hit');
  assert.ok(floorHit);
  assert.equal(floorHit.grounded, true);
  assert.equal(defender.stateFrame, PHYSICS.knockdownProtectionFrames);
  match.projectiles.length = 0;
  defender.state = 'getUp';
  defender.stateFrame = PHYSICS.wakeInvulnerableFrames;
  assert.equal(projectileAtContact(match, defender).some(e => e.type === 'hit'), true);
});

test('projectile anti-air starts a juggle and simultaneous shots cannot exceed its limit', () => {
  const match = ready(), defender = match.right;
  until(match, () => defender.airborne, { opponentInput: { up: true } });
  const first = projectileAtContact(match, defender).find(e => e.type === 'hit');
  assert.ok(first);
  assert.equal(defender.state, 'juggle');
  assert.equal(defender.juggleHits, 1);
  defender.juggleHits = PHYSICS.maxJuggleHits - 1;
  const simultaneous = projectileAtContact(match, defender, { count: 2 });
  assert.equal(simultaneous.filter(e => e.type === 'hit').length, 1);
  assert.equal(defender.juggleHits, PHYSICS.maxJuggleHits);
  const health = defender.health;
  assert.equal(projectileAtContact(match, defender).some(e => e.type === 'hit'), false);
  assert.equal(defender.health, health);
});

test('grapples miss both a jumping fighter and a launched fighter', () => {
  const match = ready(), defender = match.right;
  until(match, () => defender.airborne, { opponentInput: { up: true } });
  for (const state of ['jump', 'juggle']) {
    if (state === 'juggle') defender.enterJuggle({ fresh: true });
    const health = defender.health;
    for (const move of ['grab', 'throw'])
      assert.equal(meleeAtContact(match, move).some(e => e.type === 'hit'), false);
    assert.equal(defender.state, state);
    assert.equal(defender.health, health);
  }
});

test('a projectile keeps its launch direction after its owner turns around', () => {
  const match = ready(), defender = match.right;
  until(match, () => defender.airborne, { opponentInput: { up: true } });
  const ownerFacing = match.left.facing;
  const hit = projectileAtContact(match, defender, { facing: -ownerFacing }).find(e => e.type === 'hit');
  assert.ok(hit);
  assert.equal(Math.sign(defender.jumpVX), -ownerFacing);
  assert.equal(hit.facing, -ownerFacing);
  assert.equal(match.left.facing, ownerFacing);
});

test('combat snapshots expose juggle and recovery state', () => {
  const match = ready();
  launch(match);
  const view = match.snapshot().fighters[1];
  assert.equal(view.juggleHits, 1);
  assert.equal(view.juggleGravity, match.right.juggleGravity);
  for (const key of ['recovery', 'recoveryReady', 'stunFrames'])
    assert.ok(Object.hasOwn(view, key), `snapshot missing ${key}`);
});
