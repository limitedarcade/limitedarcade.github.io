import test from 'node:test';
import assert from 'node:assert/strict';
import { Match, PHASE } from '../game/src/engine/match.js';
import { ComboPlayback } from '../game/src/engine/comboPlayback.js';
import { comboRoute } from '../game/src/engine/comboRoutes.js';

function ready({ left = { id: 'training', combatKit: 'standard' }, gap = 0.85 } = {}) {
  const match = new Match({ left, right: { id: 'dummy', combatKit: 'standard' }, hazards: false });
  match.setPhase(PHASE.FIGHT);
  match.fighters.forEach((fighter, side) => {
    fighter.state = 'idle';
    fighter.x = (side ? 1 : -1) * gap / 2;
  });
  return match;
}

function play(routeId, { kitId = 'standard', left, limit = 360 } = {}) {
  const route = comboRoute(routeId);
  const match = ready({ left: left || { id: kitId === 'strider' ? 'carney' : 'training', combatKit: kitId } });
  const playback = new ComboPlayback({ route, actorSide: 0, kitId });
  const trace = [];
  for (let tick = 0; tick < limit && (!playback.done || match.right.airborne || match.right.comboCount > 0); tick++) {
    const events = match.step([playback.poll(match.snapshot()), {}]);
    trace.push(...events.map(event => ({ ...event, tick })));
    playback.observe(events, match.snapshot());
  }
  return { match, playback, trace };
}

test('hit, route, landing, and combo-end events share stable identities', () => {
  const { trace, playback } = play('juggle-three-hit');
  assert.equal(playback.state, 'finished');
  const attacks = trace.filter(event => event.type === 'attack');
  const hits = trace.filter(event => event.type === 'hit');
  assert.equal(new Set(attacks.map(event => event.attackId)).size, 3);
  assert.deepEqual(hits.map(event => event.attackId), attacks.map(event => event.attackId));
  assert.equal(new Set(hits.map(event => event.comboId)).size, 1);
  assert.deepEqual(hits.map(event => event.combo), [1, 2, 3]);
  const completion = trace.find(event => event.type === 'comboRouteComplete'
    && event.routeId === 'juggle-three-hit');
  const landing = trace.filter(event => event.type === 'juggleLand');
  const ending = trace.filter(event => event.type === 'comboEnd');
  assert.equal(landing.length, 1);
  assert.equal(ending.length, 1);
  assert.equal(completion.comboId, hits[0].comboId);
  assert.equal(landing[0].comboId, hits[0].comboId);
  assert.equal(ending[0].comboId, hits[0].comboId);
  assert.equal(landing[0].combo, 3);
  assert.equal(landing[0].damage, hits.at(-1).comboDamage);
});

test('an actionable gap ends identity before a later matching hit', () => {
  const match = ready();
  const trace = [];
  let phase = 'lp-press';
  for (let tick = 0; tick < 180; tick++) {
    let input = {};
    if (phase === 'lp-press') { input = { lp: true }; phase = 'lp-release'; }
    else if (phase === 'lp-release') phase = 'wait-first';
    else if (phase === 'wait-gap' && match.right.isActionable()) phase = 'hp-press';
    else if (phase === 'hp-press') { input = { hp: true }; phase = 'hp-release'; }
    else if (phase === 'hp-release') phase = 'done';
    const events = match.step([input, {}]);
    trace.push(...events);
    if (phase === 'wait-first' && events.some(event => event.type === 'hit')) phase = 'wait-gap';
    if (trace.filter(event => event.type === 'hit').length === 2) break;
  }
  const hits = trace.filter(event => event.type === 'hit');
  assert.equal(hits.length, 2);
  assert.notEqual(hits[0].comboId, hits[1].comboId);
  assert.equal(hits[1].combo, 1);
  assert.equal(trace.some(event => event.type === 'comboRouteComplete'), false);
});

test('a suffix, direct move injection, block, and wrong contact cannot complete a route', () => {
  const match = ready();
  match.left.startMove('heavyPunch');
  match.left.moveFrame = match.left.moveOf().startup - 1;
  const events = match.step([{}, {}]);
  assert.equal(events.some(event => event.type === 'comboRouteComplete'), false);

  const blocked = ready();
  const route = comboRoute('basic-one-two');
  const playback = new ComboPlayback({ route, actorSide: 0, kitId: 'standard' });
  const blockedEvents = [];
  for (let tick = 0; tick < 80 && !playback.done; tick++) {
    const next = blocked.step([playback.poll(blocked.snapshot()), { block: true }]);
    blockedEvents.push(...next);
    playback.observe(next, blocked.snapshot());
  }
  assert.equal(blockedEvents.some(event => event.type === 'comboRouteComplete'), false);
});

test('authoritative combo clears immediately while its display value lingers', () => {
  const { match, trace } = play('basic-one-two');
  const ending = trace.find(event => event.type === 'comboEnd');
  assert.ok(ending);
  assert.equal(match.right.comboCount, 0);
  assert.equal(match.snapshot().fighters[1].comboDisplayCount, 2);
  for (let tick = 0; tick < 50; tick++) match.step([{}, {}]);
  assert.equal(match.snapshot().fighters[1].comboDisplayCount, 0);
});

test('simultaneous trades interrupt unfinished route candidates', () => {
  const match = ready({ gap: 0.7 });
  // Establish a real first hit and candidate through raw LP.
  for (let tick = 0; tick < 20 && match.right.comboCount === 0; tick++)
    match.step([tick === 0 ? { lp: true } : {}, {}]);
  assert.equal(match.right.comboCount, 1);
  // Resolve two active hitboxes from the same pre-contact frame.
  match.left.startMove('lightKick', { keys: ['lk'] });
  match.right.startMove('lightPunch', { keys: ['lp'] });
  match.left.moveFrame = match.left.moveOf().startup;
  match.right.moveFrame = match.right.moveOf().startup;
  match.events.length = 0;
  match.resolveHits();
  const events = [...match.events];
  assert.ok(events.some(event => event.type === 'comboEnd' && event.reason === 'interruption'));
  assert.equal(events.some(event => event.type === 'comboRouteComplete'), false);
});
