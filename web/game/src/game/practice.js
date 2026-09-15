import { CHORDS, directionalFor } from '../engine/moveList.js';
import { MATCH } from '../engine/frameData.js';
import { PHASE } from '../engine/match.js';
import { fatalitiesFor, BRUTALITY } from '../engine/fatalities.js';

export const MOVEMENT_LESSONS = Object.freeze([
  { id: 'lesson-sprint', name: '04 · Close the gap', group: 'Fundamentals', sub: 'Movement', keys: ['forward', 'forward'],
    description: 'Tap forward, release, then tap forward again and hold to sprint. Release, block or attack to stop. Forward always means toward your opponent.' },
  { id: 'lesson-backhop', name: '05 · Make some space', group: 'Fundamentals', sub: 'Movement', keys: ['back', 'back'],
    description: 'Tap back, release, then tap back again for a short retreating hop. You cannot block or attack until it lands, so choose your moment.' },
  { id: 'lesson-recovery', name: '06 · Get up on your terms', group: 'Fundamentals', sub: 'Movement', keys: ['down', 'up'],
    description: 'You start knocked down. No input or held down keeps you there. After settling, press up or block to rise; forward or back rolls before standing. Down overrides other recovery inputs. Sweeps can still hurt you on the floor.' },
  { id: 'lesson-juggle', name: '07 · Launch and follow up', group: 'Fundamentals', sub: 'Combos', keys: ['down', 'hp', 'lp'], steps: [['down', 'hp'], ['lp']],
    description: 'Hold down + heavy punch to launch. Release, wait for your uppercut to recover, then tap light punch while your partner is airborne. Each follow-up loses lift and adds gravity; the fifth airborne hit ends the juggle opportunity.' },
]);

// Where each move sits in the list a player reads. Object.values() order put
// every metered special above the jab; this is the order the moves are learned
// in, and the sub-heading each one files under inside its tab.
const SHELF = Object.freeze({
  lightPunch: 'Normals', heavyPunch: 'Normals', lightKick: 'Normals', heavyKick: 'Normals',
  crouchPunch: 'Crouching', crouchKick: 'Crouching', jumpAttack: 'In the air',
  uppercut: 'Command', lungePunch: 'Command', retreatKick: 'Command',
  grab: 'Clinch', throw: 'Clinch',
});
const ORDER = Object.freeze(['lightPunch', 'heavyPunch', 'lightKick', 'heavyKick', 'crouchPunch', 'crouchKick',
  'jumpAttack', 'uppercut', 'lungePunch', 'retreatKick', 'grab', 'throw',
  'bodyCheck', 'heelDrop', 'risingKnee', 'powerStrike',
  'hammerRush', 'meteorKick', 'cyclone', 'groundBreaker', 'burstStrike']);

// What a move costs and what it does outrank the table. A kit is free to turn a
// universal command normal into a projectile (Flock's shuriken) or into a
// metered signature (Carney's Polar Reversal), and neither belongs on the
// shelf next to the jab just because it kept the same move id.
export function shelveMove(move) {
  if (move.cost >= 2) return { group: 'Supers', sub: 'Two stocks' };
  if (move.cost >= 1) return { group: 'Supers', sub: 'One stock' };
  if (move.projectile) return { group: 'Specials', sub: 'At range' };
  if (move.overwatch) return { group: 'Specials', sub: 'Summon' };
  if (SHELF[move.id]) return { group: 'Basics', sub: SHELF[move.id] };
  return { group: 'Specials', sub: CHORDS.some(c => c.move === move.id) ? 'Two buttons' : 'Signature' };
}

