// One character per side. Confirming Player 1's pick hands the cursor to Player 2.
export function assignFighter(fighters, side, id, confirmed = [true, true]) {
  if (![0, 1].includes(side) || !id) return { fighters, side, accepted: false };
  if (confirmed[1 - side] && fighters[1 - side] === id) return { fighters, side, accepted: false };
  const next = [fighters[0], fighters[1]];
  next[side] = id;
  return { fighters: next, side: side === 0 ? 1 : side, accepted: true };
}
