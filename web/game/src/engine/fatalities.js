// Secret commands are relative to facing. These are fictional arcade routines;
// their camera/actor tracks are presentation data, never combat advantages.
import { TRIBUTE } from './beaverTribute.js';
const CLOSE = Object.freeze({ label: 'Close', min: 0.62, max: 1.3 });
const SWEEP = Object.freeze({ label: 'Sweep distance', min: 1.5, max: 2.9 });
const ANY = Object.freeze({ label: 'Anywhere', min: 0, max: 12 });

const actor = (clip, x = 0, y = 0, turn = 0) => ({ clip, x, y, turn });
const shot = (frame, z, y, lookY, attacker, victim, x = 0, lens = {}) => Object.freeze({ frame,
  camera: Object.freeze({ z, y, lookY, x, ...lens }), attacker: Object.freeze(attacker), victim: Object.freeze(victim) });
const beat = (frame, type, bloodScale, level = 'mid') => Object.freeze({ frame, type, bloodScale, level });
const sequence = (id, name, command, range, script, tagline, extra = {}) => Object.freeze({
  id, name, command: Object.freeze(command), range, script, tagline, kind: 'fatality', ...extra,
});

export const FINISHER_SCRIPTS = Object.freeze({
  'cold-cut-flock': Object.freeze({ duration: 391 + TRIBUTE.end, impactFrame: 391, cameraMotion: true,
    shots: Object.freeze([
      shot(0, 4.3, 1.45, 1.2, actor('guard', -0.58), actor('dizzy', 0.58), 0, { orbit: -0.16 }),
      shot(54, 3.6, 1.7, 1.4, actor('confidenceWindup', -0.58), actor('dizzy', 0.58), 0, { orbit: 0.18 }),
      shot(81, 3.6, 1.5, 1.3, actor('confidenceSlash', -0.58), actor('hitHigh', 0.58), 0, { orbit: 0.18 }),
      shot(124, 3.9, 0.48, 0.55, actor('guard', -0.58), actor('dizzy', 0.58), 0.3, { orbit: -0.24 }),
      shot(170, 3.9, 0.48, 0.5, actor('confidenceSlapshot', -0.58), actor('dizzy', 0.58), 0.3, { orbit: -0.24 }),
      shot(200, 3.9, 0.48, 0.5, actor('confidenceSlapshot', -0.58), actor('dizzy', 0.58), 0.3, { orbit: -0.24 }),
      shot(224, 4.3, 0.35, 0.28, actor('confidenceSlapshot', -0.58), actor('dizzy', 0.58), 2.6, { orbit: -0.38 }),
      shot(246, 4.3, 0.35, 0.28, actor('confidenceSlapshot', -0.58), actor('dizzy', 0.58), 2.6, { orbit: -0.38 }),
      shot(285, 4.9, 0.45, 0.3, actor('guard', -0.58), actor('dizzy', 0.58), 4.2, { orbit: -0.3 }),
      shot(330, 3.8, 1.3, 1.42, actor('confidenceWindup', -0.58), actor('dizzy', 0.58), 0, { orbit: 0.3 }),
      shot(372, 3.8, 1.3, 1.42, actor('confidenceSlash', -0.58), actor('dizzy', 0.58), 0, { orbit: 0.3 }),
      shot(400, 4.2, 1.15, 1.2, actor('confidenceRaise', -0.65), actor('defeat', 0.7), 0, { orbit: 0.3 }),
      shot(454, 5.2, 0.72, 1.15, actor('confidenceRaise', -0.65), actor('defeat', 0.7), 0, { orbit: 0.12 }),
    ]), beats: Object.freeze([
      Object.freeze({ ...beat(100, 'slash', 2.2), region: 'leftArm' }),
      Object.freeze({ ...beat(110, 'slash', 2.2), region: 'rightArm' }),
      Object.freeze({ ...beat(200, 'slapshot', 0, 'low'), region: 'leftArm' }),
      Object.freeze({ ...beat(246, 'slapshot', 0, 'low'), region: 'rightArm' }),
      beat(391, 'final', 4.8, 'high'),
    ]),
  }),
  'curtain-call': Object.freeze({ duration: 270, impactFrame: 166,
    shots: Object.freeze([
      shot(0, 3.6, 1.8, 1.42, actor('guard', -0.47), actor('dizzy', 0.47)),
      shot(36, 3.0, 1.95, 1.50, actor('heavyPunch', -0.45), actor('hitHigh', 0.49)),
      shot(88, 3.5, 1.1, 1.10, actor('heavyKick', -0.5), actor('hitLow', 0.56)),
      shot(140, 3.1, 1.7, 1.30, actor('finisher', -0.52), actor('dizzy', 0.50)),
      shot(182, 5.4, 1.9, 0.82, actor('victory', -0.75), actor('defeat', 1.15)),
    ]), beats: Object.freeze([beat(49, 'blunt', 1.6), beat(102, 'slash', 2), beat(166, 'final', 4.2)]),
  }),
  'sky-fall': Object.freeze({ duration: 290, impactFrame: 192,
    shots: Object.freeze([
      shot(0, 4.9, 1.4, 1.1, actor('guard', -0.9), actor('dizzy', 0.9)),
      shot(42, 3.7, 0.7, 1.4, actor('uppercut', -0.55), actor('hitHigh', 0.5)),
      shot(85, 5.0, 3.2, 2.4, actor('guard', -0.7), actor('hitHigh', 0.8, 1.8, 0.6)),
      shot(137, 3.8, 1.6, 1.15, actor('powerStrike', -0.5), actor('hitHigh', 0.85, 0.9, 0.25)),
      shot(192, 5.8, 1.0, 0.6, actor('victory', -0.9), actor('defeat', 1.25)),
    ]), beats: Object.freeze([beat(60, 'blunt', 2), beat(158, 'blunt', 2.2), beat(192, 'final', 4.6)]),
  }),
  'cold-cut': Object.freeze({ duration: 218 + TRIBUTE.end, impactFrame: 218,
    shots: Object.freeze([
      shot(0, 3.4, 1.3, 1.3, actor('guard', -0.58), actor('dizzy', 0.58), 0, { orbit: -0.22 }),
      shot(48, 2.8, 1.9, 1.55, actor('confidenceWindup', -0.56), actor('dizzy', 0.56), -0.35, { orbit: 0.32, roll: -0.045 }),
      shot(102, 3.5, 1.05, 1.22, actor('confidenceSlash', -0.56), actor('hitLow', 0.58), 0.1, { orbit: -0.18 }),
      shot(142, 2.8, 1.88, 1.55, actor('confidenceWindup', -0.58), actor('hitHigh', 0.62), 0.36, { orbit: -0.34, roll: 0.035 }),
      shot(192, 3.3, 1.15, 1.5, actor('confidenceSlash', -0.6), actor('dizzy', 0.63), 0.12, { orbit: 0.22 }),
      shot(234, 4.8, 0.62, 1.20, actor('confidenceRaise', -0.75), actor('defeat', 0.85), 0, { orbit: -0.3 }),
      shot(306, 5.4, 1.35, 1.13, actor('confidenceRaise', -0.75), actor('defeat', 0.85), 0, { orbit: 0.15 }),
    ]), beats: Object.freeze([beat(121, 'slash', 2.4), beat(218, 'final', 4.8)]),
  }),
  whiteout: Object.freeze({ duration: 282, impactFrame: 181,
    shots: Object.freeze([
      shot(0, 5.0, 1.6, 1.20, actor('guard', -0.95), actor('dizzy', 0.95)),
      shot(40, 4.2, 1.0, 0.95, actor('lungePunch', -0.62), actor('hitHigh', 0.56)),
      shot(84, 3.6, 0.75, 0.55, actor('cyclone', -0.6), actor('hitLow', 0.65, 0.15, 0.8)),
      shot(134, 4.3, 2.6, 1.4, actor('heelDrop', -0.62), actor('hitHigh', 0.75, 0.5, 1.25)),
      shot(181, 5.8, 1.3, 0.65, actor('victory', -0.9), actor('defeat', 1.2)),
    ]), beats: Object.freeze([beat(52, 'blunt', 1.3), beat(98, 'slash', 2), beat(181, 'final', 4.3)]),
  }),
  'stage-drop': Object.freeze({ duration: 300, impactFrame: 198,
    shots: Object.freeze([
      shot(0, 5.2, 1.7, 1.2, actor('guard', -0.75), actor('dizzy', 0.75)),
      shot(40, 3.7, 1.65, 1.25, actor('grab', -0.4), actor('grabbed', 0.4)),
      shot(93, 4.9, 1.0, 1.2, actor('throw', -0.65), actor('hitHigh', 0.7, 0.2)),
      shot(145, 6.7, 2.8, 1.25, actor('victory', -0.9), actor('hitHigh', 2.3, 1.15, 1.2), 1.1),
      shot(198, 7.0, 2.1, 0.7, actor('victory', -0.9), actor('defeat', 3.4), 1.0),
    ]), beats: Object.freeze([beat(106, 'blunt', 1.8), beat(198, 'stage', 4.8)]),
  }),
  'please-hold': Object.freeze({ duration: 260, impactFrame: 155,
    shots: Object.freeze([
      shot(0, 4.8, 1.8, 1.3, actor('guard', -0.9), actor('dizzy', 0.9)),
      shot(50, 3.6, 1.8, 1.45, actor('intro', -0.9), actor('idle', 0.9)),
      shot(120, 5.1, 1.7, 1.1, actor('victory', -0.9), actor('defeat', 0.9)),
      shot(185, 5.8, 2.0, 1.1, actor('victory', -0.9), actor('defeat', 0.9)),
    ]), beats: Object.freeze([beat(155, 'confetti', 0)]),
  }),
  overkill: Object.freeze({ duration: 210, impactFrame: 38,
    shots: Object.freeze([
      shot(0, 3.8, 1.0, 1.2, actor('uppercut', -0.55), actor('hitHigh', 0.55)),
      shot(48, 5.3, 2.3, 1.65, actor('guard', -0.75), actor('hitHigh', 0.8, 1.0, 0.8)),
      shot(100, 5.8, 1.6, 0.75, actor('victory', -0.9), actor('defeat', 1.25)),
    ]), beats: Object.freeze([beat(38, 'final', 4.1)]),
  }),
});

