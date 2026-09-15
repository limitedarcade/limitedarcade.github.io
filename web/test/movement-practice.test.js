import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../game/src/engine/match.js';
import { MOVEMENT_LESSONS, preparePractice, sustainPractice, demonstrationInput, practiceDummyInput } from '../game/src/game/practice.js';

for (const id of ['trump', 'carney', 'officer_flock']) {
  test(`${id}: every movement lesson demonstrates its real controls`, () => {
    for (const entry of MOVEMENT_LESSONS) {
      const m = new Match({ left: { id }, right: { id: 'carney' } });
      preparePractice(m, entry);
      const seen = new Set(), states = new Set();
      let downFrames = 0;
      for (let frame = 0; frame < 240; frame++) {
        sustainPractice(m, entry);
        const events = m.step([demonstrationInput(entry, frame, m.left.facing, m), practiceDummyInput(m, entry, 'idle', frame)]);
        states.add(m.left.state);
        if (m.left.state === 'downed') downFrames++;
        for (const e of events) {
          seen.add(e.type);
          if (e.type === 'hit' && e.juggleHits > 1) seen.add('followup');
        }
      }
      if (entry.id === 'lesson-sprint') assert.ok(seen.has('sprint'));
      if (entry.id === 'lesson-backhop') assert.ok(seen.has('backHop'));
      if (entry.id === 'lesson-recovery') { assert.ok(downFrames >= 30); assert.ok(seen.has('recovery')); assert.ok(states.has('idle')); }
      if (entry.id === 'lesson-juggle') assert.ok(seen.has('followup'), `${id}: demonstration needs an actual airborne follow-up`);
    }
  });
}

test('standing practice dummy recovers after a knockdown without jumping or attacking', () => {
  const m = new Match(); preparePractice(m); m.right.enterHitStun(0, true);
  for (let frame = 0; frame < 160; frame++) {
    sustainPractice(m);
    const events = m.step([{}, practiceDummyInput(m, null, 'idle', frame)]);
    assert.ok(!events.some(e => ['jump', 'attack'].includes(e.type) && e.side === 1));
  }
  assert.equal(m.right.state, 'idle');
});
