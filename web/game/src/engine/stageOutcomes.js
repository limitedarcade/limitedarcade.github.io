// Presentation registry: future arenas can supply their own casts and timing.
// Match rules and fighter health never depend on an ending animation.
export const LAKE_OUTCOMES = Object.freeze({
  carney: Object.freeze({ title: 'NAME RESTORED', quote: 'Lake Ontario. Always was.', sign: 'LAKE ONTARIO', sub: 'LAC ONTARIO', color: '#bcecff' }),
  trump: Object.freeze({ title: 'THE GOLD STANDARD', quote: 'A tremendous lake. Now with my name on it.', sign: 'LAKE TRUMP', sub: 'THE GOLD STANDARD', color: '#ffd575' }),
  officer_flock: Object.freeze({ title: 'SHORELINE SECURED', quote: 'This lake is now a restricted area.', sign: 'LAKE AMERICA', sub: 'SHORELINE CLOSED', color: '#a6d8ff' }),
});

export const LAKE_OUTCOME_FRAMES = 600;
export function stageOutcome(snapshot) {
  if (snapshot.stageId !== 'lake-america' || snapshot.phase !== 'matchEnd' || snapshot.winner == null) return null;
  return LAKE_OUTCOMES[snapshot.fighters[snapshot.winner]?.id] || null;
}

export function resultDuration(snapshot, fallback = 210) {
  if (snapshot.finisher?.id === 'carney-cold-cut') return fallback;
  return stageOutcome(snapshot) ? LAKE_OUTCOME_FRAMES : fallback;
}
