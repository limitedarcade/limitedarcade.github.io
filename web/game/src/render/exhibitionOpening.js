import { REEL } from '../engine/reelTimeline.js';
import { smooth } from './lakeCameraDirector.js';
import * as THREE from '../vendor/three.module.js';
import { CinematicGrip } from './cinematicGrip.js';
import { fighterBone } from './fighterBones.js';

const mix = (a, b, t) => a + (b - a) * t;

function fit(position, target, aspect, fov = aspect < 1 ? 46 : 39) {
  const distance = Math.max(1, .95 / Math.max(.25, aspect));
  return { authored: true, position: position.map((v, i) => target[i] + (v - target[i]) * distance),
    target, fov };
}

// A short cold open in the actual arena: each gag starts on an action, with
// enough hold to read the prop. The last crane settles into the combat lane.
// Only render copies move here; live rounds and competitive rules are untouched.
export function exhibitionOpening(snapshot, { aspect = 16 / 9, reducedMotion = false, fraction = 0 } = {}) {
  if (snapshot.stageId !== 'lake-america' || snapshot.phase !== 'intro' || snapshot.quickIntro) return null;
  const frame = Math.min(REEL.fightEnd, snapshot.phaseFrame + fraction);
  const actors = snapshot.fighters.map(actor => ({ ...actor, z: 0, state: 'idle' }));
  const carney = actors.findIndex(actor => actor.id === 'carney');
  if (carney < 0) return null;
  const rival = 1 - carney;
  if (reducedMotion) return { actors, label: 'Ice axe · rescue ring · Cold Cut',
    shot: { ...fit([0, 2.6, 9], [0, 1.15, 0], aspect), static: true } };
  const action = (side, x, z, facing, clip, time, yaw) => {
    Object.assign(actors[side], { x, z, facing, state: 'intro', cinematicClip: clip,
      clipTime: Math.max(0, time) / 60 * (clip === 'idle' ? 1 : .72), reelKey: `exhibition:${clip}:${z}`, openingYaw: yaw });
  };
  if (frame < 82) {
    const t = smooth(frame / 82);
    action(rival, -6.65, -4.55, -1, 'heavyPunch', frame - 2, -2.6);
    action(carney, -4.9, -3.9, -1, 'idle', frame);
    return { actors, label: 'Freedom: sold out. No refunds.', cue: { name: 'lake-america-freedom-machine', frame: frame - 24, kind: 'machine' },
      contact: { side: rival, target: [-7.05, 1.15, -5.05], pole: [-6.4, 1.1, -4.5], limb: 'arm' },
      shot: fit([mix(-3.8, -4.3, t), mix(1.9, 1.65, t), mix(.9, .4, t)], [-6.35, 1.12, -4.8], aspect) };
  }
  if (frame < 162) {
    const t = smooth((frame - 82) / 80);
    action(rival, -1.22, -3.2, -1, 'heavyKick', frame - 84, -1.8);
    action(carney, .7, -2.9, -1, 'idle', frame);
    return { actors, label: 'The rights have taken a kicking.', cue: { name: 'lake-america-bill-of-rights', frame: frame - 113, kind: 'paper' },
      contact: { side: rival, target: [-2.05, 1.04, -3.28], pole: [-1.8, 1.1, -2.7], limb: 'leg' },
      shot: fit([mix(.5, .15, t), mix(1.5, 1.25, t), mix(2.6, 2.15, t)], [-1.7, 1.05, -3.3], aspect) };
  }
  if (frame < 242) {
    const t = smooth((frame - 162) / 80);
    action(carney, 2.6, -4.05, 1, 'heavyPunch', frame - 164, 2.05);
    action(rival, .5, -3.3, 1, 'idle', frame);
    return { actors, label: 'Liberty rings. Once.', cue: { name: 'lake-america-liberty-bell', frame: frame - 188, kind: 'bell' },
      contact: { side: carney, target: [3.25, 1.32, -4.35], pole: [2.8, 1.05, -3.6], limb: 'arm' },
      shot: fit([mix(6.8, 6.4, t), mix(2.75, 2.55, t), mix(-.7, -1.1, t)], [2.85, 1.15, -4.3], aspect) };
  }
  const t = smooth((frame - 242) / (REEL.fightEnd - 242));
  return { actors, label: frame < 310 ? 'Welcome to Lake America.' : 'Ice axe · rescue ring · Cold Cut',
    shot: fit([mix(5.5, 0, t), mix(5.7, 2.24, t), mix(16, 8.2, t)], [0, mix(.8, 1.46, t), mix(-3.3, 0, t)], aspect,
      mix(aspect < 1 ? 46 : 44, aspect < .75 ? 46 : aspect < 1.35 ? 39 : 33, t)) };
}

// Reversible stage reactions are sampled from the same frame as the strike.
// Restore before every sample, including pause, options, exit and stage swaps.
export class ExhibitionProps {
  constructor() { this.originals = new Map(); this.grips = [new CinematicGrip(), new CinematicGrip()]; }
  reset() {
    this.grips.forEach(grip => grip.restore());
    for (const [object, pose] of this.originals) {
      object.position.copy(pose.position); object.rotation.copy(pose.rotation);
    }
    this.originals.clear();
  }
  update(group, cue, reducedMotion = false) {
    this.reset();
    if (!cue || reducedMotion || cue.frame < 0) return;
    const object = group.getObjectByName(cue.name);
    if (!object) return;
    this.originals.set(object, { position: object.position.clone(), rotation: object.rotation.clone() });
    const t = cue.frame / 60, recoil = Math.sin(t * (cue.kind === 'bell' ? 18 : 32)) * Math.exp(-t * 5);
    if (cue.kind === 'machine') object.position.x += recoil * .065;
    else object.rotation.z += recoil * (cue.kind === 'bell' ? .085 : .045);
  }
  pose(opening, views) {
    if (!opening?.contact) return;
    const { side, target, pole, limb } = opening.contact;
    const view = views[side]; if (!view?.model) return;
    const frame = opening.cue.frame;
    const weight = smooth((frame + 10) / 10) * (1 - smooth((frame - 5) / 20));
    if (weight <= 0) return;
    view.root.updateWorldMatrix(true, true);
    let which = 'R', bone;
    if (limb === 'leg') {
      const left = fighterBone(view.model, 'footL'), right = fighterBone(view.model, 'footR');
      if (left && right && left.getWorldPosition(new THREE.Vector3()).y > right.getWorldPosition(new THREE.Vector3()).y) which = 'L';
      bone = fighterBone(view.model, `foot${which}`);
    } else {
      bone = view.model.getObjectByName('handR');
      if (!bone) view.model.traverse(node => { if (node.isBone && /^mixamorig:?RightHand(?:_\d+)?$/i.test(node.name)) bone = node; });
    }
    if (!bone) return;
    const destination = bone.getWorldPosition(new THREE.Vector3()).lerp(new THREE.Vector3(...target), weight);
    this.grips[side].apply(view.model, destination, new THREE.Vector3(...pole), which, limb);
  }
}
