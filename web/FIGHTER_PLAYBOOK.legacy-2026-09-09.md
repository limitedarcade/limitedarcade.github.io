# Fighter playbook — reuse this, do not re-discover

Roster: stylized political caricatures, fully shaded 3D, code-only Three.js.

> **Start at [Route C](#route-c--hitem3d-two-file-2026-09-04) at the bottom of this file.**
> Routes A and B below are kept for the reasoning, not the recipe: both are Hunyuan-era,
> and Hitem3D removes the problem they were built to solve. Read them to understand *why*
> a rule exists; run Route C.

img2threejs does **not** hand you a mesh. It writes a TypeScript factory that *builds* one, then vision-reviews pass-by-pass against the photograph until identity features clear. That argument is the product. Mixing it with “dump Hunyuan and pack the verts” is how you spend hours and still miss the PNG.

## Two routes — pick one, never blend

**A — Photograph argument (matches `trump_front.png`).** Spec from the image. Eight passes: blockout (silhouette or stop) → structural (real parts, no one-shell stand-in) → form → material (per-region, solid albedo for flat paint) → surface → lighting → interaction → optimize *without giving back gated detail*. Hunyuan, if used, is **calipers** (height, `styleHeads`, band widths). Its triangles are not the fighter. Compare every screenshot to the PNG.

**B — Force-measured GLB (Mars Cat prompt).** “Reconstruct every *multipart* GLB surface at its measured per-node cell size.” Source is a measurement instrument. Encode those verts. Parity vs the GLB, not vs the PNG. Girl-character / Mars Cat had a clean multipart 3D file. A Comfy one-node Hunyuan dump of a cel is **not** that file (`nodeCount: 1`, `skinCount: 0`, stub arms). A perfect B encode of a bad GLB is still a bad pear.

Trump so far ran **B on a Hunyuan blob**, then got judged as **A**. That cannot succeed. Coarsening 8 mm → 20 mm was a second error *inside* B.

Ringside Boxer 98k is an authored mesh at that count, not a downsample target. `glb-force-measured.md`: do not smooth, re-topologise, weld, or decimate *on route B*. Route A never ships Hunyuan topology in the first place.

Read this before HANDOFF.md. HANDOFF is session state; this is the method.

---

## Order (do not skip, do not reorder)

1. **Turnaround** — front + side + back, RGBA, one connected alpha, T-pose. Tight crop is fine.
2. **Garment gate** — hip/knee/ankle widths. Fitted suit passes. Cape/flare → stop, say what will be lost.
3. **Hunyuan GLB** — measurement instrument only. Unrigged dump is correct. `skinCount: 0` is normal.
4. **Probe + silhouette** — `probe_glb.py`, then rasterize verts. One head, arms out, not a blob. Re-seed if melted.
5. **Normals** — Comfy `SaveGLB` has POSITION only. Run `comfy/add_glb_normals.py` before SDF or the field inverts.
6. **Density** — `measure_density_convergence.py <glb> 0`. Do **not** copy another character’s slice/spoke counts.
7. **SDF / Surface Nets** — `build_head_surface.py 0 <cell>`. Cell ≈ Hunyuan voxel (`bbox / 256` ≈ 8 mm here). 4 mm = more face, huge mesh. 8 mm = viewable.
8. **Paint regions in 3D** — navy / shirt / tie / skin / hair / pants / shoe from **median RGB of the drawing**. Never project the whole cel sheet onto the mesh.
9. **Viewer** — `output/` on Vite. Skin a punch skeleton onto the shell so buttons move it.
10. **Geodesic bones** — rest pose lives in `comfy/geodesic_bind.py` and must match `src/bindSdfJab.js`. Trunk shield + rigid hair. Encode runs geodesic on the **shipped** verts.
11. **Encode** — pack `work/head8` as-is (`--no-cluster`). No `.glb` / `.bin` fetch. If it is big, it is big.
12. **Freeze** — hashes in `src/mesh-freeze-summary.json`. After this, only tracks / skin attrs. Do not move verts.
13. **Jab polish** — keyframes on the frozen tree in `src/bindSdfJab.js`. Then more authored clips.

Route A blockout lives in `src/createTrumpFighterModel.js` (clay, PNG ratios, full hands). Default viewer is that factory. Hunyuan encode is `?src=sdf` only. Capsules here are the pass-01 masses, not a discarded harness.

---

## This box

| | |
|---|---|
| ComfyUI | `http://127.0.0.1:8188`, Hunyuan `hunyuan_3d_v2.1.safetensors` |
| GPU | RTX 4060 8 GB — octree **256** max. OOM → 192 → 128, then `num_chunks` 8000 → 4000 |
| Python | Skill core = stdlib `python` 3.13. GLB pipeline = `uv sync --project integrations/glb_character_pipeline --python 3.12` (`requires-python <3.13`) |
| Showcase | `./splat/img2threejs-showcase` — needed for encode/demo wiring, **not** for loft/SDF |
| Viewer | `npm run viewer` from `fightere/` → `http://localhost:5175/output/`. Do **not** name the script `view` (`npm view` is a builtin) |
| Rig viewer | `npm run rigview` → port **5178**, launch config `fightere-rig`. A second port exists because `npm run dev` pins 5174 with `--strictPort`, and another session holding 5174 blocks the whole review loop |
| Vite | Binds `localhost` (`::1`). `127.0.0.1` may refuse. Never put Chrome `--user-data-dir` inside the Vite tree (EBUSY on Cookies) |
| Headless Chrome | `--enable-unsafe-swiftshader`, no `--disable-gpu`. Without SwiftShader you get a 12 KB black PNG. Absolute screenshot path. `?shot=1` stops rAF so the page goes idle |

Workflow JSON: `comfy/hunyuan3d_glb_api.json`. Copy front PNG into Comfy `input/`. Output → `refs/<id>.glb`.

---

## Do

- Measure `styleHeads` = figureHeight / crownToChin. Overlay default 6.0 (even 4.75) puts nose-guide on the eyes. Trump was **4.24**.
- Illustration is palette + T-pose design. GLB is volume. Arm span will disagree (here 1.43 vs 1.02). Do not average silently.
- Tie and lapels = separate parts / bones. Suit can be body shell.
- Lock a **canonical fighter component tree** on fighter #1. Clips are code, not retargetable FBX. Different trees = re-author animation per fighter.
- Strand loft: join radius **0.09 m**, perimeter ratio **3**, drop stub strands. Girl-character `40` slices was **wrong** here (160 won).
- Armpit weights: geodesic through the solid (64³, falloff³) plus a **trunk shield** (`|x|<0.48` at chest never takes arm bones). The T-pose sculpt *fuses* sleeve to jacket, so geodesic alone still walks through that webbing. Hair `y>1.76` is rigid on the head. Bind lives **inside the TF01 blob**, not a fetched `.bin`. Forearm bones must sit **inside** the stub mesh or they seed empty space and drop. If the SDF cell is finer than the geodesic step, **dilate the surface one voxel** before the outside flood or hips/spine go unreachable (thin shell leaks).
- Face likeness lives in the **SDF sculpt**. Solid skin/hair on that sculpt beats stamping the drawing on the head.
- Encode `work/head8` as-is: `326,166` verts / `653,448` tris. stdlib QEM does not finish at that size; that is not permission to rebuild at 20 mm.
- Pack TF01: uint16 positions over the mesh bbox (~0.03 mm), sRGB uint8 colour (linearise in the decoder), uint16 indices if verts < 65535 else uint32, uint8×4 skin. Pad the colour block to 4 bytes or typed arrays throw. Embed base64 in `src/surfaceData.js` as **one template + `.replace(/\s+/g,'')`**. 8 mm is ~18 MB source / ~49 MB through Vite — first load is slow, still code-only.
- Freeze hashes packed **f64le / i64le** the same way as `mesh_parity.py`. Do not dump 40k verts as pretty JSON. After freeze, jab polish is tracks only. Canonical tree: `hips → spine → chest → head / shoulderL→upperArmL→forearmL / shoulderR→upperArmR→forearmR / upLegL→legL / upLegR→legR`. Later fighters inherit this tree or they re-author clips.

## Do not

- Project a cel illustration onto the whole mesh. Ink, baked shade, and T-pose mismatch paint skin on shoulders and shirt on jacket. Pipeline rule: **solid albedo for flat paint**.
- Skip numpy and still run Stage 2. It **exits 0 and writes nothing**.
- Run `--strict-quality` on a force-measured GLB build. Parity against the measurement is the gate.
- Ship or fetch `.glb` / `.bin` / texture images in the running demo. Local diagnostic GLB in `refs/` is fine and gitignored.
- Improve `src/model.js` placeholders. Replace them.
- Pass `--allow-nonstrict`.
- Put chrome profile dirs under `fightere/` while Vite is watching.
- Author 19 clips before the surface is gated and the tree is frozen. One jab first.
- Feed this caricature to **Mixamo**. Auto-rig + mocap is img2threejs **v1.8 (not shipped)**. Mixamo’s skeleton is not our component-tree rig; clips would be FBX, not code; a 4.2-head pear with stub arms will retarget like an 8-head human in a fat suit. If a Mixamo punch is useful, watch it and **author keyframes** — same as Hunyuan: measure, don’t ship.
- Coarsen, cluster, or re-contour a signed-off sculpt to hit a triangle count. The count is not the result.

---

## Mistakes paid for — do not make them again

The user already gave turnarounds, Hunyuan, the github, and a painted 8 mm shell that looked right. Hours after that, “optimize for 100k tris” produced a worse fighter. That is failure, not progress.

- **The original result is the 8 mm painted SDF.** Encode it. Compare every later screenshot to `review/viewer_regions.png` / `review/viewer_geodesic.png`, not to the previous broken encode.
- **Do not cluster Surface Nets verts.** Degenerate faces drop, the suit goes lacy. Looks like Swiss cheese. Irreversible without going back to `work/head8`.
- **Do not rebuild at 20 mm (or 16, 24, “budget cell”) because 8 mm is “too many tris.”** Watertight + under 100k and the face is a potato, the suit stair-steps, lapels shred. The user could tell. Boxer 98k ≠ downsample target.
- **Do not treat encode as a second sculpt** (route B). Pack TF01. Stop.
- **Do not run route B and grade it against the PNG** (route A). Hunyuan never made hands, a lapel V, or ink. The factory that *builds toward the photo* was never the loop we ran.
- **Do not project the cel sheet.** Solid albedo per region. Already learned; still true.
- **Do not fetch the diagnostic GLB in the demo** once a factory exists.
- **Do not skip the screenshot against the last good frame** before calling a pass done. Route A: vs the PNG. Route B: vs the last good encode of the same mesh.

Route A, one line: spec → blockout holds the PNG silhouette → real components → paint/form/light → clips. Hunyuan numbers only.
Route B, one line: multipart GLB → measure per node → pack those verts. Nothing in either sentence is “make a smaller mesh.”

---

## Paint (copy the idea, not the numbers)

Sample **ink-masked median** RGB per region from the front PNG (skip alpha<0.2 and luma<0.28). Convert sRGB→linear for vertex colours. Classify in object space, e.g. shoes / pants / belt / jacket / shirt (front `z` + `|x|` box) / tie (midline) / neck-skin / head-skin / hair (`y` + `ny`) / hands (outer arm stubs only).

Script: `comfy/bake_vertex_colors.py`.

---

## Reuse on fighter #2

```
refs/<name>_{front,side,back}.png
comfy/hunyuan3d_glb_api.json          # change LoadImage + SaveGLB prefix + seed
comfy/add_glb_normals.py
comfy/bake_vertex_colors.py           # retune classify() bounds from that mesh’s height bands
build_head_surface.py 0 0.008         # viewable cell; 4 mm is face-only later
comfy/encode_surface.py --no-cluster --source work/head8
src/bindSdfJab.js                     # retune bone Y / arm |x|; clips only after freeze
```

New Hunyuan seed if the silhouette is not a single humanoid. Same octree 256. Reuse `src/surfaceCodec.js`. `--repack` if only the byte layout changed.

Still not done on Trump: 4 mm face encode (optional), fused-armpit mesh cut, more **authored** clips (idle / walk / hurt / special) on the frozen tree. Not Mixamo. Fused armpit webbing is mesh, not weights.

---

## img2threejs docs that actually apply

- `docs/standard-prompts/glb-force-measured.md`
- `docs/GLB_CHARACTER_PROMPT.md` → polish → animation (in that order)
- `integrations/glb_character_pipeline/PIPELINE.md` + `README.md`
- `forge/stage1_intake/probe_glb.py`, `measure_density_convergence.py`, `build_head_surface.py`

---

# Route C — Hitem3D two-file (2026-09-04). **Use this. It supersedes A and B.**

Routes A and B above both exist because Hunyuan hands back a naked blob: one node,
POSITION only, no normals, no UVs, no colour, mitten stubs. Everything painful in this
document — the SDF sculpt, cross-sections, geodesic weights, `surfaceData.js` at 18 MB,
"do not rebuild at 20 mm" — is scaffolding erected to *reconstruct* what that blob lost.

Hitem3D hands back the surface, the normals and the paint already correct. That
scaffolding is not salvage, it is dead weight. **Do not build on `src/crossSections.ts`,
`src/surfaceData.js`, `src/geodesicWeights.bin`, `work/head8`, or `src/bindSdfJab.js` for a
new fighter.** They solved a problem this route does not have.

## Ask Hitem3D for two exports of the same sculpt

Neither one alone is usable, and that is not obvious until you render both.

| Export | Carries | Missing |
|---|---|---|
| **textured** (`..._allparts_<ts>.glb`, named after the prompt) | UVs + two 8192² JPEGs (baseColor, metallicRoughness), NORMAL | one merged mesh, cut into ~64 **spatial chunks**, no semantics |
| **parts** (`Hi3D_Untitled_allparts_<ts>.glb`) | 6 named nodes `Head/Torso/LeftArm/RightArm/LeftLeg/RightLeg`, NORMAL | **`COLOR_0` is a flat segmentation tint, not paint** |

Verify they are the same sculpt before combining: **bounds must match exactly.** Ours were
both `[1.0000, 0.8011, 0.3750]`, span/height 1.248. They are independently tessellated —
0% of vertices coincide — so the join is a spatial nearest-neighbour, never an index match.

`allparts` in the *textured* filename is a lie: colour-code its connected components and
you get straight axis-aligned planes, not anatomy. Welding at `1e-5` collapses its 64
chunks to 1 (drops 2.0% duplicate verts). You do not need that mesh's topology at all —
use it only as a colour source.

## The pipeline — four commands

```
# 1. paint the anatomy mesh from the textured mesh's atlas   (~4 min, needs numpy)
python tools/bake_atlas_to_parts.py <textured.glb> <parts.glb> build/fighter_painted.glb

# 2. curvature- and colour-aware decimation
node tools/decimate.mjs build/fighter_painted.glb build/fighter_150k.glb \
     --total 150000 --budget build/budget_fighter.json

# 3. look at it
npm run dev  ->  /review/live/index.html?file=/build/fighter_150k.glb&az=-34&el=6

# 4. gate it: silhouette IoU + colour delta vs the source, never by eye alone
```

Use the venv python (`integrations/glb_character_pipeline/.venv`) — the skill's stdlib
`python` has no numpy and Stage 2 **exits 0 and writes nothing** without it.

## Why decimation is safe here, when the old rules said it was not

The earlier rule — "do not coarsen a signed-off sculpt to hit a triangle count" — is about
*re-contouring your own result*. It does not apply to a generator's raw output.
Ringside Boxer is 97,592 tris because Tripo **generated** at `faceLimit: 100000`.

Hitem3D tessellates *uniformly*: ~0.4 mm vertex spacing on a flat trouser leg and on an
eyelid alike. Most of 2 M triangles encode nothing. Three things make the reduction
invisible:

- **Quadric error metrics** move the surface, not the vertex count, so flat regions
  collapse hard and creases (lapel edge, tie knot, knuckles, nostrils) refuse. This is
  exactly what vertex *clustering* fails to do — that is the "Swiss cheese" warning above,
  and it is a warning about clustering, not about QEM.
- **Colour in the error term** (`simplifyWithAttributes`, weight 0.8 per linear-RGB
  channel). A collapse smearing the red tie into the white shirt is geometrically free and
  visually fatal; the attribute term rejects it.
- **`LockBorder` + per-part budgets.** Borders stay put so parts remain aligned and
  separable for rigging.

`meshoptimizer` (npm, WASM) does this in seconds. stdlib QEM does not finish at this size.

## The budget finding — measured, not assumed

Four builds, all gated against the 2 M source at identical camera framings:

| Build | head tris | hero IoU | 3/4 IoU | head ΔE50 | head ΔE95 |
|---|---|---|---|---|---|
| 120k, head 28% | 33,598 | 99.135% | 99.310% | 3.74 | 27.96 |
| 120k, head 46% | 55,200 | 99.053% | 99.267% | 3.00 | 21.47 |
| 200k, head 28% | 56,000 | — | — | 3.00 | 20.83 |
| **150k, head 40%** | **60,000** | **99.146%** | **99.318%** | **3.00** | **20.27** |

**Face quality tracks the head's own triangle count, not the total.** 120k-head-46% matches
200k-head-28% on the face because both give the head ~55k — the 200k build spends its extra
80k triangles on a torso that was already converged. Spend on the head; the body converges
early.

150k/head-40% beat every other build on *both* axes, including the 200k one, at 4.3 MB.
Default budget, retune per fighter:

```json
{ "Head": 0.40, "Torso": 0.22, "LeftArm": 0.09, "RightArm": 0.09, "LeftLeg": 0.10, "RightLeg": 0.10 }
```

Body silhouette is converged by ~120k (IoU 99.1%, median ΔE **0.00** — pixel-identical over
most of the surface). Do not spend there.

## Gotchas that cost time — each one measured, not guessed

- **glTF UV origin is top-left. Do not flip V.** Flipping scatters atlas samples into
  unrelated islands and produces a plausible-looking but scrambled model (hair on the
  forearm). The tell is speckled colour that still respects the silhouette.
- **Convert sRGB → linear before writing `COLOR_0`.** glTF vertex colour is linear; the
  atlas is sRGB. Skip it and everything reads washed out.
- **The parts export has interior geometry.** Splitting capped each cut, so 1.0–2.2% of
  each part's vertices sit *inside* the body — measured up to **341 mm** deep in the torso.
  They have no counterpart on the textured surface. Give them the nearest exterior colour
  (never visible) and move on; do not treat the mismatch as a bug.
- **Never add a brute-force nearest-neighbour fallback.** It is O(unmatched × |src|) and
  does not finish at 1 M × 1 M. Escalate grid coarseness instead: `0.002 → 0.02 → 0.08`
  with caps `32 → 256 → 1024`. Median match lands at **0.32–0.44 mm**.
- **In the viewer, key `vertexColors` off `!material.map`, not off a URL preset.** Keying it
  off the preset silently renders every custom `?file=` as white clay, which reads as a
  catastrophic quality regression (ΔE 104) that is entirely a viewer bug.
- **Headless Chrome cannot capture these.** A 59 MB GLB outruns `--virtual-time-budget` and
  you get a 6.8 KB blank. Capture from the live page instead: the dev-only `/__shot` Vite
  middleware in `vite.config.js` takes a POSTed base64 canvas and writes it to
  `review/shots/`. `window.__shoot(name, az, el, headshot)` drives it.
- **Gate on numbers.** Silhouette IoU against the background colour, plus median/p95 ΔE
  inside the intersection, at *identical* framing. "Looks fine" missed the clay bug.

## Rigging — done 2026-09-04, and the reason it was cheap

Hitem3D output is unrigged (`skinCount: 0`, `animationCount: 0`), which looked like the
whole remaining gap versus Ringside Boxer and its 41 free Tripo bones. It was not, because
**the six named parts are the segmentation an auto-rigger has to guess at.** Everything
below falls out of that one fact, and none of it needs Mixamo — every "Do not" above about
Mixamo still stands.

```
node tools/measure_joints.mjs build/fighter_150k.glb build/fighter_joints.json
node tools/pose_check.mjs      build/fighter_joints.json   # gate: floor + trunk clearance
node tools/rig.mjs             build/fighter_150k.glb build/fighter_joints.json \
                               build/fighter_rigged.glb
npm run rigview   ->  http://localhost:5178/review/live/index.html?file=/build/fighter_rigged.glb
```

`pose_check` is the whole loop. It runs the same solve as the exporter with no browser,
in under a second, and prints fist height against the chin, fist reach, percent extension,
elbow position, trunk clearance and floor penetration. **Tune against it, then look once.**
Retuning a stance through screenshots costs an order of magnitude more and catches less.
Viewer knobs: `?clip=`, `?bones=1` (skeleton overlay), `?rate=`, and
`window.__setClip(name, t)` / `__look(eye, at)` / `__shoot(name, az, el, headshot)` for
deterministic captures.


**Joints come out of the part bounds, not out of a template.** A part cut plane is the
generator's own statement about where a limb stops, so the neck base, the shoulder sockets
and the hip sockets are read directly off `min`/`max`. Only the joints *inside* a part need
finding, and a cross-section profile finds them: the ankle is where the foot's z extent
passes 62% of its maximum (y -0.326), and the wrist is a girth minimum along the arm — with
a caveat, see **Fists** below: the shipped heuristic looks for the minimum *before a knuckle
bulge*, this sculpt has no bulge, and it landed at the finger base instead. Elbow and knee
have **no** girth minimum on a caricature this soft and are placed proportionally — say so,
do not pretend they were measured.

**Weights are a formula, not a solve.** A Gaussian on distance-to-bone-*segment*, per-bone
sigma from the soft-tissue radius, top 4, normalised. The trunk shield that cost a whole
session on the SDF route (geodesic through the solid, 64³ flood, dilate a voxel) reduces
here to one line: `PART_BONES` says a Torso vertex may not take an arm bone. That is legal
*only* because the arm chain is separately faded to zero at the shoulder cut plane
(`ARM_FADE`, 60 mm), so at the seam both parts agree on the same {chest, shoulder} blend
and the gate never differs anywhere the two parts share geometry. Result: no armpit
collapse and no seam crack at full jab extension — check that view, it is the gate.

**Author arms as wrist targets, in viewer metres, and solve them.** Euler triples for a
guard are unguessable: shoulders sit 0.33 m off the midline on a 0.86 m arm, so a fist at
the cheek is a ~135° elbow, and the first hand-authored pass put the fists at hip height
with the forearms pointing outward. A two-bone solve with an elbow pole fixes it, and
targets in metres mean a number read off a screenshot can be typed straight in. Spine, head
and legs stay as angles — those *do* read as angles.

`pose_check.mjs` is the gate that made this converge: it runs the same solve outside the
browser and prints fist height against the chin, fist reach, percent extension, elbow x,
and whether anything went through the floor. Two real bugs it caught, in seconds each:
the jab's hip drive was rotating the *wrong way* (sign error — the lead shoulder went
backwards), and the torso deltas stacked with the guard's own blade to an **89°** turn, so
the fighter stood side-on and the punch read as a spin. Roughly 20° past the guard is a jab.

