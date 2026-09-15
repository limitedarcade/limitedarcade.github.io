# Fighter playbook — production workflow

Updated 2026-09-09. Agreed direction: preserve the existing `/web` game and Three.js renderer; improve character production and combat timing. Target: expressive 2.5D political caricatures, intuitive combat, topical specials, extreme stylized gore, and authored cinematic finishers matching `reference/ref1.jpg` through `ref4.png`.

## Authority and history

**Session entry point:** read [`FIGHTER_PROGRESS.md`](FIGHTER_PROGRESS.md) first.
It owns current task status, file claims, validation evidence and small Claude/Grok
task suggestions. This playbook owns durable production rules and the compact
truth log below. Update both when a finding changes the production route; avoid
copying the session transcript or duplicating task status here.

This guide supersedes Routes A/B/C and their code-only restrictions. The original is preserved in `FIGHTER_PLAYBOOK.legacy-2026-09-09.md` for specific measurements and debugging history. Do not read the entire archive on every task. Older instructions banning GLB/texture loading, retopology, imported animation, or changes to the 25-bone tree are retired for the new production route. Preserve existing working fighters during migration.

The first integration is implemented: Carney's textured GLB, the fighter comparison lab, simulation-owned hitstop, normal-attack contact markers, and the Vote of No Confidence cinematic proof. See `FIGHTER_MILESTONE.md` for launch instructions, validation and remaining limitations. This does not complete the rig/animation quality target below.

## Default asset flow and why

**AI concept/sculpt → cleaned mesh and UV textures → rig and authored animation in Blender → GLB → existing Three.js fighter controller.**

Three.js remains the renderer. A model does not need conversion into JavaScript source to work in Three.js. GLB is the default delivery format; the current custom binary route remains supported for existing assets until replacements pass review. Keep editable Blender sources and original generated assets; exports are reproducible build products.

The current packed Trump/Carney route reconstructs vertex colors and skeletal attributes, but not UVs or morph-target geometry. The generated canonical rig has no dedicated facial, finger, twist, or garment controls. Those limitations constrain close-ups and expressive motion; higher polygon counts and more reasoning effort alone cannot fix them.

## Build one convincing fighter before expanding

1. **Capture a baseline.** Record the current fighter at combat distance and close-up, its moves, load size, draw calls, and frame times on the target machine. Preserve reproducible captures and asset versions.
2. **Establish the look.** Reuse existing sculpts when useful. Check likeness, silhouette, face, hands, and suit against the references from front, side, and three-quarter views. AI output is a starting asset, not assumed production topology.
3. **Prepare deformation.** Clean or retopologize troublesome shoulders, elbows, hips, knees, mouth, and hands. Preserve approved likeness. Bake detail into UV textures where appropriate. Reduce geometry only with before/after visual evidence, including animation; no universal triangle count substitutes for profiling.
4. **Rig for the actual moves.** Use a shared humanoid naming/mapping contract with character-specific proportions and optional extra bones. Provide usable fingers/thumbs for weapon grips, facial bones and/or morph targets for expressions, and twist/corrective/garment controls where deformation needs them. Automated weights are a starting point; inspect and correct them.
5. **Author a small animation proof.** Guard, jab, high kick, deep crouch, recoil, weapon grip, and facial scream. Check full motion from combat and cinematic cameras. Retargeted clips may supply a base, but must be adapted to caricature proportions. Use procedural motion for secondary effects and adjustments; signature moves require deliberate posing and timing.
6. **Export and integrate.** Export mesh, textures, skinning, supported expression animation, and named clips to GLB. Validate them after loading in Three.js: Blender constraints and drivers must be baked into supported animation. Adapt `FighterView.loadGltf()` and material handling as needed; do not silently discard authored texture maps. Keep old assets available until the replacement passes.
7. **Prove one finisher.** Author both fighters, props, camera cuts, contact moments, slow motion, sound, wounds, and severance on one timeline. Use prepared detachable regions, wound caps/interiors, or cinematic mesh swaps where appropriate. Generic particle bursts do not establish close-up gore quality. Test alignment across differing fighter proportions.
8. **Expand only after the proof works.** Reuse the import contract, combat rules, review tools, and suitable clips. Unique anatomy, specials, and finishers still require individual work.

## Combat foundations to preserve and correct

Keep the existing simulation/render split, move frame data, input interface, AI, roster definitions, practice tools, and behavioral tests.

