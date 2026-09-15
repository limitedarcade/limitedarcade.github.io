import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE } from '../game/src/engine/match.js';
import { HAZARD_RULES, STAGE_HAZARD_KINDS } from '../game/src/engine/stageHazards.js';

function arena(stageId = 'lake-america', hazards = true) {
  const match = new Match({ hazards, stageId, roundsToWin: 1 });
  match.setPhase(PHASE.FIGHT);
  match.fighters.forEach(f => { f.state = 'idle'; });
  return match;
}
function step(match, count = 1) {
  const events = [];
  for (let frame = 0; frame < count; frame++) events.push(...match.step([{}, {}]));
  return events;
}

test('hazards are opt-in, warn for fifty full ticks, and strike each zone only once', () => {
  const safe = arena('lake-america', false);
  safe.left.x = -2.6;
  assert.ok(!step(safe, 1000).some(event => event.type.startsWith('hazard')));
  assert.equal(safe.left.health, safe.left.maxHealth);
  assert.equal(safe.snapshot().hazard, null);

  const match = arena(); match.left.x = -2.6;
  step(match, 599); assert.equal(match.snapshot().hazard, null);
  const events = step(match);
  assert.equal(events.find(event => event.type === 'hazardWarning').remaining, 50);
  assert.equal(match.snapshot().hazard.x, -2.6);
  assert.equal(match.snapshot().hazard.radius, HAZARD_RULES.radius);
  step(match, 49);
  assert.equal(match.snapshot().hazard.remaining, 1);
  assert.equal(match.left.health, match.left.maxHealth, 'telegraph itself deals no damage');
  const strike = step(match).find(event => event.type === 'hazardHit');
  assert.equal(strike.damage, 40); assert.equal(strike.defender, 0); assert.equal(strike.ko, false);
  assert.equal(match.left.state, 'hitStun'); assert.equal(match.snapshot().hazard, null);
  assert.ok(!step(match, 20).some(event => event.type === 'hazardHit'));
  assert.equal(match.left.health, match.left.maxHealth - 40);
});

test('outside the marked zone and airborne fighters avoid the burst', () => {
  for (const airborne of [false, true]) {
    const match = arena(); step(match, 649);
    match.left.x = airborne ? -2.6 : -2.6 + HAZARD_RULES.radius + 0.01;
    if (airborne) { match.left.y = 1; match.left.airborne = true; match.left.state = 'jump'; match.left.vy = 0; }
    const events = step(match);
    assert.ok(events.some(event => event.type === 'hazardBurst'));
    assert.ok(!events.some(event => event.type === 'hazardHit'));
    assert.equal(match.left.health, match.left.maxHealth);
  }
});

test('every arena exposes its hazard kind and cycles through fixed bounded zones', () => {
  for (const [stageId, kind] of Object.entries(STAGE_HAZARD_KINDS)) {
    const match = arena(stageId);
    const warnings = step(match, 1800).filter(event => event.type === 'hazardWarning');
    assert.deepEqual(warnings.map(event => event.x), [-2.6, 2.6, 0]);
    assert.ok(warnings.every(event => event.kind === kind && event.stageId === stageId));
    assert.equal(match.snapshot().hazard.kind, kind);
  }
});

test('reels and hitstop suspend hazards; a fresh round clears an old telegraph', () => {
  const match = arena(); step(match, 620);
  const remaining = match.snapshot().hazard.remaining, ticks = match.hazards.ticks;
  match.hitStop = 5; step(match, 5);
  assert.equal(match.hazards.ticks, ticks); assert.equal(match.snapshot().hazard.remaining, remaining);
  match.setPhase(PHASE.INTRO); step(match, 30);
  assert.equal(match.hazards.ticks, ticks); assert.equal(match.snapshot().hazard, null);
  match.setPhase(PHASE.FIGHT);
  assert.equal(match.snapshot().hazard.remaining, remaining);
  match.startRound();
  assert.equal(match.hazards.ticks, 0); assert.equal(match.hazards.warning, null);
  assert.equal(match.snapshot().hazard, null);
});

test('lethal stage hits use ordinary KO flow and simultaneous victims produce Double KO', () => {
  for (const double of [false, true]) {
    const match = arena(); step(match, 649);
    match.left.x = -2.7; match.left.health = 12;
    if (double) { match.right.x = -2.0; match.right.health = 12; }
    const events = step(match), hits = events.filter(event => event.type === 'hazardHit');
    assert.equal(hits.length, double ? 2 : 1);
    assert.ok(hits.every(event => event.ko && event.damage === 12));
    assert.equal(match.phase, PHASE.ROUND_END);
    assert.equal(match.roundReason, double ? 'double' : 'ko');
    assert.equal(match.roundWinner, double ? null : 1);
    assert.equal(match.snapshot().hazard, null, 'the warning cannot leak into the KO reel');
  }
});
