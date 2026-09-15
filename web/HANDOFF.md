# HANDOFF — Trump caricature fighter, procedural Three.js

> **Historical snapshot — 2026-09-03.** Current work starts at
> [`FIGHTER_PROGRESS.md`](FIGHTER_PROGRESS.md), then
> [`FIGHTER_PLAYBOOK.md`](FIGHTER_PLAYBOOK.md). The old paths, blockers and
> code-only restrictions below are retained for history and are superseded.

**Method (read first):** [`FIGHTER_PLAYBOOK.md`](FIGHTER_PLAYBOOK.md) — what to reuse on the next fighter.
This file is historical session state.

**For an agent with zero prior context.** Everything below was verified on this machine on
2026-09-03, not assumed. Where something is unverified it says so explicitly.

---

## 1. The mission

Build a **stylized Donald Trump caricature as a code-only, rigged, animation-ready Three.js
character**, to be one fighter in a Street Fighter–style political parody game. The target quality
bar is the "Ringside Boxer" exhibit in the img2threejs showcase: ~98k triangles, a 41-bone rig,
19 combat clips, and impact VFX whose timings were measured off the animation rather than authored
by hand.

The subject is a **caricature illustration**, not a photograph. This matters: img2threejs documents
that characters come out as "stylized reconstructions, not photoreal likeness," which is normally a
limitation — but here the target *is* stylized, so the achievable output and the goal are the same
kind of object. This is the single biggest thing working in our favour.

Note on subject matter: this is political satire of a public figure, which is the user's stated and
legitimate creative intent. Build it as specified.

---

## 2. Current state — and the one thing blocking progress

| Item | Status |
|---|---|
| Working directory `./splat/fightere` | ✅ created |
| Three reference views, cleaned to single-component RGBA | ✅ done |
| img2threejs **Step 0** garment gate | ✅ **passes** |
| Browser render → screenshot review loop | ✅ proven working end-to-end |
| Vite + Three.js review harness | ✅ built and running |
| ComfyUI Hunyuan3D capability | ✅ verified available locally |
| **`refs/trump_fighter.glb`** | ✅ generated 2026-09-03 (seed 28082601, octree 256) |
| GLB probe + humanoid sanity | ✅ plausible T-pose, 1 head, not a melted blob |
| img2threejs state (`animated-character`) | ✅ initialized |
| Intake through detail-inventory | ✅ filled |
| Spec / factory / rig | ⛔ **not started** |

**Start here:** `python forge/next.py --state fightere/.img2threejs/state.json` — next step is
`projection-route`, then spec authoring. Do not regenerate the GLB unless a later pass proves it
unusable.

### GLB facts (measured)

- Path: `fightere/refs/trump_fighter.glb` (gitignored). Source copy:
  `ComfyUI-Shared/output/3d/trump_fighter_00001_.glb`
- sha256 `568fb46182e123e41eeb55a331d9c7dd61d415037c90deefb47bdb90c6c4fcc4`
- 199,638 verts / 472,014 tris / 1 node / 1 mesh / `skinCount: 0` / `animationCount: 0`
- POSITION only (no normals, no UVs, no vertex colour). Base colour is flat grey `0.22`.
- Bounds size `[1.964, 1.922, 1.073]` (width/height 1.02, depth/height 0.56)
- Semantic: `single-region-merged-asset` — part names are hypotheses
- Silhouettes: `review/glb_front_pts.png`, `glb_side_pts.png`, `glb_top_pts.png`

**Known GLB vs illustration deltas (do not discover at review):** illustration arm span is 1.43×
height; GLB is 1.02×. Hands are mitten stubs. Tie is fused into the chest. Colour must come from
the PNGs, not the GLB.

**Measured styleHeads: 4.24** (crown-to-chin 180 px / figure 764 px). Overlay drawn at 4.75 still
put the nose guide on the eyes because hair occupies the top ~32% of the head box. Use 4.24.

---

## 3. Verified environment