- **Preserve simulation-owned hitstop:** `engine/simulationClock.js` drives Match at 60 Hz; render effects cannot overwrite hitstop. Regression replays cover 30/60/144 Hz. Keep decorative effects separate.
- **Extend explicit contact markers:** normal attacks use startup/contact/recovery sampling through `render/clipTiming.js`. Add measured markers for special clips; unmarked clips still use total-duration mapping.
- **Improve combat boxes:** replace the single body rectangle as needed with authored per-state/per-frame hurtboxes and hitboxes. Keep collision deterministic and independent of rendered mesh deformation.
- **Define severance semantics:** cosmetic damage must not secretly change combat. If losing a limb changes moves or reach, the simulation must own that state and its tests. Avoid invisible attacks from missing limbs.
- **If online play becomes a requirement:** design full state save/restore, deterministic input replay, and rollback separately. A 60 Hz loop and a HUD snapshot are not proof of rollback readiness.

## New fighter contract

Each fighter provides an ID, GLB path, scale/facing convention, skeleton mapping, named clips and contact markers, expression channels, weapon sockets, move definitions, portrait, and finisher timeline references. Validate missing clips and sockets explicitly in development instead of masking them with unrelated animations.

Separate visual presentation from authoritative move rules. Existing `fighters/`, `engine/`, and `render/` boundaries are worth retaining. Do not rewrite the whole engine to introduce the new asset route.

## Acceptance and efficient iteration

Target stable 60 FPS on the chosen hardware with both fighters, shadows, effects, and finishers active; report measured frame times and loading/memory costs. Inspect likeness, foot sliding, intersections, joint collapse, grip, facial motion, cut surfaces, and attack contact. Test both facing directions and rematches. Save a short clip or a few fixed-camera captures as evidence. Run relevant automated tests plus build checks; repeat broader checks only when changes justify them.

Use **Astra High** for main implementation and cross-system work; Light/Low for small edits and routine checks; Extra High for difficult rigging, timing, or architecture problems. This is a project recommendation, not a benchmark claim or an automatic settings change. Reserve Max for a specific unresolved problem. Official model reference: https://developers.openai.com/api/docs/models/gpt-6-astra

Be token-conscious: read this guide and the files needed for the current milestone; use targeted searches; avoid repeated full inventories, archive reads, and speculative rewrites. Give short updates stating what changed, what was verified, and what comes next. Maintain a compact milestone record with decisions and evidence. More effort should improve a concrete result, not generate more prose. Do not start parallel agents solely to spend more compute.

## Verified truths — compact, source-backed

These facts were checked on 2026-09-09; recheck the named source after it changes.
Append only reusable findings; replace corrections in place (maximum 15 bullets).

- **Carney's active asset is the hero GLB**, not `fighter.bin`; see `fighters/carney.js`. Packed `combat.bin` still supplies his special animations.
- **The texture pilot kept the original 25-bone rig.** No finger/twist/garment bones or morph-target primitives exist in that exported asset; texture improvement did not improve deformation.
- **12 named special clips already exist.** `FighterView.apply()` prefers an available move-ID clip over `move.clip`. Reading the move table alone gives the wrong animation map, including Carney's hockey special.
- **Movement rules exceed animation coverage.** Sprint uses `walkF`, back hop uses `jump`, juggle uses `hitHigh`, with a procedural pose pass. These are not dedicated athletic clips.
- **Hitstop is simulation-owned now.** `simulationClock.js` and `simulation-clock.test.js` cover combat replay at 30/60/144 Hz; do not reimplement the retired render-clock fix.
- **Normals have contact markers; packed specials do not.** `clipTiming.js` handles 10 normal attack definitions. Special source poses are authored against universal timing, while character overrides change phase ratios. Markers must come from authored animation, not current balance values.
- **The lab is not full runtime parity.** `fighterLab.js` loads GLB animations directly; the match adds packed specials and generated finisher clips. Inspect the actual route being changed.
- **Current floor checks measure joints, not skinned surfaces or planted feet.** Passing them does not establish clean knees, suit deformation, contact reach or absence of sliding.
- **Bone names alone do not ensure retargeting.** Shared clips also need compatible rest transforms, axes and scale; character proportions/weights and optional extra bones need individual fitting.
- **Export commands have different targets.** `export-combat` writes base rigged GLBs; `export-specials` writes generated special JS for both fighters; `pack-runtime` writes binary packs. The hero GLB is a separate Blender build. Do not run broad exporters expecting one fighter or the textured hero to update automatically.
- **A new move needs more than an override.** `extendMoves()` iterates existing `MOVES` keys only. A new kit-only move/input must be deliberately registered; an unknown override key is silently omitted.
- **Existing gore/finisher integration is a proof.** Real grips, authored paired choreography, cut surfaces and sustained-match profiling remain production work; none is proved by a passing unit test.

## Next milestone

Prioritize **Carney's athletic movement, six distinct standout attacks and three
short playable combos**. Start with a runtime pose/deformation proof; correct
demonstrated rig problems, author motion and markers, then tune gameplay and
reactions together. Preserve the hockey specials and finisher while doing this.
The phased tasks and acceptance evidence live in `FIGHTER_PROGRESS.md`. Return
to facial/grip/cut-surface finisher polish after this movement proof. Profile the
full match before expanding the roster.
