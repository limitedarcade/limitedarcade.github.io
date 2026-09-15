// Officer Flock's Overwatch strike: a summoned surveillance drone that rakes a
// laser diagonally down across the arena floor.
//
// This lives outside the fighter's own frame data because the drone outlives
// the move. Flock throws the summon, recovers, and is standing again while the
// camera is still tracking -- which is the whole point of the move. Putting the
// beam on the attacker's move timeline would have tied its length to his
// recovery and made a screen-wide sweep either instant or unpunishable.
//
// Geometry, once, so the renderer and the solver cannot disagree about where
// the beam is: the drone hovers at DRONE_HEIGHT and fires along a fixed
// downward diagonal, so its muzzle is always DRONE_LEAD behind the point the
// beam touches the floor. The sweep is authored as the *floor* contact moving
// from the caster's feet to the far wall; the drone's own path falls out of it.

const DRONE_HEIGHT = 2.45;
const SLOPE = 2.4;
const DEPLOY = 30, LOCK = 16, FIRE = 42, FADE = 14;

export const BEAM = Object.freeze({
  droneHeight: DRONE_HEIGHT,
  // tan(67 deg) -- steep enough that the beam reads as coming down rather than
  // across, shallow enough that the muzzle stays a shoulder's width behind the
  // opening contact and so inside the camera frame even from the corner.
  slope: SLOPE,
  deploy: DEPLOY,   // camera unfolds above the caster's shoulder
  lock: LOCK,       // lens spins up, targeting thread traces the first diagonal
  fire: FIRE,       // the sweep itself
  fade: FADE,       // afterglow while the drone folds away
  thickness: 0.13,
  lead: DRONE_HEIGHT / SLOPE,               // horizontal muzzle-to-floor offset
  total: DEPLOY + LOCK + FIRE + FADE,
});

// Where the strike is in its own life, as a phase plus a 0..1 progress through
// that phase. Everything else -- solver and renderer alike -- reads this.
export function beamPhase(age) {
  if (age < BEAM.deploy) return { phase: 'deploy', t: age / BEAM.deploy };
  if (age < BEAM.deploy + BEAM.lock) return { phase: 'lock', t: (age - BEAM.deploy) / BEAM.lock };
  if (age < BEAM.deploy + BEAM.lock + BEAM.fire)
    return { phase: 'fire', t: (age - BEAM.deploy - BEAM.lock) / BEAM.fire };
  return { phase: 'fade', t: (age - BEAM.deploy - BEAM.lock - BEAM.fire) / BEAM.fade };
}

// The floor contact for a given sweep progress. Eased so the rake starts fast
// and decelerates into the wall, which gives the far side of the arena a
// readable half-beat to react in rather than a uniform wipe.
export function contactAt(strike, t) {
  const k = 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 1.7);
  return strike.fromX + (strike.toX - strike.fromX) * k;
}

// Muzzle position for a floor contact. During deploy and lock the drone parks
// over the opening contact so the telegraph shows exactly where the rake begins.
export function muzzleAt(strike, contactX) {
  return { x: contactX - strike.facing * BEAM.lead, y: BEAM.droneHeight };
}

// Segment/AABB overlap, slab method. The beam is a line, not a box: testing its
// bounding box instead would have the sweep hit a crouching fighter standing
// well clear of the diagonal, which is the one thing this move must not do.
export function segmentHitsBox(ax, ay, bx, by, box, pad = 0) {
  const xMin = box.xMin - pad, xMax = box.xMax + pad;
  const yMin = box.yMin - pad, yMax = box.yMax + pad;
  const dx = bx - ax, dy = by - ay;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, ax - xMin], [dx, xMax - ax], [-dy, ay - yMin], [dy, yMax - ay]]) {
    if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return t0 <= t1;
}

// The live strike. `fromX`/`toX` are floor contacts, so the sweep always starts
// under the caster and ends at the wall he is facing regardless of where in the
// arena he called it -- a corner summon covers less ground, which is the price
// of using it with your back already to the wall.
export function createStrike({ owner, x, facing, arenaMax, move }) {
  const toX = facing >= 0 ? arenaMax + 0.9 : -arenaMax - 0.9;
  // The rake opens a stride in front of the caster rather than under him,
  // because the muzzle sits BEAM.lead behind the contact: an opening contact at
  // his feet would put the drone off the side of the screen every time he
  // called it from the corner.
  //
  // Nothing about the sweep is dodgeable by position -- it crosses the whole
  // floor and the beam is a solid diagonal above it. That is deliberate, and it
  // is why the numbers on the hit are a standing block's problem rather than a
  // life bar's: the answer is guard, and the price of not reading it is the
  // chip plus a knockdown. A fighter already on the floor is under the beam and
  // is not raked, which is the one positional out.
  return { owner, facing, move, fromX: x + facing * 0.9, toX, age: 0, hasHit: false, id: 1 };
}
