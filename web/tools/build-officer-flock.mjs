// Officer Flock: an already-rigged import, retargeted from the shared rig.
//
// Everything general lives in retarget.mjs. This file is only the facts that
// are true of Flock and no one else. Adding another rigged import should look
// like this file, not like a copy of the retargeter.

import { buildFighter } from './retarget.mjs';
import { fileURLToPath } from 'node:url';

const path = relative => fileURLToPath(new URL(relative, import.meta.url));

await buildFighter({
  id: 'officer_flock',
  paths: {
    target: path('../fighters/officer_flock/source/officer_flock.glb'),
    source: path('../game/public/fighters/trump/trump-rigged.glb'),
    output: path('../game/public/fighters/officer_flock/model.json'),
  },
  // The source sculpt includes a gun handle floating well outside the body.
  // Kept as a reusable prop; leaving it in would offset every portrait.
  detach: [{ name: 'Object_77', output: path('../fighters/converted/officer_flock/loose-handle.json') }],
  // This rig has only thumb and index chains -- the index is skinned to all
  // four fingers as one mitten -- so the curl is far shallower than a real
  // hand's. Tune these on flock-review.html; nothing else may re-pose them.
  fist: { index: [0.62, 0.78, 0.55], thumb: [0.41, 0.62, 0.45] },
  // Sink the rigid camera assembly into the collar. It was technically parented
  // to the animated head already, but the near-zero overlap read as a floating
  // head under the dark stage lighting.
  headAttachmentOffset: [0, -0.055, 0],
  expect: { bones: 19, triangles: 134431 },
});