| Thing | Value |
|---|---|
| OS | Windows 11 Pro 26200 |
| Shell | PowerShell primary; Git Bash also available |
| Python | **3.13.15**, invoked as `python` (docs say `python3` — that does not exist here) |
| Node / npm | v24.18.0 / 11.16.0 |
| img2threejs skill | `./.claude/skills\img2threejs`, **v1.5.2** |
| Skill dependencies | **none** — Python 3.10+ stdlib only, no pip installs needed |
| ComfyUI | running at `http://127.0.0.1:8188`, **v0.34.2**, 973 nodes |
| GPU | NVIDIA RTX 4060, **8 GB VRAM** (~7.45 GB free) |
| Dev server | Vite on port **5174**, config at `splat\.claude\launch.json` (name: `fightere`) |

Invoke the skill in Claude Code with `/img2threejs`. Its standard prompts live in
`<skill>/docs/standard-prompts/` — `build.md`, `glb-force-measured.md`, `polish.md`, `vfx.md`.

---

## 4. What img2threejs is, in one paragraph

It rebuilds a reference subject as **procedural TypeScript that constructs a `THREE.Group`** — from
primitives, generated geometry and procedural shaders. It is not photogrammetry and not mesh
import. No `.glb`, `.bin`, or texture image ever ships or is fetched at runtime; that code-only
contract is the point of the project and does not bend. The pipeline runs staged passes
(blockout → structural → form → material → surface → lighting → interaction → optimization), each
individually gated, with a reference-beside-render review at every step.

---

## 5. Reference assets — measured, not eyeballed

All in `fightere/refs/`. All are RGBA with genuine alpha, tight-cropped to the figure bounding box
(so bbox == full canvas, which is correct and not a bug), and reduced to a **single connected
component** (stray islands removed).

| File | Size | Notes |
|---|---|---|
| `trump_front.png` | 1091 × 764 | T-pose, front. 63.5% transparent. Clean bimodal alpha. |
| `trump_side.png` | 313 × 754 | Split from the combined sheet at x=313. 56 px foreign island removed. |
| `trump_back.png` | 811 × 747 | Split from the same sheet. Already clean. |
| `trump_side_back.png` | 1124 × 754 | Original combined sheet — kept for provenance, **do not use directly**. |

**The turnaround is pose-consistent.** An early reading suggested the side view used a different arm
pose; it does not. In a true side view of a T-pose the near arm points straight at the camera and
reads as a foreshortened stub with the hand facing the viewer — which is exactly what the side view
shows. This was confirmed by rendering the placeholder at 78° azimuth and observing the same
foreshortening. **No reference needs regenerating.**

Minor known variance: figure heights differ slightly across views (764 / 754 / 747 px). Some of that
is legitimate (the hair silhouette genuinely differs front vs back). Normalize height when using the
views together; do not assume they are pre-matched.

---

## 6. Step 0 result — the garment gate

img2threejs v1.5 ships a character template of **61 anatomy components and ZERO garments.** Clothing
is not implemented. Step 0 of `build.md` exists to stop a subject whose silhouette is substantially
fabric standing away from the body (cape, flared skirt, hanging sleeve) — because such a subject
comes back as a body-shaped blob wearing the character's name.

Measured on `trump_front.png`:

| Measurement | Value |
|---|---|
| Figure height | 764 px |
| Hip band (48–54%) mean width | 464 px |
| Knee band (68–74%) mean width | 362 px |
| Ankle band (92–99%) mean width | 335 px |
| Silhouette area / height² | 0.521 |
| Widest point below hip | 488 px → **+5.2% vs hip** |

**Verdict: PASSES.** A flared garment widens far more than 5.2%; that figure is body-and-jacket-hem
shape. The suit is fitted and reads as body volume, so it can be built as the body shell's surface.

Two components must be handled as **separate parts on their own sockets**, not baked into the shell:
the **necktie** (free-hanging, wants its own bone so it swings on impact) and the **jacket lapels /
open front edges** (shallow standoff from the shirt).

---

## 7. Generating the GLB with ComfyUI — the current blocker

### Why a GLB at all

