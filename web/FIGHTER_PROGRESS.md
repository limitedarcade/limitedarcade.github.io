# Fighter progress — start here

Updated: 2026-09-10 (America/Chicago). Active milestone: **Carney movement and standout attacks**.
Current handoff: local Motifect retargeting implemented for both fighters;
focused tests and sampled browser poses verified. Six combat cuts are active;
40 full takes per fighter are review-only. See `MOCAP_MILESTONE.md` for scope,
evidence and limits. Original GLBs, game rules and hockey specials are preserved.

## Read order and update rule

Read this file, then `FIGHTER_PLAYBOOK.md`, then only the files needed for your task.
`FIGHTER_MILESTONE.md` records the earlier GLB/finisher pilot. `HANDOFF.md` and
`FIGHTER_PLAYBOOK.legacy-2026-09-09.md` are historical, not current instructions.

At the start of work, claim one task and name the files you will edit. Before
handoff, update its status, evidence, remaining limits and exact next action.
Use **planned / in progress / implemented / verified / blocked**. Code existing
is not visual acceptance; tests passing is not proof of animation quality.
Replace stale state; retain only decisions and the last five completion entries.
Keep this file around 120 lines and the playbook truth log under 15 bullets.
Keep numeric asset data, raw output and captures in linked evidence, not here.
Do not reset, clean, commit or regenerate unrelated work in this shared checkout.

## Current state

- Existing pilot: textured Carney GLB, fighter comparison lab, simulation-owned
  hitstop, normal-attack contact sampling and a finisher presentation proof.
  Pilot details and its earlier visual review: `FIGHTER_MILESTONE.md`.
- New: reproducible offline BVH → animation-only GLB export, six fitted combat
  cuts for each fighter, and `motion-studio.html` before/after review. No deployment.
- Sampled roundhouse, cross and knee poses reviewed in-browser; arena practice
  loaded both fighters and registered Carney's heavy kick. This is not approval
  of every capture, every transition or sustained full-effects performance.
- Shared checkout already contains extensive modified/untracked work from other
  sessions. A clean checkout or upstream deployment is not implied.

## Evidence — rerun when the relevant inputs change

- `node tools/audit-carney.mjs` prints a compact live asset/clip/timing audit.
  Add `--json` for complete mappings and source/asset SHA-256 fingerprints.
- Baseline: `reference/carney-movement-baseline-2026-09-09.json`.
  25 skin bones; 32 GLB + 12 packed clips; GLB 13,999,876 bytes (13.35 MiB).
- Runtime fallbacks: sprint → walkF; backHop → jump; juggle → hitHigh.
  10/22 attack definitions have explicit phase markers; the 12 specials do not.
  Largest special authored-contact drift: meteorKick −2.255 simulation frames.
  This is phase arithmetic, **not measured foot/fist contact or visual QA**.
- Historical pre-mocap baseline: **175 passed, 0 failed, 5 skipped**.
  Local raw output: `fighter-test-baseline.log` (ignored by Git). The five skips
  are original asset-intake tests whose expected source GLBs are absent at the
  paths they check; do not report those tests as passed.
- Current focused mocap/pipeline/clock/Carney-flow suite: **22 passed**. Full suite:
  **188 passed, 3 failed, 5 skipped**; failures are CPU meteorKick coverage (two)
  and the easy-carney-roundhouse practice demonstration (one), in unchanged
  engine/practice files. See the mocap milestone for build and visual evidence.

## Carney delivery sequence

| ID | Status | Task and acceptance |
|---|---|---|
| M0 | Verified | Current source/asset audit and test baseline; evidence above. |
| M1 | Planned — next | Review the actual runtime clips and stress the body with head-height kick, deep crouch, lunge, twist and knockdown. Capture both facings at game distance; name defective joints/weights before editing the mesh. |
| M2 | Planned | Author guard, forward/back footwork, dedicated sprint/burst, retreat hop, jump and landing. Planted support feet, readable weight shifts, responsive transitions; keep simulation authoritative. |
| M3 | Planned | Six distinct attacks below, with authored contact/release markers, appropriate deterministic boxes and verified real inputs. Preserve hockey specials and the finisher. |
| M4 | Planned | Three short playable combo routes, opponent reactions, sound/hitstop/blood timing. Verify hit, block, miss, interruption and both facings; no unbounded juggle/cancel loops. |
| M5 | Planned | Review normal speed and slow motion, rematches and full-match frame times. Save clips/captures, fix visible defects, then approve the reusable roster template. |

