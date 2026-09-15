// The full combat clip set, authored against the canonical guard.
//
// Read `fighterRig.mjs` first -- this file uses its conventions and adds
// nothing to them:
//
//   d:  [[axis, degrees], ...]   rotation RELATIVE to the guard's pose
//   dt: [x, y, z]                translation delta, MODEL units (height ~0.95)
//   da: { L|R: [x, y, z] }       wrist target moved, VIEWER metres, from the
//                                guard's own aim
//
// Axes as the viewer sees them: +z forward (toward the opponent), +y up, +x
// toward the fighter's own left. Hips `y` is the blade of the stance; `x` is
// pitch; `z` is roll.
//
// Two rules that are easy to get wrong and expensive to debug:
//
// 1. Torso deltas are SMALL. They stack on a guard that is already bladed ~16
//    degrees, and the first pass at a cross used -30 on the hips, which summed
//    to a 46-degree turn and read as a pirouette rather than a punch. A punch
//    is about 20 degrees past the guard; the reach comes from the shoulder
//    travelling, not from the spine winding up.
//
// 2. `da` is ABSOLUTE in space, not attached to the chest. Any clip that moves
//    the body off the standing pose -- crouch, sweep, knockdown, defeat -- has
//    to bring the wrist targets down with it, or the arms stay pinned in the
//    air where the guard left them and the IK locks straight. Every such clip
//    below carries a `da` for exactly that reason.
//
// This sculpt's arms are short: the shoulder-to-fingertip span is about 0.54 m
// against a 1.92 m figure. A straight punch from a square stance therefore runs
// out of arm almost immediately, which is why every strike here rotates the
// hips and chest first -- that is what carries the shoulder forward far enough
// for the fist to travel a believable distance.

// ---- shared fragments -----------------------------------------------------

// A crouch: hips down, both legs folded, torso pitched in. Reused by the crouch
// stance, the crouching attacks and the sweep so they all sit at one height.
const CROUCH = {
  hips: { d: [['x', 14]], dt: [0, -0.052, 0.006] },
  spine: { d: [['x', 6]] },
  chest: { d: [['x', 8]] },
  neck: { d: [['x', -6]] },
  head: { d: [['x', -8]] },
  upLegL: { d: [['x', -40]] }, legL: { d: [['x', 66]] }, footL: { d: [['x', -24]] },
  upLegR: { d: [['x', -36]] }, legR: { d: [['x', 64]] }, footR: { d: [['x', -26]] },
  // The rear fist has to come OUT as it comes down, or the crouch tucks it
  // straight into the belly -- this figure is 0.54 m wide at the waist.
  da: { L: [0.02, -0.26, 0.04], R: [-0.03, -0.26, 0.10] },
};

// Flat on the back. The hips carry the whole body over, so the legs and spine
// come with them and only the arms need re-aiming.
// Down on the ice: thrown back onto the shoulders with the knees up, not laid
// out flat. Flat is not reachable here -- the legs are FK, so any pose that
// puts the hips low enough to lie down drives the feet through the ice. These
// numbers came out of a sweep (hips -64 deg, 0.22 down) as the lowest head
// height that still leaves every joint above y = 0.
const SUPINE = {
  hips: { d: [['x', -64]], dt: [0, -0.22, -0.10] },
  spine: { d: [['x', 8]] }, chest: { d: [['x', 10]] },
  neck: { d: [['x', 14]] }, head: { d: [['x', 16]] },
  upLegL: { d: [['x', -20]] }, legL: { d: [['x', 30]] }, footL: { d: [['x', -16]] },
  upLegR: { d: [['x', -12]] }, legR: { d: [['x', 24]] }, footR: { d: [['x', -14]] },
  da: { L: [0.30, -0.62, -0.72], R: [-0.24, -0.80, -0.70] },
};

