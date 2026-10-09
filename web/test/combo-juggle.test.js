import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE, PHYSICS } from '../game/src/engine/match.js';
import { ComboPlayback } from '../game/src/engine/comboPlayback.js';
import { comboRoute } from '../game/src/engine/comboRoutes.js';

function wallReplay({ fighterId, kitId, side, wall }) {
  const actor = { id: fighterId, combatKit: kitId };
  const dummy = { id: 'dummy', combatKit: 'standard' };
  const match = new Match(side ? { left: dummy, right: actor, hazards: false }
    : { left: actor, right: dummy, hazards: false });
  match.setPhase(PHASE.FIGHT);
  const direction = wall === 'left' ? -1 : 1;
  const actorX = direction * (PHYSICS.arenaMax - 0.85);
  const defenderX = direction * PHYSICS.arenaMax;
  match.fighters[side].x = actorX;
  match.fighters[1 - side].x = defenderX;
  match.fighters.forEach(fighter => { fighter.state = 'idle'; });
  match.faceOff();
  const route = comboRoute('juggle-three-hit');
  const playback = new ComboPlayback({ route, actorSide: side, kitId });
  const trace = [];
  for (let tick = 0; tick < 360 && !playback.done; tick++) {
    const inputs = [{}, {}]; inputs[side] = playback.poll(match.snapshot());
    const events = match.step(inputs);
    trace.push(...events);
    playback.observe(events, match.snapshot());
  }
  return { match, playback, trace };
}

for (const [fighterId, kitId] of [['trump', 'breaker'], ['carney', 'strider'], ['officer_flock', 'officer']]) {
  for (const side of [0, 1]) for (const wall of ['left', 'right']) {
    test(`${fighterId} juggle remains finite at the ${wall} wall from side ${side}`, () => {
      const result = wallReplay({ fighterId, kitId, side, wall });
      assert.equal(result.playback.state, 'finished', result.playback.reason);
      const hits = result.trace.filter(event => event.type === 'hit' && event.attacker === side);
      assert.deepEqual(hits.map(event => event.move), ['uppercut', 'lightPunch', 'heavyPunch']);
      assert.deepEqual(hits.map(event => event.juggleHits), [1, 2, 3]);
      assert.ok(hits.at(-1).comboDamage < 300);
    });
  }
}

function contact(match, moveId) {
  const attacker = match.left, defender = match.right;
  attacker.x = defender.x - attacker.facing * 0.7;
  assert.equal(attacker.startMove(moveId), true);
  attacker.moveFrame = attacker.moveOf().startup;
  match.events.length = 0;
  match.resolveHits();
  return [...match.events];
}

test('repeat launchers consume the same five-contact juggle budget', () => {
  const match = new Match({ hazards: false });
  match.setPhase(PHASE.FIGHT);
  match.left.state = match.right.state = 'idle';
  match.left.x = -0.35; match.right.x = 0.35;
  assert.ok(contact(match, 'uppercut').some(event => event.launched));
  for (let expected = 2; expected <= PHYSICS.maxJuggleHits; expected++) {
    match.right.y = 0.55;
    const events = contact(match, expected === 2 ? 'uppercut' : 'lightPunch');
    assert.equal(events.filter(event => event.type === 'hit').length, 1);
    assert.equal(match.right.juggleHits, expected);
  }
  const health = match.right.health;
  match.right.y = 0.55;
  assert.equal(contact(match, 'uppercut').some(event => event.type === 'hit'), false);
  assert.equal(match.right.health, health);
});

