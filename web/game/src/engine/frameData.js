// Frame data for the eight-move set, in 60 Hz frames.
//
// Everything the combat solver needs lives here as plain data so the rules can
// be tested without a renderer, a GPU, or a clock. Distances are metres in
// fighter-local space where +x is *forward* (toward the opponent); the solver
// mirrors by facing, so a move is authored once and works on both sides.
//
// Guard levels follow the standard 2D-fighter contract:
//   'mid'      blocked standing or crouching
//   'low'      blocked crouching only
//   'overhead' blocked standing only
//   'throw'    unblockable; beaten by spacing and by punishing the recovery

export const TICK_HZ = 60;
export const TICK = 1 / TICK_HZ;

// Body boxes. The fighter is a column; crouching shortens it, which is the
// whole reason overheads and lows mean anything.
export const BODY = Object.freeze({
  pushWidth: 0.52,
  standTop: 1.86,
  crouchTop: 1.16,
  airTop: 1.70,
  halfWidth: 0.29,
});

// A single hit definition. `level` gates blocking, `hitStun`/`blockStun` are in
// frames, `push` is [attackerShove, defenderShove] in metres on contact.
function hit({
  level = 'mid', damage = 40, hitStun = 16, blockStun = 10, chip = 0,
  box, push = [0.10, 0.16], knockdown = false, hitStop = 5,
  meter = 18, bloodScale = 1, launch = 0, juggle = true, groundHit = false,
}) {
  return Object.freeze({
    level, damage, hitStun, blockStun, chip,
    box: Object.freeze(box), push: Object.freeze(push),
    knockdown, hitStop, meter, bloodScale, launch, juggle, groundHit,
  });
}

