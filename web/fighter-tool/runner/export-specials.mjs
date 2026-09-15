import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_ROOT, GAME_ROOT } from './config.mjs';
import { createRig, buildTracks } from '../tools/fighterRig.mjs';
import { loadPose } from '../tools/poseSidecar.mjs';
import { SPECIAL_CLIPS } from '../tools/specialClips.mjs';
// Animation-only supplement: the same tracks run on GLB and packed models.
for (const id of ['trump', 'carney']) {
  const path = join(TOOL_ROOT, 'build', id, `${id}_joints.json`);
  const measured = JSON.parse(readFileSync(path));
  const rig = createRig(measured.joints, measured.bounds, loadPose(path));
  const clips = SPECIAL_CLIPS.map(clip => ({ name: clip.name, duration: clip.keys.at(-1)[0],
    tracks: buildTracks(clip, rig).map(track => {
      const bone = rig.bones[track.bone];
      const values = track.values.map((v, i) => +(v + (track.path === 'translation' ? bone.local[i % 3] : 0)).toFixed(7));
      return { name: `${bone.name}.${track.path === 'translation' ? 'position' : 'quaternion'}`,
        type: track.path === 'translation' ? 'vector' : 'quaternion', times: track.times, values };
    }),
  }));
  writeFileSync(join(GAME_ROOT, 'src/fighters', id, 'specialClips.js'), `export const SPECIAL_CLIPS = ${JSON.stringify(clips)};\n`);
  console.log(`${id}: ${clips.length} move-specific animation clips`);
}
