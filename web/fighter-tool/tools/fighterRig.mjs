// The canonical fighter skeleton, the skin-weight field, and the authored clips.
//
// This is the Route C rig. It exists because Hitem3D hands back six *named*
// parts and no skeleton: the names are a free, correct segmentation, and using
// them is what lets the weights be written down as a formula instead of solved
// for. Every fighter after this one inherits this tree verbatim -- clips are
// code, not retargetable FBX, so a different tree means re-authoring every clip.
//
//   root
//     hips
//       spine -> chest -> neck -> head -> headEnd
//                      -> shoulderL -> upperArmL -> forearmL -> handL -> handEndL
//                      -> shoulderR -> upperArmR -> forearmR -> handR -> handEndR
//       upLegL -> legL -> footL -> toeL
//       upLegR -> legR -> footR -> toeR
//
// Model space: +Y up, +Z front, +X toward the LeftArm part. Bind pose is the
// T-pose the sculpt was generated in, so every rest rotation is identity.
//
// Spine, head and legs are authored as angles, because that is how they read
// ("blade the stance, sink into it"). Arms are authored as WRIST TARGETS and
// solved, because they do not: a boxing guard on a 4.2-head caricature with a
// 0.86 m arm span and a shoulder a third of a metre off the midline needs a
// ~120 degree elbow, and no one guesses the three Euler angles that produce
// that twice in a row.
//
// Wrist targets are in VIEWER METRES -- the 1.9 m figure standing on the floor
// that the review page renders -- not in model units. Authoring a pose means
// looking at a picture and saying where the fist should be, and every number
// you can read off that picture is in metres. createRig converts. The knuckles
// land ~7 cm past the wrist along the forearm.

// ---- quaternion helpers -------------------------------------------------
const AXIS = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const qAxis = (axis, deg) => {
  const a = AXIS[axis], h = (deg * Math.PI) / 360, s = Math.sin(h);
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)];
};
export const qMul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qConj = (q) => [-q[0], -q[1], -q[2], q[3]];
export const qRot = (q, v) => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
};
export const IDENTITY = [0, 0, 0, 1];

// A pose entry is [[axis, degrees], ...] composed so the FIRST pair is applied
// last -- written outermost-first, the way the motion is described out loud
// ("swing it forward, then drop it").
const qOf = (ops) => (ops || []).reduce((q, [ax, d]) => qMul(q, qAxis(ax, d)), IDENTITY);

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Shortest-arc rotation taking unit `from` to unit `to`.
function qBetween(from, to) {
  const d = dot(from, to);
  if (d > 0.999999) return IDENTITY;
  if (d < -0.999999) {
    let axis = cross([1, 0, 0], from);
    if (len(axis) < 1e-6) axis = cross([0, 1, 0], from);
    axis = norm(axis);
    return [axis[0], axis[1], axis[2], 0];
  }
  const c = cross(from, to), w = 1 + d;
  const q = [c[0], c[1], c[2], w], l = Math.hypot(q[0], q[1], q[2], q[3]);
  return q.map((v) => v / l);
}

// ---- skeleton -----------------------------------------------------------
// name, parent, and which measured joint supplies its rest position. `tip`
// bones carry no weight; they exist so every deforming bone has a direction.
export const BONES = [
  ['root', null, 'root'],
  ['hips', 'root', 'hips'],
  ['spine', 'hips', 'spine'],
  ['chest', 'spine', 'chest'],
  ['neck', 'chest', 'neck'],
  ['head', 'neck', 'head'],
  ['headEnd', 'head', 'headEnd', 'tip'],
  ['shoulderL', 'chest', 'shoulderL'],
  ['upperArmL', 'shoulderL', 'upperArmL'],
  ['forearmL', 'upperArmL', 'forearmL'],
  ['handL', 'forearmL', 'handL'],
  ['handEndL', 'handL', 'handEndL', 'tip'],
  ['shoulderR', 'chest', 'shoulderR'],
  ['upperArmR', 'shoulderR', 'upperArmR'],
  ['forearmR', 'upperArmR', 'forearmR'],
  ['handR', 'forearmR', 'handR'],
  ['handEndR', 'handR', 'handEndR', 'tip'],
  ['upLegL', 'hips', 'upLegL'],
  ['legL', 'upLegL', 'legL'],
  ['footL', 'legL', 'footL'],
  ['toeL', 'footL', 'toeL', 'tip'],
  ['upLegR', 'hips', 'upLegR'],
  ['legR', 'upLegR', 'legR'],
  ['footR', 'legR', 'footR'],
  ['toeR', 'footR', 'toeR', 'tip'],
];

