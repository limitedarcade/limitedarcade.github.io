import * as THREE from '../vendor/three.module.js';

// Named, replaceable skeletal clips assembled from the fighter's own rig poses.
// Values after each name are normalized source times, not runtime clip clocks.
const win = {
  carney: [[0,'idle',0],[1.8,'idle',.3],[2.5,'crouch',.6],[3.3,'heavyPunch',.28],[3.7,'heavyPunch',.45],[4,'heavyPunch',.62],[4.5,'victory',.45],[6.8,'victory',.7],[7.4,'crouch',.22],[8,'idle',.4],[10,'idle',.4]],
  trump: [[0,'idle',0],[1.5,'victory',.3],[2,'victory',.65],[2.5,'victory',.3],[3,'victory',.65],[3.6,'heavyPunch',.25],[4,'heavyPunch',.6],[4.5,'victory',.6],[5,'victory',.35],[5.5,'victory',.7],[6,'victory',.35],[6.5,'victory',.7],[8,'victory',.85],[10,'victory',.85]],
  officer_flock: [[0,'guard',0],[1.8,'guard',.2],[2.5,'grab',.45],[3.2,'grab',.8],[3.7,'heavyPunch',.3],[4,'heavyPunch',.6],[4.7,'guard',.1],[6,'guard',.2],[8,'idle',.2],[10,'idle',.2]],
};
const lose = {
  carney: [[0,'hitHigh',.5],[.5,'crouch',.35],[1.1,'crouch',.7],[1.6,'hitLow',.6],[2.3,'crouch',.9],[4,'crouch',.9],[10,'crouch',.9]],
  trump: [[0,'hitHigh',.4],[.35,'hitHigh',.9],[.9,'knockdown',.6],[1.4,'defeat',.9],[1.8,'knockdown',.65],[2.1,'defeat',.9],[2.4,'knockdown',.65],[2.8,'defeat',1],[10,'defeat',1]],
  officer_flock: [[0,'hitHigh',.5],[.6,'crouch',.7],[1.2,'crouchGuard',.3],[1.8,'crouchGuard',.6],[2.5,'defeat',.85],[3.2,'defeat',1],[10,'defeat',1]],
};

export function compose(name, clips, keys) {
  const fallback = clips.idle || clips.guard;
  if (!fallback) return null;
  const poses = keys.map(([time, key, fraction]) => {
    const clip = clips[key] || fallback;
    return { time, tracks: new Map(clip.tracks.map(track => [track.name, {
      track, value: Array.from(track.createInterpolant().evaluate(clip.duration * fraction)),
    }])) };
  });
  const names = new Set(poses.flatMap(pose => [...pose.tracks.keys()]));
  const times = Array.from({ length: 301 }, (_, i) => i / 30);
  const tracks = [];
  for (const binding of names) {
    const base = poses.find(pose => pose.tracks.has(binding)).tracks.get(binding);
    const values = []; let index = 0;
    for (const time of times) {
      while (index < poses.length - 2 && time >= poses[index + 1].time) index++;
      const a = poses[index], b = poses[index + 1];
      const av = (a.tracks.get(binding) || base).value, bv = (b.tracks.get(binding) || base).value;
      const raw = THREE.MathUtils.clamp((time - a.time) / (b.time - a.time), 0, 1), t = raw * raw * (3 - 2 * raw);
      if (base.track.ValueTypeName === 'quaternion') {
        const q = new THREE.Quaternion().fromArray(av).slerp(new THREE.Quaternion().fromArray(bv), t).normalize();
        values.push(...q.toArray());
      } else values.push(...av.map((v, i) => THREE.MathUtils.lerp(v, bv[i], t)));
    }
    tracks.push(new base.track.constructor(binding, times, values));
  }
  const clip = new THREE.AnimationClip(name, 10, tracks);
  clip.userData = { stage: 'lake-america', authoredOutcome: true };
  return clip;
}

export function buildLakeOutcomeClips(id, clips) {
  if (!win[id]) return [];
  return [compose('lakeAmericaWin', clips, win[id]), compose('lakeAmericaLose', clips, lose[id])].filter(Boolean);
}
