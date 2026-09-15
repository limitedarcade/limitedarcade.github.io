# Local combat mocap — 2026-09-10

Implemented for Carney and Trump. The original character GLBs, textures,
renderer choices, game rules and authored special-move choreography are intact.
No FBX loader or runtime retargeting was added. No external dataset download,
new dependency, deployment or commit was needed.

## Review

Run `npm run dev` from `web`, then open `/motion-studio.html`.
Choose **Play showcase** for the six active combat cuts. The default comparison
uses the same fighter on both sides: previous authored motion versus mocap.
The camera, facing, contact-pose button, time scrub and playback speed support
pose inspection. Original/textured comparison remains available separately.
The old Fighter Lab links to Motion Studio and retains its existing workflow.

For the reviewed Carney roundhouse pose:
`/motion-studio.html?clip=heavyKick&time=0.464&facing=1.5707963267948966`.

## Delivered

| Game clip | Local source | Treatment |
|---|---|---|
| lightPunch | jab_right | Compact straight, guard settle |
| heavyPunch | cross_right | Torso-driven cross |
| lightKick | front_kick | Forward kick, ankle fitted to 0.87m contact band |
| heavyKick | roundhouse_kick_right | Full-body roundhouse; source actually kicks left |
| uppercut | uppercut_right | Rising punch |
| risingKnee | knee_strike | Close-range knee |

All six have explicit contact/release markers and use the existing simulation
timing. Carney's roundhouse ankle is fitted to 1.48m; Trump's to 1.23m. These
are targets at the existing 1.92m normalized character scale, not mesh changes.
The full source movement remains available separately for review.

- `game/public/fighters/carney/mocap.glb`: 6 clips, 184,672 bytes.
- `game/public/fighters/trump/mocap.glb`: 6 clips, 182,460 bytes.
- Each `mocap-library.glb`: all 40 source takes, approximately 2.34 MiB;
  loaded by Motion Studio, **not by the match**.
- `tools/export-mocap.mjs`: `npm run export-mocap` reproduces all four GLBs.
- `reference/mocap-build.json`: source fingerprints, unchanged original-target
  SHA-256 fingerprints, clip metadata and ankle-reach residuals.

The exporter maps rest-space rotations, scales root motion to each skeleton,
fits feet with two-bone IK without stretching segments, then cuts and blends
the selected attacks. It writes standard animation-only glTF 2.0 binaries.
Animation extras are explicitly restored by the runtime loader because this
vendored Three.js loader does not preserve them on AnimationClip.

## Verification

- `node --test test/mocap.test.js test/simulation-clock.test.js test/carney-flow.test.js test/fighter-pipeline.test.js`:
  **22 passed, 0 failed**. Checks actual generated assets, every track binding,
  finite unit rotations, unique names, small runtime packs, unchanged protected
  move aliases, deterministic sampling, kick contact heights, source texture/skin
  contract, finisher reset, combo inputs and 30/60/144Hz simulation timing.
- Production Vite build passed with Motion Studio included. The existing large
  shared Three.js chunk warning remains.
- Browser review: Carney roundhouse and cross, Trump knee, both character loads;
  final raised Carney roundhouse inspected beside the previous authored kick.
  Support foot grounded and strike leg/torso silhouette readable in that pose.
- Actual practice arena loaded Carney/Trump and registered Final Draft (HK):
  101 damage, one hit. This verifies integration, not exhaustive move acceptance.
- Full suite: **188 passed, 3 failed, 5 skipped**. Two CPU move-coverage tests
  miss meteorKick; one easy-carney-roundhouse practice demonstration test fails.
  Those engine/practice files were not changed in this task. Full-suite baseline
  equivalence was not established, so do not call the entire project green.

## Limits and next work

The pack is AI-generated motion, not automatically production-approved mocap.
All 40 takes were structurally tested, but not all were visually reviewed.
Capture names can be misleading: the supposed right roundhouse kicks left,
and sweep_kick is too high to replace the game's low sweep. Existing low sweep,
movement, spins, weapon attacks, synchronized throws and finisher are preserved.
The target rig lacks the source finger chains, so this is body-motion retargeting.
Unreachable full-library ankle targets are clamped; the report exposes residuals.
Raw falls/grabs in particular still need per-clip acceptance before game use.

Source license: `mocap/README.txt` permits personal/commercial use and prohibits
standalone raw-pack resale/redistribution. Preserve that notice; do not publish
the source pack as a reusable download. The linked Bandai and Xperience datasets
were not needed for this local implementation.

User review and routine timing/clip selection can proceed at Medium reasoning.
Remaining larger work is both-facing hit/block/miss/interruption review, complete
match profiling, and the separate CPU/practice test failures—not a format migration.
