// Animation-only export for Carney. Does not regenerate meshes or other fighters.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRig, sampleClip, qConj, qMul } from '../fighter-tool/tools/fighterRig.mjs';
import { loadPose } from '../fighter-tool/tools/poseSidecar.mjs';
import { CARNEY_MOTION } from '../fighter-tool/tools/carneyMotion.mjs';
import { fileURLToPath } from 'node:url';

const jointsPath = fileURLToPath(new URL('../fighter-tool/build/carney/carney_joints.json', import.meta.url));
const measured = JSON.parse(readFileSync(jointsPath));
const rig = createRig(measured.joints, measured.bounds, loadPose(jointsPath));
const floats = [], directory = [], diagnostics = []; let cursor = 0;
for (const motion of CARNEY_MOTION) {
  const samples = sampleClip(motion, rig);
  if (motion.plant) {
    const initial = rig.fk(samples[0][1]).at(motion.plant);
    for (const [, pose] of samples) {
      let state = rig.fk(pose);
      const parent = rig.bones[rig.bones[rig.boneIndex[motion.plant]].parent].name;
      // Keep the sole level; allow its authored yaw to pivot with the hips.
      const hipQ = pose.hips.r;
      const yaw = Math.atan2(2 * (hipQ[3] * hipQ[1] + hipQ[0] * hipQ[2]), 1 - 2 * (hipQ[1] ** 2 + hipQ[0] ** 2));
      const q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
      pose[motion.plant] = { ...pose[motion.plant], r: qMul(qConj(state.at(parent).q), q) };
      state = rig.fk(pose);
      pose.hips.t = pose.hips.t.map((v, axis) => v + initial.pos[axis] - state.at(motion.plant).pos[axis]);
    }
  }
  const names = [...new Set(samples.flatMap(([, pose]) => Object.keys(pose)))];
  const tracks = [];
  for (const name of names) {
    const bone = rig.bones[rig.boneIndex[name]];
    for (const type of ['quaternion', 'vector']) {
      const times = samples.map(([t]) => t), values = [];
      let previous;
      for (const [, pose] of samples) {
        let value = type === 'quaternion' ? [...(pose[name]?.r || [0, 0, 0, 1])]
          : bone.local.map((v, axis) => v + (pose[name]?.t?.[axis] || 0));
        if (type === 'quaternion' && previous && value.reduce((v, x, i) => v + x * previous[i], 0) < 0) value = value.map(v => -v);
        previous = value; values.push(...value);
      }
      const timeOffset = cursor; cursor += times.length;
      const valueOffset = cursor; cursor += values.length;
      floats.push(Float32Array.from(times), Float32Array.from(values));
      tracks.push({ name: `${name}.${type === 'quaternion' ? 'quaternion' : 'position'}`, type, count: times.length, times: timeOffset, values: valueOffset });
    }
  }
  const userData = { contactMarkers: motion.contactMarkers, authoredMovement: motion.authoredMovement, label: motion.label, source: 'Carney motion', plant: motion.plant };
  directory.push({ name: motion.name, duration: motion.keys.at(-1)[0], userData, tracks });
  const contactPose = samples.reduce((best, entry) => Math.abs(entry[0] - (motion.contactMarkers?.[0] || 0)) < Math.abs(best[0] - (motion.contactMarkers?.[0] || 0)) ? entry : best);
  const state = rig.fk(contactPose[1]);
  diagnostics.push({ name: motion.name, contact: motion.contactMarkers,
    feetAtContact: Object.fromEntries(['footL', 'footR'].map(n => [n, rig.toView(state.at(n).pos).map(v => +v.toFixed(3))])) });
}
const json = Buffer.from(JSON.stringify(directory)), offset = (8 + json.length + 3) & ~3;
const buffer = Buffer.alloc(offset + cursor * 4);
buffer.writeUInt32LE(0x31494642, 0); buffer.writeUInt32LE(json.length, 4); json.copy(buffer, 8);
let position = offset;
for (const chunk of floats) { Buffer.from(chunk.buffer).copy(buffer, position); position += chunk.byteLength; }
writeFileSync(new URL('../game/public/fighters/carney/motion.bin', import.meta.url), buffer);
writeFileSync(new URL('../reference/carney-motion-measurements.json', import.meta.url), JSON.stringify(diagnostics, null, 2) + '\n');
console.log(`Carney: ${directory.length} authored clips, ${(buffer.length / 1024).toFixed(0)} KiB. Mesh unchanged.`);
console.log(JSON.stringify(diagnostics.slice(0, 6)));