export const COMBAT_CLIPS = [
  // ---- stance and movement ------------------------------------------------
  {
    // A step cycle that keeps the guard intact. The hands ride the body rather
    // than swinging: a fighter who pumps his arms while walking drops his guard
    // on every step, which is exactly what the stance exists to prevent.
    name: 'walkF', loop: true,
    keys: [
      [0.00, {}],
      [0.18, {
        hips: { dt: [0, 0.012, 0.004], d: [['y', -4]] }, chest: { d: [['y', 3]] },
        upLegL: { d: [['x', -22]] }, legL: { d: [['x', 26]] }, footL: { d: [['x', -8]] },
        upLegR: { d: [['x', 14]] }, legR: { d: [['x', -6]] },
        da: { L: [0.01, 0.03, 0.02], R: [0.0, 0.03, 0.01] },
      }],
      [0.36, {
        hips: { dt: [0, -0.001, 0] },
        upLegL: { d: [['x', 6]] }, upLegR: { d: [['x', -4]] },
      }],
      [0.54, {
        hips: { dt: [0, 0.012, 0.004], d: [['y', 4]] }, chest: { d: [['y', -3]] },
        upLegR: { d: [['x', -20]] }, legR: { d: [['x', 24]] }, footR: { d: [['x', -8]] },
        upLegL: { d: [['x', 12]] }, legL: { d: [['x', -6]] },
        da: { L: [-0.01, 0.03, 0.01], R: [0.0, 0.03, 0.02] },
      }],
      [0.72, {}],
    ],
  },
  {
    name: 'walkB', loop: true,
    keys: [
      [0.00, {}],
      [0.20, {
        hips: { dt: [0, 0.010, -0.006], d: [['y', 3]] }, chest: { d: [['x', -3]] },
        upLegR: { d: [['x', 18]] }, legR: { d: [['x', 14]] }, footR: { d: [['x', -6]] },
        upLegL: { d: [['x', -10]] }, legL: { d: [['x', 8]] },
        da: { L: [0.0, 0.02, -0.03], R: [0.0, 0.02, -0.02] },
      }],
      [0.40, { hips: { dt: [0, -0.005, 0] } }],
      [0.60, {
        hips: { dt: [0, 0.010, -0.006], d: [['y', -3]] }, chest: { d: [['x', -3]] },
        upLegL: { d: [['x', 20]] }, legL: { d: [['x', 12]] }, footL: { d: [['x', -6]] },
        upLegR: { d: [['x', -8]] }, legR: { d: [['x', 8]] },
        da: { L: [0.0, 0.02, -0.02], R: [0.0, 0.02, -0.03] },
      }],
      [0.80, {}],
    ],
  },
  { name: 'crouch', loop: true, keys: [[0.0, CROUCH], [1.2, { ...CROUCH, hips: { d: [['x', 15]], dt: [0, -0.046, 0.006] } }], [2.4, CROUCH]] },
  {
    name: 'crouchGuard', loop: true,
    keys: [
      [0.0, { ...CROUCH, da: { L: [0.0, -0.20, 0.04], R: [-0.03, -0.20, 0.06] } }],
      [2.0, { ...CROUCH, da: { L: [0.0, -0.20, 0.04], R: [-0.03, -0.20, 0.06] } }],
    ],
  },
  {
    // Tuck on the way up, reach on the way down. The sim owns the arc; this is
    // only the shape the body makes inside it.
    name: 'jump', loop: false,
    keys: [
      [0.00, { ...CROUCH, hips: { d: [['x', 8]], dt: [0, -0.05, 0] } }],
      [0.14, {
        hips: { dt: [0, 0.03, 0] },
        upLegL: { d: [['x', -46]] }, legL: { d: [['x', 62]] },
        upLegR: { d: [['x', -38]] }, legR: { d: [['x', 56]] },
        chest: { d: [['x', 6]] },
        da: { L: [0.0, 0.08, -0.02], R: [0.0, 0.08, -0.02] },
      }],
      [0.42, {
        upLegL: { d: [['x', -16]] }, legL: { d: [['x', 22]] },
        upLegR: { d: [['x', 18]] }, legR: { d: [['x', 10]] },
        chest: { d: [['x', -4]] },
        da: { L: [0.0, 0.04, 0.0], R: [0.0, 0.04, 0.0] },
      }],
      [0.60, {}],
    ],
  },
  {
    name: 'land', loop: false,
    keys: [
      [0.00, { ...CROUCH, hips: { d: [['x', 10]], dt: [0, -0.040, 0.004] } }],
      [0.16, { hips: { dt: [0, -0.02, 0] }, upLegL: { d: [['x', -8]] }, legL: { d: [['x', 12]] }, upLegR: { d: [['x', -6]] }, legR: { d: [['x', 10]] } }],
      [0.28, {}],
    ],
  },
  {
    name: 'intro', loop: false,
    keys: [
      [0.00, { hips: { d: [['y', 22]] }, chest: { d: [['y', 16]] }, head: { d: [['y', -18]] }, da: { L: [-0.04, -0.08, -0.04], R: [0.06, -0.08, 0.0] } }],
      [0.55, { hips: { d: [['y', -6]] }, chest: { d: [['y', -8]] }, head: { d: [['x', -4]] }, da: { L: [0.03, 0.05, 0.08], R: [-0.02, 0.04, 0.05] } }],
      [1.00, {}],
    ],
  },

  // ---- strikes ------------------------------------------------------------
  {
    // Lead jab. Short, straight, and back behind the guard immediately.
    name: 'lightPunch', loop: false,
    keys: [
      [0.00, {}],
      [0.06, { hips: { d: [['y', 7]] }, chest: { d: [['y', 5]] }, da: { L: [0.02, 0.01, -0.06] } }],
      [0.15, {
        hips: { d: [['y', -9]], dt: [0, 0.003, 0.014] },
        spine: { d: [['y', -3]] }, chest: { d: [['y', -11]] },
        neck: { d: [['y', 12]] }, head: { d: [['y', 8], ['x', -3]] },
        shoulderL: { d: [['y', -20]] },
        upLegR: { d: [['x', -7]] }, legR: { d: [['x', -5]] },
        da: { L: [-0.13, 0.05, 0.29], R: [-0.02, 0.0, -0.02] },
      }],
      [0.21, {
        hips: { d: [['y', -7]], dt: [0, 0.002, 0.012] },
        chest: { d: [['y', -9]] }, neck: { d: [['y', 10]] }, shoulderL: { d: [['y', -17]] },
        da: { L: [-0.12, 0.05, 0.26] },
      }],
      [0.32, { hips: { d: [['y', 4]] }, chest: { d: [['y', 3]] }, da: { L: [0.03, -0.01, -0.04] } }],
      [0.42, {}],
    ],
  },
  {
    // Rear cross. Everything here is the hip turn -- the rear shoulder travels
    // roughly 0.25 m forward, and that, not the elbow, is what gives the fist
    // somewhere to go on an arm this short.
    name: 'heavyPunch', loop: false,
    keys: [
      [0.00, {}],
      [0.10, {
        // Coil AWAY. Positive hip y carries the REAR shoulder forward on this
        // rig, so the wind-up is negative and the strike positive -- the mirror
        // of the jab, which is a lead-hand punch.
        hips: { d: [['y', -10]] }, chest: { d: [['y', -8]] }, head: { d: [['y', 8]] },
        upLegR: { d: [['x', 6]] },
        da: { L: [0.02, 0.0, -0.03], R: [-0.04, 0.01, -0.08] },
      }],
      [0.26, {
        hips: { d: [['y', 26]], dt: [0, 0.004, 0.022] },
        spine: { d: [['y', 8]] }, chest: { d: [['y', 20]] },
        neck: { d: [['y', -16]] }, head: { d: [['y', -12], ['x', -4]] },
        shoulderR: { d: [['y', 22]] }, shoulderL: { d: [['y', -10]] },
        upLegR: { d: [['x', -16]] }, legR: { d: [['x', -8]] },
        upLegL: { d: [['x', 8]] },
        da: { R: [0.24, -0.03, 0.30], L: [-0.06, -0.04, -0.20] },
      }],
      [0.36, {
        hips: { d: [['y', 23]], dt: [0, 0.003, 0.020] },
        chest: { d: [['y', 18]] }, neck: { d: [['y', -14]] },
        shoulderR: { d: [['y', 20]] },
        upLegR: { d: [['x', -14]] },
        da: { R: [0.22, -0.03, 0.27], L: [-0.05, -0.03, -0.18] },
      }],
      [0.56, { hips: { d: [['y', 6]] }, chest: { d: [['y', 4]] }, da: { R: [0.05, 0.0, 0.04] } }],
      [0.74, {}],
    ],
  },
  {
    // Lead snap kick to the body. The support leg straightens and the hips
    // shift back to counterweight, or the figure walks itself off its own feet.
    name: 'lightKick', loop: false,
    keys: [
      [0.00, {}],
      [0.08, { hips: { dt: [0, -0.012, -0.008] }, upLegL: { d: [['x', -22]] }, legL: { d: [['x', 40]] } }],
      [0.20, {
        hips: { d: [['x', -8]], dt: [0, 0.004, -0.014] },
        chest: { d: [['x', -6]] }, head: { d: [['x', 4]] },
        upLegL: { d: [['x', -54]] }, legL: { d: [['x', 6]] }, footL: { d: [['x', -14]] },
        upLegR: { d: [['x', 6]] }, legR: { d: [['x', -8]] },
        da: { L: [0.03, 0.02, -0.06], R: [0.02, 0.02, -0.05] },
      }],
      [0.28, {
        hips: { d: [['x', -6]], dt: [0, 0.003, -0.012] },
        upLegL: { d: [['x', -48]] }, legL: { d: [['x', 10]] },
        da: { L: [0.03, 0.02, -0.05], R: [0.02, 0.02, -0.04] },
      }],
      [0.42, { upLegL: { d: [['x', -14]] }, legL: { d: [['x', 20]] } }],
      [0.54, {}],
    ],
  },
  {
    // Rear roundhouse. The hips open past the shoulders and the support foot
    // pivots with them; without the pivot the kick reads as a hip dislocation.
    name: 'heavyKick', loop: false,
    keys: [
      [0.00, {}],
      [0.12, {
        hips: { d: [['y', -12]] }, chest: { d: [['y', -8]] },
        upLegR: { d: [['x', 14]] }, legR: { d: [['x', 34]] },
        da: { L: [0.02, 0.0, -0.05], R: [-0.04, 0.0, -0.08] },
      }],
      [0.32, {
        hips: { d: [['y', 30]], dt: [0, 0.010, 0.010] },
        spine: { d: [['y', 8]] }, chest: { d: [['y', 16]] },
        neck: { d: [['y', -14]] }, head: { d: [['y', -10]] },
        upLegR: { d: [['x', -58]] }, legR: { d: [['x', 12]] }, footR: { d: [['x', -16]] },
        upLegL: { d: [['x', 10]] }, legL: { d: [['x', -10]] }, footL: { d: [['y', -24]] },
        da: { L: [0.10, -0.04, -0.18], R: [-0.10, -0.06, -0.02] },
      }],
      [0.44, {
        hips: { d: [['y', 26]], dt: [0, 0.008, 0.008] },
        chest: { d: [['y', 14]] }, neck: { d: [['y', -12]] },
        upLegR: { d: [['x', -50]] }, legR: { d: [['x', 16]] },
        upLegL: { d: [['x', 8]] }, footL: { d: [['y', -20]] },
        da: { L: [0.09, -0.04, -0.16], R: [-0.09, -0.05, -0.01] },
      }],
      [0.66, { hips: { d: [['y', 8]] }, upLegR: { d: [['x', -14]] }, legR: { d: [['x', 18]] }, footL: { d: [['y', -6]] } }],
      [0.86, {}],
    ],
  },
  {
    name: 'crouchPunch', loop: false,
    keys: [
      [0.00, CROUCH],
      [0.10, { ...CROUCH, hips: { d: [['x', 14], ['y', 6]], dt: [0, -0.052, 0.006] }, da: { L: [0.02, -0.28, 0.02], R: [-0.03, -0.26, 0.10] } }],
      [0.20, {
        ...CROUCH,
        hips: { d: [['x', 14], ['y', -10]], dt: [0, -0.050, 0.014] },
        chest: { d: [['x', 8], ['y', -12]] }, shoulderL: { d: [['y', -18]] },
        da: { L: [-0.10, -0.22, 0.28], R: [-0.03, -0.26, 0.08] },
      }],
      [0.34, CROUCH],
    ],
  },
  {
    // Sweep. Deeper than the crouch stance, rear leg fully extended along the
    // floor. The trailing hand goes down to the ice as a prop -- that is what
    // stops the pose reading as a fall.
    name: 'crouchKick', loop: false,
    keys: [
      [0.00, CROUCH],
      [0.14, { ...CROUCH, hips: { d: [['x', 18], ['y', 12]], dt: [0, -0.070, 0] }, da: { L: [0.06, -0.34, 0.02], R: [-0.05, -0.32, 0.08] } }],
      [0.34, {
        hips: { d: [['x', 10], ['y', -30]], dt: [0, -0.098, 0.006] },
        spine: { d: [['x', 6], ['y', -8]] }, chest: { d: [['x', 10], ['y', -14]] },
        neck: { d: [['x', -8]] }, head: { d: [['x', -10], ['y', 12]] },
        upLegR: { d: [['x', -22], ['z', -34]] }, legR: { d: [['x', 10]] }, footR: { d: [['x', -8]] },
        upLegL: { d: [['x', -58]] }, legL: { d: [['x', 86]] }, footL: { d: [['x', -28]] },
        da: { L: [0.20, -0.50, 0.10], R: [-0.06, -0.40, 0.14] },
      }],
      [0.46, {
        hips: { d: [['x', 12], ['y', -24]], dt: [0, -0.095, 0.004] },
        chest: { d: [['x', 10], ['y', -12]] },
        upLegR: { d: [['x', -20], ['z', -28]] }, legR: { d: [['x', 12]] },
        upLegL: { d: [['x', -56]] }, legL: { d: [['x', 84]] }, footL: { d: [['x', -26]] },
        da: { L: [0.19, -0.48, 0.08], R: [-0.06, -0.38, 0.12] },
      }],
      [0.70, CROUCH],
      [0.86, {}],
    ],
  },
  {
    name: 'jumpAttack', loop: false,
    keys: [
      [0.00, {
        upLegL: { d: [['x', -30]] }, legL: { d: [['x', 44]] },
        upLegR: { d: [['x', -24]] }, legR: { d: [['x', 40]] },
        da: { L: [0.0, 0.06, -0.02], R: [0.0, 0.06, -0.02] },
      }],
      [0.14, {
        hips: { d: [['x', -10]] }, chest: { d: [['x', -8]] },
        upLegR: { d: [['x', -46]] }, legR: { d: [['x', 6]] }, footR: { d: [['x', -14]] },
        upLegL: { d: [['x', 16]] }, legL: { d: [['x', 34]] },
        da: { L: [0.08, 0.02, -0.14], R: [0.05, 0.02, -0.10] },
      }],
      [0.30, {
        hips: { d: [['x', -8]] },
        upLegR: { d: [['x', -40]] }, legR: { d: [['x', 12]] },
        upLegL: { d: [['x', 12]] }, legL: { d: [['x', 30]] },
        da: { L: [0.07, 0.02, -0.12], R: [0.04, 0.02, -0.08] },
      }],
      [0.46, {
        upLegL: { d: [['x', -22]] }, legL: { d: [['x', 32]] },
        upLegR: { d: [['x', -18]] }, legR: { d: [['x', 30]] },
      }],
    ],
  },

  // ---- grapples -----------------------------------------------------------
  {
    // Both hands out, palms forward. Short reach, long recovery: the pose has
    // to look committed, because mechanically it is.
    name: 'grab', loop: false,
    keys: [
      [0.00, {}],
      [0.06, { hips: { d: [['y', 6]] }, da: { L: [0.0, 0.02, -0.06], R: [0.0, 0.02, -0.06] } }],
      [0.16, {
        hips: { d: [['y', 10]], dt: [0, 0.004, 0.020] },
        chest: { d: [['y', 8], ['x', -4]] }, neck: { d: [['y', -8]] }, head: { d: [['x', -4]] },
        shoulderL: { d: [['y', -12]] }, shoulderR: { d: [['y', 14]] },
        upLegR: { d: [['x', -10]] },
        da: { L: [-0.06, 0.04, 0.18], R: [0.20, 0.04, 0.26] },
      }],
      [0.30, {
        hips: { d: [['y', 8]], dt: [0, 0.003, 0.016] },
        chest: { d: [['y', 6], ['x', -3]] },
        da: { L: [-0.05, 0.03, 0.16], R: [0.18, 0.03, 0.22] },
      }],
      [0.52, {}],
    ],
  },
  {
    // Holding on. Small, tense, and looping -- the opponent is doing the moving.
    name: 'grabHold', loop: true,
    keys: [
      [0.00, {
        hips: { d: [['y', 8]], dt: [0, 0.002, 0.014] }, chest: { d: [['y', 6]] },
        shoulderL: { d: [['y', -10]] }, shoulderR: { d: [['y', 12]] },
        da: { L: [-0.04, 0.06, 0.16], R: [0.18, 0.06, 0.20] },
      }],
      [0.34, {
        hips: { d: [['y', 6]], dt: [0, 0.006, 0.014] }, chest: { d: [['y', 5], ['x', -4]] },
        shoulderL: { d: [['y', -12]] }, shoulderR: { d: [['y', 14]] },
        da: { L: [-0.04, 0.10, 0.14], R: [0.18, 0.10, 0.18] },
      }],
      [0.68, {
        hips: { d: [['y', 8]], dt: [0, 0.002, 0.014] }, chest: { d: [['y', 6]] },
        shoulderL: { d: [['y', -10]] }, shoulderR: { d: [['y', 12]] },
        da: { L: [-0.04, 0.06, 0.16], R: [0.18, 0.06, 0.20] },
      }],
    ],
  },
  {
    // Two-handed slam: gather, lift across the body, drive down and through.
    name: 'throw', loop: false,
    keys: [
      [0.00, {}],
      [0.12, {
        hips: { d: [['y', -12]] }, chest: { d: [['y', -10], ['x', -6]] }, head: { d: [['y', 10]] },
        da: { L: [-0.04, 0.22, 0.02], R: [0.06, 0.24, 0.04] },
      }],
      [0.30, {
        hips: { d: [['y', 24]], dt: [0, 0.010, 0.018] },
        spine: { d: [['y', 8]] }, chest: { d: [['y', 18], ['x', 14]] },
        neck: { d: [['y', -14], ['x', -8]] }, head: { d: [['y', -10], ['x', -10]] },
        shoulderL: { d: [['y', -14]] }, shoulderR: { d: [['y', 18]] },
        upLegR: { d: [['x', -18]] }, legR: { d: [['x', -6]] }, upLegL: { d: [['x', 10]] },
        da: { L: [-0.04, -0.46, 0.30], R: [0.16, -0.44, 0.32] },
      }],
      [0.42, {
        hips: { d: [['y', 20]], dt: [0, 0.006, 0.014] },
        chest: { d: [['y', 16], ['x', 16]] }, head: { d: [['x', -10]] },
        upLegR: { d: [['x', -14]] },
        da: { L: [-0.04, -0.52, 0.26], R: [0.15, -0.50, 0.28] },
      }],
      [0.64, { hips: { d: [['y', 8]] }, chest: { d: [['x', 6]] }, da: { L: [0.0, -0.14, 0.06], R: [0.04, -0.14, 0.06] } }],
      [0.86, {}],
    ],
  },

  // ---- reactions ----------------------------------------------------------
  {
    name: 'hitHigh', loop: false,
    keys: [
      [0.00, {}],
      [0.06, {
        hips: { d: [['x', -10]], dt: [0, 0.004, -0.028] },
        spine: { d: [['x', -8]] }, chest: { d: [['x', -14], ['y', 10]] },
        neck: { d: [['x', -20]] }, head: { d: [['x', -26], ['y', 14]] },
        shoulderL: { d: [['y', 12]] },
        upLegL: { d: [['x', 12]] }, upLegR: { d: [['x', -10]] },
        da: { L: [0.08, 0.04, -0.22], R: [0.06, 0.02, -0.18] },
      }],
      [0.20, {
        hips: { d: [['x', -4]], dt: [0, 0, -0.010] },
        chest: { d: [['x', -6], ['y', 4]] }, neck: { d: [['x', -8]] }, head: { d: [['x', -10], ['y', 6]] },
        da: { L: [0.03, 0.01, -0.08], R: [0.02, 0.01, -0.06] },
      }],
      [0.36, {}],
    ],
  },
  {
    name: 'hitLow', loop: false,
    keys: [
      [0.00, {}],
      [0.06, {
        hips: { d: [['x', 18]], dt: [0, -0.030, -0.020] },
        spine: { d: [['x', 16]] }, chest: { d: [['x', 22]] },
        neck: { d: [['x', -10]] }, head: { d: [['x', -14]] },
        upLegL: { d: [['x', -16]] }, legL: { d: [['x', 22]] },
        upLegR: { d: [['x', -12]] }, legR: { d: [['x', 20]] },
        da: { L: [0.06, -0.26, -0.10], R: [0.04, -0.26, -0.08] },
      }],
      [0.22, {
        hips: { d: [['x', 8]], dt: [0, -0.012, -0.006] }, chest: { d: [['x', 10]] }, head: { d: [['x', -6]] },
        upLegL: { d: [['x', -6]] }, legL: { d: [['x', 8]] }, upLegR: { d: [['x', -4]] }, legR: { d: [['x', 8]] },
        da: { L: [0.02, -0.10, -0.04], R: [0.02, -0.10, -0.03] },
      }],
      [0.38, {}],
    ],
  },
  {
    // A blocked hit moves the guard, not the head. The forearms absorb and the
    // whole body slides back a little.
    name: 'blockHit', loop: false,
    keys: [
      [0.00, {}],
      [0.05, {
        hips: { d: [['x', 5]], dt: [0, -0.008, -0.016] }, chest: { d: [['x', 6]] },
        shoulderL: { d: [['y', 8]] }, shoulderR: { d: [['y', 6]] },
        upLegL: { d: [['x', -8]] }, legL: { d: [['x', 10]] },
        da: { L: [0.04, -0.02, -0.13], R: [0.03, -0.02, -0.11] },
      }],
      [0.16, { hips: { dt: [0, 0, -0.005] }, da: { L: [0.01, 0, -0.04], R: [0.01, 0, -0.03] } }],
      [0.26, {}],
    ],
  },
  {
    name: 'grabbed', loop: true,
    keys: [
      [0.00, {
        hips: { d: [['x', -6]], dt: [0, 0.004, -0.014] }, chest: { d: [['x', -8]] },
        neck: { d: [['x', -10]] }, head: { d: [['x', -12], ['y', 8]] },
        da: { L: [0.10, 0.10, -0.16], R: [0.08, 0.12, -0.14] },
      }],
      [0.26, {
        hips: { d: [['x', -3], ['y', 8]], dt: [0, 0.002, -0.012] }, chest: { d: [['x', -6], ['y', 6]] },
        head: { d: [['x', -10], ['y', -8]] },
        da: { L: [0.14, 0.06, -0.14], R: [0.04, 0.08, -0.12] },
      }],
      [0.52, {
        hips: { d: [['x', -6]], dt: [0, 0.004, -0.014] }, chest: { d: [['x', -8]] },
        head: { d: [['x', -12], ['y', 8]] },
        da: { L: [0.10, 0.10, -0.16], R: [0.08, 0.12, -0.14] },
      }],
    ],
  },
  {
    // Knockdown: driven back on the heels, then over. The last key is the pose
    // the fighter lies in while the sim counts down the get-up.
    name: 'knockdown', loop: false,
    keys: [
      [0.00, {}],
      [0.10, {
        hips: { d: [['x', -22]], dt: [0, -0.010, -0.055] },
        spine: { d: [['x', -14]] }, chest: { d: [['x', -18]] },
        neck: { d: [['x', -18]] }, head: { d: [['x', -22]] },
        upLegL: { d: [['x', 22]] }, upLegR: { d: [['x', 14]] },
        da: { L: [0.10, -0.06, -0.34], R: [0.08, -0.06, -0.30] },
      }],
      [0.34, {
        hips: { d: [['x', -48]], dt: [0, -0.13, -0.10] },
        spine: { d: [['x', 4]] }, chest: { d: [['x', 6]] }, neck: { d: [['x', 8]] }, head: { d: [['x', 10]] },
        upLegL: { d: [['x', -14]] }, legL: { d: [['x', 26]] },
        upLegR: { d: [['x', -8]] }, legR: { d: [['x', 22]] },
        da: { L: [0.22, -0.40, -0.50], R: [-0.18, -0.54, -0.50] },
      }],
      [0.52, SUPINE],
      [0.90, SUPINE],
    ],
  },
  {
    name: 'getUp', loop: false,
    keys: [
      [0.00, SUPINE],
      [0.22, {
        hips: { d: [['x', -26]], dt: [0, -0.15, -0.05] },
        spine: { d: [['x', 20]] }, chest: { d: [['x', 24]] }, neck: { d: [['x', 6]] }, head: { d: [['x', 4]] },
        upLegL: { d: [['x', -26]] }, legL: { d: [['x', 58]] },
        upLegR: { d: [['x', -20]] }, legR: { d: [['x', 52]] },
        da: { L: [0.20, -0.46, -0.26], R: [-0.16, -0.58, -0.26] },
      }],
      [0.46, { ...CROUCH, hips: { d: [['x', 22]], dt: [0, -0.058, 0] }, da: { L: [0.04, -0.30, 0.02], R: [-0.03, -0.30, 0.08] } }],
      [0.66, {}],
    ],
  },
  {
    // Dizzy: the KO window pose. Loose, heavy, and unmistakably out of it, so
    // the FINISH HIM prompt is not the only thing telling the player.
    name: 'dizzy', loop: true,
    keys: [
      [0.00, {
        hips: { d: [['x', 8], ['z', 6]], dt: [0, -0.030, -0.010] },
        spine: { d: [['x', 6], ['z', 4]] }, chest: { d: [['x', 10], ['z', 6]] },
        neck: { d: [['x', -14]] }, head: { d: [['x', -18], ['z', 12], ['y', -10]] },
        upLegL: { d: [['x', -10]] }, legL: { d: [['x', 14]] },
        upLegR: { d: [['x', -6]] }, legR: { d: [['x', 12]] },
        da: { L: [0.08, -0.24, -0.08], R: [-0.06, -0.26, -0.06] },
      }],
      [0.60, {
        hips: { d: [['x', 10], ['z', -6]], dt: [0, -0.038, -0.014] },
        spine: { d: [['x', 8], ['z', -4]] }, chest: { d: [['x', 12], ['z', -6]] },
        neck: { d: [['x', -16]] }, head: { d: [['x', -20], ['z', -12], ['y', 12]] },
        upLegL: { d: [['x', -8]] }, legL: { d: [['x', 16]] },
        upLegR: { d: [['x', -10]] }, legR: { d: [['x', 14]] },
        da: { L: [0.06, -0.28, -0.10], R: [-0.04, -0.30, -0.08] },
      }],
      [1.20, {
        hips: { d: [['x', 8], ['z', 6]], dt: [0, -0.030, -0.010] },
        spine: { d: [['x', 6], ['z', 4]] }, chest: { d: [['x', 10], ['z', 6]] },
        neck: { d: [['x', -14]] }, head: { d: [['x', -18], ['z', 12], ['y', -10]] },
        upLegL: { d: [['x', -10]] }, legL: { d: [['x', 14]] },
        upLegR: { d: [['x', -6]] }, legR: { d: [['x', 12]] },
        da: { L: [0.08, -0.24, -0.08], R: [-0.06, -0.26, -0.06] },
      }],
    ],
  },

  // ---- finisher and outcomes ---------------------------------------------
  {
    // The finisher, attacker side: a long wind-up so the camera has something
    // to push in on, one committed strike, then the raised-arm hold the round
    // ends on.
    name: 'finisher', loop: false,
    keys: [
      [0.00, {}],
      [0.22, {
        hips: { d: [['y', -22]], dt: [0, 0.012, -0.020] },
        spine: { d: [['y', -8]] }, chest: { d: [['y', -16], ['x', -10]] },
        neck: { d: [['x', -6]] }, head: { d: [['y', 14], ['x', -8]] },
        shoulderR: { d: [['y', -16]] },
        upLegR: { d: [['x', 12]] }, legR: { d: [['x', 8]] },
        da: { L: [-0.06, 0.14, -0.12], R: [-0.10, 0.28, -0.18] },
      }],
      [0.44, {
        hips: { d: [['y', 30]], dt: [0, 0.006, 0.028] },
        spine: { d: [['y', 10]] }, chest: { d: [['y', 24], ['x', 8]] },
        neck: { d: [['y', -16]] }, head: { d: [['y', -14], ['x', -6]] },
        shoulderR: { d: [['y', 24]] }, shoulderL: { d: [['y', -12]] },
        upLegR: { d: [['x', -20]] }, legR: { d: [['x', -8]] }, upLegL: { d: [['x', 10]] },
        da: { R: [0.26, -0.10, 0.32], L: [-0.06, -0.10, -0.16] },
      }],
      [0.60, {
        hips: { d: [['y', 22]], dt: [0, 0.004, 0.018] },
        chest: { d: [['y', 18], ['x', 6]] }, shoulderR: { d: [['y', 18]] },
        upLegR: { d: [['x', -14]] },
        da: { R: [0.24, -0.14, 0.28], L: [-0.05, -0.08, -0.14] },
      }],
      [0.95, {
        // The hold. One arm up, chest open, weight settled -- the beat the
        // round-end splash lands on.
        hips: { d: [['y', -6]] }, spine: { d: [['x', -6]] }, chest: { d: [['x', -12], ['y', -4]] },
        neck: { d: [['x', -8]] }, head: { d: [['x', -10]] },
        shoulderR: { d: [['z', -22]] },
        da: { R: [-0.06, 0.52, -0.10], L: [0.04, -0.16, -0.10] },
      }],
      [1.40, {
        hips: { d: [['y', -6]] }, chest: { d: [['x', -12], ['y', -4]] }, head: { d: [['x', -10]] },
        shoulderR: { d: [['z', -22]] },
        da: { R: [-0.06, 0.52, -0.10], L: [0.04, -0.16, -0.10] },
      }],
    ],
  },
  {
    // The finisher, victim side. Struck, lifted off balance, then down.
    name: 'finisherVictim', loop: false,
    keys: [
      [0.00, {
        hips: { d: [['x', 8]], dt: [0, -0.030, -0.010] },
        chest: { d: [['x', 10]] }, head: { d: [['x', -18], ['z', 12]] },
        da: { L: [0.06, -0.22, -0.10], R: [-0.04, -0.24, -0.08] },
      }],
      [0.14, {
        hips: { d: [['x', -26]], dt: [0, 0.020, -0.050] },
        spine: { d: [['x', -18]] }, chest: { d: [['x', -24], ['y', 14]] },
        neck: { d: [['x', -26]] }, head: { d: [['x', -34], ['y', 18]] },
        upLegL: { d: [['x', 26]] }, upLegR: { d: [['x', 18]] },
        da: { L: [0.16, 0.12, -0.40], R: [0.12, 0.10, -0.36] },
      }],
      [0.42, {
        hips: { d: [['x', -50]], dt: [0, -0.14, -0.14] },
        spine: { d: [['x', 6]] }, chest: { d: [['x', 8]] }, neck: { d: [['x', 12]] }, head: { d: [['x', 16]] },
        upLegL: { d: [['x', -16]] }, legL: { d: [['x', 30]] },
        upLegR: { d: [['x', -10]] }, legR: { d: [['x', 26]] },
        da: { L: [0.24, -0.42, -0.54], R: [-0.20, -0.56, -0.54] },
      }],
      [0.70, SUPINE],
      [1.40, SUPINE],
    ],
  },
  {
    name: 'victory', loop: true,
    keys: [
      [0.00, {
        hips: { d: [['y', -6]] }, chest: { d: [['x', -10], ['y', -6]] },
        neck: { d: [['x', -8]] }, head: { d: [['x', -10]] },
        shoulderL: { d: [['z', 16]] }, shoulderR: { d: [['z', -18]] },
        da: { L: [0.22, 0.30, -0.12], R: [-0.14, 0.24, -0.34] },
      }],
      [0.90, {
        hips: { d: [['y', -6]], dt: [0, 0.012, 0] }, chest: { d: [['x', -14], ['y', -6]] },
        head: { d: [['x', -14]] },
        shoulderL: { d: [['z', 20]] }, shoulderR: { d: [['z', -22]] },
        da: { L: [0.23, 0.33, -0.13], R: [-0.13, 0.26, -0.35] },
      }],
      [1.80, {
        hips: { d: [['y', -6]] }, chest: { d: [['x', -10], ['y', -6]] },
        head: { d: [['x', -10]] },
        shoulderL: { d: [['z', 16]] }, shoulderR: { d: [['z', -18]] },
        da: { L: [0.22, 0.30, -0.12], R: [-0.14, 0.24, -0.34] },
      }],
    ],
  },
  {
    // Defeat: down onto one knee, then the head goes. Not flat on the back --
    // the round-end splash needs a readable silhouette, not a lump.
    name: 'defeat', loop: false,
    keys: [
      [0.00, {}],
      [0.20, {
        hips: { d: [['x', 16]], dt: [0, -0.060, -0.020] },
        spine: { d: [['x', 12]] }, chest: { d: [['x', 18]] },
        neck: { d: [['x', -6]] }, head: { d: [['x', -10]] },
        upLegL: { d: [['x', -26]] }, legL: { d: [['x', 40]] },
        upLegR: { d: [['x', -20]] }, legR: { d: [['x', 36]] },
        da: { L: [0.16, -0.32, -0.02], R: [-0.20, -0.34, -0.06] },
      }],
      [0.55, {
        hips: { d: [['x', 22]], dt: [0, -0.115, -0.010] },
        spine: { d: [['x', 16]] }, chest: { d: [['x', 26]] },
        neck: { d: [['x', -4]] }, head: { d: [['x', 10]] },
        upLegL: { d: [['x', -30]] }, legL: { d: [['x', 96]] }, footL: { d: [['x', -34]] },
        upLegR: { d: [['x', -52]] }, legR: { d: [['x', 78]] }, footR: { d: [['x', -22]] },
        da: { L: [0.18, -0.52, 0.04], R: [-0.22, -0.54, 0.0] },
      }],
      [1.10, {
        hips: { d: [['x', 24]], dt: [0, -0.120, -0.014] },
        spine: { d: [['x', 18]] }, chest: { d: [['x', 30]] },
        neck: { d: [['x', -2]] }, head: { d: [['x', 16]] },
        upLegL: { d: [['x', -30]] }, legL: { d: [['x', 98]] }, footL: { d: [['x', -34]] },
        upLegR: { d: [['x', -52]] }, legR: { d: [['x', 80]] }, footR: { d: [['x', -22]] },
        da: { L: [0.18, -0.56, 0.02], R: [-0.22, -0.58, -0.02] },
      }],
    ],
  },
];