export function practiceMoves(fighter, stage) {
  const inputs = new Map(CHORDS.map(c => [c.move, c.buttons]));
  // The kit's own commands as well as the universal ones, so a signature move
  // arrives in the practice list with the buttons that actually perform it
  // rather than with an empty input strip.
  for (const d of directionalFor(fighter.kit)) inputs.set(d.move, [d.direction, d.button]);
  for (const [id, keys] of Object.entries({ lightPunch: ['lp'], heavyPunch: ['hp'], lightKick: ['lk'], heavyKick: ['hk'], crouchPunch: ['down', 'lp'], jumpAttack: ['up', 'lp'] })) inputs.set(id, keys);
  // `ends` names the move the chain finishes on. A chain entry has no move id
  // of its own, so it is the only way a caller -- the panel's copy, the
  // demonstration test -- can tell which attack proves the lesson landed.
  const easy = fighter.kit.easyChains ? [
    { id: 'easy-carney-roundhouse', name: '08 · Three taps, high kick', comboButtons: ['lp', 'lp', 'lp'], ends: 'heavyKick', description: 'Release between three light-punch taps. Land the first punch to flow through a shoulder check into Final Draft. Holding the button does not repeat it; blocks and misses stop the chain.' },
    { id: 'easy-carney-axe', name: '09 · Change the ending', comboButtons: ['lp', 'lk', 'lk'], ends: 'heelDrop', description: 'Tap light punch, light kick, light kick. Land the opener to finish with Ice Pick, an overhead axe kick. Choose your ending; mixing every button can produce a different chord.' },
    { id: 'easy-carney-spin', name: '10 · Spend on spectacle', comboButtons: ['lp', 'lp', 'hk'], ends: 'spinKick', description: 'Tap light punch twice, then heavy kick. Polar Reversal costs one meter stock and ends the chain with a spinning heel. Practice supplies meter; a real round makes you earn it. Forward + HK also performs it.' },
  ].map(entry => ({ ...entry, keys: entry.comboButtons, endsName: fighter.moves[entry.ends]?.name, group: 'Fundamentals', sub: 'Easy chains' })) : [];
  const moves = Object.values(fighter.moves).filter(m => m.id !== 'finisher')
    .map(m => ({ ...m, keys: inputs.get(m.id) || [], ...shelveMove(m) }))
    // Cost first, so the two-stock burst always closes the Supers tab even when
    // a kit adds a metered move the universal order has never heard of.
    .sort((a, b) => (a.cost || 0) - (b.cost || 0) ||
      (ORDER.indexOf(a.id) + 1 || ORDER.length + 1) - (ORDER.indexOf(b.id) + 1 || ORDER.length + 1));
  return [...easy, ...moves,
    ...(stage === 'lake-america' ? [{ id: 'stageAxe', name: 'Arena axe', keys: ['down', 'lp', 'hp'], group: 'Basics', sub: 'Arena', description: 'Crouch and press both punches beside the axe at the far-left edge. Reset places you there. The stage holds one axe, and it can be thrown only once per round.' }] : []),
    ...fatalitiesFor(fighter.id, stage).map(f => ({ ...f, keys: f.command, group: 'Finishers', sub: 'Fatality' })),
    ...(fighter.moves.uppercut?.brutality !== false
      ? [{ ...BRUTALITY, keys: ['down', 'hp'], group: 'Finishers', sub: 'Brutality' }] : [])];
}

export function preparePractice(match, entry) {
  match.startRound(); match.round = 1; match.phase = PHASE.FIGHT; match.phaseFrame = 0;
  match.events.length = 0;
  const distance = entry?.range && entry.kind !== 'brutality' ? Math.max(0.85, (entry.range.min + Math.min(entry.range.max, 3)) / 2) : entry?.projectile || entry?.overwatch ? 3 : 0.85;
  match.fighters.forEach((f, i) => { f.resetRound((i ? 1 : -1) * distance / 2); f.state = 'idle'; f.roundsWon = 0; f.addMeter(9999); });
  if (entry?.id === 'stageAxe') { match.left.x = -5; match.right.x = -2; }
  if (entry?.id === 'lesson-sprint') { match.left.x = -3.2; match.right.x = 2.2; }
  if (entry?.id === 'lesson-recovery') match.left.enterHitStun(0, true);
  if (entry?.group === 'Finishers') {
    match.roundsToWin = 1;
    if (entry.kind === 'brutality') {
      match.right.health = 1; match.right.comboCount = 2; match.right.comboIdle = 0;
      match.right.enterHitStun(90, false);
    } else {
      match.phase = PHASE.FINISHER_WINDOW; match.roundWinner = 0;
      match.left.roundsWon = 1; match.right.health = 0; match.right.enterDizzy();
    }
  }
}