Two routes exist. **Photo-only** reconstructs purely from the reference images and is documented as
the weaker path. **GLB-measured** feeds a rough 3D mesh in as a *measurement instrument* — the
pipeline reads dimensions, per-band widths, centroids, part bounds and base colours off it and
forces those measured values into the emitted code instead of approximating them. The showcase's
Ringside Boxer used the GLB route. **The user explicitly chose GLB-measured.**

Critically: **the GLB does not need to be good, rigged, or animated.** It is never shipped and never
fetched at runtime. `skinCount: 0` and `animationCount: 0` are documented as the normal case. A raw
unrigged image-to-3D dump is exactly the right input.

### Verified capability — no downloads required

Queried live from the running ComfyUI instance:

- **`hunyuan_3d_v2.1.safetensors` is already installed** and exposed by `ImageOnlyCheckpointLoader`.
- All required nodes present: `ImageOnlyCheckpointLoader`, `CLIPVisionEncode`,
  `Hunyuan3Dv2Conditioning`, `EmptyLatentHunyuan3Dv2`, `KSampler`, `VAEDecodeHunyuan3D`,
  `VoxelToMesh`, `SaveGLB`.
- TRELLIS2 nodes are *also* installed (`Trellis2ShapeStage`, `VaeDecodeStructureTrellis2`, etc.) as a
  fallback, but no TRELLIS2 weights were confirmed — Hunyuan3D is the verified-ready path.
- All enum values used in the workflow below were validated against `/object_info`.

### The workflow

Ready to run: **`fightere/comfy/hunyuan3d_glb_api.json`** (ComfyUI *API* format, 9 nodes, validated).

Steps:

1. Copy the reference into ComfyUI's input folder so `LoadImage` can find it:
   ```
   copy "./splat/fightere\refs\trump_front.png" "<ComfyUI>\input\trump_front.png"
   ```
2. POST the workflow:
   ```
   curl -s -X POST http://127.0.0.1:8188/prompt -H "Content-Type: application/json" -d "{\"prompt\": <contents of hunyuan3d_glb_api.json>}"
   ```
   Poll `http://127.0.0.1:8188/history/<prompt_id>` for completion.
   There is an existing ComfyUI client with working queue/poll patterns worth reading at
   `./tools\comfy\client.py` (base defaults to
   `http://127.0.0.1:8188`). It is a 2D SDXL pipeline, so reuse its plumbing, not its graph.
3. Output lands at `<ComfyUI>\output\3d\trump_fighter_00001_.glb`.
4. Copy it to `fightere\refs\trump_fighter.glb`.

### VRAM — the real risk on this box

8 GB is tight for Hunyuan3D. The workflow sets `octree_resolution: 256`, which should fit.
**If it OOMs**, step down in this order: `octree_resolution` 256 → 192 → 128, then `num_chunks`
8000 → 4000. Do not raise resolution above 256 on a 4060. Mesh density matters far less than usual
here, because the mesh is only ever measured, never shipped.

### Sanity-check the GLB before using it

Do not feed a malformed mesh into the pipeline. The skill ships a prober:

```
python "./.claude/skills\img2threejs\forge\stage1_intake\probe_glb.py" "./splat/fightere\refs\trump_fighter.glb"
```

Confirm it is a plausible single humanoid — arms out, one head, not a melted blob. If Hunyuan3D
produced something unusable, re-roll with a different `seed` in node `6` before proceeding. It is
much cheaper to re-roll here than to discover it three passes into the build.

---

## 8. After the GLB — the build pipeline

Use the **`glb-force-measured`** prompt, not `build.md`:
`<skill>/docs/standard-prompts/glb-force-measured.md`

Fill its placeholders as:

```
GLB (measurement instrument): ./splat/fightere\refs\trump_fighter.glb
Reference image (optional):   ./splat/fightere\refs\trump_front.png
Subject name:  TrumpFighter
Demo id:       trump-fighter
Overwrite:     no
```

**"Force" means:** every parameter the GLB genuinely measures is locked to its measured value rather
than an inferred one, each with a check proving it landed in the emitted code. 1:1 refers to the
measured *parameters*, never to the file.

On a forced build, `--strict-quality` is **replaced, not lowered** — parity gates compare emitted
code against the measurement, which is a stricter question than whether a judgement was defensible.

