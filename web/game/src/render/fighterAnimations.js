import { loadBinaryClips, loadClipAsset } from './binaryClips.js';
import { buildConfidenceClips } from './confidenceClips.js';
import { loadMocapClips } from './mocapClips.js';
import { buildLakeOutcomeClips, compose } from './lakeOutcomeClips.js';

// One composition order for the match and the review lab. Motion packs are
// animation-only replacements; the textured mesh and its rig stay untouched.
export async function fighterAnimations(definition, base) {
  const clips = Object.fromEntries(base.map(clip => [clip.name, clip]));
  const [specials, motion, mocap] = await Promise.all([
    definition.extraClips === false ? [] : loadBinaryClips(definition.id),
    definition.motionAsset ? loadClipAsset(definition.motionAsset) : [],
    loadMocapClips(definition.mocapAsset),
  ]);
  for (const clip of [...specials, ...motion]) clips[clip.name] = clip;
  if (definition.id === 'carney') for (const clip of buildConfidenceClips(clips)) clips[clip.name] = clip;
  // Preserve the authored finisher's source poses before replacing normals.
  for (const clip of mocap) clips[clip.name] = clip;
  for (const clip of buildLakeOutcomeClips(definition.id, clips)) clips[clip.name] = clip;
  if (definition.id === 'carney') {
    const clip = compose('beaverPresentation', clips, [
      [0,'idle',0], [1.35,'crouch',.32], [1.8,'crouch',.4],
      [2.28,'crouch',.35], [2.8,'idle',.3], [3.35,'idle',.3],
      [3.7,'idle',.3], [4.22,'victory',.42], [10,'victory',.42],
    ]);
    if (clip) clips[clip.name] = clip;
  }
  return Object.values(clips);
}
