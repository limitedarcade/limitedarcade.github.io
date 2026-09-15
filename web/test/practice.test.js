import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE } from '../game/src/engine/match.js';
import { practiceMoves, preparePractice, demonstrationInput, sustainPractice } from '../game/src/game/practice.js';

for (const id of ['trump', 'carney', 'officer_flock', 'lang']) {
  test(`${id}: every listed demonstration performs its real move or finisher`, () => {
    const m = new Match({ left: { id }, right: { id: 'carney' }, hazards: false });
    for (const entry of practiceMoves(m.left, 'lake-america')) {
      assert.ok(entry.keys.length, `${entry.id} needs playable inputs`);
      preparePractice(m, entry);
      let performed = false;
      for (let frame = 0; frame < 750; frame++) {
        sustainPractice(m, entry);
        const events = m.step([demonstrationInput(entry, frame, m.left.facing), {}]);
        if (entry.group === 'Finishers') performed ||= events.some(e => e.type === 'finisherStart' && e.finisherId === entry.id);
        else if (entry.id === 'stageAxe') performed ||= m.projectiles.some(p => p.kind === 'axe');
        // A chain lesson has no move id of its own; the attack that proves it is its ender.
        else performed ||= events.some(e => e.type === 'attack' && e.side === 0 && e.move === (entry.ends || entry.id));
      }
      assert.ok(performed, `${id}: ${entry.id} demonstration never performed`);
    }
  });
}
test('training sustains health, meter and clock; reset clears cinematic and damage state', () => {
  const m = new Match(); preparePractice(m);
  for (let i = 0; i < 7000; i++) { sustainPractice(m); m.step([{}, { hp: i % 90 < 9 }]); }
  assert.equal(m.phase, PHASE.FIGHT); assert.ok(m.timer >= 98); assert.equal(m.left.meterStocks, 3);
  const entry = practiceMoves(m.left, 'lake-america').find(e => e.group === 'Finishers');
  preparePractice(m, entry); assert.equal(m.phase, PHASE.FINISHER_WINDOW);
  preparePractice(m); assert.equal(m.finisher, null); assert.equal(m.right.health, m.right.maxHealth);
});
