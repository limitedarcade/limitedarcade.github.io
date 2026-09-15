import { combatKitFor } from './combatKits.js';
import { FATALITY_REGISTRY } from '../engine/fatalities.js';

export const trumpFighter = Object.freeze({
  id: 'trump',
  label: "Trump",
  combat: combatKitFor('trump'),
  fatalities: FATALITY_REGISTRY.trump,
  runtime: 'threejs',
  mocapAsset: 'fighters/trump/mocap.glb',
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
