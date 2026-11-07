// Reserve three seconds for the airborne pursuit, then retain the existing
// collection, handoff and hero hold on the same simulation clock.
const EXTRA_FLIGHT = 138;
export const TRIBUTE = Object.freeze({ land: 42 + EXTRA_FLIGHT, slide: 104 + EXTRA_FLIGHT,
  approach: 55 + EXTRA_FLIGHT, arrive: 150 + EXTRA_FLIGHT,
  lift: 185 + EXTRA_FLIGHT, present: 292 + EXTRA_FLIGHT, take: 322 + EXTRA_FLIGHT,
  place: 384 + EXTRA_FLIGHT, release: 405 + EXTRA_FLIGHT, hero: 438 + EXTRA_FLIGHT, end: 522 + EXTRA_FLIGHT });
export const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export function tributeFlight(t, spawn, landing, out, arc = 4.8) {
  const a = Math.max(0, Math.min(1, t / TRIBUTE.land));
  for (let i = 0; i < 3; i++) out[i] = lerp(spawn[i], landing[i], a);
  out[1] += Math.sin(a * Math.PI) * arc;
  return out;
}
export function tributeImpact(finisher) {
  if (finisher?.id !== 'carney-cold-cut') return null;
  return finisher.script === 'cold-cut-flock' ? 391 : 218;
}
export function tributeTime(finisher, frame) {
  const impact = tributeImpact(finisher);
  return impact === null ? null : Math.max(0, Math.min(TRIBUTE.end, frame - impact));
}
export function tributePose(t) {
  const approach = smooth((t - TRIBUTE.approach) / (TRIBUTE.arrive - TRIBUTE.approach));
  const lift = smooth((t - TRIBUTE.arrive) / (TRIBUTE.lift - TRIBUTE.arrive));
  const carry = smooth((t - TRIBUTE.lift) / (TRIBUTE.present - TRIBUTE.lift));
  const take = smooth((t - TRIBUTE.present) / (TRIBUTE.take - TRIBUTE.present));
  const place = smooth((t - TRIBUTE.take) / (TRIBUTE.place - TRIBUTE.take));
  const retreat = smooth((t - TRIBUTE.release) / (TRIBUTE.hero - TRIBUTE.release));
  return { approach, lift, carry, take, place, retreat,
    headX: t < TRIBUTE.lift ? 3.05 : lerp(3.05, -.08, carry),
    groupX: lerp(7.8, 3.05, approach) - 3.13 * carry,
    carneyX: lerp(-.65, -.3, smooth((t - TRIBUTE.lift) / 80)) + .7 * smooth((place - .35) / .65) - 1.05 * retreat,
    // Carry the collapse away from the head's foreground path and finish
    // beside the board before it appears, leaving its lettering unobstructed.
    bodyOffsetX: 1.9 * smooth(t / 55), bodyZ: -1.15 * smooth(t / 55),
    // Keep the board behind the pickup/handoff, where it cannot mask the head.
    signX: 1.05, signZ: -.35, signTop: 1.28,
  };
}
