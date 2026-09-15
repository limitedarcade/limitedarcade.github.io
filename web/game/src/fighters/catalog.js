import { trumpFighter } from './trump.js';
import { carneyFighter } from './carney.js';
import { officer_flockFighter } from './officer_flock.js';
import { langFighter } from './lang.js';

const catalog = new Map([
  [trumpFighter.id, trumpFighter],
  [carneyFighter.id, carneyFighter],
  [officer_flockFighter.id, officer_flockFighter],
  [langFighter.id, langFighter],
]);

export const DEFAULT_FIGHTER_ID = trumpFighter.id;

export function getFighter(id) {
  const fighter = catalog.get(id);
  if (!fighter) throw new Error(`Unknown fighter: ${id}`);
  return fighter;
}

export function hasFighter(id) {
  return catalog.has(id);
}

export function listFighters() {
  return [...catalog.values()];
}
