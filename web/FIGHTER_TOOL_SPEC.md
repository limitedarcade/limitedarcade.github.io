# Fighter pipeline runner — spec

A desktop tool that turns two Hitem3D exports into a rigged, gated, game-ready fighter
registered in the web build. Written 2026-09-04, after Trump shipped and while Carney was
being staged.

Read [`FIGHTER_PLAYBOOK.md`](./FIGHTER_PLAYBOOK.md) first. That document is the *method*
and it is already correct; this document is the *product* that stops you re-typing the
method. Nothing here changes a single number in the playbook.

---

## The one-line thesis

**Build a pipeline runner, not an agent.**

Route C is four deterministic commands wrapped in four numeric gates. Neither the commands
nor the gates need a language model. What needed intelligence was *deriving* the method,
and that was one-time work already paid for and written down. Re-running it on fighter #2
needs a progress bar and a validator, not an LLM.

The thing that makes this automatable at all is that the gates are numbers. Most
image-to-3D pipelines cannot be automated because nobody can score the output. This one
can: silhouette IoU, ΔE50/ΔE95, trunk clearance in metres, floor penetration, left-right
wrist agreement. Every one of those is a float with a threshold, and the session log proves
the point — "looks fine" shipped a model rendering as white clay at ΔE 104, and the number
caught it.