Canonical tree, inherited verbatim by every later fighter — 25 bones, 19 deforming:

```
root > hips > spine > chest > neck > head > headEnd
                            > shoulderL/R > upperArmL/R > forearmL/R > handL/R > handEndL/R
            > upLegL/R > legL/R > footL/R > toeL/R
```

Clips: `tpose` (bind — it must key every bone, or an AnimationMixer leaves the previous
stance behind), `guard`, `idle` 3.4 s, `jab` 0.62 s with 0.48 m of fist travel. Bind pose is
the T-pose the sculpt was generated in, so every rest rotation is identity and each inverse
bind matrix is a pure translation.

Two viewer traps, both fixed in `review/live/main.js`: an un-faded clip switch must `stop()`
the old action or the two blend by weight and you get an averaged pose; and framing on the
bind box leaves every clip small in frame, because a T-pose is 2.37 m wide and no fighting
pose is.

### Trunk clearance — the gate that catches "tuck the elbow in"

Boxing coaching says elbows in and under. That is advice for a normal ribcage. This trunk is
**0.54 m wide at the belly and still 0.40 m at the chest**, so the tucked rear elbow sat
**0.19 m inside the body** and the whole right arm vanished into the jacket. Nothing in a
joint list says so, and it is easy to miss from the front because the arm is *behind* the
silhouette, not poking through it.

