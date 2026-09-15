import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Announcer, comboTier, COMBO_TIERS } from '../game/src/game/announcer.js';
import { VOICES } from '../game/src/game/fightAudio.js';
import { AUDIO_FILES } from '../game/src/game/audioManifest.js';
import { decidingRound } from '../game/src/engine/reelTimeline.js';
import { Match } from '../game/src/engine/match.js';
import { MATCH } from '../game/src/engine/frameData.js';
import { existsSync } from 'node:fs';

// A recording stand-in for FightAudio: the announcer is only ever allowed to
// reach audio through `voice`, so this is the whole surface.
function spy() {
  const said = [];
  return { said, voice: (cue) => said.push(cue) };
}

const snapshot = (overrides = {}) => ({
  phase: 'fight', round: 1, roundsToWin: 2, flawless: false, winner: null,
  fighters: [
    { side: 0, healthPct: 1, stocks: 0 },
    { side: 1, healthPct: 1, stocks: 0 },
  ],
  ...overrides,
});

test('every announcer cue resolves to a manifest entry and a file on disk', () => {
  const audio = spy();
  const announcer = new Announcer({ audio });
  // Drive every trigger the announcer owns, then assert on what it asked for.
  const s = snapshot();
  for (const tier of COMBO_TIERS) {
    announcer.reset();
    announcer.event({ type: 'hit', defender: 1, combo: tier.hits, move: 'lightPunch' }, s);
  }
  announcer.reset();
  announcer.event({ type: 'hit', defender: 1, combo: 1, move: 'burstStrike' }, s);
  announcer.reset();
  announcer.event({ type: 'roundEnd', reason: 'ko' }, snapshot({ flawless: true }));
  announcer.reset();
  announcer.event({ type: 'roundEnd', reason: 'timeout' }, s);
  announcer.reset();
  announcer.event({ type: 'finisherWindow' }, s);
  announcer.reset([0]);
  announcer.event({ type: 'matchEnd' }, snapshot({ winner: 1 }));
  announcer.reset();
  announcer.finisherExpired(s);
  announcer.reset();
  announcer.update(snapshot({
    fighters: [{ side: 0, healthPct: 0.1, stocks: MATCH.meterMax }, { side: 1, healthPct: 1, stocks: 0 }],
  }));

  assert.ok(audio.said.length >= 10, `only ${audio.said.length} cues fired`);
  for (const cue of new Set(audio.said)) {
    const file = AUDIO_FILES[VOICES[cue]];
    assert.ok(VOICES[cue], `cue "${cue}" has no VOICES entry`);
    assert.ok(file, `cue "${cue}" maps to a missing manifest key`);
    assert.ok(existsSync(new URL(`../game/public/audio/${file}`, import.meta.url)), file);
  }
});

test('combo tiers escalate once each and never fire below four hits', () => {
  assert.equal(comboTier(3), null);
  assert.equal(comboTier(4).label, 'BRUTAL');
  assert.equal(comboTier(9).label, 'FEROCITY');
  assert.equal(comboTier(40).label, 'DECIMATION');

  const audio = spy();
  const announcer = new Announcer({ audio });
  for (let hits = 1; hits <= 12; hits += 1) {
    for (let f = 0; f < 200; f += 1) announcer.tick();  // never blocked by cooldown
    announcer.event({ type: 'hit', defender: 1, combo: hits, move: 'lightPunch' }, snapshot());
  }
  assert.deepEqual(audio.said, ['vicious', 'savagery', 'ferocity', 'decimation']);
});

test('a loud call interrupts a quiet one; a quiet call never interrupts a loud one', () => {
  const audio = spy();
  const announcer = new Announcer({ audio });
  // Danger is flavour; the finisher window is decisive.
  announcer.update(snapshot({ fighters: [{ side: 0, healthPct: 0.1, stocks: 0 }, { side: 1, healthPct: 1, stocks: 0 }] }));
  assert.deepEqual(audio.said, ['fearIsWeakness']);
  announcer.event({ type: 'finisherWindow' }, snapshot());
  assert.deepEqual(audio.said, ['fearIsWeakness', 'execution']);
  // Now the reverse: nothing quiet gets through while the loud call runs.
  announcer.update(snapshot({ round: 2, fighters: [{ side: 0, healthPct: 0.05, stocks: 0 }, { side: 1, healthPct: 1, stocks: 0 }] }));
  assert.deepEqual(audio.said, ['fearIsWeakness', 'execution']);
});

test('once-per-round calls latch, and the latch reopens on the next round', () => {
  const audio = spy();
  const announcer = new Announcer({ audio });
  const low = (round) => snapshot({ round, fighters: [{ side: 0, healthPct: 0.2, stocks: 0 }, { side: 1, healthPct: 1, stocks: 0 }] });
  for (let f = 0; f < 300; f += 1) { announcer.update(low(1)); announcer.tick(); }
  assert.deepEqual(audio.said, ['fearIsWeakness']);
  for (let f = 0; f < 300; f += 1) { announcer.update(low(2)); announcer.tick(); }
  assert.deepEqual(audio.said, ['fearIsWeakness', 'fearIsWeakness']);
});

test('a dead fighter is not taunted for being in danger', () => {
  const audio = spy();
  const announcer = new Announcer({ audio });
  announcer.update(snapshot({ fighters: [{ side: 0, healthPct: 0, stocks: 0 }, { side: 1, healthPct: 1, stocks: 0 }] }));
  assert.deepEqual(audio.said, []);
});

test('game over belongs to a human losing, not to the CPU losing', () => {
  const human = spy();
  const a = new Announcer({ audio: human });
  a.reset([0]);
  a.event({ type: 'matchEnd' }, snapshot({ winner: 1 }));   // side 0 is human, side 1 won
  assert.deepEqual(human.said, ['gameOver']);

  const cpu = spy();
  const b = new Announcer({ audio: cpu });
  b.reset([0]);
  b.event({ type: 'matchEnd' }, snapshot({ winner: 0 }));   // the human won
  assert.deepEqual(cpu.said, []);
});

test('the deciding round is only the round where both fighters are one win short', () => {
  const m = new Match({ roundsToWin: 2 });
  assert.equal(decidingRound(m.snapshot()), false);
  m.fighters[0].roundsWon = 1;
  assert.equal(decidingRound(m.snapshot()), false);
  m.fighters[1].roundsWon = 1;
  assert.equal(decidingRound(m.snapshot()), true);
  // A best-of-one has no decider: every round is simply the round.
  const single = new Match({ roundsToWin: 1 });
  assert.equal(decidingRound(single.snapshot()), false);
});
