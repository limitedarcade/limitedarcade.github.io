// Fixed phase frames are the edit points; rendering and sound share this reel.
export const REEL = Object.freeze({ versusEnd: 110, introEnd: 210, roundEnd: 335,
  fightEnd: 410, slowEnd: 32, freezeEnd: 52, koEnd: 100, roundEndFrames: 240, resultFrames: 210 });

// The round that decides the match: both fighters are one win short. A best-of
// one has no decider -- every round is simply the round.
export function decidingRound(s) {
  return s.roundsToWin > 1 && s.fighters.every((f) => f.roundsWon === s.roundsToWin - 1);
}

export function endCard(snapshot) {
  if (snapshot.friendship) return { kind: 'friendship', title: 'PLEASE HOLD', subtitle: 'FRIENDSHIP' };
  if (snapshot.brutality) return { kind: 'brutality', title: 'BRUTALITY', subtitle: 'COMBO COMPLETE' };
  if (snapshot.fatality && snapshot.finisher?.kind === 'stage') return { kind: 'fatality', title: 'STAGE FATALITY', subtitle: snapshot.finisher.name.toUpperCase() };
  if (snapshot.fatality) return { kind: 'fatality', title: 'FATALITY', subtitle: 'FINALITY' };
  if (snapshot.roundReason === 'double') return { kind: 'double', title: 'DOUBLE K.O.', subtitle: 'BOTH FIGHTERS DOWN' };
  if (snapshot.flawless) return { kind: 'flawless', title: 'FLAWLESS', subtitle: 'VICTORY' };
  if (snapshot.winner === null && snapshot.phase === 'matchEnd') return { kind: 'draw', title: 'DRAW', subtitle: 'THE RIVALRY CONTINUES' };
  return { kind: 'victory', title: 'VICTORY', subtitle: snapshot.roundReason === 'timeout' ? 'TIME EXPIRED' : 'ROUND COMPLETE' };
}

export function reelAt(s) {
  const f = s.phaseFrame;
  if (s.phase === 'intro') {
    if (f < REEL.versusEnd) return { stage: 'versus', t: f / 60, text: 'VS', voice: 'versus', locked: true };
    if (f < REEL.introEnd) return { stage: 'walkout', t: (f - REEL.versusEnd) / 60, locked: true };
    if (f < REEL.roundEnd) {
      const decider = decidingRound(s);
      return { stage: 'round', t: (f - REEL.introEnd) / 60,
        text: decider ? 'FINAL ROUND' : `ROUND ${s.round}`,
        voice: decider ? 'deathRound' : `round${Math.min(s.round, 3)}`, locked: true };
    }
    return { stage: 'fight', t: (f - REEL.roundEnd) / 60, text: 'FIGHT!', voice: 'fight', locked: true };
  }
  if (s.phase === 'roundEnd') {
    const decided = s.fighters.some(fighter => fighter.roundsWon >= s.roundsToWin)
      || s.round >= s.roundsToWin * 2 - 1;
    if (f >= 190 && !decided) return { stage: 'intermission', t: (f - 190) / 60,
      text: `ROUND ${s.round + 1}`, subtitle: 'RESET THE RIVALRY', locked: true };
    if (f < REEL.slowEnd && s.roundReason !== 'timeout') return { stage: 'slowmo', t: f / 60, scale: 0.2, locked: true };
    if (f < REEL.freezeEnd && s.roundReason !== 'timeout') return { stage: 'freeze', t: (f - REEL.slowEnd) / 60, scale: 0, locked: true };
    if (f < REEL.koEnd) return { stage: 'ko', t: Math.max(0, f - REEL.freezeEnd) / 60,
      text: s.roundReason === 'double' ? 'DOUBLE K.O.' : s.roundReason === 'timeout' ? 'TIME UP' : 'K.O.',
      voice: s.roundReason === 'timeout' ? 'suddenDeath' : 'ko', scale: s.roundReason === 'timeout' ? 1 : 0, locked: true };
    return { stage: 'roundVictory', t: (f - REEL.koEnd) / 60, locked: true };
  }
  if (s.phase === 'finisherWindow') return { stage: 'finish', t: f / 60, text: 'FINISH IT!', voice: 'finish', locked: false };
  if (s.phase === 'finisher') return { stage: 'execution', t: f / 60, locked: true };
  if (s.phase === 'matchEnd') return { stage: 'result', t: f / 60, text: endCard(s).title,
    voice: s.friendship ? 'finale' : s.brutality ? 'brutality' : s.fatality ? 'fatality' : s.winner === null ? 'ko' : 'victor', locked: true };
  return { stage: 'play', t: 0, locked: false };
}
