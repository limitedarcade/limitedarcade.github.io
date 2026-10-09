import test from 'node:test';
import assert from 'node:assert/strict';
import { Vfx } from '../game/src/render/vfx.js';
import { FightAudio } from '../game/src/game/fightAudio.js';

function cueHarness({ reducedMotion = false, quality = 1 } = {}) {
  const cues = [];
  const vfx = Object.assign(Object.create(Vfx.prototype), {
    reducedMotion, quality,
    flash: (kind, data) => cues.push({ kind, ...data }),
  });
  return { vfx, cues };
}

test('launch, air contact, and landing have distinct bounded pooled cues', () => {
  const { vfx, cues } = cueHarness();
  assert.equal(vfx.onComboHit({ x: 0, y: 1, launched: true }), 'launch');
  const launch = cues.splice(0);
  assert.ok(launch.some(cue => cue.kind === 'ring'));
  assert.ok(launch.some(cue => cue.kind === 'lines'));
  assert.equal(vfx.onComboHit({ x: 0, y: 2, juggle: true }), 'air');
  assert.deepEqual(cues.map(cue => cue.kind), ['spark']);
  cues.length = 0; vfx.onJuggleLand({ x: 0 });
  assert.ok(cues.some(cue => cue.kind === 'ring'));
  assert.ok(cues.every(cue => cue.life <= 0.22));
});

test('reduced motion and performance mode retain readable flashes without streak decoration', () => {
  const { vfx, cues } = cueHarness({ reducedMotion: true, quality: 0.5 });
  vfx.onComboHit({ x: 0, y: 1, launched: true });
  vfx.onJuggleLand({ x: 0 });
  assert.ok(cues.some(cue => cue.kind === 'ring'));
  assert.ok(!cues.some(cue => cue.kind === 'lines' || cue.kind === 'mist'));
});

test('combo audio adds contact accents without duplicating announcer voices', () => {
  const audio = new FightAudio(); const effects = []; const voices = [];
  audio.effect = (name, options) => effects.push([name, options]);
  audio.voice = cue => voices.push(cue);
  const moveData = { hit: { damage: 40 } };
  audio.event({ type: 'hit', move: 'lightPunch', moveData, x: 0, y: 1, combo: 4, launched: true });
  audio.event({ type: 'juggleLand', x: 0 });
  audio.event({ type: 'comboRouteComplete', x: 0 });
  assert.ok(effects.some(([name]) => name === 'somersault'));
  assert.ok(effects.some(([name]) => name === 'body_hit_large'));
  assert.equal(voices.length, 0, 'Announcer is the only combo-voice owner');
});