So `measure_joints.mjs` now also writes a `trunk` profile — half-width (x) and half-depth (z)
of the Torso part in 22 horizontal bands — and `pose_check.mjs` tests every elbow and wrist
against it as an ellipse, inverse-skinned by whichever trunk bone covers that height so it
works on a bladed stance. It prints signed clearance in metres and exits non-zero under
-0.03 m. Run it before you look at anything.

The fix is the **elbow pole**, and the two sides are not mirror images:

```js
const ELBOW_POLE = { L: [0.42, -1, -0.30], R: [-1.42, -1.00, -0.24] };
```

The lead arm reaches across the front where there is nothing to hit. The rear arm is folded
alongside the belly and has to be driven outboard hard. Pole x against elbow height is a
shallow trade — measured on the guard: x -1.55 → elbow y 1.33 m, clearance +0.07; x -1.10 →
elbow y 1.26 m, clearance -0.00. 7 cm of elbow height buys the whole margin, so take the
clearance. Rear wrist target also moved outboard, x -0.02 → -0.20.

### Fists — not done, and the three ways to do it

The sculpt has **open, fanned hands**, so an extended jab reads as a "stop" gesture. This is
a mesh problem, not a weights problem, and the measurements needed are already in
`build/fighter_joints.json`.

The landmark this needs is now correct — **fixed 2026-09-04**, see *Wrist landmark* below.
`hand` sits at x ±0.4180 on both arms, palm and fingers are the outer 21.7% of arm length,
and the hand is a flat paddle: ~5 cm thick in y, ~16 cm wide in z, fingers fanning in the xz
plane. `measured.armL.palmFrac` in the joints JSON is what B and C key off.

