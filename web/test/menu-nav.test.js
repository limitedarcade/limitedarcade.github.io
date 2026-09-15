import test from 'node:test';
import assert from 'node:assert/strict';
import { MenuNavigator } from '../game/src/input/menuNav.js';

const pad = (over = {}) => ({
  connected: true,
  mapping: 'standard',
  axes: over.axes || [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: Boolean(over.buttons?.[i]), value: 0 })),
});

const nav = () => new MenuNavigator({ isActive: () => true, onBack: () => {} });

test('d-pad and left stick both feed the direction set', () => {
  assert.deepEqual(nav().directions([pad({ buttons: { 13: true } })]),
    { up: false, down: true, left: false, right: false });
  assert.deepEqual(nav().directions([pad({ axes: [-0.9, 0, 0, 0] })]),
    { up: false, down: false, left: true, right: false });
});

test('a stick inside the deadzone reads as neutral', () => {
  assert.deepEqual(nav().directions([pad({ axes: [0.3, -0.3, 0, 0] })]),
    { up: false, down: false, left: false, right: false });
});

test('opposite directions from two sources cancel', () => {
  const dir = nav().directions([pad({ buttons: { 14: true }, axes: [0.9, 0, 0, 0] })]);
  assert.equal(dir.left, false);
  assert.equal(dir.right, false);
});

test('face and shoulder buttons are read across every connected pad', () => {
  const b = nav().buttons([pad({ buttons: { 0: true } }), pad({ buttons: { 5: true } })]);
  assert.equal(b.south, true);
  assert.equal(b.r1, true);
  assert.equal(b.east, false);
});