// Demonstrations use the same held inputs as a player, including chord timing.
export function demonstrationInput(entry, frame, facing = 1, match = null) {
  const direction = key => key === 'forward' ? (facing > 0 ? 'right' : 'left') : key === 'back' ? (facing > 0 ? 'left' : 'right') : key;
  if (entry?.id === 'lesson-move') return frame < 40 ? { left: true } : frame < 80 ? { right: true } : {};
  if (entry?.id === 'lesson-jump') return frame < 8 ? { up: true } : frame > 65 && frame < 100 ? { down: true } : {};
  if (entry?.id === 'lesson-block') return { block: true };
  if (entry?.id === 'lesson-recovery') return frame >= 90 && frame < 115 ? { [direction('back')]: true } : {};
  if (frame < 20) return {};
  if (entry?.comboButtons) {
    const tick = frame - 20, button = entry.comboButtons[Math.floor(tick / 12)];
    return button && tick % 12 < 3 ? { [button]: true } : {};
  }
  if (entry?.id === 'lesson-sprint' || entry?.id === 'lesson-backhop') {
    const pressed = (frame >= 20 && frame < 22) || (frame >= 25 && frame < (entry.id === 'lesson-sprint' ? 60 : 27));
    return pressed ? { [direction(entry.id === 'lesson-sprint' ? 'forward' : 'back')]: true } : {};
  }
  if (entry?.id === 'lesson-juggle') {
    if (frame < 30) return { down: true, hp: true };
    if (match?.left.isActionable() && match.right.state === 'juggle' && match.right.juggleHits === 1) return { lp: true };
    return {};
  }
  if (entry.group === 'Finishers' && entry.kind !== 'brutality') {
    const n = frame - 20, index = Math.floor(n / 12);
    return index < entry.keys.length && n % 12 < 5 ? { [direction(entry.keys[index])]: true } : {};
  }
  if (entry.id === 'jumpAttack') return frame < 27 ? { up: true } : frame < 36 ? { lp: true } : {};
  return frame < 30 ? Object.fromEntries(entry.keys.map(k => [direction(k), true])) : {};
}

export function practiceDummyInput(match, entry, behavior = 'idle', frame = 0) {
  if (entry?.group === 'Finishers') return {};
  if (match.right.state === 'downed' || match.right.state === 'getUp') return { block: true };
  if (entry?.id === 'lesson-block' || behavior === 'attack') return frame % 90 < 9 ? { lp: true } : {};
  return behavior === 'block' ? { block: true } : behavior === 'crouch' ? { block: true, down: true } : {};
}

export function sustainPractice(match, entry) {
  match.timer = MATCH.timerTicks;
  if (match.phase === PHASE.FINISHER_WINDOW) match.phaseFrame = Math.min(match.phaseFrame, 120);
  for (const f of match.fighters) {
    f.addMeter(9999);
    if (match.phase === PHASE.FIGHT && entry?.kind !== 'brutality') f.health = f.maxHealth;
  }
  if (entry?.kind === 'brutality' && match.phase === PHASE.FIGHT && match.right.health > 0) {
    match.right.comboCount = Math.max(2, match.right.comboCount); match.right.comboIdle = 0;
    if (match.right.state !== 'hitStun') match.right.enterHitStun(90, false);
  }
}