**A — regenerate from Hitem3D with fists.** Best-looking hands, and the pipeline downstream
is four automated commands now. But it re-rolls the sculpt: identity, paint and proportions
all change, and the current painted 150k is a signed-off result. Only worth it if you are
re-generating anyway. Do not gamble the likeness on the hands.

**B — bake the fist into the rest mesh. Recommended.** A new step between decimate and
measure, `tools/make_fists.mjs`, per arm part: take verts outboard of the palm start;
converge the fan by scaling z toward the hand mid-plane with falloff along x; curl the finger
region about the hand's local z as an *arc* (two stages, knuckle then mid-phalanx — a single
hinge reads as a bent paddle, not a fist); recompute normals; leave colour alone, the fingers
are already skin. Weights and clips need no change at all, because it happens before the rig
is built and the bind pose simply becomes a fist — which is what a fighter wants. Roughly one
file, ~120 lines. Risks: knuckle detail will not appear on a decimated surface, and the thumb
sweeps with the fingers unless it is separated out. Gate it with a hand-scale capture, not a
full-body one.

**C — rig it: `fingersL/R` + `fingerTipL/R` curl bones** at the knuckle line, weighted by a
smoothstep along the hand axis, curl baked into GUARD. Keeps open/closed as a *pose*, which
is worth having later for a grab or an open-palm taunt. But a rigid rotation cannot converge
fanned fingers, so alone it reads as a mitten. The good combination is B for the rest shape
plus C's bones on top, curling *open* rather than closed.