Then rigging and clips via `<skill>/docs/GLB_ANIMATED_CHARACTER_PROMPT.md`. Stage 5 machinery lives
in `<skill>/forge/stage5_rig/` — `emit_rig.py`, `geodesic_skinning.py`, `rig_gates.py`,
`action_design.py`, `emit_animation_runtime.py`, `mesh_parity.py`. The skeleton is derived from the
component tree so bones cannot drift from geometry; skinning is geodesic (weights measured *through*
the solid), which is what stops the belly deforming when an arm swings.

### Roster implication — decide before building fighter #2

Because the skeleton derives from the component tree and clips are emitted as code (not retargetable
FBX), **two fighters with different component trees get incompatible rigs.** Lock a canonical
"fighter base" component tree on this character and vary silhouette/proportion/material per fighter
on top of it, so combat clips are authored once and inherited. Getting this wrong means re-authoring
animation per fighter.

---

## 9. The review harness — how quality actually gets verified

**This is not optional, and it is not automatic.** `forge/stage4_review/render_bridge.py` states
plainly that it *does not render*: "A browser adapter (Chrome MCP or Playwright) must produce the
actual Three.js pixels." The agent **is** the renderer. Skipping this loop means no quality gating
at all.

Already built and confirmed working: `fightere/` is a Vite + Three.js app whose camera is fully
URL-driven and deterministic.

```
npm --prefix fightere run dev        # or preview_start with launch.json name "fightere"
http://localhost:5174/?capture=hero&bg=neutral&w=620&h=830&hud=0
```

URL parameters:

| Param | Values |
|---|---|
| `capture` | `hero`, `orbit-plus35`, `orbit-minus35`, `profile`, `rear`, `head-hero`, `head-threequarter` |
| `az` / `el` | explicit azimuth / elevation degrees, override the preset |
| `bg` | `neutral` (mid grey), `dark`, `alpha` (transparent — **use for silhouette / IoU work**) |
| `light` | `neutral` (flat, closest to reading albedo), `grazing` (rakes the surface for form review) |
| `w` / `h` | fixed pixel size, default 900×1200 |
| `hud` | `0` to hide the overlay — **always set for real review captures** |

`src/capturePlan.js` mirrors `CAPTURE_PLAN` in `render_bridge.py` exactly. Keep them in sync.

Two hard-won gotchas, both already fixed but easy to reintroduce:

1. **Resize the browser viewport to match `w`/`h` before screenshotting.** A canvas larger than the
   viewport is silently clipped, and a clipped capture destroys the silhouette the IoU gate measures.
2. **Frame on whichever axis is binding.** A T-pose is far wider than tall; sizing the camera on
   height alone crops the hands straight off. `main.js` now uses
   `max(spanY, spanX / aspect)`.

`window.__READY__` and `window.__FIGHTER3D__` are set after first render — poll them before
screenshotting rather than guessing at timing.

### ⚠️ `src/model.js` is a throwaway placeholder

It is a crude capsule blockout, roughly proportioned to the reference (~4.75 head-units, belly
widest), written **only** to validate the harness. `userData.sculptRuntime.status` is
`"placeholder"`. **Delete it and replace with the generated `createTrumpFighterModel` factory** the
moment real geometry exists. Do not treat it as work in progress and do not try to improve it.

---

## 10. Rules that must not be broken

- **Never pass `--allow-nonstrict`.** It exists for legacy fixtures; production never uses it.
- **~89 validation failures on a freshly scaffolded spec are normal and expected.** The forge scripts
  *scaffold*, they do not *assess*. `primaryType` is literally `"unassessed"`, all eight complexity
  scores are `0`, `detailInventory` is empty. Those are **fields to fill from looking at the
  reference**, not defects to report. Fill them, then validate. An agent told to "run the gate and do
  not advance" will otherwise stop on its first command, every time.
- **Do not advance a pass until its side-by-side review passes.** The pipeline is fail-closed by
  design. `generate_threejs_factory.py` exits 2 with `{"status":"BLOCKED"}` and writes no file when
  the spec is not ready.
