import * as THREE from '../vendor/three.module.js';
import { PHYSICS, TICK } from '../engine/frameData.js';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };

export function recoveryProgress(view) {
  return clamp((view.stateFrame || 0) / (view.recovery === 'forward' || view.recovery === 'back'
    ? PHYSICS.rollFrames : PHYSICS.getUpFrames));
}

// These states follow simulation frames, so hitstop, slow motion and a dropped
// render frame cannot make the picture get up before the fighter can act.
export function movementClipTime(view, duration, metadata = {}) {
  const frame = Math.max(0, view.stateFrame || 0);
  switch (view.state) {
    case 'sprint': return (frame * TICK * (metadata.authoredMovement ? 1 : PHYSICS.sprintMultiplier)) % duration;
    case 'landing': return metadata.authoredMovement ? duration * clamp(frame / PHYSICS.landRecovery) : null;
    case 'backHop': return duration * clamp(frame * TICK / (2 * PHYSICS.backHopVelocity / PHYSICS.gravity));
    case 'juggle': return duration * (0.24 + 0.3 * clamp(frame / 20));
    case 'knockdown': return duration * clamp(frame / Math.max(1, view.stunFrames || PHYSICS.knockdownFrames));
    case 'downed': return duration;
    case 'defeat': return Math.min(duration, frame * TICK);
    case 'getUp': {
      const progress = recoveryProgress(view);
      if (view.recovery !== 'forward' && view.recovery !== 'back') return duration * progress;
      // Draw the knees in while rolling, then finish the authored rise.
      const pose = progress < 0.65 ? 0.36 * smooth(progress / 0.65)
        : 0.36 + 0.64 * smooth((progress - 0.65) / 0.35);
      return duration * pose;
    }
    default: return null;
  }
}

// Existing clips supply the joints. A small, reversible whole-body pass adds
// the sprint lean, helpless air reaction and directional recovery roll. The
// root remains exactly at the simulation position: there is no second jump arc.
export class MovementPose {
  constructor(model, pivot) {
    this.model = model;
    this.pivot = pivot;
    this.contactBones = [];
    model.traverse(node => {
      if (!node.isBone) return;
      // Both the canonical rigs and Officer Flock's imported Mixamo names.
      if (/^(hips|mixamorig[:]?Hips(?:_\d+)?)$/i.test(node.name)) this.hips = node;
      if (/^(hips|head|chest|hand[LR]|leg[LR]|foot[LR]|toe[LR])$/.test(node.name)
        || /mixamorig[:]?(Hips|Head|Spine2|(?:Left|Right)(Hand|Leg|Foot|ToeBase))(?:_\d+)?$/i.test(node.name)) this.contactBones.push(node);
    });
    this.point = new THREE.Vector3();
    this.centre = new THREE.Vector3();
    this.before = new THREE.Vector3();
  }

  apply(view) {
    let angle = 0, rollProgress = null;
    // The original knockdown clip ends in a raised, seated fall. Settle its
    // weight onto the floor while waiting, then unwind during the authored rise.
    let proneWeight = view.state === 'downed' ? 1 : 0;
    if (view.state === 'defeat') proneWeight = smooth(((view.stateFrame || 0) * TICK - 0.45) / 0.75);
    if (view.state === 'knockdown') proneWeight = smooth(((view.stateFrame || 0) / Math.max(1, view.stunFrames || PHYSICS.knockdownFrames) - 0.45) / 0.55);
    if (view.state === 'getUp') proneWeight = 1 - smooth(recoveryProgress(view) / (view.recovery === 'stand' ? 0.65 : 0.35));
    if (view.state === 'sprint') angle = 0.14;
    if (view.state === 'backHop') {
      const progress = clamp((view.stateFrame || 0) * TICK / (2 * PHYSICS.backHopVelocity / PHYSICS.gravity));
      angle = -0.22 * Math.sin(progress * Math.PI);
    }
    if (view.state === 'juggle') angle = -0.35 - 0.75 * smooth((view.stateFrame || 0) / 26);
    if (view.state === 'getUp' && (view.recovery === 'forward' || view.recovery === 'back')) {
      rollProgress = clamp(recoveryProgress(view) / 0.7);
      angle = (view.recovery === 'forward' ? 1 : -1) * Math.PI * 2 * smooth(rollProgress);
    }
    angle -= 0.72 * proneWeight;
    if (!angle) return;

    this.pivot.updateWorldMatrix(true, true);
    if (this.hips) this.pivot.worldToLocal(this.hips.getWorldPosition(this.centre));
    else this.centre.set(0, 0.9, 0);
    this.before.copy(this.centre).applyQuaternion(this.pivot.quaternion);
    this.pivot.rotateX(angle);
    this.point.copy(this.centre).applyQuaternion(this.pivot.quaternion);
    this.pivot.position.add(this.before.sub(this.point));

    if (rollProgress !== null || view.state === 'sprint' || proneWeight > 0) {
      this.pivot.updateWorldMatrix(true, true);
      let bottom = Infinity;
      for (const bone of this.contactBones) bottom = Math.min(bottom, bone.getWorldPosition(this.point).y);
      // Clearance peaks during the roll and vanishes at either endpoint; the
      // unmodified downed and standing clips retain their authored floor line.
      const clearance = rollProgress === null ? 0 : 0.08 * Math.sin(rollProgress * Math.PI);
      if (proneWeight > 0 && Number.isFinite(bottom)) {
        // Bone centres need room for the torso and head surface beneath them.
        const settle = (view.y + 0.34 - bottom) * proneWeight;
        this.pivot.position.y += settle;
        bottom += settle;
      }
      if (bottom < view.y + clearance) this.pivot.position.y += view.y + clearance - bottom;
    }
  }
}