Proposed M3 mapping (design targets, not completed animations):

| Choreography | Existing move / decision |
|---|---|
| Stepping straight | `lungePunch` / Slipstream |
| Head-height roundhouse | `heavyKick` / Final Draft |
| Axe kick | `heelDrop` / Ice Pick |
| Spinning back kick | New kit-specific move/input; choose during M3. Do not overwrite the hockey special. |
| Flying knee | `risingKnee` / Cold Shoulder; airborne behavior needs explicit simulation rules. |
| Low sweep | `crouchKick` / Black Ice |

M4 targets: a short grounded pressure chain; a launcher → airborne follow-up;
a committed advancing combo with a punishable ending. Exact inputs and cancel
windows remain design work; the earlier conversational examples are not contracts.

## Small tasks Claude or Grok can claim

All **unclaimed suggestions**, not dispatched work. Claim an ID here before editing;
avoid overlapping files. These are scopes, not assertions about model capability.

| ID / suggested helper | Bounded deliverable | Files / dependency |
|---|---|---|
| C1 / Claude | Add authored markers for the 12 packed specials; regression-test contact/release using actual clips and both kits. No frame-data rebalance. | `game/src/render/clipTiming.js`, a new focused test; coordinate with M3 before editing. |
| C2 / Claude | Let the fighter lab inspect Carney's packed special clips as well as GLB clips, with clear source labels. Preserve original/textured comparison. | `game/src/fighterLab.js`, `game/fighter-lab.html`; helps M1. |
| C3 / Claude | Add practice entries demonstrating the three accepted combo routes through real inputs, with clear reset conditions. | `game/src/game/practice.js`, focused practice tests; waits for M4 route decisions. |
| G1 / Grok | Write a fictional Jake Lang move sheet: eight increasingly inept blocks, distinguishing actual guard, counter and attack; give each a readable tell and punishable weakness. | New `docs/jake-lang-moves.md`; no roster/code edits or real-person factual claims. |
| G2 / Grok | Write a concise pose/timing brief for the six Carney attacks: anticipation, contact, follow-through, support foot and silhouette. | New `docs/carney-attack-brief.md`; use M3 mapping, no numeric balance edits. |
| G3 / either | Review supplied M1/M3 footage at normal speed and slow motion; return timestamped foot sliding, joint collapse, intersections and contact defects. | New review note with evidence paths; waits for footage, never invent observations. |

## Decisions and recent completions

- 2026-09-10: Retargeted the local combat pack to Carney and Trump; active clips
  stay in small GLB supplements. The six new cuts are not completion of the
  broader proposed M3 choreography table. Evidence: `MOCAP_MILESTONE.md`.
- 2026-09-10: User requests moderately mash-friendly, balanced, striking combat.
  Use a small deterministic light-button chain and short input buffer; preserve
  block/whiff punishment and meter-gated spectacle. No random move roulette.
- 2026-09-09: Carney movement/attacks take priority over further close-up finisher
  polish. Reuse shared combat, rig mappings and suitable clips; fit weights and
  proportions per fighter. Jake Lang stays a future fictional parody concept.
- 2026-09-09: Added this handoff, live audit and fingerprinted baseline. Verified
  the test count above. Corrected the assumption that specials merely reuse
  `move.clip`: packed move-ID clips take precedence in the actual renderer.

## Next checkpoint

Have the user judge Motion Studio's six-cut showcase at normal speed. Medium
reasoning is sufficient for clip selection and small timing/UI adjustments.
Next larger acceptance task: hit/block/miss/interruption and both facings in
practice, including existing heelDrop and specials; resolve the three failing
CPU/practice checks separately before claiming the complete suite is green.