### Wrist landmark — the one landmark found by searching, and how it fails

Every other joint is read off a bound. The wrist is found by scanning a girth profile, and
that makes it the only one that can be *wrong* rather than merely approximate. It was, for a
whole session.

The obvious rule — smallest girth in the outer half of the arm — assumes a hand that bulges
at the knuckles. This one tapers all the way to the fingertips, so the global minimum is the
END of the fingers and the landmark landed 10 cm out, at the finger base. The `hand` bone was
therefore the *finger* bone, the IK end effector was in the wrong place, and the arm's usable
reach was overstated by 17%.

What actually marks a wrist is girth **ceasing to decline**: it thins into the wrist, then
holds or widens across the palm. So: smooth the profile with a 3-tap mean, walk outward from
45% of arm length, take the first slice whose successor is at least 2% fatter. Both matter —
unsmoothed, a single noisy bin made the right arm latch on at 65% while the left went to 78%,
a 9 cm disagreement on a symmetric sculpt.

Which is the free gate: **the two arms are a cross-check on each other.** They are
independently tessellated, so agreement is evidence the search found anatomy rather than
noise. `measure_joints.mjs` warns above 3% of arm length; Trump now comes out at 0.05%. If a
fighter has no palm flare at all the tool says so out loud and falls back to 72% of arm
length, flagged in the notes as a guess rather than a measurement.