// Influence radius per bone, as a FRACTION OF FIGURE HEIGHT.
//
// These were tuned in model units on a figure that happened to be 0.801 tall,
// which silently made every one of them a Trump fact. Hitem3D does not promise
// a scale, so the next export at a different size would have got the same
// numbers and a completely different falloff. Divided through by height they
// reproduce this fighter exactly and carry to the next one.
//
// They are still the soft-tissue radii of a pear-shaped caricature, not a
// human: chest and hips are wide because the belly is. Expect to retune them
// per fighter -- `rig.mjs --sigma-report` prints each one against the measured
// local thickness so you can see which ones do not fit before you look.
export const SIGMA = {
  hips: 0.1685, spine: 0.1560, chest: 0.1685, neck: 0.0687, head: 0.1311,
  shoulderL: 0.0936, upperArmL: 0.0936, forearmL: 0.0774, handL: 0.0624,
  shoulderR: 0.0936, upperArmR: 0.0936, forearmR: 0.0774, handR: 0.0624,
  upLegL: 0.1311, legL: 0.1061, footL: 0.0774,
  upLegR: 0.1311, legR: 0.1061, footR: 0.0774,
};

// Which bones a given part's vertices may be weighted to.
//
// This is the trunk shield, and it is the one place the six named parts earn
// their keep. The T-pose sculpt fuses sleeve to jacket at the armpit, and the
// belly is wider (|x| 0.2275) than the shoulder the arm attaches at (0.1218),
// so a purely spatial falloff hands the upper ribs to the upper arm and the
// armpit collapses the first time the arm swings. A part gate cannot introduce
// a seam crack here because the arm chain is additionally faded to zero at the
// shoulder cut plane (ARM_FADE): at the seam both parts agree on the same
// {chest, shoulder} blend, and everywhere the gate actually differs, the two
// parts have no geometry in common.
export const PART_BONES = {
  Head: ['neck', 'head', 'chest'],
  Torso: ['hips', 'spine', 'chest', 'neck', 'shoulderL', 'shoulderR', 'upLegL', 'upLegR'],
  LeftArm: ['chest', 'neck', 'shoulderL', 'upperArmL', 'forearmL', 'handL'],
  RightArm: ['chest', 'neck', 'shoulderR', 'upperArmR', 'forearmR', 'handR'],
  LeftLeg: ['hips', 'spine', 'upLegL', 'legL', 'footL'],
  RightLeg: ['hips', 'spine', 'upLegR', 'legR', 'footR'],
};
// Distance outboard of the shoulder cut plane over which the arm chain fades
// in from nothing, as a fraction of height. 0 at the cut keeps the seam
// continuous with the torso.
export const ARM_FADE = 0.0749;
// Band across the crotch over which a leg's bones fade out, so the left thigh
// never takes hold of the right one. Fractions of height.
export const LEG_SIDE_FADE = [-0.0250, 0.0562];

export const MAX_INFLUENCES = 4;

// ---- poses --------------------------------------------------------------
// Orthodox boxing stance: the figure faces +Z, blades to its right, and leads
// with the left (+X) hand. The head pivot sits at 1.55 m and the chin around
// 1.45 m, so a wrist at y 1.40 is cheek height on this figure.
//
// The blade is deliberately shallow (~29 degrees total). Turning further looks
// correct on a human and wrong here: this caricature is 0.54 m wide at the
// belly, and past about 35 degrees the near shoulder swings so far in front of
// the head that the guard reads as a lunge.
const GUARD = {
  hips: { r: [['y', -16]], t: [0, -0.012, 0.004] },
  spine: { r: [['y', -5]] },
  chest: { r: [['y', -8], ['x', -5]] },
  neck: { r: [['y', 12], ['x', -4]] },
  head: { r: [['y', 8], ['x', 3]] },
  shoulderL: { r: [['y', -10], ['z', -4]] },
  shoulderR: { r: [['y', 6], ['z', 6]] },
  handL: { r: [['z', 8], ['y', -18]] },
  handR: { r: [['z', -10], ['y', 14]] },

  upLegL: { r: [['x', -11], ['z', -4]] },
  legL: { r: [['x', 9]] },
  footL: { r: [['x', 2]] },
  upLegR: { r: [['x', 11], ['z', 5]] },
  legR: { r: [['x', 11]] },
  footR: { r: [['x', -13]] },

  // Lead wrist out in front of the sternum, rear wrist tucked by the jaw.
  aim: { L: [0.32, 1.30, 0.40], R: [-0.32, 1.38, 0.22] },
};