// box = [xMin, xMax, yMin, yMax] in metres, fighter-local, +x forward.
function special(id, name, clip, startup, active, recovery, damage, box, options = {}) {
  return Object.freeze({ id, name, clip, startup, active, recovery,
    cost: options.cost || 0, travel: options.travel || 0,
    cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
    hit: hit({ damage, box, hitStun: 24, blockStun: 14, hitStop: 8,
      bloodScale: 1.3, ...options }),
  });
}
export const MOVES = Object.freeze({
  bodyCheck: special('bodyCheck', 'Body Check', 'grab', 7, 4, 18, 65, [0.18, 1.12, 0.8, 1.5], { travel: 1.7 }),
  heelDrop: special('heelDrop', 'Heel Drop', 'heavyKick', 16, 5, 24, 108, [0.25, 1.44, 1.05, 1.9], { level: 'overhead' }),
  risingKnee: special('risingKnee', 'Rising Knee', 'lightKick', 10, 5, 22, 94, [0.2, 1.13, 0.8, 1.95], { knockdown: true, launch: 6.4, travel: 0.7 }),
  powerStrike: special('powerStrike', 'Power Strike', 'heavyPunch', 18, 4, 29, 145, [0.25, 1.42, 0.8, 1.8], { knockdown: true, chip: 12, push: [0.15, 0.6] }),
  hammerRush: special('hammerRush', 'Hammer Rush', 'heavyPunch', 11, 6, 24, 170, [0.2, 1.38, 0.8, 1.85], { cost: 1, travel: 3, knockdown: true, bloodScale: 1.8 }),
  meteorKick: special('meteorKick', 'Meteor Heel', 'heavyKick', 16, 6, 25, 182, [0.2, 1.5, 0.9, 1.98], { cost: 1, level: 'overhead', knockdown: true, bloodScale: 1.9 }),
  cyclone: special('cyclone', 'Cyclone Sweep', 'crouchKick', 13, 7, 26, 160, [0.18, 1.65, 0.08, 0.65], { cost: 1, level: 'low', knockdown: true, groundHit: true, travel: 1.5 }),
  groundBreaker: special('groundBreaker', 'Ground Breaker', 'throw', 19, 5, 30, 195, [0.2, 1.45, 0.2, 1.7], { cost: 1, knockdown: true, chip: 18, bloodScale: 2 }),
  burstStrike: special('burstStrike', 'Burst Strike', 'finisher', 22, 7, 40, 290, [0.18, 1.75, 0.4, 1.95], { cost: 2, knockdown: true, chip: 24, bloodScale: 2.6, hitStop: 14 }),
  uppercut: special('uppercut', 'Rising Uppercut', 'heavyPunch', 8, 6, 23, 110, [0.15, 1.14, 0.75, 2.6], { knockdown: true, launch: 7.4 }),
  lungePunch: special('lungePunch', 'Lunging Cross', 'heavyPunch', 13, 4, 24, 102, [0.22, 1.5, 1.1, 1.76], { travel: 2.8 }),
  retreatKick: special('retreatKick', 'Retreating Kick', 'lightKick', 8, 4, 17, 62, [0.24, 1.4, 0.6, 1.2], { travel: -1.8, push: [0.1, 0.42] }),
  lightPunch: Object.freeze({
    id: 'lightPunch', name: 'Light Punch', clip: 'lightPunch',
    startup: 4, active: 3, recovery: 7,
    cancelInto: Object.freeze(['heavyPunch', 'lightKick', 'heavyKick', 'grab']),
    cancelWindow: Object.freeze([4, 12]),
    hit: hit({ damage: 42, hitStun: 15, blockStun: 9, box: [0.26, 1.02, 1.24, 1.62], hitStop: 4, meter: 14, bloodScale: 0.55 }),
  }),
  heavyPunch: Object.freeze({
    id: 'heavyPunch', name: 'Heavy Punch', clip: 'heavyPunch',
    startup: 9, active: 4, recovery: 19,
    cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
    hit: hit({ damage: 98, hitStun: 24, blockStun: 13, chip: 8, box: [0.28, 1.32, 1.10, 1.74], push: [0.16, 0.34], hitStop: 8, meter: 26, bloodScale: 1.35 }),
  }),
  lightKick: Object.freeze({
    id: 'lightKick', name: 'Light Kick', clip: 'lightKick',
    startup: 5, active: 3, recovery: 9,
    cancelInto: Object.freeze(['heavyKick', 'heavyPunch', 'throw']),
    cancelWindow: Object.freeze([5, 14]),
    hit: hit({ damage: 46, hitStun: 15, blockStun: 9, box: [0.26, 1.10, 0.62, 1.06], hitStop: 4, meter: 14, bloodScale: 0.55 }),
  }),
  heavyKick: Object.freeze({
    id: 'heavyKick', name: 'Heavy Kick', clip: 'heavyKick',
    startup: 12, active: 5, recovery: 22,
    cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
    hit: hit({ damage: 114, hitStun: 28, blockStun: 15, chip: 11, box: [0.28, 1.46, 0.82, 1.50], push: [0.20, 0.46], hitStop: 9, knockdown: true, meter: 30, bloodScale: 1.6 }),
  }),

  // Crouch variants share the button but change level and reach. The sweep is
  // the only true low, which is what makes crouch-blocking a real decision
  // instead of a strictly better stance.
  crouchPunch: Object.freeze({
    id: 'crouchPunch', name: 'Crouch Punch', clip: 'crouchPunch',
    startup: 5, active: 3, recovery: 8,
    cancelInto: Object.freeze(['crouchKick', 'heavyKick']), cancelWindow: Object.freeze([5, 13]),
    hit: hit({ damage: 38, hitStun: 14, blockStun: 9, box: [0.26, 0.98, 0.80, 1.14], hitStop: 4, meter: 12, bloodScale: 0.5 }),
  }),
  crouchKick: Object.freeze({
    id: 'crouchKick', name: 'Sweep', clip: 'crouchKick',
    startup: 8, active: 4, recovery: 20,
    cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
    hit: hit({ level: 'low', damage: 72, hitStun: 22, blockStun: 12, chip: 5, box: [0.24, 1.34, 0.06, 0.50], push: [0.14, 0.40], hitStop: 7, knockdown: true, groundHit: true, meter: 22, bloodScale: 1.0 }),
  }),
  jumpAttack: Object.freeze({
    id: 'jumpAttack', name: 'Jump Attack', clip: 'jumpAttack',
    startup: 5, active: 8, recovery: 4, air: true,
    cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
    hit: hit({ level: 'overhead', damage: 66, hitStun: 20, blockStun: 12, chip: 4, box: [0.20, 1.18, 0.60, 1.40], hitStop: 6, meter: 20, bloodScale: 0.9 }),
  }),

  // Both punches. A grab is a stance, not damage: it locks the victim so the
  // attacker can follow up, and it loses to any strike that lands during the
  // long recovery, which is the risk that stops it being free pressure.
  grab: Object.freeze({
    id: 'grab', name: 'Grab', clip: 'grab',
    startup: 3, active: 2, recovery: 26,
    cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
    grabHold: 46, grabTickDamage: 6, grabTickEvery: 9,
    hit: hit({ level: 'throw', damage: 0, hitStun: 46, blockStun: 0, box: [0.22, 0.86, 0.55, 1.60], push: [0, 0], hitStop: 6, meter: 16, bloodScale: 0.3 }),
  }),
  // Both kicks. Unblockable, big damage, hard knockdown, and slow enough to be
  // read. This is the reward the grab sets up and the punish for mashing.
  throw: Object.freeze({
    id: 'throw', name: 'Throw', clip: 'throw',
    startup: 5, active: 2, recovery: 30,
    cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
    hit: hit({ level: 'throw', damage: 138, hitStun: 46, blockStun: 0, box: [0.22, 0.96, 0.45, 1.70], push: [0, 1.35], hitStop: 11, knockdown: true, meter: 34, bloodScale: 2.0 }),
  }),
  finisher: Object.freeze({
    id: 'finisher', name: 'Finisher', clip: 'finisher',
    startup: 18, active: 6, recovery: 40,
    cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
    hit: hit({ level: 'throw', damage: 9999, hitStun: 240, blockStun: 0, box: [0.20, 1.55, 0.30, 1.90], push: [0, 0], hitStop: 22, meter: 0, bloodScale: 4.0 }),
  }),
});

