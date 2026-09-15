import { combatKitFor } from './combatKits.js';
import { FATALITY_REGISTRY } from '../engine/fatalities.js';

export const carneyFighter = Object.freeze({
  id: 'carney',
  label: "Carney",
  combat: combatKitFor('carney'),
  fatalities: FATALITY_REGISTRY.carney,
  runtime: 'gltf',
  runtimeAsset: 'fighters/carney/carney-hero.glb',
  motionAsset: 'fighters/carney/motion.bin',
  mocapAsset: 'fighters/carney/mocap.glb',
  preserveMaterials: true,
  authoredHeight: 1.92,
  facingRotationY: Math.PI / 2,
  clips: Object.freeze({
    bind: 'tpose',
    idle: 'idle',
    guard: 'guard',
    light: 'jab',
  }),
  effects: Object.freeze({
    practiceFinisher: 'paperBurst',
  }),
});
