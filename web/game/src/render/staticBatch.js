import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

// Bake static object transforms into shared buffers, keeping every triangle,
// normal and UV. Material, shadow state and spatial cell remain separate so
// batching does not turn distant scenery into one uncullable draw.
export function batchStaticMeshes(root, accept, cellSize = 16) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(), groups = new Map();
  root.traverseVisible(mesh => {
    if (!mesh.isMesh || mesh.isSkinnedMesh || Array.isArray(mesh.material) || mesh.material.transparent
      || mesh.geometry.morphAttributes.position || !accept(mesh)) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    const p = new THREE.Vector3().setFromMatrixPosition(matrix);
    const format = Object.entries(mesh.geometry.attributes).map(([name, a]) => `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`).sort().join(',');
    const key = [mesh.material.uuid, mesh.castShadow, mesh.receiveShadow, mesh.renderOrder, mesh.layers.mask,
      Boolean(mesh.geometry.index), format, Math.floor(p.x / cellSize), Math.floor(p.z / cellSize)].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ mesh, matrix });
  });
  const removed = [], retired = new Set();
  let batches = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const forceIndex = members.some(({ matrix }) => matrix.determinant() < 0);
    const geometries = members.map(({ mesh, matrix }) => {
      const geometry = mesh.geometry.clone().applyMatrix4(matrix);
      if (forceIndex && !geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
      if (matrix.determinant() < 0) {
        if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.attributes.position.count }, (_, i) => i));
        const index = geometry.index;
        for (let i = 0; i < index.count; i += 3) { const a = index.getX(i); index.setX(i, index.getX(i + 2)); index.setX(i + 2, a); }
      }
      return geometry;
    });
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());
    if (!geometry) continue;
    const source = members[0].mesh, batch = new THREE.Mesh(geometry, source.material);
    batch.name = `Static scenery batch ${++batches}`;
    batch.castShadow = source.castShadow; batch.receiveShadow = source.receiveShadow;
    batch.renderOrder = source.renderOrder; batch.layers.mask = source.layers.mask;
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); root.add(batch);
    for (const { mesh } of members) { removed.push(mesh); retired.add(mesh.geometry); mesh.removeFromParent(); }
  }
  root.traverse(mesh => { if (mesh.isMesh) retired.delete(mesh.geometry); });
  retired.forEach(geometry => geometry.dispose());
  return { sourceDraws: removed.length, batches, savedDraws: removed.length - batches };
}