// Where the elbow is pushed: down, outboard, and behind the hand.
//
// Boxing coaching says keep the elbows in and under. That is advice for a
// normal ribcage. This trunk is 0.54 m wide at the belly and still 0.40 m at
// the chest, so "in and under" puts the rear elbow 0.19 m INSIDE the body --
// measured, not guessed, by the trunk-clearance test in pose_check. The rear
// elbow has to ride outside the silhouette, and the pole is what puts it there.
// The two sides are not mirror images: the lead arm reaches across the front
// where there is nothing to hit, the rear arm is folded alongside the belly.
const ELBOW_POLE = { L: [0.42, -1, -0.30], R: [-1.42, -1.00, -0.24] };

export const VIEW_HEIGHT = 1.9;      // the review page normalises every fighter to this

export function createRig(joints, bounds, opts = {}) {
  // Per-fighter pose overrides. Everything else in this file is a fraction of
  // height and transfers untouched, but the wrist targets are absolute viewer
  // metres, and a fighter with different proportions needs his own -- Carney's
  // chin sits 8 cm higher than Trump's and his reach is 4 cm shorter, so
  // Trump's targets put every one of his fists low and his lead arm past its
  // own reach. Per-fighter guards live in configs/<id>.json; the clips move
  // relative to whatever that guard says (see `da`), so setting the guard sets
  // the whole clip family. aimOffset shifts every target at once and is the
  // blunt version of the same idea. Default [0,0,0].
  const aimOffset = opts.aimOffset || [0, 0, 0];
  const elbowPole = { L: [...ELBOW_POLE.L], R: [...ELBOW_POLE.R], ...(opts.elbowPole || {}) };
  const guard = opts.guard || GUARD;
  const J = { ...joints, root: [0, 0, 0] };
  J.headEnd = [J.head[0], J.head[1] + 0.130, J.head[2]];

  // Model units <-> viewer metres. The page scales the figure to 1.9 m and puts
  // its feet on the floor, so that is the frame poses are authored in.
  const floor = bounds ? bounds.min[1] : -0.4005;
  const scale = VIEW_HEIGHT / ((bounds ? bounds.max[1] - bounds.min[1] : 0.801));
  const toView = (p) => [p[0] * scale, (p[1] - floor) * scale, p[2] * scale];
  const toModel = (p) => [p[0] / scale, p[1] / scale + floor, p[2] / scale];

  const boneIndex = {}, bones = [];
  for (const [name, parent, jointName, kind] of BONES) {
    const world = J[jointName];
    if (!world) throw new Error(`joint "${jointName}" missing from the measurement`);
    const pi = parent === null ? -1 : boneIndex[parent];
    if (parent !== null && pi === undefined) throw new Error(`bone "${name}" listed before its parent`);
    const pw = pi < 0 ? [0, 0, 0] : bones[pi].world;
    boneIndex[name] = bones.length;
    bones.push({ name, parent: pi, kind: kind || 'deform', world: [...world], local: sub(world, pw) });
  }

  // Rest limb directions, needed because the right arm's rest axis is -X.
  const restDir = (a, b) => norm(sub(J[b], J[a]));
  const ARM = {
    L: { up: restDir('upperArmL', 'forearmL'), fore: restDir('forearmL', 'handL'),
         a: len(sub(J.forearmL, J.upperArmL)), b: len(sub(J.handL, J.forearmL)) },
    R: { up: restDir('upperArmR', 'forearmR'), fore: restDir('forearmR', 'handR'),
         a: len(sub(J.forearmR, J.upperArmR)), b: len(sub(J.handR, J.forearmR)) },
  };

  // Forward kinematics over a rotation/translation map, in bone order.
  function fk(pose) {
    const out = [];
    for (const b of bones) {
      const p = pose[b.name];
      const q = p?.r || IDENTITY;
      const t = p?.t ? add(b.local, p.t) : b.local;
      if (b.parent < 0) { out.push({ q, pos: t }); continue; }
      const par = out[b.parent];
      out.push({ q: qMul(par.q, q), pos: add(par.pos, qRot(par.q, t)) });
    }
    return { list: out, at: (n) => out[boneIndex[n]] };
  }

  // Two-bone solve for one arm. The pole fixes the elbow so the answer is a
  // single pose rather than a circle of them.
  function solveArm(pose, side, targetView) {
    const target = toModel(add(targetView, aimOffset));
    const S = 'shoulder' + side, U = 'upperArm' + side, F = 'forearm' + side;
    const st = fk(pose);
    const root = st.at(U).pos;                       // shoulder joint, world
    const parentQ = st.at(S).q;                      // upperArm's rotations are in here
    const { a, b } = ARM[side];

    let toT = sub(target, root);
    const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, len(toT)));
    const n = norm(toT);
    let pole = elbowPole[side];
    pole = sub(pole, mul(n, dot(pole, n)));
    if (len(pole) < 1e-5) pole = sub([0, -1, 0], mul(n, dot([0, -1, 0], n)));
    pole = norm(pole);

    const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    const elbow = add(root, add(mul(n, a * cosA), mul(pole, a * sinA)));

    const dirU = norm(sub(elbow, root));
    const dirF = norm(sub(add(root, mul(n, d)), elbow));

    // Express each direction in its own parent's frame, then take the shortest
    // arc from the rest direction. Shortest arc leaves the roll free, which is
    // fine: this caricature is in a suit, there is no visible forearm twist.
    const qU = qBetween(ARM[side].up, qRot(qConj(parentQ), dirU));
    const upperWorld = qMul(parentQ, qU);
    const qF = qBetween(ARM[side].fore, qRot(qConj(upperWorld), dirF));
    return { [U]: qU, [F]: qF, reach: len(toT), span: a + b,
             clamped: len(toT) > a + b - 1e-4 };
  }

  // Resolve a pose delta against the guard.
  function resolve(delta, flags = {}) {
    const pose = {};
    for (const [bone, v] of Object.entries(guard)) {
      if (bone === 'aim') continue;
      pose[bone] = { r: qOf(v.r), t: v.t ? [...v.t] : null };
    }
    // Wrist targets start at the guard's and are moved by the clip. `da` is a
    // DELTA in viewer metres and is what clips should use: the guard's aim is
    // the one thing in a pose that is genuinely per-fighter (Carney's chin is
    // 6 cm higher than Trump's and his reach is 4 cm shorter), so a clip that
    // named absolute targets would drag every fighter back onto Trump's guard
    // the moment it played. `aim` stays as an absolute override for authoring.
    let aim = {};
    for (const s of ['L', 'R']) if (guard.aim?.[s]) aim[s] = [...guard.aim[s]];
    const clamped = [];
    if (flags.bind) {
      for (const k of Object.keys(pose)) pose[k] = { r: IDENTITY, t: pose[k].t ? [0, 0, 0] : null };
      pose.upperArmL = { r: IDENTITY, t: null }; pose.forearmL = { r: IDENTITY, t: null };
      pose.upperArmR = { r: IDENTITY, t: null }; pose.forearmR = { r: IDENTITY, t: null };
      return pose;
    }
    for (const [bone, v] of Object.entries(delta || {})) {
      if (bone === 'aim') { for (const s of ['L', 'R']) if (v[s]) aim[s] = [...v[s]]; continue; }
      if (bone === 'da') {
        for (const s of ['L', 'R']) if (v[s] && aim[s]) aim[s] = add(aim[s], v[s]);
        continue;
      }
      const b = (pose[bone] ||= { r: IDENTITY, t: null });
      if (v.r) b.r = qOf(v.r);                        // absolute override
      if (v.d) b.r = qMul(b.r, qOf(v.d));             // relative to the guard
      if (v.t) b.t = [...v.t];
      if (v.dt) b.t = add(b.t || [0, 0, 0], v.dt);
    }
    // Arms last: the solve needs the finished spine to know where the shoulder is.
    for (const side of ['L', 'R']) {
      const sol = solveArm(pose, side, aim[side]);
      pose['upperArm' + side] = { r: sol['upperArm' + side], t: null };
      pose['forearm' + side] = { r: sol['forearm' + side], t: null };
      if (sol.clamped) clamped.push(side);
    }
    if (clamped.length) {
      // Non-enumerable: buildTracks treats every key of a resolved pose as a
      // bone name, and a diagnostic must not become a track.
      Object.defineProperty(pose, 'clamped', { value: clamped, enumerable: false });
      if (!flags.quiet)
        console.warn(`  ! ${clamped.join('/')} wrist target is past the arm's reach, arm locked straight`);
    }
    return pose;
  }

  return { bones, boneIndex, fk, resolve, solveArm, toView, toModel, joints: J, scale, floor };
}

