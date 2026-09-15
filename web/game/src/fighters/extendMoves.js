import { MOVES } from '../engine/frameData.js';

// Author only the differences. Every kit still implements the same universal
// buttons, so input, animation and tutorials retain a stable vocabulary.
export function extendMoves(overrides) {
  const result = {};
  for (const [id, base] of Object.entries(MOVES)) {
    const change = overrides[id] || {};
    const hit = { ...base.hit, ...change.hit };
    hit.box = Object.freeze([...hit.box]);
    hit.push = Object.freeze([...hit.push]);
    result[id] = Object.freeze({ ...base, ...change, id, hit: Object.freeze(hit),
      cancelInto: Object.freeze([...(change.cancelInto || base.cancelInto)]),
      cancelWindow: Object.freeze([...(change.cancelWindow || base.cancelWindow)]),
    });
  }
  return Object.freeze(result);
}
