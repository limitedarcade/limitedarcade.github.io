import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, DEFAULT_BINDINGS, DEFAULT_OPTIONS, OPTION_KEY, OptionsStore, keyLabel } from '../game/src/game/options.js';
import { ACHIEVEMENTS, PROFILE_KEY, PlayerProfile } from '../game/src/game/profile.js';
import { PlayerInput } from '../game/src/input/sources.js';

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
}

test('every action remains bound with unavailable, corrupt or partial preferences', () => {
  for (const storage of [null, memoryStorage({ [OPTION_KEY]: '{broken' }), memoryStorage({ [OPTION_KEY]: JSON.stringify({ settings: { quality: 'ultra', motion: false, rumble: 'yes' }, bindings: [{ left: 'KeyQ' }, {}] }) }), { getItem() { throw new Error('Private session'); }, setItem() { throw new Error('Full'); } }]) {
    const options = new OptionsStore(storage);
    assert.deepEqual(options.bindings, DEFAULT_BINDINGS);
    assert.deepEqual(options.settings, DEFAULT_OPTIONS);
    for (const side of [0, 1]) assert.equal(Object.keys(options.keymap(side)).length, ACTIONS.length);
    assert.doesNotThrow(() => options.set('quality', 'performance'));
  }
});

test('remaps persist physical keys and drive the real input class for either single-player side', () => {
  const storage = memoryStorage(); const options = new OptionsStore(storage);
  assert.equal(options.bind(0, 'left', 'KeyQ').ok, true);
  assert.equal(options.bind(1, 'hp', 'Numpad8').ok, true);
  const reopened = new OptionsStore(storage);
  for (const side of [0, 1]) {
    const input = new PlayerInput({ keymap: reopened.keymap(side, { single: true }) });
    // Key is deliberately different to its physical code, like a non-US layout.
    assert.equal(input.onKeyDown('a', 'KeyQ'), true);
    assert.equal(input.keys.has('left'), true);
    input.onKeyUp('a', 'KeyQ'); assert.equal(input.keys.has('left'), false);
    assert.equal(input.onKeyDown('8', 'Numpad8'), true); assert.equal(input.keys.has('hp'), true);
  }
  const twoPlayerLeft = new PlayerInput({ keymap: reopened.keymap(0) });
  assert.equal(twoPlayerLeft.onKeyDown('8', 'Numpad8'), false);
  assert.equal(new PlayerInput({ keymap: reopened.keymap(1) }).onKeyDown('a', 'KeyQ'), false);
});

test('reserved and duplicate bindings are refused without erasing existing controls', () => {
  const options = new OptionsStore(memoryStorage()); const before = JSON.stringify(options.bindings);
  for (const code of ['Escape', 'Backquote', 'Tab', 'MetaLeft', 'ControlLeft', 'KeyD', 'ArrowLeft', 'Unknown']) assert.equal(options.bind(0, 'lp', code).ok, false);
  assert.equal(JSON.stringify(options.bindings), before);
  assert.equal(options.bind(9, 'lp', 'KeyQ').ok, false);
  assert.equal(options.bind(0, '__proto__', 'KeyQ').ok, false);
  assert.equal(options.bind(0, 'left', 'KeyA').ok, true);
  assert.equal(keyLabel('Numpad4'), 'Num 4'); assert.equal(keyLabel('ArrowLeft'), '←');
});

test('display and feedback preferences are validated, observable and resolved for the device', () => {
  const options = new OptionsStore(memoryStorage()); let changed = 0;
  const unsubscribe = options.subscribe(() => changed++);
  assert.equal(options.reducedMotion(true), true); assert.equal(options.qualityValue(true), 0.5);
  options.set('motion', 'full'); assert.equal(options.reducedMotion(true), false);
  options.set('quality', 'cinematic'); assert.equal(options.qualityValue(true), 1);
  options.set('rumble', false); assert.equal(options.settings.rumble, false);
  assert.equal(changed, 3);
  assert.equal(options.set('quality', 'not-a-mode'), false); assert.equal(options.set('__proto__', {}), false);
  unsubscribe(); options.resetBindings(); assert.equal(changed, 3);
});

