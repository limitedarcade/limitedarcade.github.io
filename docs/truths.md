# Truths — how to do this right

Canon brief: **TRUMP vs MARK CARNEY** on **Lake America**. Visual source: `art/comfy/refs/scene_brief_trump_carney.png`.

## Character creation

1. Write `art/comfy/characters/<slug>.traits.json` (exaggerated SF satire traits + forbids).
2. Optional: pad a satire crop to **1024×1024** (magenta). Verify size with PIL.
3. `python tools/comfy/create_fighter.py --slug <slug> --count 6`
4. **Visual QA** each option against the satire reference (hair, face, suit, tie, bulk, pose, full body).
5. `python tools/comfy/create_fighter.py --slug <slug> --lock options/<pick>.png`

Satire = **Street Fighter boss caricature**, not photoreal portrait. User’s written brief beats any misread of files on disk.

## Actions (punch / kick)

1. Start from the **locked idle** (`*_idle_ref.png` in Comfy input).
2. Build a **pose map** (OpenPose from an action donor, or a clear action txt2img).
3. **img2img + OpenPose ControlNet** onto the idle (try `thibaud_xl_openpose_256lora` first on 8 GB VRAM).
4. Lead prompts with the **verb**; keep the traits sheet identity lines.
5. Visual QA: same character + clearly different pose + still 1024².

## Comfy / SDXL

- Checkpoint: Juggernaut XL V8. LoRA: Pixel Art XL ~0.85 for idle (no “pixel art” in the prompt).
- Sampler `dpmpp_2m_sde`, CFG ~5, steps ~34.
- **Always generate at 1024** (fighters 1024², stages 1024×576). Scale refs *before* encode.
- Negatives stay short. Stage text (e.g. LAKE AMERICA) → stamp in PIL, don’t trust the model.

## SNES crunch → ROM

1. Color Bible row per character under `docs/color-bible/rows/`.
2. `matte.py` cuts the fighter out by delegating to **artpipeline's matte** (`ARTPIPELINE_ROOT`). battlefi does not own background removal.
3. `tools/pipeline/process_assets.py` → `rom/res/`.
4. Build via `tools/wsl_build_rom.sh` (copy to `~/bfi-build` — **no spaces in build path**).
5. **gfx4snes sizes (measure `.pic`, don’t guess):** `-s 32` → **2048 bytes / 64 tiles**; `-s 64` → **4096 / 128 tiles**. Wrong `FRAME_BYTES` uploads a fraction of the sprite and attack frames read mid-idle garbage (flicker between two broken looks).
6. Prefer loading **all action frames at boot** and only changing OAM tile indices in-fight.
7. After rebuild: hard-reload ROM; Y/B = punch, A/X = kick should clearly change pose.

## Locked masters

| Asset | Path |
|-------|------|
| Trump idle / punch / kick | `art/raw/trump/trump_*_1024_01.png` |
| Carney idle / punch / kick | `art/raw/carney/carney_*_1024_01.png` |
| Lake America | `art/raw/lake_america/lake_america_1024_01.png` |

Actions: `python tools/comfy/create_actions.py --slug <slug>` (OpenPose ControlNet → idle). Prefer `thibaud_xl_openpose_256lora` on 8 GB; keep the **1024** character frame (ignore the 512 pose map sidecar).

Details: `docs/gameplay-handoff.md` (sprite budget & animation facts), `docs/art-pipeline-status.md` (what art exists, how to generate), `docs/fighter-pipeline.md`, `docs/civitai-prompting-guide.md`, `docs/controlnet-manifest.md`.

## Action frames actually have to move

- **img2img off the locked idle can never produce an attack frame.** Encoding the
  idle and denoising it keeps the idle's composition at every denoise worth using.
  Tried 0.58, 0.82, 0.85, 0.90; tried thibaud and xinsir OpenPose at strength 0.88
  and 1.0; tried a generated donor and a hand-authored skeleton. Every single run
  came back as the idle stance in different shading — which in the ROM reads as the
  fighter strobing between two colors instead of animating.
- **The same ControlNet, same map, from an EMPTY latent, nails the pose first try.**
  That is the whole fix: `build_pose_txt2img` — pose from the map, identity from the
  prompt, no idle latent. Verify a suspect ControlNet this way before tuning anything
  else; it is one cheap generation and it isolates the variable.
- **Author the pose map, do not generate a donor.** `tools/comfy/pose_rig.py` draws
  COCO-18 skeletons directly. Asking SDXL for a "straight punch" donor returned a
  guard stance twice and a kick once, at a minute of GPU each. Authored maps are
  exact, free, and editable — retune a limb by moving a number.
- `xinsir_xl_openpose` transfers pose markedly better than `thibaud_xl_openpose_256lora`.
- **Check the silhouette, not the thumbnail.** Two 1024 masters can look "different"
  and still be the same pose. Diff the alpha masks of the 32² frames before building:
  idle→attack should move 100+ of ~250 opaque pixels. Under ~50 is a non-animation.

## Frames of one fighter must be crunched together

- `fit_group` (not `fit`) fits every frame of a character on ONE scale, ground line
  and foot anchor. Fitting each frame to its own bounding box rescales it per pose —
  a kick is wider than an idle, so the fighter shrinks and slides when he attacks.
- Standing height (head to planted foot) is the stable measure to normalise on; it
  survives a thrown fist or a raised leg, and it cancels the model's framing drift.
- The foot anchor beats the bbox centre: an extended limb drags the bbox centre
  sideways and the whole fighter appears to step.

## Cutting the fighter out of the render

