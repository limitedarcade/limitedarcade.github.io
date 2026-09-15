import { combatKitFor } from './combatKits.js';

export const langFighter = Object.freeze({
  id: 'lang', label: 'Jake Lang', combat: combatKitFor('lang'),
  runtime: 'threejs', extraClips: false,
  authoredHeight: 1.92, facingRotationY: Math.PI / 2,
  clips: Object.freeze({ bind: 'tpose', idle: 'idle', guard: 'guard', light: 'lang_lightPunch' }),
  effects: Object.freeze({ practiceFinisher: 'paperBurst' }),
});