test('profile recovers from damaged and unavailable storage without blocking a match', () => {
  for (const storage of [null, memoryStorage({ [PROFILE_KEY]: '<html>' }), { getItem() { throw Error('Blocked'); }, setItem() { throw Error('Quota'); } }]) {
    const profile = new PlayerProfile(storage);
    assert.equal(profile.data.matches, 0);
    profile.begin({ humanSides: [1] });
    assert.equal(profile.complete({ winner: 1 }), true);
    assert.equal(profile.data.wins, 1);
  }
  const profile = new PlayerProfile(memoryStorage({ [PROFILE_KEY]: JSON.stringify({ matches: -9, wins: '200', bestCombo: null, discoveries: ['good-id', 'good-id', '<script>', 7], unlocks: ['fake'], recent: [{ outcome: 'invalid', stage: 'x' }] }) }));
  assert.equal(profile.data.matches, 0); assert.equal(profile.data.wins, 0);
  assert.deepEqual(profile.data.discoveries, ['good-id']); assert.equal(profile.data.unlocks.includes('fake'), false);
  assert.deepEqual(profile.data.recent, []);
});

test('a match records the human side, discoveries and rewards exactly once', () => {
  const storage = memoryStorage(); const profile = new PlayerProfile(storage);
  profile.begin({ humanSides: [1], stage: 'lake-america' });
  profile.event({ type: 'hit', attacker: 0, damage: 600, combo: 10 });
  profile.event({ type: 'hit', attacker: 1, damage: 81, combo: 5 });
  profile.event({ type: 'roundEnd', winner: 1, reason: 'ko', round: 1 }, { round: 1, flawless: true });
  profile.event({ type: 'roundEnd', winner: 1, reason: 'ko', round: 1 }, { round: 1, flawless: true });
  profile.event({ type: 'finisher', attacker: 1, finisherId: 'secret-routine' });
  for (let i = 0; i < 120; i++) profile.tick(0.5);
  assert.equal(profile.complete({ winner: 1, roundWinner: 0 }), true);
  assert.equal(profile.complete({ winner: 1 }), false);
  const restored = new PlayerProfile(storage);
  assert.equal(restored.data.matches, 1); assert.equal(restored.data.wins, 1);
  assert.equal(restored.data.rounds, 1); assert.equal(restored.data.flawless, 1); assert.equal(restored.data.knockouts, 1);
  assert.equal(restored.data.totalDamage, 81); assert.equal(restored.data.bestCombo, 5); assert.equal(restored.data.playSeconds, 60);
  assert.deepEqual(restored.data.discoveries, ['secret-routine']); assert.deepEqual(restored.data.stages, ['lake-america']);
  for (const id of ['first-bell', 'clean-slate', 'secret-menu', 'combo-lab']) assert.equal(restored.data.unlocks.includes(id), true);
  assert.ok(restored.data.recent[0].at > 1e12);
});

test('draws, losses, spectators and abandoned matches do not become solo wins', () => {
  const profile = new PlayerProfile(memoryStorage());
  profile.begin({ humanSides: [0] }); profile.complete({ winner: null, roundWinner: 0 });
  profile.begin({ humanSides: [1] }); profile.complete({ winner: 0 });
  profile.begin({ humanSides: [] }); profile.complete({ winner: 0 });
  profile.begin({ humanSides: [0, 1] }); profile.complete({ winner: 1 });
  profile.begin({ humanSides: [0] }); profile.abandon(); profile.complete({ winner: 0 });
  assert.equal(profile.data.matches, 4); assert.equal(profile.data.wins, 0); assert.equal(profile.data.losses, 1); assert.equal(profile.data.draws, 1);
  assert.deepEqual(profile.data.recent.map(r => r.outcome), ['draw', 'loss', 'watched', 'watched']);
  profile.reset(); assert.equal(profile.data.matches, 0); assert.equal(profile.data.unlocks.length, 0);
});

test('progression remains bounded and unlock descriptions correspond to earned conditions', () => {
  const profile = new PlayerProfile(memoryStorage());
  for (let i = 0; i < 12; i++) { profile.begin({ stage: ['lake-america', 'capitol', 'palm-resort'][i % 3] }); profile.complete({ winner: 0 }); }
  assert.equal(profile.data.recent.length, 8); assert.equal(profile.data.stages.length, 3);
  assert.equal(profile.data.unlocks.includes('after-hours'), true); assert.equal(profile.data.unlocks.includes('tour-of-duty'), true);
  for (const id of profile.data.unlocks) assert.equal(ACHIEVEMENTS.find(a => a.id === id).earned(profile.data), true);
});