Correcting it shortened the IK chain from 0.2917 to 0.2414 model units and every authored
wrist target had to move. Expect that: **the aim targets are downstream of this landmark.**

### Fighter #2 — what to hand over, and what transfers

The pipeline is now scale-free. Everything that used to be a length in model units — the
neck offset, the head pivot, the pelvis drop, the deltoid inset, sigma, the arm fade, the
crotch band — is a **fraction of figure height** or a fraction of limb length. They were all
silently Trump facts: Hitem3D promises no scale, so an export at a different size would have
taken the same numbers and produced a different rig. Divided through by height they reproduce
this fighter to within a couple of vertices.

**What I need, and cannot make myself:**

1. `refs/<name>_{front,side,back}.png` — turnaround, RGBA, one connected alpha, T-pose.
2. **Two Hitem3D exports of the same sculpt** — the textured one (named after the prompt,
   carries UVs + the two 8192² atlases) and the parts one (`Hi3D_Untitled_allparts_<ts>.glb`,
   six named nodes). Neither alone is usable. **Check their bounds match exactly** before
   combining; they are independently tessellated, so the join is spatial, never by index.

**Then four commands**, unchanged from Trump: `bake_atlas_to_parts.py` → `decimate.mjs` →
`measure_joints.mjs` → `rig.mjs`, with `pose_check.mjs` as the gate.

