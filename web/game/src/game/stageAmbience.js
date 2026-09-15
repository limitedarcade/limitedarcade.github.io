import { stageById } from '../render/stageRegistry.js';

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Quiet, original procedural ambience on the existing effects bus. One shared
// stereo buffer and two filtered voices cover every arena; selecting a stage
// retunes them instead of allocating another AudioContext or another loop.
export class StageAmbience {
  constructor(audio) {
    this.audio = audio;
    this.definition = stageById('lake-america');
    this.paused = true;
    this.nodes = [];
    this.sources = [];
    this.ctx = null;
  }

  setStage(definition) {
    this.definition = typeof definition === 'string' ? stageById(definition) : (definition || stageById('lake-america'));
    this.sync();
    this.retune();
  }

  // Safe to call after audio.unlock(), or each frame until the first gesture
  // has created the audio context. Once attached it is an inexpensive no-op.
  sync() {
    if (!this.audio?.ctx || !this.audio.effects || this.ctx === this.audio.ctx) return;
    this.releaseNodes();
    const ctx = this.ctx = this.audio.ctx;
    this.output = ctx.createGain(); this.output.gain.value = 0; this.output.connect(this.audio.effects);
    this.nodes.push(this.output);
    const rate = 22050, duration = 8, count = rate * duration;
    const buffer = ctx.createBuffer(2, count, rate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let state = 17171 + channel * 7001, brown = 0;
      for (let i = 0; i < count; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const white = state / 2147483648 - 1;
        brown = (brown + white * 0.025) / 1.025;
        const edge = Math.min(1, i / 600, (count - 1 - i) / 600);
        data[i] = (white * 0.42 + brown * 1.7) * edge;
      }
    }
    const voice = type => {
      const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), volume = ctx.createGain();
      source.buffer = buffer; source.loop = true;
      filter.type = type; filter.frequency.value = 400; filter.Q.value = 0.6; volume.gain.value = 0;
      source.connect(filter).connect(volume).connect(this.output); source.start();
      this.sources.push(source); this.nodes.push(source, filter, volume);
      return { source, filter, volume };
    };
    this.wind = voice('lowpass'); this.water = voice('bandpass');
    this.water.source.playbackRate.value = 0.87;
    // The slow LFO changes pressure, not pitch. It feels like weather passing
    // behind the stage without pulling focus from impacts or voice lines.
    const motion = ctx.createOscillator(), depth = ctx.createGain();
    motion.frequency.value = 0.14; depth.gain.value = 0.12;
    motion.connect(depth).connect(this.output.gain); motion.start();
    this.motion = motion; this.depth = depth;
    this.sources.push(motion); this.nodes.push(motion, depth);
    this.retune();
  }

  retune() {
    if (!this.ctx) return;
    const ambient = this.definition.ambient || {}, t = this.ctx.currentTime;
    const ramp = (param, value, time = 0.65) => {
      param.cancelScheduledValues(t); param.setTargetAtTime(value, t, time);
    };
    ramp(this.wind.filter.frequency, ambient.kind === 'storm' ? 380 : ambient.kind === 'water' ? 520 : 230);
    ramp(this.wind.volume.gain, clamp(ambient.wind || 0, 0, 0.2));
    ramp(this.water.filter.frequency, ambient.kind === 'ice' ? 180 : ambient.kind === 'storm' ? 1450 : 870);
    ramp(this.water.filter.Q, ambient.kind === 'ice' ? 4 : 0.55);
    ramp(this.water.volume.gain, clamp(ambient.water || 0, 0, 0.2));
    ramp(this.motion.frequency, ambient.kind === 'water' ? 0.12 : ambient.kind === 'ice' ? 0.065 : 0.19);
    ramp(this.output.gain, this.paused ? 0 : 0.43, 0.2);
    ramp(this.depth.gain, this.paused ? 0 : 0.07, 0.2);
  }

  pause(value = true) { this.paused = Boolean(value); this.sync(); this.retune(); }

  releaseNodes() {
    for (const source of this.sources) { try { source.stop(); } catch {} }
    for (const node of this.nodes) { try { node.disconnect(); } catch {} }
    this.nodes = []; this.sources = []; this.ctx = null;
  }

  dispose() { this.releaseNodes(); }
}
