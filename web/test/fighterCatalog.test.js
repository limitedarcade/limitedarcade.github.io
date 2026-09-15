import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_FIGHTER_ID, getFighter, hasFighter, listFighters } from '../game/src/fighters/catalog.js';

test('fighter catalog exposes stable ids and an explicit default', () => {
  assert.equal(DEFAULT_FIGHTER_ID, 'trump');
  assert.deepEqual(listFighters().map((fighter) => fighter.id), ['trump', 'carney', 'officer_flock', 'lang']);
  assert.equal(hasFighter('carney'), true);
  assert.equal(hasFighter('missing'), false);
  assert.equal(getFighter(DEFAULT_FIGHTER_ID).id, DEFAULT_FIGHTER_ID);
  assert.throws(() => getFighter('missing'), /Unknown fighter/);
});
