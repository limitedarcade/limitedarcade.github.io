// One simulation clock owns the slide, collection, handoff and hero hold.
export const TRIBUTE = Object.freeze({ land: 42, slide: 104, arrive: 150,
  lift: 185, present: 292, take: 322, place: 384, release: 405, hero: 438, end: 522 });
export const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export function tributeImpact(finisher) {
  if (finisher?.id !== 'carney-cold-cut') return null;
  return finisher.script === 'cold-cut-flock' ? 391 : 218;
}
export function tributeTime(finisher, frame) {
  const impact = tributeImpact(finisher);
  return impact === null ? null : Math.max(0, Math.min(TRIBUTE.end, frame - impact));
}
export function tributePose(t) {
  const approach = smooth((t - 55) / (TRIBUTE.arrive - 55));
  const lift = smooth((t - TRIBUTE.arrive) / (TRIBUTE.lift - TRIBUTE.arrive));
  const carry = smooth((t - TRIBUTE.lift) / (TRIBUTE.present - TRIBUTE.lift));
  const take = smooth((t - TRIBUTE.present) / (TRIBUTE.take - TRIBUTE.present));
  const place = smooth((t - TRIBUTE.take) / (TRIBUTE.place - TRIBUTE.take));
  const retreat = smooth((t - TRIBUTE.release) / (TRIBUTE.hero - TRIBUTE.release));
  return { approach, lift, carry, take, place, retreat,
    headX: t < TRIBUTE.lift ? 3.05 : lerp(3.05, -.08, carry),
    groupX: lerp(7.8, 3.05, approach) - 3.13 * carry,
    carneyX: lerp(-.65, -.3, smooth((t - TRIBUTE.lift) / 80)) + .7 * smooth((place - .35) / .65) - 1.05 * retreat,
    signX: 1.05, signZ: .72, signTop: 1.28,
  };
}