import { COMBAT_CLIPS } from './combatClips.mjs';

// Keyframed clips. Each key is [time, poseDelta]; deltas are resolved against
// GUARD, so a bone a clip never mentions holds the stance instead of snapping
// back to the T-pose. Wrist motion is authored as `da` -- metres MOVED from
// wherever this fighter's guard put the fist -- for the same reason: a clip is
// a motion, and only the guard knows where a given fighter's hands live.
export const CLIPS = [
  {
    // The bind pose, as a clip. It has to exist and it has to key *every* bone:
    // an AnimationMixer only touches the properties a clip names, so a tpose
    // that keyed nothing would leave the fighter in whatever guard came before.
    name: 'tpose', loop: true, bind: true,
    keys: [[0, {}], [0.5, {}]],
  },
  {
    name: 'guard', loop: true,
    keys: [[0, {}], [2, {}]],
  },
  {
    // Weight shift and breath. Nothing here is fast: a fighter that bounces
    // reads as a cartoon, and this caricature is already one.
    name: 'idle', loop: true,
    keys: [
      [0.0, {}],
      [0.8, {
        hips: { d: [['y', 3]], dt: [0.004, 0.007, 0] },
        chest: { d: [['y', 3], ['x', -2]] }, head: { d: [['y', -4], ['x', -2]] },
        da: { L: [0.01, 0.03, -0.01], R: [0.01, 0.03, 0.01] },
      }],
      [1.7, {
        hips: { d: [['y', -3]], dt: [-0.004, -0.004, 0] },
        chest: { d: [['y', -3], ['x', 1]] }, head: { d: [['y', 5], ['x', 1]] },
        da: { L: [-0.01, -0.02, 0.01], R: [-0.01, -0.02, -0.01] },
      }],
      [2.6, {
        hips: { d: [['y', 2]], dt: [0.003, 0.005, 0] },
        chest: { d: [['y', 2], ['x', -1]] }, head: { d: [['y', -2]] },
        da: { L: [0.01, 0.02, 0], R: [0, 0.02, 0] },
      }],
      [3.4, {}],
    ],
  },
  {
    // Lead-hand jab. The power comes from the hips: they open ~26 degrees and
    // the chest follows, which is why the lead shoulder travels much further
    // than the arm extension alone would carry it.
    name: 'jab', loop: true,
    keys: [
      [0.00, {}],
      [0.09, {                                        // coil: unwind the blade a little
        hips: { d: [['y', 8]] }, chest: { d: [['y', 6]] },
        da: { L: [0.02, 0.02, -0.08] },
      }],
      // The torso deltas are deliberately modest. They stack on the guard's
      // own blade, and the first pass at -26/-10/-24 summed with it to an 89
      // degree turn: the fighter ended up standing side-on, which reads as a
      // spin rather than a punch. ~20 degrees past the guard is a jab.
      [0.22, {                                        // extension
        hips: { d: [['y', -8]], dt: [0, 0.004, 0.016] },
        spine: { d: [['y', -3]] }, chest: { d: [['y', -10]] },
        neck: { d: [['y', 13]] }, head: { d: [['y', 8], ['x', -4]] },
        shoulderL: { d: [['y', -20]] },
        upLegR: { d: [['x', -7]] }, legR: { d: [['x', -6]] },
        da: { L: [-0.14, 0.06, 0.30], R: [-0.03, 0.01, -0.02] },
      }],
      [0.30, {                                        // brief hold at full reach
        hips: { d: [['y', -7]], dt: [0, 0.003, 0.015] },
        spine: { d: [['y', -3]] }, chest: { d: [['y', -9]] },
        neck: { d: [['y', 12]] }, head: { d: [['y', 7], ['x', -3]] },
        shoulderL: { d: [['y', -18]] },
        upLegR: { d: [['x', -6]] }, legR: { d: [['x', -5]] },
        da: { L: [-0.13, 0.06, 0.28], R: [-0.02, 0.01, -0.01] },
      }],
      [0.46, {                                        // recovery, past the guard
        hips: { d: [['y', 5]] }, chest: { d: [['y', 4]] },
        da: { L: [0.03, -0.01, -0.05] },
      }],
      [0.62, {}],
    ],
  },
  // The full combat set lives in combatClips.mjs so this file stays the rig
  // kernel. Same authoring contract, same guard-relative deltas.
  ...COMBAT_CLIPS,
];

