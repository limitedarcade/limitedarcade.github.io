import test from 'node:test';
import assert from 'node:assert/strict';
import { Fighter } from '../game/src/engine/fighter.js';
import { PHYSICS } from '../game/src/engine/frameData.js';
import { DirectionTapBuffer } from '../game/src/engine/movementInput.js';

const fighter = (side = 0) => {
  const f = new Fighter({ id: 'practice', side }); f.state = 'idle'; return f;
};
const tick = (f, input = {}, allowInput = true) => {
  const events = [];
  f.step({ input, allowInput, allowFinisher: false, opponentX: f.side === 0 ? 3 : -3, events });
  return events;
};
const advance = (f, frames, input = {}) => { for (let n = 0; n < frames; n++) tick(f, input); };
const tapTwice = (f, direction) => { tick(f, { [direction]: true }); tick(f); return tick(f, { [direction]: true }); };

test('double tap requires two distinct presses within its window', () => {
  const buffer = new DirectionTapBuffer(PHYSICS.doubleTapFrames);
  for (let frame = 0; frame < 40; frame++) assert.equal(buffer.step({ right: true }, 1), null);
  buffer.step({}, 1);
  assert.equal(buffer.step({ right: true }, 1), null, 'a long-held first press has expired');
  buffer.step({}, 1);
  assert.equal(buffer.step({ right: true }, 1), 'sprint');
  for (let frame = 0; frame < 15; frame++) assert.equal(buffer.step({ right: true }, 1), null);
});

test('opposite directions, side switches and committed frames clear tap history', () => {
  for (const interruption of [
    b => b.step({ left: true }, 1),
    b => b.step({}, -1),
    b => b.step({}, 1, false),
    b => b.step({ down: true }, 1),
    b => b.step({ block: true }, 1),
    b => b.step({ left: true, right: true }, 1),
  ]) {
    const b = new DirectionTapBuffer();
    b.step({ right: true }, 1); b.step({}, 1); interruption(b); b.step({}, 1);
    assert.equal(b.step({ right: true }, 1), null);
  }
});

test('holding through a side switch cannot manufacture a first tap', () => {
  const b = new DirectionTapBuffer();
  for (let n = 0; n < 20; n++) b.step({ right: true }, 1);
  b.step({ right: true }, -1); b.step({}, -1);
  assert.equal(b.step({ right: true }, -1), null);
});

test('a directional attack takes priority over a back-hop chord-window conflict', () => {
  const f = fighter();
  tick(f, { left: true }); tick(f);
  advance(f, 4, { left: true, lk: true });
  assert.equal(f.state, 'attack'); assert.equal(f.move, 'retreatKick'); assert.equal(f.airborne, false);
});

for (const side of [0, 1]) {
  const forward = side === 0 ? 'right' : 'left', back = side === 0 ? 'left' : 'right';
  test(`side ${side}: double-forward sprints, release/block/crouch/attack interrupt`, () => {
    const f = fighter(side), events = tapTwice(f, forward);
    assert.equal(f.state, 'sprint'); assert.ok(events.some(e => e.type === 'sprint'));
    const x = f.x; tick(f, { [forward]: true });
    assert.ok(Math.abs(f.x - x) > f.physics.walkForward / 60 * 2);
    tick(f); assert.equal(f.state, 'idle');
    tapTwice(f, forward); tick(f, { [forward]: true, block: true }); assert.equal(f.state, 'blockStand');
    tick(f); tapTwice(f, forward); tick(f, { [forward]: true, down: true }); assert.equal(f.state, 'crouch');
    tick(f); tapTwice(f, forward); advance(f, 4, { [forward]: true, lp: true });
    assert.equal(f.state, 'attack'); assert.equal(f.move, 'lightPunch');
  });

  test(`side ${side}: double-back hops without cancelling into a jump or attack`, () => {
    const f = fighter(side), x = f.x;
    tapTwice(f, back); assert.equal(f.state, 'backHop'); assert.ok(f.airborne);
    const direction = -f.facing;
    for (let frame = 0; frame < 8; frame++) {
      tick(f, { up: true, hp: frame % 2 === 0, block: true });
      assert.equal(f.state, 'backHop'); assert.equal(f.blockStance(), null);
    }
    assert.ok((f.x - x) * direction > 0.5);
    for (let frame = 0; frame < 60 && f.state !== 'landing'; frame++) tick(f);
    assert.equal(f.state, 'landing'); assert.equal(f.y, 0); assert.equal(f.airborne, false);
    advance(f, PHYSICS.landRecovery); assert.equal(f.state, 'idle');
  });

  test(`side ${side}: remain down, then choose either roll or guarded stand`, () => {
    for (const choice of ['stand', 'forward', 'back']) {
      const f = fighter(side);
      f.enterHitStun(12, true);
      advance(f, PHYSICS.knockdownFrames + 100);
      assert.equal(f.state, 'downed'); assert.equal(f.recoveryReady, true);
      const x = f.x;
      tick(f, { down: true, [forward]: true, up: true, lp: true });
      assert.equal(f.state, 'downed', 'Down deliberately suppresses recovery');
      const input = choice === 'stand' ? { block: true } : { [choice === 'forward' ? forward : back]: true };
      tick(f, input); assert.equal(f.state, 'getUp'); assert.equal(f.recovery, choice);
      assert.equal(f.isStrikeInvulnerable(), true);
      advance(f, PHYSICS.wakeInvulnerableFrames, input); assert.equal(f.isStrikeInvulnerable(), false);
      advance(f, f.stunFrames - f.stateFrame, input);
      assert.equal(f.state, choice === 'stand' ? 'blockStand' : 'idle');
      const displacement = f.x - x;
      if (choice === 'stand') assert.equal(displacement, 0);
      else assert.ok(Math.abs(displacement - (choice === 'forward' ? f.facing : -f.facing) * PHYSICS.rollDistance) < 1e-8);
    }
  });
}

test('airborne hit reactions stay helpless until landing, and round reset clears momentum/history', () => {
  const f = fighter(); f.enterJuggle({ velocity: 7, push: 0.5, fresh: true });
  for (let frame = 0; frame < 20; frame++) {
    tick(f, { lp: frame % 2 === 0, up: true, left: true, block: true });
    assert.equal(f.state, 'juggle'); assert.equal(f.blockStance(), null);
  }
  f.resetRound(-1); f.state = 'idle';
  assert.equal(f.jumpVX, 0); assert.equal(f.vy, 0); assert.equal(f.juggleHits, 0);
  tick(f, { right: true }); assert.equal(f.state, 'walkF');
});

test('inactive phases cannot queue a dash, and hops/rolls respect arena walls', () => {
  const f = fighter(); tick(f, { right: true }, false); tick(f, {}, false);
  tick(f, { right: true }); assert.equal(f.state, 'walkF');
  f.x = PHYSICS.arenaMin; tapTwice(f, 'left'); advance(f, 40);
  assert.ok(f.x >= PHYSICS.arenaMin);
  f.state = 'idle'; f.enterHitStun(10, true); advance(f, PHYSICS.knockdownFrames);
  tick(f, { left: true }); advance(f, PHYSICS.rollFrames);
  assert.ok(f.x >= PHYSICS.arenaMin);
});