Corollary: **do not put a weak local VLM in the gate.** It is the one component guaranteed
to reintroduce "looks fine". See [Where a model does belong](#where-a-model-does-belong).

---

## What exists today

Verified present and working in `splat/fightere`:

| stage | command | runtime | needs |
|---|---|---|---|
| 1. paint | `python tools/bake_atlas_to_parts.py <textured.glb> <parts.glb> <out.glb>` | ~4 min | venv numpy + PIL |
| 2. decimate | `node tools/decimate.mjs <in.glb> <out.glb> --total 150000 --budget <b.json>` | seconds | `meshoptimizer` |
| 3. measure | `node tools/measure_joints.mjs <in.glb> <joints.json>` | seconds | — |
| 3b. gate | `node tools/pose_check.mjs <joints.json> [clip]` | <1 s | — |
| 4. rig | `node tools/rig.mjs <parts.glb> <joints.json> <out.glb>` | seconds | — |
| tune | `node tools/aim_sweep.mjs <joints.json> <L\|R> [--clip n] [--key i] [--x a,b] …` | seconds | — |

Support modules: `glb_io.py`, `glbIo.mjs`, `glbRigIo.mjs`, `fighterRig.mjs`.
Review viewer: `review/live/{index.html,main.js}` plus the `/__shot` Vite middleware in
`vite.config.js` — headless Chrome cannot capture a 59 MB GLB, so that middleware is the
only capture path that works.

Python must be the skill venv:
`~/.claude/skills/img2threejs/integrations/glb_character_pipeline/.venv/Scripts/python.exe`
(numpy 2.4.6, PIL 12.3.0). System `python` has no numpy and **stage 1 exits 0 writing
nothing** without it. The runner must hard-fail on a missing numpy rather than inherit that
silent no-op.

## What does not exist yet

- **`tools/make_fists.mjs`** — route B in the playbook, ~120 lines, unwritten. **Trump only.**
  His sculpt has open fanned hands, so an extended jab reads as a traffic-cop "stop"
  gesture. Carney's sculpt generated with closed fists, which means this is a property of
  the prompt rather than of Hitem3D — asking for fists up front may retire the tool
  entirely. If it is written, it must run **between decimate and measure**, because it moves
  the wrist landmark and every authored aim target is downstream of that landmark.
- Any of the above copied into `/web`. `meshoptimizer` is not even in `web/package.json`.

---

## Architecture

Three layers, strictly separated. The bottom two must stay usable without the top one.

```
  GUI  (Electron or Vite+Tauri; a local web page is fine)
   |      drop zone, validator report, stage progress, gate table,
   |      side-by-side renders, live tuning sliders, publish button
   v
  runner/  (Node, headless, scriptable, exit-code driven)
   |      orchestrates stages, parses gate output, writes run manifest
   v
  tools/   (unchanged — the playbook's four commands + gates)
```

The runner is the real deliverable. The GUI is a view over it. Anything the GUI can do must
also be reachable as `node runner/build-fighter.mjs --config carney.json`, so a fighter can
be rebuilt in CI or from a chat session without clicking.

### Per-fighter config

One file, checked in, the complete record of a fighter's tuning:

```jsonc
{
  "id": "carney",
  "displayName": "Carney",
  "source": {
    "textured": "carney_Stylized Cel-Shaded Businessman 3D Model_allparts_20260904_123033.glb",
    "parts":    "carney_allparts_20260904_122231.glb"
  },
  "decimate": { "total": 150000,
                "budget": { "Head": 0.40, "Torso": 0.22,
                            "LeftArm": 0.09, "RightArm": 0.09,
                            "LeftLeg": 0.10, "RightLeg": 0.10 } },
  "rig": { "elbowPole": { "L": [0.42, -1, -0.30], "R": [-1.42, -1.00, -0.24] },
           "guard": { /* angles + wrist targets, viewer metres */ } },
  "gates": { "minIoU": 0.985, "maxDE50": 4.0, "maxDE95": 25.0,
             "minTrunkClearance": -0.03, "maxWristDisagreement": 0.03 }
}
```

Trump's shipped values are the defaults. Carney inherits them and overrides what the sweep
finds.

**Partly built already.** The pose half of this shipped during the Carney run as a sidecar
next to the joints file — `build/<id>_joints.json` -> `build/<id>_pose.json` — carrying
`aimOffset` and optional `elbowPole`, auto-loaded by `rig`, `pose_check` and `aim_sweep`.
No sidecar means the built-in defaults, so fighter #1 is unaffected by the mechanism
existing. The runner should absorb this into the single config above rather than invent a
second format; the sidecar is the migration target, not a competing one.

Carney needed exactly one value: `aimOffset [0, 0.13, 0]`. The `aim` wrist targets are the
last thing in `fighterRig.mjs` still expressed in absolute viewer metres instead of a
fraction of height, so a fighter whose chin sits at a different height inherits a dropped
guard. Every other tunable transferred untouched.

---

## Stage 0: the validator

**Build this first. It is the highest-value hour in the whole project.**

It runs in ~200 ms against the GLB JSON chunks alone — no geometry decode — and it would
have caught, instantly, the exact wall this project hit on 2026-09-04: a Carney parts export
with no textured counterpart, discovered only after inspecting files by hand.

Checks, in order, each with a message that says what to *do*:

1. **Two files, correctly identified.** Textured = 1 mesh, `images >= 1`, has `TEXCOORD_0`.
   Parts = 6 meshes, `images == 0`, has `COLOR_0`.
   If both files look like parts: *"Missing the textured export — the one named after your
   prompt, carrying the atlases. Re-export it from the same sculpt."*
   Do not attempt to infer which is which from the filename. `allparts` appears in both
   Hitem3D filenames and means nothing.
2. **Six semantic node names present and exact**: `Head`, `Torso`, `LeftArm`, `RightArm`,
   `LeftLeg`, `RightLeg`.
3. **Bounds match.** Union of POSITION accessor min/max on each file. Threshold: max
   component delta <= **1 mm per metre of figure height**.
   Measured: Trump 0.24 mm/m (shipped fine), Carney 0.00 mm/m. Anything above ~1 mm/m means
   the two exports are different sculpts and the spatial join will be garbage.
4. **Atlas sanity.** At least one image, `image/jpeg` or `image/png`, decodes, plausibly
   large (Trump and Carney both ship ~8192²; warn under 2048²).
5. **Triangle count sane.** Textured is approximately the generator's `faceLimit` (2.0 M on
   both fighters). Parts carries 1–6% more from the interior caps — expected, not a bug.
6. **Environment.** venv python resolves and imports numpy + PIL; `meshoptimizer`
   installed; the tools directory is present.

Output a short PASS/FAIL card. Fail closed — never start a four-minute bake against a pair
that cannot combine.

---

## Stages and their gates

