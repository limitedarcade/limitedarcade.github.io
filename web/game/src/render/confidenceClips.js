import * as THREE from '../vendor/three.module.js';

// Presentation-only edits of the existing rig animation. Keeping these as
// named clips lets a Blender animator replace them without touching combat.
function retime(name, source, keys) {
  if (!source) return null;
  const times = keys.map(key => key[0]);
  const tracks = source.tracks.map(track => {
    const sample = track.createInterpolant();
    const values = keys.flatMap(([, time]) => Array.from(sample.evaluate(Math.min(time, source.duration))));
    return new track.constructor(track.name, times, values, track.getInterpolation());
  });
  return new THREE.AnimationClip(name, times.at(-1), tracks);
}

export function buildConfidenceClips(clips) {
  return [
    retime('confidenceWindup', clips.heavyPunch, [[0, 0], [0.28, 0.10], [0.9, 0.20]]),
    retime('confidenceSlash', clips.heavyPunch, [[0, 0.20], [0.20, 0.23], [0.315, 0.26], [0.44, 0.30], [0.58, 0.36], [0.85, 0.56]]),
    retime('confidenceRaise', clips.victory, [[0, 0], [0.6, 0.6], [1.2, 1.1], [2.6, 1.1]]),
    retime('confidenceSlapshot', clips.heavyPunch, [[0, 0], [0.38, 0.20], [0.50, 0.30], [0.68, 0.56], [0.86, 0], [1.15, 0.20], [1.267, 0.30], [1.5, 0.56]]),
  ].filter(Boolean);
}
