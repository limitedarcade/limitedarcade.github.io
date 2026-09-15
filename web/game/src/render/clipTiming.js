// Authored contact intervals in seconds. These are animation facts, separate
// from balance frame data; a faster fighter can reuse the same motion safely.
export const CONTACT_MARKERS = Object.freeze({
  lightPunch: [0.15, 0.21], heavyPunch: [0.26, 0.36],
  lightKick: [0.20, 0.28], heavyKick: [0.32, 0.44],
  crouchPunch: [0.10, 0.20], crouchKick: [0.34, 0.46],
  jumpAttack: [0.14, 0.30], grab: [0.16, 0.30],
  throw: [0.30, 0.42], finisher: [0.44, 0.60],
  // Timestamps baked by the canonical special exporter, independent of kit balance.
  bodyCheck: [7 / 60, 11 / 60], heelDrop: [16 / 60, 21 / 60],
  risingKnee: [10 / 60, 15 / 60], powerStrike: [18 / 60, 22 / 60],
  hammerRush: [11 / 60, 17 / 60], meteorKick: [16 / 60, 22 / 60],
  cyclone: [13 / 60, 20 / 60], groundBreaker: [19 / 60, 24 / 60],
  burstStrike: [22 / 60, 29 / 60], uppercut: [8 / 60, 14 / 60],
  lungePunch: [13 / 60, 17 / 60], retreatKick: [8 / 60, 12 / 60],
});

export function attackClipTime(frame, move, duration, markers) {
  const total = move.startup + move.active + move.recovery;
  const f = Math.max(0, Math.min(total, frame));
  if (!markers) return total > 0 ? f / total * duration : duration;
  const [contact, release] = markers;
  if (!(contact >= 0 && release >= contact && release <= duration)) {
    throw new RangeError('Animation contact markers must lie within the clip');
  }
  if (f < move.startup) return f / Math.max(1, move.startup) * contact;
  if (f < move.startup + move.active) return contact +
    (f - move.startup) / Math.max(1, move.active) * (release - contact);
  return release + (f - move.startup - move.active) /
    Math.max(1, move.recovery) * (duration - release);
}
