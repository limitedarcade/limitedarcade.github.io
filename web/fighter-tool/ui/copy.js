export const STEPS = [
  { id: 'start', label: 'Start' },
  { id: 'drop', label: 'Drop' },
  { id: 'report', label: 'Validate' },
  { id: 'build', label: 'Build' },
  { id: 'review', label: 'Review' },
  { id: 'tune', label: 'Guard' },
  { id: 'pack', label: 'Pack' },
  { id: 'publish', label: 'Export' },
];

export const STAGE_HELP = {
  validate: 'One textured GLB, or two Hitem3D exports of the same sculpt. Fail closed.',
  bake: 'Paint or split into Head / Torso / arms / legs. Two-file bake is ~4 minutes; a solo textured split is seconds.',
  decimate: 'Spend triangles on the head. Body is already converged by ~120k.',
  fists: 'Only if the T-pose has open hands. Carney’s drawing already has fists — skip this.',
  measure: 'Joints from part bounds. Wrist is the only searched landmark.',
  pose: 'Trunk clearance and floor, in viewer metres. Tune against this, then look once.',
  rig: 'Canonical 25-bone tree. tpose must key every bone.',
  encode: 'Copy the measured surface into JavaScript. Vertex counts must match the GLB.',
};

export function gateFix(g) {
  return g.fix || (g.status === 'pass' ? 'Looks like the shipped Trump numbers.' : '');
}
