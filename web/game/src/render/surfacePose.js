import * as THREE from '../vendor/three.module.js';

// A cut samples many vertices of one fixed pose. Three's ordinary skinning
// path rebuilds four bone matrices per vertex; resolve those matrices once.
// Keep doubles (rather than the GPU's float bone texture) and the same morph,
// bind and world transforms so the lifted surface still matches the body.
export function surfacePose(mesh) {
  const geometry = mesh.geometry, position = geometry.attributes.position;
  const morphs = (geometry.morphAttributes.position || []).flatMap((attribute, i) => {
    const weight = mesh.morphTargetInfluences?.[i] ?? 0;
    return weight === 0 ? [] : [{ attribute, weight }];
  });
  const morph = new THREE.Vector3(), delta = new THREE.Vector3();
  const vertex = (id, target) => {
    target.fromBufferAttribute(position, id);
    if (morphs.length) {
      morph.set(0, 0, 0);
      for (const { attribute, weight } of morphs) {
        delta.fromBufferAttribute(attribute, id);
        if (!geometry.morphTargetsRelative) delta.sub(target);
        morph.addScaledVector(delta, weight);
      }
      target.add(morph);
    }
    return target;
  };
  if (!mesh.isSkinnedMesh) return (id, target) => vertex(id, target).applyMatrix4(mesh.matrixWorld);
  const matrices = mesh.skeleton.bones.map((bone, i) =>
    new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[i]));
  const base = new THREE.Vector3(), weighted = new THREE.Vector3();
  const indices = new THREE.Vector4(), weights = new THREE.Vector4();
  return (id, target) => {
    vertex(id, target);
    base.copy(target).applyMatrix4(mesh.bindMatrix);
    indices.fromBufferAttribute(mesh.geometry.attributes.skinIndex, id);
    weights.fromBufferAttribute(mesh.geometry.attributes.skinWeight, id);
    target.set(0, 0, 0);
    for (let i = 0; i < 4; i++) {
      const weight = weights.getComponent(i);
      if (weight !== 0) target.addScaledVector(weighted.copy(base).applyMatrix4(matrices[indices.getComponent(i)]), weight);
    }
    return target.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
  };
}
