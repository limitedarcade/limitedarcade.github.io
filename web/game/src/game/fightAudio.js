import { AUDIO_FILES } from './audioManifest.js';
import { moveOf } from '../engine/frameData.js';

// The move an event came from. Combat events carry their own definition, which
// is the only way a kit-specific move -- one that is on no universal table --
// can be looked up here at all; the id lookup stays as the fallback for events
// synthesised by the renderer rather than by the simulation.
function moveFrom(event) {
  return event.moveData || moveOf(event.move);
}

export const VOICES = {
  select: '01. Select Your Champion', versus: '03. Embrace the Fury', fight: '02. Fight',
  round1: '09. First Round', round2: '10. Second Round', round3: '11. Third Round',
  ko: '17. KO', victor: '14. Victor', finish: '19. I Demand a Sacrifice', fatality: '23. Finality',
  combo: '27. Vicious', power: '08. Berserk',
  // Everything below was already on disk and in the manifest with no trigger
  // behind it. `announcer.js` decides when each one has been earned.
  deathRound: '12. Death Round', deathMatch: '13. Death Match', suddenDeath: '15. Sudden Death',
  vicious: '27. Vicious', savagery: '21. Savagery', ferocity: '24. Ferocity',
  decimation: '25. Decimation', apocalypse: '05. Apocalypse',
  pathetic: '07. Pathetic', disappointing: '20. Disappointing',
  fearIsWeakness: '04. Fear is Weakness', rageFuel: '26. Rage Fuel',
  execution: '22. Execution', knockout: '16. Knockout',
  gameOver: '28. Game Over', youDied: '18. You Died',
};

export const MUSIC_TRACKS = Object.freeze({
  theme: Object.freeze({ file: 'Stage Cleared!.mp3', loop: true }),
  battle: Object.freeze({ file: 'Stage Two_ Odd Odds.mp3', loop: true }),
  final: Object.freeze({ file: 'Stage Two_ Odd Odds.mp3', loop: true }),
  victory: Object.freeze({ file: 'Victory Fanfare.mp3', loop: false }),
});

export class FightAudio {
  constructor() {
    this.buffers = new Map(); this.active = new Set(); this.lastPick = new Map();
    this.settings = { master: 0.75, effects: 0.85, voice: 1, music: 0.45, muted: false };
    try { Object.assign(this.settings, JSON.parse(localStorage.getItem('bfi-audio') || '{}')); } catch {}
    for (const key of ['master', 'effects', 'voice', 'music']) this.settings[key] = Math.max(0, Math.min(1, Number(this.settings[key]) || 0));
    this.musicTracks = new Map(); this.musicKey = null; this.wantedMusic = 'theme';
    this.epoch = 0; this.voiceSerial = 0; this.comboAt = -100; this.enabled = false;
  }