**battlefi does not do this itself any more.** `tools/pipeline/matte.py` calls
artpipeline's `pipeline.matte`, which measures the backdrop per frame, separates
cast shadow by saturation, estimates fractional alpha in an edge band, and
decontaminates it. Fix matting *there* and both projects get the fix. Do not
reintroduce a local flood fill, and do not reach for `rembg` — artpipeline tried
it and it leaves a halo tens of pixels wide.

What battlefi still owns: `largest_piece` (an SNES sprite is one connected blob;
judged on a *dilated* mask, because dithered edges leave hairline gaps and raw
connectivity disowns a whole kicking leg over a one-pixel break).

Why the old local version had to go, measured 2026-08-28:

- **One key at tol 48 deleted 86,095 pixels of Trump** from the locked idle —
  his right leg, hip, shoe and whole outline. That master sits on a near-black
  backdrop (28,28,28), so a tolerance ball of 48 around the key lands squarely on
  a navy suit. The frames of one fighter do **not** share a backdrop: trump_idle
  near-black, trump_punch near-white, trump_kick a gradient, carney_kick cyan.
  Nothing is the magenta the prompt asks for; the prompt does not control this.
- It also kept the SDXL ground shadow as sprite (carney idle and punch), because
  a shadow is not within tolerance of the page and so is never flooded.

**Tolerance follows the frame** (`matte.frame_tolerance`). artpipeline's flat 12
suits its own references (backgrounds 251–255); these masters have 50-level
gradient backdrops, and at 12 the two kick frames came back with 40% and 8% of
the frame retained as a white slab. Tolerance is now p95 of the border ring's
spread from its own median, plus 8, clamped to [12, 64] — p95 and not max,
because the maxima are the fighter's own foot resting on the border.

`fit_group` prints per-frame coverage against the group median. A frame far above
it kept backdrop; a frame far below it lost subject. Read those numbers.

## Frames of one fighter must be crunched together

- `fit_group` (not `fit`) fits every frame of a character on ONE scale, ground line
  and foot anchor. Fitting each frame to its own bounding box rescales it per pose —
  a kick is wider than an idle, so the fighter shrinks and slides when he attacks.
- Standing height (head to planted foot) is the stable measure to normalise on; it
  survives a thrown fist or a raised leg, and it cancels the model's framing drift.
- The foot anchor beats the bbox centre: an extended limb drags the bbox centre
  sideways and the whole fighter appears to step.

## Cutting the fighter out of the render

Three separate bugs, all of which shipped broken sprites:

- **Corner flood only reaches what touches a corner.** The gap between the legs is
  sealed off underneath by the fighter's own drop shadow, so it survived as a white
  wedge welded to the sprite. Now cleared as a "flat pocket": an exact-key region
  (tol 10) of 200px+ anywhere in the frame.
- **Do not sample many border points for the key.** One dark pixel on the border
  becomes a key that matches a dark suit, and the whole fighter is "background".
  One robust key (median of corners + edge midpoints), tolerance ~48.
- **Do not use a gradient-following flood** (join neighbours within a step). It
  sounds right for gradient backdrops and it leaks straight through these softly
  shaded figures — at step 16 it ate everything but Trump's hair and tie.
- Judge "largest blob" on a *dilated* copy of the mask. Dithered pixel-art edges
  leave hairline gaps, and raw connectivity disowns a whole kicking leg over a
  one-pixel break.

## The real consistency limit

Every frame is an independent diffusion sample, so identity, suit colour, lighting
and framing are re-rolled each time — Carney came out light grey idle, near-black
punch, navy kick. No prompt or seed fixes this; it is structural. See the sprite
sheet / puppetry options before generating another fighter one frame at a time.

## Painted references work — the flat vector style is a SNES constraint, not a limit

Validated 2026-08-29 on trump/idle. The flat-vector look was never a failure; it
is prescribed by `artpipeline/config.yaml`, whose own comment says the style and
negative prompts "are not cosmetic; they are matte.py's preconditions written as
text". Correct for a 16-colour 64px sprite. Wrong for the web build, which has
neither limit.

A painted GPT-Image caricature was cut out to flat white
(`tools/pipeline/sheet_to_reference.py`), installed as `sources/trump.png`, and
run through the unchanged H3 loop:

| measure | result |
|---|---|
| attempts | 1 (1.00 attempts per usable loop) |
| time / VRAM | 118 s, 7.34 GB |
| matte coverage spread | **1.3% of median, zero outliers** |
| loop seam ratio | **0.83x** (config calls <1x a good loop) |
| identity across 21 frames | holds — face, hair, suit, tie, bulk, shading |

**The style survived H3 completely.** Nothing about the video model forces flat
colour; the flattening came from `video_suffix`, which asked for "flat 2d cartoon
vector illustration, bold black outlines" on every single clip. That is now
overridable per subject (`manifest.yaml` `video_suffix:` on an entry), so the
ten-animal roster keeps flat vector and the fighters get painted. Verified: fox
still renders the flat-vector prompt.

Two things this does NOT solve:

- **Pose.** H3 animates the reference it is given. A sheet drawn in a
  celebration pose yields 21 frames of celebration. The guard stance has to be
  in the reference, and the local stack cannot put it there — there is no
  IPAdapter, InstantID or PuLID node installed and the only checkpoints are
  photoreal SDXL, so a local re-pose is an independent sample of a generic man,
  which is the failure recorded above. Re-pose where the sheet was drawn.
- **Resolution.** Frames export at 366x562 from a 768x768 render. Fine for the
  SNES crunch, thin for a web billboard. Raise the render size or add an upscale
  pass before building atlases.