export const FATALITY_REGISTRY = Object.freeze({
  trump: Object.freeze([
    sequence('trump-curtain-call', 'Curtain Call', ['down', 'forward', 'down', 'hp'], CLOSE, 'curtain-call', 'THE ENCORE HAS BEEN CANCELLED.'),
    sequence('trump-sky-fall', 'Sky Fall', ['back', 'forward', 'back', 'hk'], SWEEP, 'sky-fall', 'MIND THE LANDING.'),
  ]),
  carney: Object.freeze([
    sequence('carney-cold-cut', 'Vote of No Confidence', ['down', 'back', 'down', 'hp'], CLOSE, 'cold-cut', 'CONFIDENCE: ZERO. HEADCOUNT: MINUS ONE.'),
    sequence('carney-whiteout', 'Whiteout', ['forward', 'back', 'forward', 'hk'], SWEEP, 'whiteout', 'VISIBILITY: NONE.'),
  ]),
});

const STAGE_TITLES = Object.freeze({ 'lake-america': ['Lake Effect', 'THIN ICE. THICK REGRET.'],
  capitol: ['Closing Ceremony', 'PLEASE USE THE OTHER EXIT.'], 'palm-resort': ['Pool Rules', 'NO RUNNING. NO REMATCH.'],
  'executive-lawn': ['Garden Variety', 'KEEP OFF THE GRASS.'] });
