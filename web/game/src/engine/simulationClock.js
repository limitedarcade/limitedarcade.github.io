import { TICK } from './frameData.js';

// The only wall-clock boundary. Hitstop is consumed by Match.step(), never by
// the monitor. Retain fractional ticks and bound catch-up after tab suspension.
export class SimulationClock {
  constructor() { this.reset(); }
  reset() { this.accumulator = 0; }
  advance(seconds, step, rate = () => 1) {
    this.accumulator += Math.min(0.25, Math.max(0, seconds));
    let count = 0;
    while (count < 15) {
      // Evaluate per simulation tick so speed ramps cross the same contact
      // frames on every display. The accumulator remains in wall seconds.
      const cost = TICK / Math.min(4, Math.max(0.01, rate()));
      if (this.accumulator + 1e-10 < cost) break;
      this.accumulator = Math.max(0, this.accumulator - cost);
      const keepGoing = step(); count++;
      if (keepGoing === false) { this.accumulator = 0; break; }
    }
    return count;
  }
  fraction(rate = 1) { return Math.min(1, this.accumulator * rate / TICK); }
}