// Turn the authored keys into per-bone tracks. Every bone the clip touches at
// any key gets a key at *every* time in the clip, so linear interpolation never
// blends a posed bone against a stale neighbour.
export function buildTracks(clip, rig) {
  const resolved = sampleClip(clip, rig);
  const touched = new Set();
  for (const [, r] of resolved) for (const k of Object.keys(r)) touched.add(k);

  const times = resolved.map(([t]) => t);
  const tracks = [];
  for (const bone of touched) {
    if (!(bone in rig.boneIndex)) throw new Error(`clip "${clip.name}" poses unknown bone "${bone}"`);
    const rot = [], trs = [];
    const movesT = resolved.some(([, r]) => r[bone]?.t);
    let prev = null;
    for (const [, r] of resolved) {
      let q = r[bone]?.r || IDENTITY;
      // Keep successive keys on the same hemisphere or LERP takes the long way.
      if (prev && (q[0] * prev[0] + q[1] * prev[1] + q[2] * prev[2] + q[3] * prev[3]) < 0)
        q = [-q[0], -q[1], -q[2], -q[3]];
      prev = q;
      rot.push(q[0], q[1], q[2], q[3]);
      if (movesT) { const t = r[bone]?.t || [0, 0, 0]; trs.push(t[0], t[1], t[2]); }
    }
    tracks.push({ bone: rig.boneIndex[bone], path: 'rotation', times, values: rot });
    if (movesT) tracks.push({ bone: rig.boneIndex[bone], path: 'translation', times, values: trs, additive: true });
  }
  return tracks;
}