export const JOKE_FINISHER = sequence('please-hold', 'Please Hold', ['down', 'down', 'lp'], ANY, 'please-hold',
  'YOUR CALL IS VERY IMPORTANT TO US.', { kind: 'friendship' });
export const BRUTALITY = sequence('overkill', 'Overkill', [], ANY, 'overkill', 'A LITTLE TOO MUCH FOLLOW-THROUGH.',
  { kind: 'brutality', requirement: 'Win the deciding round with a Rising Uppercut as hit 3 or later in a combo.' });

export function stageFatality(stageId = 'lake-america') {
  const [name, tagline] = STAGE_TITLES[stageId] || STAGE_TITLES['lake-america'];
  return sequence(`stage-${stageId}`, name, ['down', 'forward', 'back', 'hk'], SWEEP, 'stage-drop', tagline,
    { kind: 'stage', stageId });
}

export function fatalitiesFor(fighterId, stageId = 'lake-america') {
  return [...(FATALITY_REGISTRY[fighterId] || []), stageFatality(stageId), JOKE_FINISHER];
}
export function fatalityOf(id, stageId = 'lake-america') {
  if (typeof id === 'string' && id.startsWith('stage-')) return stageFatality(id.slice(6));
  return [...Object.values(FATALITY_REGISTRY).flat(), stageFatality(stageId), JOKE_FINISHER, BRUTALITY].find(f => f.id === id) || null;
}

