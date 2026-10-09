import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBO_ROUTES, comboRoute, routesForKit, validateComboRoutes } from '../game/src/engine/comboRoutes.js';
import { COMBAT_KITS } from '../game/src/fighters/combatKits.js';

test('catalog registers the seven stable route ids', () => {
  assert.deepEqual(COMBO_ROUTES.map(route => route.id), [
    'basic-one-two', 'basic-three-hit', 'juggle-first', 'juggle-three-hit',
    'easy-carney-roundhouse', 'easy-carney-axe', 'easy-carney-spin',
  ]);
  assert.equal(comboRoute('lesson-juggle'), null);
  assert.equal(routesForKit('flincher').length, 0);
});

for (const kitId of ['standard', 'breaker', 'strider', 'officer']) {
  test(`${kitId} catalog resolves against its authoritative move data`, () => {
    assert.deepEqual(validateComboRoutes(COMBO_ROUTES, COMBAT_KITS[kitId]), []);
  });
}

test('catalog validation rejects structural and kit mistakes', () => {
  const original = COMBO_ROUTES[0];
  const broken = [original, { ...original, kits: ['flincher'], steps: [
    { keys: ['hp'], expectedMove: 'missingMove', contact: 'launch' },
  ], expectedHits: 2, timingByKit: { flincher: { transitions: [] } } }];
  const errors = validateComboRoutes(broken, COMBAT_KITS.flincher).join('\n');
  assert.match(errors, /duplicate/);
  assert.match(errors, /Lang/);
  assert.match(errors, /expectedHits/);
  assert.match(errors, /missing move/);
});

test('catalog validation rejects impossible contacts, cancels, timing, and costs', () => {
  const oneTwo = COMBO_ROUTES[0];
  const impossible = { ...oneTwo, id: 'bad-launch', kits: ['standard'],
    steps: [{ ...oneTwo.steps[0], contact: 'launch' }, oneTwo.steps[1]] };
  const noCancel = { ...oneTwo, id: 'bad-cancel', kits: ['standard'],
    steps: [oneTwo.steps[0], { ...oneTwo.steps[1], expectedMove: 'uppercut' }] };
  const badTiming = { ...oneTwo, id: 'bad-timing', kits: ['standard'], timingByKit: {
    standard: { transitions: [{ gate: 'contact', window: [0, 2], timeout: 3 }] },
  } };
  const spin = COMBO_ROUTES.find(route => route.id === 'easy-carney-spin');
  const badCost = { ...spin, id: 'bad-cost', setup: { ...spin.setup, stocks: 0 } };
  const errors = validateComboRoutes([impossible, noCancel, badTiming], COMBAT_KITS.standard)
    .concat(validateComboRoutes([badCost], COMBAT_KITS.strider)).join('\n');
  assert.match(errors, /cannot launch/);
  assert.match(errors, /cannot cancel/);
  assert.match(errors, /at least four ticks/);
  assert.match(errors, /setup declares 0 stocks, needs 1/);
});
