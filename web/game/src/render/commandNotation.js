import { keyLabel } from '../game/options.js';

export const ACTION = Object.freeze({
  lp: { label: 'LP', tone: 'lp', pad: 'x', padName: 'X' },
  hp: { label: 'HP', tone: 'hp', pad: 'y', padName: 'Y' },
  lk: { label: 'LK', tone: 'lk', pad: 'a', padName: 'A' },
  hk: { label: 'HK', tone: 'hk', pad: 'b', padName: 'B' },
  block: { label: 'BLK', tone: 'block', pad: 'lb', padName: 'LB' },
  grab: { label: 'GRAB', tone: 'grab', pad: 'xy', padName: 'X+Y' },
});
export const DIR = Object.freeze({
  up: '↑', down: '↓', left: '←', right: '→', forward: 'F', back: 'B',
  '↑': '↑', '↓': '↓', '←': '←', '→': '→', f: 'F', b: 'B',
});
const JOIN = new Set(['+', '→', 'then', '/', '·']);
const DIR_ID = Object.freeze({ '↑': 'up', '↓': 'down', '←': 'left', '→': 'right', f: 'forward', b: 'back' });

export function keyCapText(code) {
  if (!code) return '?';
  if (/^Numpad/.test(code)) return code.replace(/^Numpad/, '');
  return keyLabel(code);
}

export function notationTokens(text) {
  if (!text) return [];
  return String(text).split(/(\s*(?:→|\+|then|\/|·)\s*)/i).filter(part => part !== '').map(part => {
    const raw = part.trim();
    const join = raw.toLowerCase();
    if (JOIN.has(join) || JOIN.has(raw)) return ['join', join === 'then' ? 'then' : (raw === '→' ? '→' : (raw === '/' ? '/' : '+'))];
    const id = raw.toLowerCase();
    if (ACTION[id]) return ['action', id];
    if (DIR[id] !== undefined) return ['dir', DIR_ID[id] || id];
    return ['text', raw];
  });
}

export function tokensFromActions(ids, join = '+') {
  const out = [];
  for (const [i, id] of ids.entries()) {
    if (i) out.push(['join', join]);
    const key = String(id).toLowerCase();
    if (ACTION[key]) out.push(['action', key]);
    else if (DIR[key] !== undefined) out.push(['dir', key]);
    else out.push(['text', id]);
  }
  return out;
}