| # | stage | writes | gate |
|---|---|---|---|
| 1 | bake atlas → parts | `build/<id>_painted.glb` | median match distance <= 0.5 mm; unmatched fraction reported, not fatal (1–2% interior verts are expected) |
| 2 | decimate | `build/<id>_<n>k.glb` + `-decimate.json` | silhouette IoU >= 98.5% and head ΔE50 <= 4.0 / ΔE95 <= 25, at identical framing vs the 2 M source |
| 2b | **fists** *(to build)* | `build/<id>_fists.glb` | hand-scale capture; fingertip convergence, thumb separated |
| 3 | measure joints | `build/<id>_joints.json` | left/right wrist agreement <= 3% of arm length (Trump: 0.05%); tool must say out loud when it fell back to the 72% guess |
| 3b | pose check | — | trunk clearance **inside a band** at every elbow and wrist, every clip -- not merely >= -0.03 m: the floor catches an elbow buried in the trunk, but an elbow winged out into space passes it easily (Carney's first rig did, while visibly wrong). Also: no floor penetration, extension % in range, and the elbow `out`/`drop` pair in a sane range |
| 4 | rig | `build/<id>_rigged.glb` + `-rig.json` | loads; every clip keys every bone; no seam crack at full jab extension |
| 5 | publish | `game/public/fighters/<id>/` | `asset.json` + catalog entry written; game boots with the fighter selected |

Gate thresholds live in the config, not in code. A fighter that misses one is not blocked
from continuing — it is **flagged**, and the run manifest records which gate it failed with
what value. The user decides. Silent auto-pass is the failure mode to avoid, not a strict
gate.

### Reference numbers (Trump, shipped)

Keep these visible in the UI as the comparison column. 150k / head-40% beat every other
build on both axes at 4.3 MB:

| build | head tris | hero IoU | 3/4 IoU | head ΔE50 | head ΔE95 |
|---|---|---|---|---|---|
| 120k, head 28% | 33,598 | 99.135% | 99.310% | 3.74 | 27.96 |
| 120k, head 46% | 55,200 | 99.053% | 99.267% | 3.00 | 21.47 |
| 200k, head 28% | 56,000 | — | — | 3.00 | 20.83 |
| **150k, head 40%** | **60,000** | **99.146%** | **99.318%** | **3.00** | **20.27** |

Face quality tracks the head's own triangle count, not the total. The body is converged by
~120k (median ΔE 0.00 — pixel-identical over most of the surface). Do not spend there.

---

## The tuning loop — the part worth a GUI

Everything above is fire-and-forget. This is not, and it is where a GUI actually earns its
place, because `pose_check` runs headless in under a second. That makes the four judgment
knobs genuinely *interactive* rather than a screenshot round-trip.

Panel, live-updating on every slider move:

- **Head budget share** — re-run decimate on the head part only, show IoU/ΔE against the
  stored table.
- **Elbow pole L/R** — show `out` (elbow offset from its own shoulder) and `drop` (elbow
  below the fist) next to clearance, because clearance alone cannot tell a tucked elbow from
  a winged one. Only the pole's **x** matters and inboard is negative on both sides; its z is
  projected out by the solve and does nothing. Surface the measured trade: on Trump, pole
  x -1.55 gave elbow y 1.33 m and clearance +0.07; x -1.10 gave y 1.26 m and clearance -0.00.
  On Carney the useful range was +0.42 -> -0.40 on the lead and -1.42 -> -0.20 on the rear,
  and past those the elbow starts rising again on the inside — more tucked is not
  monotonically better.
- **Guard angles + wrist targets**, authored in **viewer metres**. Never expose model
  units in the UI. The mesh is ~0.8–0.97 units tall and every threshold in the playbook is
  in metres; typing metres into a model-unit field once folded an arm 170°.
- **`aim_sweep` button** — sweeps a wrist-target neighbourhood and returns the roomiest pose
  that is not straining. Authoring a guard is a constrained problem (beside the jaw AND
  outside the belly AND on an arm short enough that reaching the face nearly locks it) and
  those three fight each other. The sweep is better at it than a person or a model. Present
  its ranked output as clickable candidates.

Renders come from the existing `/__shot` middleware driving
`window.__shoot(name, az, el, headshot)`. Match the browser viewport to the canvas `w`/`h`
before capture, or the shot is silently cropped from the top-left and the crop looks exactly
like a camera that did not move.

Frame the camera **after** the first pose is applied, never on the bind box: a T-pose is
2.37 m wide and no fighting pose is.

---

## Publish

On pass, write:

```
game/public/fighters/<id>/
  <id>-rigged.glb
  asset.json          { schemaVersion, id, displayName, model, skeleton, clips, source, runtimeUse }
game/src/fighters/<id>.js   { id, label, runtimeAsset, authoredHeight, facingRotationY, clips, effects }
```

and add the catalog entry. The existing format is already generic — `trump.js` is fourteen
lines of frozen data and `catalog.js` is a `Map` — so this is templating, not design work.

Also write `build/<id>-run.json`: every stage's inputs, the resolved config, all gate
numbers, tool versions, and timestamps. That manifest is what makes a fighter reproducible
six months later, and it is what a future session should read instead of re-deriving.

Ship-side rule from the playbook, unchanged: the raw 53–60 MB Hitem3D exports never enter
the production build. Only the ~6 MB rigged derivative does.

---

## Where a model does belong

Not in the geometry, and not in the gates.

**No:** vision QA of the mesh. A small local VLM asked "does this look right?" is precisely
the component that says "looks fine" to the clay bug. The numeric gates already do this job
better and in milliseconds. Adding a model here makes the pipeline worse *and* slower.

**No:** orchestration. Choosing the next budget or elbow pole given gate output is a search
over a small scored space. `aim_sweep` already does it exhaustively and correctly.

**Yes, later, on the creative side** — where there is no ground truth to measure against and
the output is text a human will edit anyway:

- fighter description → move brief (light, heavy, two kicks, block, throw, special, taunt,
  victory, defeat, finisher), which the README already lists as an open creative decision;
- clip naming, roster copy, stage descriptions;
- turning a session's findings into a playbook diff.

A local LMStudio model is fine for all of that. It is a separate feature from the runner and
should not block it.

---

## Build order

1. **Validator** (~1 h). Standalone `node runner/validate.mjs <a.glb> <b.glb>`. Immediately
   useful with no GUI at all.
2. **Copy the tooling into `/web`** — `tools/`, `review/live/`, the `/__shot` middleware,
   `build/budget_fighter.json`, and `meshoptimizer` in `package.json`. Keep Trump's
   `fighter_joints.json` / `-decimate.json` / `-rig.json` as regression baselines.
3. **Headless runner** driven by the config file, writing the run manifest. Prove it by
   rebuilding Trump byte-comparably from his config.
4. **`make_fists.mjs`**, for Trump only, and before any re-tune of his guard — it moves the
   wrist landmark. Carney does not need it.
5. ~~Carney through the pipeline~~ — **done 2026-09-04.** Budget unchanged at 150k/head-40%,
   `SIGMA` unchanged, elbow poles unchanged; only the aim offset moved. See the playbook's
   *Fighter #2, Carney* section for the measured numbers.
6. **GUI**, last, over a runner that already works.

Roughly a day or two through step 3, and that covers about 90% of a fighter.

## What stays manual

- **Hitem3D itself.** A web service with a manual two-file export, and the only remaining
  gamble in the pipeline: re-rolling a sculpt re-rolls identity, paint and proportions.
  A signed-off fighter is never worth regenerating for a fixable downstream problem — which
  is the whole argument for baking fists (route B) rather than regenerating with them
  (route A).
- **The final likeness call.** One person, one look, once, after the numbers pass.

---

## Appendix: verified source pairs

| fighter | export | nodes | images | verts | tris | size (x,y,z) |
|---|---|---|---|---|---|---|
| Trump | textured | `geometry_0` | 2 | 1,020,124 | 2,000,000 | 1.0001, 0.8011, 0.3750 |
| Trump | parts | 6 named | 0 | 1,028,020 | 2,056,204 | 1.0000, 0.8011, 0.3750 |
| Carney | textured | `geometry_0` | 2 | 1,019,201 | 2,000,000 | 0.9998, 0.9678, 0.2469 |
| Carney | parts | 6 named | 0 | 1,055,969 | 2,111,830 | 0.9998, 0.9678, 0.2469 |

Bound agreement: Trump 0.24 mm per metre of height, Carney 0.00 (bit-identical). Both pass.

Carney is 0.9678 tall by 0.2469 deep against Trump's 0.8011 by 0.3750 — a substantially
slimmer figure. The rig is scale-free, so lengths transfer, but expect `SIGMA` (thinner
chest and hips) and both elbow poles to want retuning. A narrower trunk should make
clearance easier than it was on Trump, not harder.
