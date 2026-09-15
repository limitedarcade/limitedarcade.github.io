import * as THREE from '../../vendor/three.module.js';
import { buildFighter } from '../_shared/meshCodec.js';

let cache = null;

export const FIGHTER_ID = "carney";
export const FIGHTER_NAME = "carney";
export const PARTS = ["Head","Torso","LeftArm","RightArm","LeftLeg","RightLeg"];
export const CLIPS = ["tpose","guard","idle","jab","walkF","walkB","crouch","crouchGuard","jump","land","intro","lightPunch","heavyPunch","lightKick","heavyKick","crouchPunch","crouchKick","jumpAttack","grab","grabHold","throw","hitHigh","hitLow","blockHit","grabbed","knockdown","getUp","dizzy","finisher","finisherVictim","victory","defeat"];
export const HEIGHT = 0.967734;

/** Load the packed surface and rig. Cheap to call twice. */
export async function prewarm() {
  if (cache) return cache;
  const [surface, rig] = await Promise.all([
    import('./surfaceData.js'),
    import('./rigData.js'),
  ]);
  cache = { model: surface.SURFACE_MODEL, stream: surface.SURFACE_STREAM, rig: rig.RIG };
  return cache;
}

/**
 * Rebuild the fighter as a Three.js group. Await prewarm() first.
 *
 *   const { group, play, update, explode } = createFighter();
 *   scene.add(group);
 *   play('idle');
 */
export function createFighter(options = {}) {
  if (!cache) {
    throw new Error('call prewarm() and await it before createFighter() — the packed surface loads on demand');
  }
  return buildFighter(THREE, cache.model, cache.stream, cache.rig, {
    castShadow: true,
    receiveShadow: true,
    ...options,
  });
}
