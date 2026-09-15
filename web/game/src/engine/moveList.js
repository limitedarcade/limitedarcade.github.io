// Shared by input resolution, AI, and the pause-screen command list.
export const CHORDS = Object.freeze([
  { buttons: ['lp', 'hp'], move: 'grab', note: 'Close-range clinch. Follow with LK + HK to throw.' },
  { buttons: ['lp', 'lk'], move: 'bodyCheck', note: 'A quick shoulder check to interrupt pressure.' },
  { buttons: ['lp', 'hk'], move: 'heelDrop', note: 'An overhead heel drop. Beats crouching guard.' },
  { buttons: ['hp', 'lk'], move: 'risingKnee', note: 'A rising knee that knocks down on contact.' },
  { buttons: ['hp', 'hk'], move: 'powerStrike', note: 'A slow, forceful strike with long recovery.' },
  { buttons: ['lk', 'hk'], move: 'throw', note: 'Unblockable at close range; misses airborne opponents.' },
  { buttons: ['lp', 'hp', 'lk'], move: 'hammerRush', note: 'A driving hammer strike. Costs one meter stock.' },
  { buttons: ['lp', 'hp', 'hk'], move: 'meteorKick', note: 'A heavy overhead kick. Costs one meter stock.' },
  { buttons: ['lp', 'lk', 'hk'], move: 'cyclone', note: 'A low spinning sweep. Costs one meter stock.' },
  { buttons: ['hp', 'lk', 'hk'], move: 'groundBreaker', note: 'A crushing knockdown. Costs one meter stock.' },
  { buttons: ['lp', 'hp', 'lk', 'hk'], move: 'burstStrike', note: 'A committed power burst. Costs two stocks; punishable on a miss.' },
]);

export const DIRECTIONAL = Object.freeze([
  { move: 'uppercut', direction: 'down', button: 'hp', input: '↓ + HP', note: 'Rising uppercut; catches jump-ins.' },
  { move: 'lungePunch', direction: 'forward', button: 'hp', input: 'Forward + HP', note: 'Step into a long cross. Long recovery.' },
  { move: 'retreatKick', direction: 'back', button: 'lk', input: 'Back + LK', note: 'Kick while withdrawing to create space.' },
  { move: 'crouchKick', direction: 'down', button: 'hk', input: '↓ + HK', note: 'Low sweep; must be blocked crouching.' },
]);

// Commands a single kit adds on top of the universal tables. Signature moves
// that exist on one fighter cannot live in DIRECTIONAL: every consumer of that
// list -- the pause screen, the practice menu, the CPU -- would offer them to
// fighters who have no such move, and the input resolver would try to start it.
// So a kit declares its own, and every one of those readers merges the two.
export function directionalFor(kit) {
  return kit?.commands?.length ? [...DIRECTIONAL, ...kit.commands] : DIRECTIONAL;
}

export function chordMove(buttons) {
  return CHORDS.find(c => c.buttons.length === buttons.length && c.buttons.every(b => buttons.includes(b)))?.move || null;
}

export function directionalMove(button, input, facing, table = DIRECTIONAL) {
  const forward = facing > 0 ? input.right : input.left;
  const back = facing > 0 ? input.left : input.right;
  return table.find(c => c.button === button &&
    ({ down: input.down, forward: forward && !back && !input.down, back: back && !forward && !input.down })[c.direction])?.move;
}
