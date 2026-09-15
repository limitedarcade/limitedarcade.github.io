import { REEL } from '../engine/reelTimeline.js';

export const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// Polar interpolation follows the outside of the subjects, never a straight
// chord through their bodies. Both halves stop gently at the reverse angle.
export function returnOrbit(frame, start, reverse, end) {
  return Math.PI * (frame <= reverse ? smooth((frame - start) / (reverse - start))
    : 1 - smooth((frame - reverse) / (end - reverse)));
}

export function lakeEntranceCamera(snapshot, { reducedMotion = false, portrait = false, aspect = portrait ? 9 / 16 : 16 / 9 } = {}) {
  if (snapshot.stageId !== 'lake-america' || snapshot.phase !== 'intro' || reducedMotion) return null;
  const frame = snapshot.phaseFrame;
  if (frame >= REEL.roundEnd) return null;
  const orbit = returnOrbit(frame, 0, 155, REEL.roundEnd);
  const lift = Math.sin(orbit / 2);
  return { authored: true, orbit, x: 0, z: 8.2 + lift * 1.2, y: 2.24 + lift * 2.2,
    lookY: 1.46, fov: aspect < .75 ? 46 : aspect < 1.35 ? 39 : 33 };
}

// Preserve the authored angles in narrow panes. Widen the lens and back away
// along the same viewing ray instead of substituting a stationary camera.
function fitShot(shot, aspect) {
  if (aspect >= 1) return shot;
  const distance = Math.max(1, .85 / Math.max(.25, aspect));
  const position = shot.position.map((value, i) => shot.target[i] + (value - shot.target[i]) * distance);
  position[1] = Math.max(.65, position[1]);
  return { ...shot, fov: 48, position };
}

function orbitShot(subject, angle, radius, y, lookY) {
  return { authored: true, position: [subject.x + Math.sin(angle) * radius, y, subject.z + Math.cos(angle) * radius],
    target: [subject.x, lookY, subject.z], fov: 38 };
}

export function lakeOutcomeCamera(frame, winner, loser, { reducedMotion = false, portrait = false, aspect = portrait ? 9 / 16 : 16 / 9, finishedVictim = false } = {}) {
  if (reducedMotion) {
    // Keep the entire sign and both staged actors in a stationary composition.
    return { authored: true, position: [-2.5, 4.6, Math.max(15, 9 / Math.max(.25, aspect))], target: [-2.5, 1, -4], fov: 45, static: true };
  }
  if (frame < 108 && !finishedVictim) {
    const t = smooth(frame / 108);
    return fitShot(orbitShot(loser, lerp(-.55, .5, t), lerp(5.6, 4.7, t), lerp(1.75, 1.1, t), .95), aspect);
  }
  if (frame < 252) {
    const t = smooth((frame - (finishedVictim ? 0 : 108)) / (finishedVictim ? 252 : 144));
    return fitShot(orbitShot(winner, lerp(.8, -.85, t), lerp(6.8, 5.6, t), lerp(2.4, .8, t), 1.1), aspect);
  }
  // The reveal gets a readable insert before the camera returns to the cast.
  if (frame < 312) return fitShot({ authored: true,
    position: [-6.5, 2.05, lerp(-5.4, -6.2, smooth((frame - 252) / 60))], target: [-6.5, 1.45, -11.2], fov: 38 }, aspect);
  const orbit = returnOrbit(frame, 312, 414, 552), lift = Math.sin(orbit / 2);
  return fitShot({ authored: true,
    position: [winner.x + Math.sin(orbit) * 7, 1.8 + lift * 2.1, winner.z + Math.cos(orbit) * 7],
    target: [winner.x, 1.1, winner.z], fov: 38 }, aspect);
}
