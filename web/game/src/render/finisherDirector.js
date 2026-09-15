import { iceArmPose, ARM_BEATS } from './coldCutIce.js';

const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((value, i) => value + (b[i] - value) * t);

// Local stage coordinates: X follows the attack, Y is up, Z faces the audience.
// Each pursuit is anchored to the exact trajectory used by the actual debris.
export function coldCutCamera(frame, origin, facing, { reducedMotion = false, portrait = false, trackLimbs = true, subjects = {} } = {}) {
  // The second arm finishes sliding at hit + 60, but it remains the subject
  // until the authored return beat. Dropping to master at the exact rest frame
  // leaves both settled arms stranded at the edge of the rink.
  const pursuitRegion = frame >= ARM_BEATS.rightArm.hit && frame < 330 ? 'rightArm'
    : frame >= ARM_BEATS.leftArm.hit && frame < ARM_BEATS.leftArm.hit + 60 ? 'leftArm' : null;
  // Portrait keeps its stable wide composition except for the two authored
  // slapshots. Those cuts must follow the real severed meshes just as desktop
  // does; returning here used to strand the arms outside the phone viewport.
  if (reducedMotion || (portrait && !(pursuitRegion && trackLimbs))) return { authored: true, tight: true, x: origin,
    y: 1.7, lookY: 1.05, z: portrait ? 9 : 6.3, orbit: 0 };
  let position, target, cut;
  const shots = [
    [0, [2.5, 1.35, 5.8], [0, 1.05, 0]],
    [76, [1.3, 1.48, 3.5], [.2, 1.32, 0]],
    [119, [1.9, 1.25, 4.0], [.3, 1.05, 0]],
    [160, [2.3, .5, 4.0], [.15, .48, 0]],
    [194, [1.7, .45, 3.9], [.45, .48, 0]],
    [300, [2.5, 1.35, 5.2], [.1, 1.1, 0]],
    [371, [1.4, 1.5, 3.0], [.3, 1.4, 0]],
    [400, [1.45, 1.44, 3.05], [.4, 1.4, 0]],
    [454, [-2.6, .7, 6.2], [-.1, 1.0, 0]],
    [510, [-3.2, .9, 6.7], [-.1, 1.0, 0]],
  ];
  let index = 0;
  while (index < shots.length - 1 && frame >= shots[index + 1][0]) index++;
  const a = shots[index], b = shots[index + 1] || a;
  const t = b === a ? 0 : smooth((frame - a[0]) / (b[0] - a[0]));
  position = mix(a[1], b[1], t); target = mix(a[2], b[2], t); cut = 'master';
  // Show the swing and contact first, then match the outgoing arm's speed.
  // Cover the full slapshot slide (hit to hit+60), preferring the live arm when both travel.
  const region = pursuitRegion;
  if (region && trackLimbs) {
    const pose = iceArmPose(region, frame, 0, 1, { x: .58, y: 1.3, z: 0 });
    target = [pose.x + .22, pose.y + .25, pose.z];
    position = [pose.x + 1.8, .64, pose.z + 3.3];
    if (subjects[region]) {
      const [worldX,y,z]=subjects[region], localX=(worldX-origin)*facing;
      target=[localX+.08,y,z];
      position=[localX+1.35,y+.5,z+2.7];
    }
    cut = region;
  }
  const world = value => [origin + value[0] * facing, value[1], value[2]];
  return { authored: true, position: world(position), target: world(target), cut, fov: portrait ? 46 : 38 };
}
