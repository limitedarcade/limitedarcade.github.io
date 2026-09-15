import test from 'node:test';
import assert from 'node:assert/strict';
import { assignFighter } from '../game/src/render/fighterPick.js';
import { notationTokens, tokensFromActions, keyCapText } from '../game/src/render/commandNotation.js';
import { STAGES } from '../game/src/render/stageRegistry.js';

test('confirming player 1 hands the cursor to player 2 without changing the locked pair', () => {
  const result = assignFighter(['trump', 'carney'], 0, 'trump');
  assert.equal(result.accepted, true);
  assert.equal(result.side, 1);
  assert.deepEqual(result.fighters, ['trump', 'carney']);
});

test('a side cannot lock the other players fighter', () => {
  assert.equal(assignFighter(['trump', 'carney'], 0, 'carney').accepted, false);
  assert.equal(assignFighter(['trump', 'carney'], 1, 'trump').accepted, false);
  assert.deepEqual(assignFighter(['trump', 'carney'], 0, 'carney').fighters, ['trump', 'carney']);
});

test('player 1 can swap to a free fighter and player 2 then takes the vacated one', () => {
  const first = assignFighter(['trump', 'carney'], 0, 'officer_flock');
  assert.equal(first.accepted, true);
  assert.equal(first.side, 1);
  assert.deepEqual(first.fighters, ['officer_flock', 'carney']);
  const second = assignFighter(first.fighters, first.side, 'trump');
  assert.equal(second.accepted, true);
  assert.equal(second.side, 1);
  assert.deepEqual(second.fighters, ['officer_flock', 'trump']);
});

test('player 2 confirming a free fighter stays on player 2', () => {
  const result = assignFighter(['trump', 'carney'], 1, 'officer_flock');
  assert.equal(result.accepted, true);
  assert.equal(result.side, 1);
  assert.deepEqual(result.fighters, ['trump', 'officer_flock']);
});

test('command notation becomes arcade tokens instead of a run-on sentence', () => {
  assert.deepEqual(notationTokens('↓ + LP'), [['dir', 'down'], ['join', '+'], ['action', 'lp']]);
  assert.deepEqual(tokensFromActions(['lp', 'hk'], '+'), [['action', 'lp'], ['join', '+'], ['action', 'hk']]);
  assert.deepEqual(tokensFromActions(['down', 'lp', 'hp']),
    [['dir', 'down'], ['join', '+'], ['action', 'lp'], ['join', '+'], ['action', 'hp']]);
  assert.deepEqual(tokensFromActions(['down', 'grab']),
    [['dir', 'down'], ['join', '+'], ['action', 'grab']]);
  assert.equal(keyCapText('Numpad4'), '4');
  assert.equal(keyCapText('Space'), 'Space');
});

test('only Lake America is open and arena 3 is Reflecting Pool', () => {
  assert.equal(STAGES.filter(stage => !stage.comingSoon).map(stage => stage.id).join(), 'lake-america');
  assert.equal(STAGES[2].name, 'Reflecting Pool');
  assert.equal(STAGES[1].comingSoon && STAGES[2].comingSoon && STAGES[3].comingSoon, true);
});
