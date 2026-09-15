// Deliberately authored poses on the existing canonical rig. Metres in `da`,
// model units in `dt`; absolute r overrides are used for clear leg silhouettes.
// Contact timestamps live beside the choreography, never in balance data.
const r = (x, y = 0, z = 0) => ({ r: [['y', y], ['x', x], ['z', z]] });
const hips = (x, y, drop = 0, forward = 0) => ({ ...r(x, y), dt: [0, drop, forward] });
const chamber = {
  hips: hips(-10, -8), upLegR: r(-96, 0, 6), legR: r(104), footR: r(-22),
  upLegL: r(-9, 0, -5), legL: r(15),
  chest: r(2, -8), da: { L: [0.04, 0.08, -0.04], R: [-0.05, 0.06, -0.04] },
};
const high = {
  hips: hips(-19, 18, .009, .015), spine: r(-5, 5), chest: r(-8, 9),
  head: r(8, -12), neck: r(7, -12),
  upLegR: r(-123, 0, -12), legR: r(9), footR: r(5),
  upLegL: r(10, 0, -7), legL: r(8), footL: r(-18, -35),
  da: { L: [0.05, 0.05, -0.11], R: [-.10, -.18, -.12] },
};
const sweep = {
  hips: hips(21, -12, -.115, .016), spine: r(9), chest: r(13, 12),
  neck: r(-13), head: r(-10), upLegL: r(-65, 0, -9), legL: r(113), footL: r(-48),
  upLegR: r(-70, 28, -32), legR: r(8), footR: r(12),
  da: { L: [.08, -.65, .05], R: [-.08, -.48, -.04] },
};
const spin = (angle, kick = false) => {
  const theta = angle * Math.PI / 180;
  const aim = x => [Math.cos(theta) * x + Math.sin(theta) * .28, 1.29, -Math.sin(theta) * x + Math.cos(theta) * .28];
  return { hips: hips(kick ? 15 : -4, angle), spine: r(kick ? 10 : 0, 0), chest: r(0, 0),
    neck: r(-4, kick ? -25 : 0), head: r(-3, kick ? -20 : 0),
    upLegR: r(kick ? -112 : -80, 0, kick ? -9 : 0), legR: r(kick ? 12 : 104), footR: r(-5),
    upLegL: r(-8), legL: r(11), aim: { L: aim(.34), R: aim(-.34) } };
};
const clip = (name, keys, metadata = {}) => ({ name, loop: false, keys, ...metadata });
const footwork = (lead, back = false) => ({
  hips: hips(back ? -3 : 4, lead ? -12 : -21, -.008), chest: r(back ? -5 : 0, lead ? -10 : -3),
  upLegL: r(lead ? -29 : 19), legL: r(lead ? 27 : 8), footL: r(lead ? 2 : -27),
  upLegR: r(lead ? 19 : -29), legR: r(lead ? 8 : 27), footR: r(lead ? -27 : 2),
  da: { L: [.015, .02, lead ? .02 : -.02], R: [-.015, .02, lead ? -.02 : .02] },
});