export const MOVE_IDS = Object.freeze(Object.keys(MOVES));

// Movement and match constants. Walk speeds are metres/second; the sim converts
// with TICK so changing TICK_HZ never changes how fast anyone walks.
export const PHYSICS = Object.freeze({
  walkForward: 2.35,
  walkBack: 1.85,
  doubleTapFrames: 12,
  sprintMultiplier: 2.35,
  backHopSpeed: 4.8,
  backHopVelocity: 2.8,
  jumpVelocity: 6.35,
  jumpForwardSpeed: 2.55,
  gravity: 19.5,
  landRecovery: 4,
  arenaMin: -5.4,
  arenaMax: 5.4,
  minSeparation: 0.62,
  startSeparation: 2.5,
  knockdownFrames: 46,
  knockdownProtectionFrames: 18,
  getUpFrames: 22,
  rollFrames: 28,
  rollDistance: 1.15,
  wakeInvulnerableFrames: 8,
  maxJuggleHits: 5,
  juggleLaunch: 7.4,
  jugglePop: 4.8,
  juggleGravityStep: 0.18,
  dizzyFrames: 320,
});

export const MATCH = Object.freeze({
  maxHealth: 1000,
  roundsToWin: 2,
  maxRounds: 3,
  timerTicks: 99,
  ticksPerCount: 54,          // 99 counts x 0.9 s = ~89 s, Mortal Kombat length
  meterMax: 3,
  meterUnitsPerStock: 320,
  finisherStocks: 2,          // FINISH HIM needs the gauge past two thirds
  finisherWindowFrames: 300,  // 5 s to input it
  introFrames: 410,
  roundEndFrames: 240,
});

// The Lake America prop, thrown once a round. It is a projectile, so only the
// name and `hit` are read here -- the toss itself borrows grab's frame data
// (see `Fighter.moveOf`). A real axe takes something with it: `weapon` is what
// tells the gore layer this hit severs rather than merely wounds.
export const STAGE_AXE = Object.freeze({
  id: 'stageAxe', name: 'Ice Axe', clip: 'grab', weapon: 'axe',
  startup: 24, active: 1, recovery: 35,
  cancelInto: Object.freeze([]), cancelWindow: Object.freeze([0, 0]),
  hit: hit({ level: 'mid', damage: 110, chip: 0, hitStun: 24, blockStun: 12,
    box: [0.22, 0.86, 0.55, 1.60], push: [0, 0.4], knockdown: true, hitStop: 8,
    meter: 16, bloodScale: 2 }),
});

// Sim x of the Lake America prop, and how close a fighter must stand to throw
// it. The painted axe sits a little further left; the prompt projects from the
// fighter so it stays readable in the play plane.
export const STAGE_AXE_ZONE = Object.freeze({
  stageId: 'lake-america',
  x: -5,
  reach: 1,
  promptLift: 2.08,
});

export function inStageAxeZone(x) {
  return Math.abs(x - STAGE_AXE_ZONE.x) < STAGE_AXE_ZONE.reach;
}

// Same competitive cost as the axe; a blunt rescue ring has its own stock.
export const STAGE_RING = Object.freeze({
  ...STAGE_AXE, id: 'stageRing', name: 'Rescue Ring', weapon: 'rescueRing',
  hit: Object.freeze({ ...STAGE_AXE.hit, bloodScale: .45 }),
});
export const STAGE_RING_ZONE = Object.freeze({ ...STAGE_AXE_ZONE, x: 5 });
export function inStageRingZone(x) {
  return Math.abs(x - STAGE_RING_ZONE.x) < STAGE_RING_ZONE.reach;
}

// Stage props are not part of any fighter's move list, so they live outside
// MOVES -- adding them there would put an unplayable entry in every loadout,
// the practice list and the CPU's plans -- but `moveOf` still has to resolve
// them for the audio and announcer layers, which look moves up by id.
const STAGE_MOVES = Object.freeze({ stageAxe: STAGE_AXE, stageRing: STAGE_RING });

export function moveOf(id, source = null) {
  const move = source?.moves?.[id] || source?.moveSet?.[id] || MOVES[id] || STAGE_MOVES[id];
  if (!move) throw new Error(`Unknown move: ${id}`);
  return move;
}

export function totalFrames(move) {
  return move.startup + move.active + move.recovery;
}

// Absolute-space box for an attack, given the attacker's position and facing.
// Facing is +1 (looking toward +x) or -1. Mirroring here, once, is why every
// box above can be authored as if the fighter always faced right.
export function worldBox(box, x, y, facing) {
  const [x0, x1, y0, y1] = box;
  return facing >= 0
    ? { xMin: x + x0, xMax: x + x1, yMin: y + y0, yMax: y + y1 }
    : { xMin: x - x1, xMax: x - x0, yMin: y + y0, yMax: y + y1 };
}

export function boxesOverlap(a, b) {
  return a.xMin <= b.xMax && b.xMin <= a.xMax && a.yMin <= b.yMax && b.yMin <= a.yMax;
}