  async unlock() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain(); this.effects = this.ctx.createGain();
      this.voiceBus = this.ctx.createGain(); this.duck = this.ctx.createGain();
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -10; limiter.knee.value = 12; limiter.ratio.value = 5;
      limiter.attack.value = 0.003; limiter.release.value = 0.2;
      this.effects.connect(this.duck).connect(this.master);
      this.voiceBus.connect(this.master); this.master.connect(limiter).connect(this.ctx.destination);
      this.musicBus = this.ctx.createGain(); this.musicBus.connect(this.duck);
      this.applySettings();
    }
    this.enabled = true;
    // Request media playback while the pointer/key gesture is still active.
    // Waiting for resume() first can consume the browser's autoplay grant; the
    // rejected play would then leave musicKey set and every later setMusic call
    // would incorrectly assume that the silent track was already running.
    this.setMusic(this.wantedMusic);
    this.retryMusic();
    try { await this.ctx.resume(); } catch { return; }
    // Fetch once. Audio assets total only a few MB after removing source metadata.
    this.preloadPromise ||= Promise.all(Object.keys(AUDIO_FILES).map(key => this.load(key)));
    await this.preloadPromise;
  }

  load(key) {
    if (!this.ctx || !AUDIO_FILES[key]) return Promise.resolve(null);
    if (!this.buffers.has(key)) this.buffers.set(key,
      fetch(`${import.meta.env.BASE_URL}audio/${AUDIO_FILES[key]}`)
        .then(r => { if (!r.ok) throw Error(`Audio ${r.status}`); return r.arrayBuffer(); })
        .then(b => this.ctx.decodeAudioData(b)).catch(() => null));
    return this.buffers.get(key);
  }

  set(key, value) {
    this.settings[key] = value; this.applySettings();
    try { localStorage.setItem('bfi-audio', JSON.stringify(this.settings)); } catch {}
  }
  setMenuPreview(active) {
    if (this.menuPreview === active) return;
    this.menuPreview = active;
    this.stop();
    this.applySettings();
    this.setMusic(active ? 'theme' : this.wantedMusic);
  }
  applySettings() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : this.settings.master, t, 0.025);
    this.effects.gain.setTargetAtTime(this.settings.effects * (this.menuPreview ? 0.12 : 1), t, 0.025);
    this.voiceBus.gain.setTargetAtTime(this.menuPreview ? 0 : this.settings.voice, t, 0.025);
    this.musicBus.gain.setTargetAtTime(this.settings.music, t, 0.05);
  }
  async play(key, { gain = 0.65, x = 0, voice = false, rate, serial } = {}) {
    if (!this.ctx || !this.enabled || (voice && this.menuPreview)) return;
    const epoch = this.epoch, buffer = await this.load(key);
    if (!buffer || epoch !== this.epoch || !this.enabled || this.ctx.state !== 'running') return;
    if (voice && serial !== this.voiceSerial) return;
    if (this.active.size > 22 && !voice) return;
    const source = this.ctx.createBufferSource(), volume = this.ctx.createGain(), pan = this.ctx.createStereoPanner();
    source.buffer = buffer; source.playbackRate.value = rate ?? (voice ? 1 : 0.95 + Math.random() * 0.1);
    volume.gain.value = gain; pan.pan.value = voice ? 0 : Math.max(-0.75, Math.min(0.75, x / 5.4));
    source.connect(volume).connect(pan).connect(voice ? this.voiceBus : this.effects);
    this.active.add(source);
    source.onended = () => { this.active.delete(source); source.disconnect(); volume.disconnect(); pan.disconnect(); };
    if (voice) {
      this.voiceSource?.stop(); this.voiceSource = source;
      const t = this.ctx.currentTime;
      this.duck.gain.cancelScheduledValues(t);
      this.duck.gain.setTargetAtTime(0.48, t, 0.04);
      this.duck.gain.setTargetAtTime(1, t + buffer.duration, 0.18);
    }
    source.start();
  }
  voice(cue) { if (VOICES[cue]) void this.play(VOICES[cue], { voice: true, gain: 0.9, serial: ++this.voiceSerial }); }
  effect(prefix, options) {
    const choices = Object.keys(AUDIO_FILES).filter(k => k.toLowerCase().startsWith(prefix.toLowerCase()));
    const fresh = choices.filter(k => k !== this.lastPick.get(prefix));
    const pool = fresh.length ? fresh : choices;
    if (!pool.length) return;
    const key = pool[Math.floor(Math.random() * pool.length)]; this.lastPick.set(prefix, key);
    void this.play(key, options);
  }
  impact() { this.effect('metal_punch_finisher', { gain: 0.65, rate: 0.7 }); }
  event(e) {
    const opts = { x: e.x || 0 };
    if (e.type === 'attack') {
      const move = moveFrom(e);
      this.effect(/kick|knee|heel|cyclone/i.test(e.move) ? 'kick_short_whoosh' : 'punch_short_whoosh', { ...opts, gain: 0.26 });
      if (move.cost) this.effect(move.cost === 2 ? 'fire_punch_finisher' : 'fire_punch_', { ...opts, gain: 0.38 });
    }
    if (e.type === 'hit') {
      const heavy = moveFrom(e).hit.damage >= 90;
      this.effect(`${e.y > 1.15 ? 'face' : 'body'}_hit_${heavy ? 'large' : 'small'}`, { ...opts, gain: heavy ? 0.8 : 0.55 });
      if (e.knockdown) this.effect('bone_breaking', { ...opts, gain: 0.27 });
      if (e.combo >= 4 && this.ctx && this.ctx.currentTime - this.comboAt > 10) { this.comboAt = this.ctx.currentTime; this.voice('combo'); }
    }
    if (e.type === 'block') this.effect(moveFrom(e).hit.damage >= 90 ? 'block_large' : 'block_small', { ...opts, gain: 0.55 });
    if (e.type === 'jump') this.effect('somersault', { ...opts, gain: 0.14 });
    if (e.type === 'land') this.effect('body_hit_small', { ...opts, gain: 0.12, rate: 0.65 });
    if (e.type === 'finisher') {
      this.effect('face_hit_finisher', { ...opts, gain: 0.8 });
      this.effect('guts_and_gore', { ...opts, gain: 0.52 });
      this.effect('wood_bat_finisher', { ...opts, gain: 0.42 });
    }
  }
  setMusic(key) {
    this.wantedMusic = key;
    if (this.menuPreview && key) key = 'theme';
    if (!this.ctx || !this.enabled || this.musicKey === key) return;
    this.musicKey = key;
    if (key && !this.musicTracks.has(key)) {
      const track = MUSIC_TRACKS[key];
      if (!track) return;
      const element = new Audio(`${import.meta.env.BASE_URL}music/${encodeURIComponent(track.file)}`);
      element.loop = track.loop; element.preload = 'auto';
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      this.ctx.createMediaElementSource(element).connect(gain).connect(this.musicBus);
      this.musicTracks.set(key, { element, gain });
    }
    for (const [id, track] of this.musicTracks) {
      const t = this.ctx.currentTime;
      track.gain.gain.cancelScheduledValues(t);
      track.gain.gain.setTargetAtTime(id === key ? 1 : 0, t, 0.25);
      if (id === key) { track.element.currentTime = 0; void track.element.play().catch(() => {}); }
      else setTimeout(() => { if (this.musicKey !== id) track.element.pause(); }, 1200);
    }
  }
  retryMusic() {
    const track = this.musicTracks.get(this.musicKey);
    if (track?.element.paused && !track.element.ended) void track.element.play().catch(() => {});
  }
  stop() {
    this.epoch++; this.voiceSerial++;
    for (const source of this.active) { try { source.stop(); } catch {} }
    this.active.clear(); this.voiceSource = null;
    if (this.ctx) { this.duck.gain.cancelScheduledValues(this.ctx.currentTime); this.duck.gain.value = 1; }
  }
  pause(value) {
    this.enabled = !value;
    if (!this.ctx) return;
    if (value) {
      for (const track of this.musicTracks.values()) track.element.pause();
      void this.ctx.suspend();
    } else {
      void this.ctx.resume();
      const track = this.musicTracks.get(this.musicKey);
      if (track) void track.element.play().catch(() => {});
    }
  }
}
