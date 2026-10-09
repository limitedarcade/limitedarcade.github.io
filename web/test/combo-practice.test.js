import test from 'node:test';
import assert from 'node:assert/strict';
import { ComboPracticeSession } from '../game/src/game/comboPractice.js';
import { comboRoute } from '../game/src/engine/comboRoutes.js';
import { Match } from '../game/src/engine/match.js';
import { practiceMoves, preparePractice } from '../game/src/game/practice.js';
import { MATCH } from '../game/src/engine/frameData.js';

test('Try requires ordered raw presses and the authoritative route completion contact', () => {
  const route = comboRoute('basic-one-two');
  const session = new ComboPracticeSession({ route, actorSide: 0, kitId: 'standard' });
  session.input({ lp: true }); session.input({}); session.input({ hp: true });
  assert.equal(session.state, 'active');
  session.observe([{ type: 'comboRouteComplete', side: 0, routeId: route.id, comboId: '4', damage: 154 }], { phase: 'fight' });
  assert.equal(session.state, 'complete'); assert.equal(session.damage, 154);
  assert.match(session.feedback, /154 damage/);
});

test('wrong input, block, dropped combo, and missing stock cannot report success', () => {
  const route = comboRoute('easy-carney-spin');
  const wrong = new ComboPracticeSession({ route, actorSide: 0, kitId: 'strider' });
  wrong.input({ hp: true }); assert.equal(wrong.state, 'failed'); assert.equal(wrong.reason, 'different-move');
  const blocked = new ComboPracticeSession({ route, actorSide: 1, kitId: 'strider' });
  blocked.observe([{ type: 'block', attacker: 1 }], { phase: 'fight' });
  assert.equal(blocked.state, 'failed'); assert.equal(blocked.reason, 'blocked');
  const noStock = new ComboPracticeSession({ route, actorSide: 0, kitId: 'strider', mode: 'watch' });
  noStock.poll({ phase: 'fight', hitStop: 0, fighters: [{ health: 1, stocks: 0 }, { health: 1, stocks: 0 }] });
  assert.equal(noStock.playback.reason, 'resource');
});

test('practice catalog is route-driven, excludes unsupported Lang, and route-cost setup is exact', () => {
  const capable = new Match({ left: { id: 'carney' }, right: { id: 'lang' } });
  const entries = practiceMoves(capable.left, 'lake-america').filter(entry => entry.group === 'Combos');
  assert.ok(entries.some(entry => entry.id === 'juggle-first'));
  assert.ok(entries.some(entry => entry.sub === 'Carney chains'));
  const metered = entries.find(entry => entry.id === 'easy-carney-spin');
  preparePractice(capable, metered, { routeCost: true, playerSide: 0 });
  assert.equal(capable.left.meter, MATCH.meterUnitsPerStock);
  const lang = new Match({ left: { id: 'lang' }, right: { id: 'carney' } });
  assert.equal(practiceMoves(lang.left, 'lake-america').some(entry => entry.group === 'Combos'), false);
});
