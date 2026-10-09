// Canonical rigs and imported Mixamo rigs share presentation roles, not names.
const MIXAMO = Object.freeze({ hips: 'Hips', spine: 'Spine', chest: 'Spine2',
  neck: 'Neck', head: 'Head', footL: 'LeftFoot', footR: 'RightFoot',
  toeL: 'LeftToeBase', toeR: 'RightToeBase' });

export function fighterBone(model, role) {
  const canonical = model.getObjectByName(role);
  if (canonical) return canonical;
  const alias = MIXAMO[role];
  if (!alias) return null;
  const pattern = new RegExp(`^mixamorig[:]?${alias}(?:_\\d+)?$`, 'i');
  let found = null;
  model.traverse(node => { if (!found && node.isBone && pattern.test(node.name)) found = node; });
  return found;
}