export const CARNEY_MOTION = [
  clip('idle', [[0, {}], [.32, { hips: hips(1, -13, .005), chest: r(-3, -8), da: { L: [.015, .03, .015], R: [-.015, .02, -.01] } }],
    [.66, { hips: hips(2, -19, -.008), chest: r(-4, -7), upLegL: r(-14), legL: r(15), da: { L: [0, -.01, 0], R: [0, -.01, .02] } }]],
  { loop: true, cycleEnd: 1.04, label: 'Alert fighting stance' }),
  clip('walkF', [[0, footwork(true)], [.145, {}], [.29, footwork(false)], [.435, {}]],
  { loop: true, cycleEnd: .58, authoredMovement: true, label: 'Forward fighting steps' }),
  clip('walkB', [[0, footwork(false, true)], [.16, {}], [.32, footwork(true, true)], [.48, {}]],
  { loop: true, cycleEnd: .64, authoredMovement: true, label: 'Retreating fighting steps' }),
  clip('jump', [[0, { hips: hips(7, -16, -.035), upLegL: r(-30), legL: r(53), upLegR: r(-25), legR: r(50), da: { L: [0, -.08, 0], R: [0, -.08, 0] } }],
    [.18, { hips: hips(-8, -12), upLegL: r(-62), legL: r(98), upLegR: r(-45), legR: r(85), footL: r(-34), footR: r(-30), da: { L: [0, .10, 0], R: [0, .10, 0] } }],
    [.43, { hips: hips(-4, -18), upLegL: r(-42), legL: r(68), upLegR: r(-62), legR: r(99), footL: r(-22), footR: r(-32), da: { L: [.02, .05, 0], R: [-.02, .04, 0] } }],
    [.70, {}]], { authoredMovement: true, label: 'Athletic jump tuck' }),
  clip('heavyKick', [[0, {}], [.11, chamber], [.24, { ...chamber, hips: hips(-16, -14) }],
    [.34, high], [.41, { ...high, hips: hips(-17, 27) }], [.56, chamber], [.78, {}]],
  { plant: 'footL', contactMarkers: [.34, .41], label: 'Final Draft · high roundhouse' }),

  clip('heelDrop', [[0, {}], [.14, chamber],
    [.32, { ...high, hips: hips(-10, -8), upLegR: r(-150), legR: r(5), footR: r(15), da: { L: [.03, .14, -.04], R: [-.06, .09, -.04] } }],
    [.39, { ...high, hips: hips(-5, -6), upLegR: r(-141), legR: r(5) }],
    [.47, { ...high, hips: hips(8, -5), upLegR: r(-91), legR: r(8), chest: r(12) }],
    [.53, { ...high, hips: hips(12, -5), upLegR: r(-63), legR: r(12), chest: r(15) }],
    [.68, chamber], [.88, {}]],
  { plant: 'footL', contactMarkers: [.39, .53], label: 'Ice Pick · axe kick' }),

  clip('risingKnee', [[0, {}], [.12, { hips: hips(14, -15, -.036), upLegL: r(-32), legL: r(47), upLegR: r(-28), legR: r(51), da: { L: [0, -.08, -.05], R: [0, -.07, -.05] } }],
    [.26, { hips: hips(-13, 8, .05, .025), upLegL: r(-120), legL: r(130), footL: r(-40), upLegR: r(23), legR: r(42), chest: r(-8, 9), da: { L: [.08, .11, -.08], R: [-.05, .15, .02] } }],
    [.34, { hips: hips(-8, 16, .042, .026), upLegL: r(-111), legL: r(128), footL: r(-40), upLegR: r(9), legR: r(45), chest: r(-7), da: { L: [.06, .09, -.04], R: [-.05, .08, -.03] } }],
    [.5, { hips: hips(10, -8, -.024), upLegL: r(-30), legL: r(45), upLegR: r(-22), legR: r(42), da: { L: [0, -.09, 0], R: [0, -.09, 0] } }], [.68, {}]],
  { contactMarkers: [.26, .34], label: 'Cold Shoulder · driving knee' }),

  clip('lungePunch', [[0, {}], [.13, { hips: hips(-6, -32), chest: r(-3, -17), upLegL: r(1), legL: r(24), da: { L: [.03, .04, -.08], R: [-.07, -.04, -.15] } }],
    [.27, { hips: hips(9, 12, -.009, .025), spine: r(5, 9), chest: r(5, 19), neck: r(-7, -16), head: r(-5, -14), upLegL: r(-25), legL: r(33), upLegR: r(18), legR: r(6), da: { L: [0, .03, -.12], R: [.18, .06, .32] } }],
    [.34, { hips: hips(8, 17, -.01, .02), chest: r(7, 14), upLegL: r(-23), legL: r(31), da: { L: [0, .02, -.10], R: [.16, .04, .28] } }],
    [.47, { hips: hips(0, -2), chest: r(0, 5), da: { R: [.07, 0, .04] } }], [.67, {}]],
  { contactMarkers: [.27, .34], label: 'Slipstream · stepping cross' }),

  clip('crouchKick', [[0, {}], [.17, { ...sweep, upLegR: r(-81), legR: r(112), hips: hips(20, -32, -.095) }],
    [.31, sweep], [.39, { ...sweep, hips: hips(24, 19, -.115, .016), upLegR: r(-75, -10, -24) }],
    [.54, { ...sweep, upLegR: r(-66), legR: r(101), hips: hips(12, 8, -.07) }], [.76, {}]],
  { contactMarkers: [.31, .39], label: 'Black Ice · low sweep' }),

  clip('spinKick', [[0, {}], [.13, spin(-35)], [.27, spin(80)], [.41, spin(230)],
    [.53, spin(350, true)], [.62, spin(375, true)], [.78, spin(400)], [1.03, {}]],
  { plant: 'footL', contactMarkers: [.53, .62], label: 'Polar Reversal · spinning heel' }),

  clip('bodyCheck', [[0, {}], [.10, { hips: hips(-3, -27), chest: r(0, -15), da: { L: [0, 0, -.08], R: [0, 0, -.10] } }],
    [.20, { hips: hips(13, -2, -.014, .04), chest: r(12, -20), upLegL: r(-28), legL: r(38), upLegR: r(21), legR: r(6), da: { L: [-.07, -.13, -.05], R: [.06, -.10, .04] } }],
    [.27, { hips: hips(12, 4, -.008, .035), chest: r(8, -15), da: { L: [-.07, -.10, -.04], R: [.06, -.08, .03] } }], [.48, {}]],
  { contactMarkers: [.20, .27], label: 'Second Reading · shoulder check' }),

  clip('sprint', [[0, { hips: hips(11, -12, -.014), upLegL: r(-48), legL: r(63), upLegR: r(29), legR: r(29), chest: r(5, -3), da: { L: [.02, -.04, .08], R: [-.02, -.04, -.08] } }],
    [.12, { hips: hips(10, -8, .01), upLegL: r(-8), legL: r(30), upLegR: r(-22), legR: r(93), chest: r(3), da: { L: [.03, .02, -.03], R: [-.03, .02, .03] } }],
    [.24, { hips: hips(11, -17, -.014), upLegR: r(-48), legR: r(63), upLegL: r(29), legL: r(29), chest: r(5, -9), da: { L: [.02, -.04, -.08], R: [-.02, -.04, .08] } }],
    [.36, { hips: hips(10, -20, .01), upLegR: r(-8), legR: r(30), upLegL: r(-22), legL: r(93), chest: r(3), da: { L: [.03, .02, .03], R: [-.03, .02, -.03] } }]],
  { loop: true, cycleEnd: .48, authoredMovement: true, label: 'Explosive sprint' }),

  clip('backHop', [[0, {}], [.07, { hips: hips(-12, -14, -.027), upLegL: r(-31), legL: r(50), upLegR: r(-26), legR: r(52), da: { L: [0, -.05, 0], R: [0, -.05, 0] } }],
    [.17, { hips: hips(-17, -12), upLegL: r(-45), legL: r(75), upLegR: r(-39), legR: r(82), footL: r(-27), footR: r(-30), da: { L: [0, .08, -.05], R: [0, .06, -.04] } }],
    [.29, { hips: hips(7, -15, -.02), upLegL: r(-23), legL: r(34), upLegR: r(9), legR: r(17), da: { L: [0, -.04, 0], R: [0, -.04, 0] } }], [.36, {}]],
  { authoredMovement: true, label: 'Guarded retreat hop' }),

  clip('land', [[0, { hips: hips(12, -12, -.045), upLegL: r(-36), legL: r(62), upLegR: r(-30), legR: r(59), chest: r(8), da: { L: [0, -.13, .03], R: [0, -.13, .03] } }],
    [.055, { hips: hips(8, -16, -.023), upLegL: r(-22), legL: r(35), upLegR: r(-15), legR: r(30), da: { L: [0, -.06, 0], R: [0, -.06, 0] } }], [.14, {}]],
  { authoredMovement: true, label: 'Weighted landing' }),
];
for (const motion of CARNEY_MOTION) if (motion.cycleEnd) motion.keys.push([motion.cycleEnd, structuredClone(motion.keys[0][1])]);
