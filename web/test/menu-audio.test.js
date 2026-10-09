import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { FightAudio, MUSIC_TRACKS, victoryTrack, captionFor, VOICES } from '../game/src/game/fightAudio.js';
import { OptionsStore } from '../game/src/game/options.js';

test('music cues use the supplied menu, fight, and victory tracks', () => {
  assert.deepEqual(MUSIC_TRACKS.theme, { file: 'Stage Cleared!.mp3', loop: true });
  assert.deepEqual(MUSIC_TRACKS.battle, { file: 'Stage Two_ Odd Odds.mp3', loop: true });
  assert.deepEqual(MUSIC_TRACKS.final, { file: 'Final Round Mayhem.mp3', loop: true });
  assert.deepEqual(MUSIC_TRACKS.finisher, { file: 'KO Overdrive.mp3', loop: true });
  assert.deepEqual(MUSIC_TRACKS.champion, { file: 'Victory.mp3', loop: false });
  assert.deepEqual(MUSIC_TRACKS.results, { file: 'Winner Take All.mp3', loop: true });
  assert.deepEqual(MUSIC_TRACKS.victory, { file: 'Victory Fanfare.mp3', loop: false });
});

test('every supplied track has a cue, and every cue has a file', () => {
  for (const { file } of Object.values(MUSIC_TRACKS)) assert.ok(existsSync(new URL(`../game/public/music/${file}`, import.meta.url)), file);
  assert.equal(new Set(Object.values(MUSIC_TRACKS).map(t => t.file)).size, Object.keys(MUSIC_TRACKS).length, 'no track does two jobs');
});

test('a round win gets the fanfare; the match-winning round gets the victory theme', () => {
  const fighters = roundsWon => roundsWon.map(n => ({ roundsWon: n }));
  assert.equal(victoryTrack({ roundsToWin: 2, fighters: fighters([1, 0]) }), 'victory');
  assert.equal(victoryTrack({ roundsToWin: 2, fighters: fighters([1, 2]) }), 'champion');
  assert.equal(victoryTrack({ roundsToWin: 1, fighters: fighters([1, 0]) }), 'champion');
});

test('menu exhibition keeps the theme playing and restores combat music on entry', () => {
  const audio = new FightAudio();
  const played = [];
  const gain = () => ({ cancelScheduledValues() {}, setTargetAtTime() {} });
  audio.ctx = { currentTime: 0 };
  audio.enabled = true;
  audio.duck = { gain: gain() };
  for (const name of ['master', 'effects', 'voiceBus', 'musicBus']) audio[name] = { gain: gain() };
  for (const key of ['theme', 'battle', 'victory']) audio.musicTracks.set(key, {
    gain: { gain: gain() }, element: { play: () => { played.push(key); return Promise.resolve(); }, pause() {} },
  });
  audio.setMenuPreview(true);
  audio.setMusic('battle');
  audio.setMusic('victory');
  assert.equal(audio.musicKey, 'theme');
  assert.deepEqual(played, ['theme']);
  audio.setMusic('battle');
  audio.setMenuPreview(false);
  assert.equal(audio.musicKey, 'battle');
  assert.deepEqual(played, ['theme', 'battle']);
});

test('preview mix preserves preferences and suppresses announcer loading and ducking', async () => {
  const audio = new FightAudio();
  const settings = { ...audio.settings };
  audio.setMenuPreview(true);
  audio.ctx = { currentTime: 0 };
  audio.enabled = true;
  const gains = {};
  for (const name of ['master', 'effects', 'voiceBus', 'musicBus']) audio[name] = { gain: { setTargetAtTime(value) { gains[name] = value; } } };
  audio.applySettings();
  assert.equal(gains.effects, settings.effects * 0.12);
  assert.equal(gains.voiceBus, 0);
  audio.load = () => { throw Error('background announcer must not load or play'); };
  await audio.play('announcer', { voice: true });
  assert.deepEqual(audio.settings, settings);
  audio.menuPreview = false;
  audio.applySettings();
  assert.equal(gains.effects, settings.effects);
  assert.equal(gains.voiceBus, settings.voice);
});

test('unlock requests music before awaiting context resume and retries denied playback', async () => {
  const audio = new FightAudio();
  const order = [];
  let finishResume, resumeCount = 0;
  audio.ctx = {
    currentTime: 0,
    state: 'suspended',
    resume() {
      order.push('resume');
      return resumeCount++ === 0 ? new Promise(resolve => { finishResume = resolve; }) : Promise.resolve();
    },
  };
  audio.load = async () => null;
  const element = {
    paused: true,
    ended: false,
    currentTime: 0,
    play() { order.push('play'); this.paused = false; return Promise.resolve(); },
    pause() {},
  };
  const gain = { cancelScheduledValues() {}, setTargetAtTime() {} };
  audio.musicTracks.set('theme', { element, gain: { gain } });

  const unlocking = audio.unlock();
  assert.deepEqual(order, ['play', 'resume']);
  finishResume();
  await unlocking;

  element.paused = true;
  await audio.unlock();
  assert.deepEqual(order, ['play', 'resume', 'play', 'resume']);
});

test('announcer captions read the call as spoken and follow the captions option', () => {
  assert.equal(captionFor('fight'), 'Fight');
  assert.equal(captionFor('fearIsWeakness'), 'Fear is Weakness');
  assert.equal(captionFor('nope'), '');
  for (const cue of Object.keys(VOICES)) assert.ok(captionFor(cue) && !/^\d/.test(captionFor(cue)), cue);
  const options = new OptionsStore(null);
  assert.equal(options.settings.captions, 'auto');
  assert.equal(options.set('captions', 'on'), true);
  assert.equal(options.set('captions', 'sometimes'), false);
  const audio = new FightAudio(), heard = [];
  audio.onVoice = cue => heard.push(cue);
  audio.play = async () => {};
  audio.voice('fight'); audio.voice('not-a-cue');
  assert.deepEqual(heard, ['fight']);
  assert.equal(audio.inaudible(), true, 'no audio context yet means nobody heard it');
});