// Bake at 60 Hz: checking only the authored endpoints misses feet dipping
// through the floor while the legs rotate between them. Correct the whole
// skeleton after IK, so lifting the hips does not leave the wrists behind.
export function sampleClip(clip, rig) {
  const keys = clip.keys.map(([t, p]) => [t, rig.resolve(p, { bind: clip.bind, quiet: true })]);
  const names = [...new Set(keys.flatMap(([, p]) => Object.keys(p)))];
  const samples = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const [ta, a] = keys[i], [tb, b] = keys[i + 1];
    const steps = Math.max(1, Math.ceil((tb - ta) * 60));
    for (let j = 0; j < steps; j++) {
      const u = j / steps, p = {};
      for (const name of names) {
        const qa = a[name]?.r || IDENTITY, qb = b[name]?.r || IDENTITY;
        const dot = qa.reduce((sum, x, k) => sum + x * qb[k], 0);
        const sign = dot < 0 ? -1 : 1;
        const theta = Math.acos(Math.min(1, Math.abs(dot)));
        const wa = theta < 1e-6 ? 1 - u : Math.sin((1 - u) * theta) / Math.sin(theta);
        const wb = theta < 1e-6 ? u : Math.sin(u * theta) / Math.sin(theta);
        const q = qa.map((x, k) => x * wa + qb[k] * sign * wb);
        const norm = Math.hypot(...q);
        const at = a[name]?.t || [0, 0, 0], bt = b[name]?.t || [0, 0, 0];
        p[name] = { r: q.map(x => x / norm), t: at.map((x, k) => x + (bt[k] - x) * u) };
      }
      samples.push([ta + (tb - ta) * u, p]);
    }
  }
  samples.push([keys.at(-1)[0], structuredClone(keys.at(-1)[1])]);
  if (!clip.bind) for (const [, pose] of samples) {
    // Root is an origin marker, not a body joint.
    const lowest = Math.min(...rig.fk(pose).list.slice(1).map(n => rig.toView(n.pos)[1]));
    const lift = Math.max(0, 0.014 - lowest) / rig.scale;
    const hips = (pose.hips ||= { r: IDENTITY, t: [0, 0, 0] });
    hips.t = [...(hips.t || [0, 0, 0])];
    hips.t[1] += lift;
  }
  return samples;
}

export { GUARD, ELBOW_POLE };