export class FinisherCommandBuffer {
  constructor() { this.reset(); }
  reset() { this.history = []; this.previous = {}; this.frame = 0; }
  step(raw = {}, facing = 1) {
    this.frame += 1;
    const input = { down: !!raw.down, up: !!raw.up,
      forward: !!raw[facing > 0 ? 'right' : 'left'], back: !!raw[facing > 0 ? 'left' : 'right'],
      lp: !!raw.lp, hp: !!raw.hp, lk: !!raw.lk, hk: !!raw.hk, block: !!raw.block };
    for (const key of ['down', 'up', 'forward', 'back', 'lp', 'hp', 'lk', 'hk', 'block'])
      if (input[key] && !this.previous[key]) this.history.push({ key, frame: this.frame });
    this.previous = input;
    this.history = this.history.filter(e => this.frame - e.frame <= 90).slice(-12);
  }
  match(entries, distance) {
    for (const entry of entries) {
      const recent = this.history.slice(-entry.command.length);
      if (!entry.command.length || recent.length !== entry.command.length) continue;
      if (!entry.command.every((key, i) => recent[i].key === key)) continue;
      if (recent.at(-1).frame !== this.frame) continue;
      if (recent.some((e, i) => i && e.frame - recent[i - 1].frame > 32)) continue;
      if (distance < entry.range.min - 0.002 || distance > entry.range.max + 0.002) return { rejected: entry, distance };
      this.history = [];
      return { finisher: entry };
    }
    return null;
  }
}

// Shot cuts are intentional; root offsets travel smoothly inside each cut.
// x coordinates are measured relative to the staged midpoint, +x toward victim.
export function finisherCinematicAt(finisher, frame) {
  if (!finisher) return null;
  const script = FINISHER_SCRIPTS[finisher.script];
  if (!script) return null;
  let index = 0;
  while (index < script.shots.length - 1 && frame >= script.shots[index + 1].frame) index += 1;
  const current = script.shots[index], next = script.shots[index + 1] || current;
  const mix = next === current ? 0 : Math.min(1, Math.max(0, (frame - current.frame) / (next.frame - current.frame)));
  const t = mix * mix * (3 - 2 * mix);
  const lerp = (a, b) => a + (b - a) * t;
  const at = key => ({ ...current[key], x: lerp(current[key].x, next[key].x),
    y: lerp(current[key].y, next[key].y), turn: lerp(current[key].turn, next[key].turn),
    clipTime: Math.max(0, (Math.min(frame, script.duration) - current.frame) / 60) });
  const camera = { ...current.camera };
  if (script.cameraMotion) for (const key of ['x', 'y', 'z', 'lookY', 'orbit', 'roll'])
    camera[key] = lerp(current.camera[key] || 0, next.camera[key] || 0);
  // Camera keys must not restart an actor's ongoing swing.
  const poseAt = key => {
    const pose = at(key);
    if (script.cameraMotion) {
      let start = index;
      while (start > 0 && script.shots[start - 1][key].clip === current[key].clip) start--;
      pose.clipTime = Math.max(0, (Math.min(frame, script.duration) - script.shots[start].frame) / 60);
    }
    return pose;
  };
  return { cut: script.cameraMotion ? 0 : index, camera, attacker: poseAt('attacker'), victim: poseAt('victim'),
    duration: script.duration, progress: frame / script.duration, complete: frame >= script.duration };
}
