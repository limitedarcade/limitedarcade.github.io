import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE, MATCH } from '../game/src/engine/match.js';
import { practiceMoves, preparePractice, demonstrationInput } from '../game/src/game/practice.js';

function setup(side = 0, distance = .84) {
  const match = new Match({ left: { id: side ? 'trump' : 'carney' }, right: { id: side ? 'carney' : 'trump' } });
  match.setPhase(PHASE.FIGHT);
  match.fighters.forEach((f, i) => { f.state = 'idle'; f.x = (i ? 1 : -1) * distance / 2; });
  return match;
}
function run(match, side, source, defender = () => ({}), frames = 90) {
  const events = [];
  for (let frame = 0; frame < frames; frame++) {
    const inputs = [{}, {}]; inputs[side] = source(frame); inputs[1 - side] = defender(frame);
    events.push(...match.step(inputs).map(e => ({ ...e, frame })));
  }
  return events;
}

for (const side of [0, 1]) for (const cadence of [6, 8, 10, 12, 14]) {
  test(`Carney three-tap chain tolerates ${cadence}-frame taps on side ${side}`, () => {
    const m = setup(side);
    const hits = run(m, side, t => ({ lp: t % cadence < 2 })).filter(e => e.type === 'hit' && e.attacker === side);
    assert.deepEqual(hits.slice(0, 3).map(e => e.move), ['lightPunch', 'bodyCheck', 'heavyKick']);
    assert.equal(hits[2].combo, 3);
    assert.ok(hits.reduce((n, e) => n + e.damage, 0) < 210, 'a short assisted chain cannot remove a huge fraction of the life bar');
  });
}
test('holding, blocking and whiffing never unlock an assisted chain', () => {
  const held = run(setup(), 0, () => ({ lp: true }));
  assert.deepEqual(held.filter(e => e.type === 'attack').map(e => e.move), ['lightPunch']);
  for (const [distance, guard] of [[.84, true], [4, false]]) {
    const events = run(setup(0, distance), 0, t => ({ lp: t % 8 < 2 }), () => ({ block: guard }));
    assert.ok(events.filter(e => e.type === 'attack').every(e => e.move === 'lightPunch'));
    assert.equal(events.filter(e => e.type === 'hit').length, 0);
  }
});
test('practice performs all three routes through real inputs, not injected hits', () => {
  const m = setup();
  const entries = practiceMoves(m.left, m.stageId).filter(e => e.comboButtons);
  assert.equal(entries.length, 3);
  for (const entry of entries) {
    preparePractice(m, entry);
    const hits = run(m, 0, frame => demonstrationInput(entry, frame, m.left.facing, m)).filter(e => e.type === 'hit');
    const expected = entry.id.endsWith('roundhouse') ? 'heavyKick' : entry.id.endsWith('axe') ? 'heelDrop' : 'spinKick';
    assert.equal(hits[2]?.move, expected, entry.id);
    assert.equal(hits[2]?.combo, 3, entry.id);
  }
});
test('Polar Reversal spends a real stock and cannot be mashed into existence without it', () => {
  const m = setup(), f = m.left;
  assert.equal(f.startMove('spinKick'), false);
  f.addMeter(MATCH.meterUnitsPerStock);
  assert.equal(f.startMove('spinKick'), true); assert.equal(f.meter, 0);
  assert.equal(f.startMove('spinKick'), false);
  assert.equal(f.moveOf('spinKick').recovery, 27);
  assert.equal(f.moveOf('spinKick').cancelInto.length, 0);
});
