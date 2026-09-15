// Pose amplification: one gain per body group, applied after the mixer samples.
//
// Every clip is baked keyframe data, so the only way to make a punch bigger
// without re-authoring the rig is to push each bone further along the arc it is
// already travelling. `rest.slerp(animated, gain)` with a gain above 1
// extrapolates past the authored pose along that same great arc, so the motion
// keeps its shape and only its amplitude changes -- 140% is the same punch,
// thrown 40% further.
//
// Restore-before-sample is the discipline HitRecoil already uses here. The
// mixer overwrites a bone outright for the tracks a clip owns, but a clip that
// leaves a bone untracked would otherwise inherit last frame's amplified value
// and compound it every frame until the limb wound itself off.

// `hips` is deliberately absent. Amplifying it rotates the entire fighter
// about the pelvis, which tilts the feet through the floor long before the
// swing looks good -- the whole-body lean belongs to a root-motion pass, not
// to this one. `root`, the toes, and the *End tips carry no readable motion.
const GROUPS = Object.freeze({
  torso: ['spine', 'chest'],
  head: ['neck', 'head'],
  arms: ['shoulderL', 'upperArmL', 'forearmL', 'handL', 'shoulderR', 'upperArmR', 'forearmR', 'handR'],
  legs: ['upLegL', 'legL', 'footL', 'upLegR', 'legR', 'footR'],
});

// Same data shape as ai.js TUNABLES, so the debug studio builds this panel from
// the list rather than keeping a second copy of it. A gain reads as a
// percentage of the authored pose: 100% is the clip exactly as exported.
export const POSE_TUNABLES = Object.freeze([
  { key: 'torso', label: 'Torso swing', hint: 'Spine and chest. The cheapest weight: it turns a punch from an arm into a body.' },
  { key: 'arms', label: 'Arm reach', hint: 'Shoulder to hand. Safe to push hardest; the worst it does is cross the body.' },
  { key: 'legs', label: 'Leg throw', hint: 'Above about 125% the feet start to float. The sim never moves -- only the picture.' },
  { key: 'head', label: 'Head snap', hint: 'Neck and head. Small amounts read as intent; large amounts read as whiplash.' },
].map((t) => Object.freeze({ min: 0.5, max: 2, step: 0.05, unit: null, ...t })));

// A bone already bent near 180 degrees has nowhere left to go: extrapolating it
// past a half turn takes the short way round instead and the elbow or knee
// inverts. Capping the amplified angle keeps a heavy gain honest on the extreme
// frames -- the limb stops growing rather than folding backwards.
const MAX_ANGLE = 2.8;

const DEFAULTS = Object.freeze(Object.fromEntries(POSE_TUNABLES.map((t) => [t.key, 1])));
const STORAGE_KEY = 'battlefi.pose';

// Live, shared by both fighters: a lopsided pair is a different feature.
export const POSE = { ...DEFAULTS };

// Persisted so a tuning session survives a reload. A value good enough to keep
// can be read straight out of this key and pasted over DEFAULTS above.
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  for (const t of POSE_TUNABLES) {
    const value = Number(saved[t.key]);
    if (Number.isFinite(value)) POSE[t.key] = Math.max(t.min, Math.min(t.max, value));
  }
} catch { /* Private mode and corrupt JSON both just mean "authored amplitude". */ }

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(POSE)); } catch { /* not worth a broken frame */ }
}

export function getPose(key) { return POSE[key]; }
export function setPose(key, value) { POSE[key] = value; persist(); }
export function resetPose() { Object.assign(POSE, DEFAULTS); persist(); }

export class PoseAmp {
  // Built while the model is still at rest -- no mixer has updated yet on
  // either load path -- so the bind quaternions are readable straight off the
  // bones and no separate rest pose has to be shipped.
  constructor(model) {
    this.groups = [];
    for (const [key, names] of Object.entries(GROUPS)) {
      const bones = [];
      const rest = [];
      for (const name of names) {
        const bone = model.getObjectByName(name);
        if (!bone) continue;
        bones.push(bone);
        rest.push(bone.quaternion.clone());
      }
      if (bones.length) this.groups.push({ key, bones, rest });
    }
    this.saved = [];
  }

  restore() {
    for (const [bone, quaternion] of this.saved) bone.quaternion.copy(quaternion);
    this.saved.length = 0;
  }

  apply() {
    for (const group of this.groups) {
      const gain = POSE[group.key];
      if (!(Math.abs(gain - 1) > 1e-3)) continue;
      for (let i = 0; i < group.bones.length; i += 1) {
        const bone = group.bones[i];
        const animated = bone.quaternion.clone();
        this.saved.push([bone, animated]);
        const rest = group.rest[i];
        const angle = rest.angleTo(animated);
        const limited = angle * gain > MAX_ANGLE ? MAX_ANGLE / angle : gain;
        bone.quaternion.copy(rest).slerp(animated, limited);
      }
    }
  }
}
