import { combatKitFor } from './combatKits.js';

export const officer_flockFighter = Object.freeze({
  id: 'officer_flock',
  label: 'Officer Flock',
  combat: combatKitFor('officer_flock'),
  runtime: 'threejs',
  sceneAsset: 'fighters/officer_flock/model.json',
  extraClips: false,
  preserveMaterials: true,
  authoredHeight: 1.92,
  facingRotationY: Math.PI / 2 - 0.3,
  clips: Object.freeze({ bind: 'tpose', idle: 'idle', guard: 'guard', light: 'jab' }),
  effects: Object.freeze({ practiceFinisher: 'paperBurst' }),
});