**Transfers unchanged:** the canonical tree, the weight formula, `PART_BONES` and the trunk
shield, the ARM_FADE seam argument, both codecs, the viewer, and all four gates.

**Expect to retune, in this order:**

| what | how to find out fast |
|---|---|
| decimation budget (head share) | the IoU / ΔE table; face quality tracks the head's own count |
| `SIGMA` fractions | `rig.mjs` prints `sigmaModelUnits`; a non-pear fighter needs a thinner chest and hips |
| `GUARD` angles and `aim` targets | `pose_check`, then `aim_sweep` |
| `ELBOW_POLE` | falls straight out of the trunk width — `aim_sweep` reports whether anything passes |

`tools/aim_sweep.mjs` exists for exactly this: it sweeps a wrist-target neighbourhood and
prints, per candidate, where the fist lands, trunk clearance at wrist/fist/elbow, and percent
extension, then names the roomiest pose that is not straining. Authoring a guard is a
constrained problem — beside the jaw AND outside the belly AND on an arm short enough that
reaching the face nearly locks it — and those three fight each other. Sweep, do not guess.

**Watch for:** `fk` returns model units and every authored threshold is in viewer metres.
Compare them directly and every fist reports as being down by the ankles. Go through
`rig.toView`.

### Mistakes this session — do not pay for these twice

- **Slice profiles: `ext1`/`cen1` is the axis *after* the slice axis, `ext2`/`cen2` the one
  after that.** Slicing on y gives z then x; slicing on x gives y then z. Got this backwards
  once reading torso columns and once writing the arm axis, and both look plausible.
- **Author poses in viewer metres, never model units.** All the reasoning happens by reading
  a screenshot, which is metres; the mesh is 0.801 tall. The first wrist targets were metre
  values typed into a model-unit field, which put the fists 5 cm from the shoulder and folded
  the arm 170 degrees. `createRig` converts — keep it that way.
- **Check the sign of the hip drive.** The jab's first version rotated the hips the wrong way
  and sent the lead shoulder *backwards*.
- **Clip deltas stack on the guard's own blade.** -26/-10/-24 on top of a -29 degree guard is
  an **89 degree** turn: the fighter stood side-on and it read as a spin. ~20 degrees past the
  guard is a jab.
- **An un-faded clip switch must `stop()` the old action** or three blends the two by weight
  and you get an averaged pose that looks like the rig is broken.
- **Do not frame on the bind box.** A T-pose is 2.37 m wide and no fighting pose is, so every
  clip renders small and centred. Frame after the first pose is applied.
- **Match the browser viewport to the canvas `w`/`h` before screenshotting** (already in
  HANDOFF §9). A canvas wider than the pane is silently cropped from the top-left, and the
  crop looks exactly like a camera that did not move.

### Fighter #2, Carney — run 2026-09-04. The reuse claim held.

Four commands, unchanged, plus one new number. Recorded because "it transfers" is worth
more as a measurement than as a promise.

**What transferred with no edit at all:** the canonical tree, `SIGMA`, `PART_BONES`, the
trunk shield, `ARM_FADE`, `LEG_SIDE_FADE`, both codecs, the viewer, all four gates, and the
decimation budget (150k / head 40% -> 60,000 head triangles, the same figure that won the
Trump sweep). The scale-free refactor did what it claimed.

**What did not transfer: the `aim` wrist targets.** They are the one thing in the file still
expressed in absolute viewer metres rather than a fraction of height, and they were authored
against Trump's chin at 1.45 m. Carney's head pivot sits at 1.63 m against Trump's 1.57, so
the identical targets hung every fist 0.09-0.15 m below the jaw -- a dropped guard that
`pose_check` named in one run and that would have been easy to mistake for a stance choice
in a screenshot.

Fixed with a per-fighter sidecar, `build/<name>_pose.json`, loaded automatically beside the
joints file by `rig`, `pose_check` and `aim_sweep`. It carries an `aimOffset` applied at the
single point every aim target funnels through (`solveArm`), so it covers GUARD and every
clip key at once, and an optional `elbowPole`. **No sidecar means the old defaults**, so
fighter #1 is untouched -- verified by re-running Trump's guard after the patch and getting
identical numbers.

Offset found by sweeping against the Trump reference (lead fist -0.00 vs chin at 44%
extension, rear +0.02 at 80%):

| aimOffset y | lead vs chin | rear vs chin |
|---|---|---|
| +0.08 | -0.06 | -0.01 |
| +0.11 | -0.03 | **+0.02** (rear matches Trump) |
| +0.14 | **0.00** (lead matches Trump) | +0.06 |
| +0.17 | +0.03 | +0.09 |

One offset cannot match both ends. **0.13** splits them: lead -0.01, rear +0.05, both inside
the 4 cm band Trump ships in.