- **Set `styleHeads` from measurement.** It defaults to `6.0`; this caricature is far squatter
  (roughly 4.5–5 — measure it). Leaving the default puts the "nose base" guide on the eyes and
  wrecks the face.
- **The landmark overlay divides IMAGE height, not the figure bounding box.** Since these references
  are tight-cropped those coincide here, but do not assume it for future fighters.
- **No `.glb`, `.bin`, or texture image may ship or be fetched at runtime.** Symlink the GLB
  somewhere gitignored. The deliverable is TypeScript.
- **Part names derived from measured bounds are HYPOTHESES and must say so.** Bone names on a rigged
  mesh are the rig's own and must *not* carry that caveat.

---

## 11. Honest limits — state these, don't discover them at review

Not shipped in v1.5, per the roadmap: **clothing**, **IK**, the `hairProfile` compiler, pose-sweep
gating, and blendshape expression work beyond the morph-target emitter. Auto-rig, skin weights and
Mixamo compatibility are **v1.8**, not available.

From the GLB route specifically: texture images and normal maps are deliberately **not** copied.
Appearance is carried as per-vertex colour sampled from the base-colour map at each vertex UV, so
detail finer than vertex spacing is not carried. Where a map drove roughness or metalness, the
emitted value is a measured **median** and must be recorded as such, not presented as an authored
constant.

Hair is the classic single-image failure and has a **hard scalp-exposure gate** that can block.
Prefer stylized clumps (5–15 major masses matching the silhouette) over strand geometry. Strand-level
hair is permanently out of scope by architecture — no textures, no alpha.

The likeness doc is explicit: a single view per side cannot yield guaranteed likeness. **Never claim
"100% match."** Report per-region confidence, and flag any inferred region with which strategy
produced it.

**Budget:** ~150k–350k model tokens for a character, roughly 2× a hard-surface prop — plus the
browser review loop on top (7 captures × ~8 passes, plus correction rounds). This is a multi-session
job. State is resumable via `forge/state.py`; use it.

Triangle target: keep the hero under ~100k (the boxer is 97,592). Two fighters plus a stage share
the frame budget.

---

## 12. File map

```
./splat/
  .claude\launch.json                 Vite launch config, name "fightere", port 5174
  fightere\
    HANDOFF.md                        this document
    index.html                        review harness shell
    package.json / vite.config.js     three ^0.170, vite ^5.4
    src\
      main.js                         URL-driven deterministic camera + capture handshake
      capturePlan.js                  mirrors CAPTURE_PLAN in render_bridge.py
      model.js                        ⚠️ PLACEHOLDER — delete when real geometry lands
    refs\
      trump_front.png                 1091×764  ← Hunyuan3D input
      trump_side.png                  313×754
      trump_back.png                  811×747
      trump_side_back.png             original combined sheet (provenance only)
      trump_fighter.glb               ✅ measurement instrument (gitignored)
      glb-probe.json / nodes.json / anatomy.json
    comfy\
      hunyuan3d_glb_api.json          ready-to-POST ComfyUI API workflow
      last_prompt.json                prompt_id 44144729-2b78-4686-8900-a5d52321ce36
    .img2threejs\state.json           animated-character checklist
    assessment.json                   filled pre-spec
    review\                           silhouettes, landmarks, zone crops, admission

```

**Do not touch** `./` — that is the user's separate
SNES romhack project (PVSnesLib, ComfyUI 2D sprite pipeline). It is read-only context for this task.
Its `tools\comfy\client.py` is worth reading for ComfyUI plumbing patterns only.

---

## 13. Open questions for the user

1. **Where does the finished fighter ship?** **Decided 2026-09-03:** `fightere/output/` with a
   standalone viewer at `http://localhost:5175/output/` (`npm run viewer`).
2. **How many clips?** **Decided 2026-09-03:** start with **one** combat clip — standing `jab`.
3. **Art direction:** **Decided 2026-09-03:** fully shaded 3D (MeshPhysicalMaterial, key/fill/rim).
   Cel projection skipped so baked illustration lighting does not fight the lights.