**The elbow poles did need overriding, and the way I first got this wrong is the lesson.**
`pose_check` reported Carney's trunk clearance at +0.13/+0.15 m against Trump's +0.04/+0.07,
every gate passed, and I read that as "the inherited poles have margin to spare." They do not.
Clearance that large on a narrow fighter is not margin, it is **chicken wings** -- the elbows
were floating 15 cm off his ribs at chest height, and the guard read as a shrug.

The trunk-clearance gate is **one-sided**. It was built to catch an elbow buried *inside* a
0.54 m belly, so it tests a floor and nothing else. An elbow winged out into empty space
scores beautifully on it. A positive number means "not inside the body", never "in the right
place" -- see *Still open* for the band this suggests.

The numbers say it plainly: inherited, Carney's elbows sit in almost the same absolute place
as Trump's (out +0.09/+0.13 against his +0.06/+0.14). Same elbow, much narrower body.

Mechanics worth keeping: the pole rotates the elbow about the shoulder-to-wrist axis, so **x
is the only lever that matters and "inboard" is negative x on both sides**. The pole's z does
nothing measurable -- it is projected perpendicular to a shoulder-to-target direction that is
mostly forward, so the z component projects straight out. Sweeping it is wasted time.

| lead pole x | elbow out | drop below fist | clearance |
|---|---|---|---|
| +0.42 (inherited) | +0.09 | -0.31 | +0.20 |
| 0.00 | -0.00 | -0.34 | +0.13 |
| **-0.40 (chosen)** | **-0.09** | **-0.32** | **+0.08** |
| -0.80 | -0.15 | -0.28 | +0.07 |
| -1.40 | -0.19 | -0.22 | +0.06 |

| rear pole x | elbow out | drop below fist | clearance |
|---|---|---|---|
| -1.42 (inherited) | +0.13 | -0.19 | +0.16 |
| -0.80 | +0.10 | -0.24 | +0.13 |
| **-0.20 (chosen)** | **+0.04** | **-0.28** | **+0.07** |
| +0.40 | -0.04 | -0.27 | -0.00 |
| +1.00 | -0.09 | -0.23 | -0.02 |

**"More tucked" is not monotonically better.** Past the chosen values the elbow stops dropping
and starts rising again on the inside, so the drop column is what picks the value, not the
clearance column. Final: `L [-0.40,-1,-0.30]`, `R [-0.20,-1.00,-0.24]`. Minimum clearance
across all four clips is +0.03 at the jab's rear forearm, 6 cm above the fail line.

`pose_check` now prints **both** elbows plus `out` (elbow lateral offset from its own
shoulder) and `drop` (elbow height below the fist). It printed only `elbowR` before, which is
how a two-sided problem stayed invisible.

**Two numbers that came out better than Trump's**, both traceable to the export pair:

- Bounds matched **bit-identically** (Trump's pair differed by 0.24 mm per metre of height),
  and the atlas transfer landed at a median match distance of **0.00 mm on all six parts**
  against Trump's 0.32-0.44 mm. Interior fraction 0.95-1.46%, the expected 1-2%.
- The wrist landmark found a real palm flare on both arms and the two sides agreed to four
  decimals (x +/-0.4452). That cross-check is free and it is the one landmark that can be
  wrong rather than merely approximate -- see *Wrist landmark* above.

**Carney's sculpt has closed fists.** The open fanned hands are a Trump-sculpt property, not
a Hitem3D one, so `make_fists.mjs` is not needed for this fighter and the jab does not read
as a traffic-cop gesture. Worth asking for fists in the generation prompt next time; it is
cheaper than baking them.

**One thing to look at, not yet a defect:** Carney's leg joints are asymmetric in x by 0.0392
(knee, ankle, toe) against Trump's 0.0121. Knee and foot x are read off each leg part's own
median, so this is the sculpt's stance rather than a measurement failure, but it is 4% of
height and larger than anything Trump showed.

## Still open on this route

Code-only conversion: `build/fighter_150k.glb` is a **fetched** GLB, so it is a baseline and
a review target, not the deliverable. Packing it as embedded code is the next step, and
150k tris is a far kinder input to that than 326k was. The rig adds ~1.5 MB of skin
attributes (6.04 MB total) and the clips are already code.

**Fists** — route B above, `tools/make_fists.mjs`. Still the single biggest read on
**Trump**: an extended jab from an open hand is a traffic-cop gesture. Carney does not need
it — that sculpt generated with closed fists — so this is now a one-fighter problem, and
asking for fists in the generation prompt may retire it entirely.

**Trunk clearance wants a band, not a floor.** The gate fails below -0.03 m and is happy at
+0.20, but +0.20 on a slim fighter is an elbow winged out into space -- it passed Carney's
first rig while the stance was visibly wrong. An upper bound of roughly +0.12, or better, a
check on `out`/`drop` directly, would have caught it without a screenshot. Until then, read
the elbow line, not just the clearance line.

More clips — walk, hurt, block, special — on the frozen tree. Not Mixamo.

Also still authored by hand rather than measured, and fine to leave that way as long as the
clearance gate passes: elbow and knee placement, and the elbow pole directions.
