# Art pipeline — status and how to run it

Last updated 2026-08-29 (evening). Update the table when clips land; it is the
only record of what actually exists.

## Where fighter art comes from

Frames come from the **artpipeline** repo at `C:\source\repos\artpipeline`,
which animates one locked reference into a closed loop with MiniMax H3 video.
H3 runs **locally in ComfyUI** — no cloud API, nothing to pay for.

battlefi keeps the back end: Color Bible remap → gfx4snes → LoRom `.sfc`.
The web port skips Color Bible and builds full-colour atlases via
`tools/pipeline/build_web_atlas.py`.

**Never generate a fighter pose as a standalone image.** Each SDXL sample
re-rolls the character, so the idle and the punch come back as two different
men.

**Locked identity (2026-08-29 evening):** painterly concepts
`carney_concept.png` / `trump_concept.png`, cut out to white-ground 1024
masters in `artpipeline/sources/{carney,trump}.png` and
`art/comfy/refs/*_concept_master_1024.png`. Previous flat-vector sources are
backed up under `artpipeline/work/_bak_sources_*`.

artpipeline is **not a git repo**. Back up `manifest.yaml` and `config.yaml`
before editing either.

## Clip status

21 frames per clip. Verified means: identity checked across all frames and the
matte checked by compositing on magenta.

| fighter | idle | punch | kick | hit |
|---------|------|-------|------|-----|
| Carney  | done (re-prompted; first 3 attempts static) | done | done | done |
| Trump   | done | done | done | done |

**All 8 clips regenerated 2026-08-29 evening** from the painterly concept
masters. Both fighters use the painted `video_suffix` in `manifest.yaml`.
Web atlases: `web/public/fighters/{trump,carney}.{png,json}`.

Carney idle note: the shared "stands still and breathes / smallest sway"
prompt scored peak d(t) ≈ 0.67 three times (below `motion_floor` 1.0). Idle
prompt was strengthened to an explicit chest-rise + weight-shift and the
retry accepted at peak d(t) 3.48.

## Getting a clip into the ROM

`tools/pipeline/import_clip.py` lifts one frame of a clip onto a 1024 canvas as
a battlefi master. The frame keeps its alpha, and `matte.has_cutout` sees a real
cut-out and skips re-matting, so it reaches the ROM exactly as artpipeline cut it.

```bash
python tools/pipeline/import_clip.py --slug trump --action idle          # frame 0
python tools/pipeline/import_clip.py --slug trump --action punch         # auto peak
python tools/pipeline/import_clip.py --slug trump --action kick --frame 9
```

For attacks it picks the frame where the fighter is most extended, measured on
the **largest connected piece** — not the raw bounding box. H3 draws a white
motion crescent off the fist, detached on the fast frames, and a plain bbox
measures the effect instead of the punch: it chose a half-retracted arm whose
sprite then moved only 186px of 726 against the idle, i.e. barely animated.
Measuring the body picked the real apex and that went to 303px.

Previous masters are preserved as `*_pre_h3.png` beside the new ones.

Then `python tools/pipeline/process_assets.py` and `tools/wsl_build_rom.sh`.

## The out-of-memory problem — read before running a batch

The H3 weights are 19.5 GB (UNET) + 14.6 GB (text encoder) = **34 GB against
32 GB of host RAM**. A batch survives three or four clips, then host memory
fragments and the loader dies:

```
MemoryError:
generation failed: node MiniMaxH3ImageToVideo (id 7) failed:
HostBuffer.read_file_slice failed
```

This killed two batch runs on 2026-08-29 — one after 4 clips, one on the first.
It is not a workflow or prompt fault and retrying inside the same process does
not help, because the memory is already gone.

**Run one clip per process and flush ComfyUI's memory between clips:**

```bash
cd /c/source/repos/artpipeline
for job in "trump idle" "trump kick" "trump hit" "carney hit"; do
  set -- $job
  ./.venv/Scripts/python.exe -m pipeline.cli run --only "$1" --animation "$2"
  curl -s -X POST http://127.0.0.1:8188/free \
    -H 'Content-Type: application/json' \
    -d '{"unload_models":true,"free_memory":true}' >/dev/null
done
```

Roughly 4–5 minutes per clip. `run` retries up to 3 times and mattes and
exports on its own.

## Swapping a source: `run` does NOT re-prep

`pipeline.cli run` reads `work/prepped/<id>.png`, never `sources/<id>.png`.
There is no prep step inside `run` and no flag to force one. Replace a source
and the next `run` regenerates happily from the **stale prepped copy**, reports
success, and hands back a clip of the old character.

Measured 2026-08-29: `sources/trump.png` was replaced with the painted
reference at 11:12, `run --only trump --animation idle` completed at 11:15
"accepted in 114s", and every one of the 21 frames was the previous flat-vector
Trump. `work/prepped/trump.png` was still dated 08-28 20:48. Nothing in the
output says so — the failure is silent and the clip looks fine on its own.

**Always prep after touching a source:**

```bash
cd /c/source/repos/artpipeline
./.venv/Scripts/python.exe -m pipeline.cli prep
./.venv/Scripts/python.exe -m pipeline.cli run --only trump --animation idle
```

`prep` takes no arguments and re-normalises all 12 sources; it is a few seconds
and it prints the measured background and margin per source, which is worth
reading — a new reference should show its background at or near (255,255,255).

## Checking a clip is good

Do both. A clip can have perfect identity and a broken matte.

1. **Look at the contact sheet** — `artpipeline/out/sheets/<fighter>_<anim>.png`.
   Same face, same suit, same tie in every frame. The grey tiles in a sheet are
   the sheet's own backing, not retained background — do not chase them.
2. **Measure the alpha.** Per-frame opaque coverage should sit near the clip
   median. A frame far above it kept background; far below it lost subject.

```bash
cd /c/source/repos/artpipeline && ./.venv/Scripts/python.exe -c "
import numpy as np, sys
from PIL import Image
from pathlib import Path
d=Path('out/sprites')/sys.argv[1]/sys.argv[2]
cov=[(np.array(Image.open(f).convert('RGBA'))[:,:,3]>128).mean() for f in sorted(d.glob('*.png'))]
m=float(np.median(cov)); print('median %.1f%%'%(100*m))
print([(i,'%.0f%%'%(100*c)) for i,c in enumerate(cov) if abs(c-m)/m>0.25] or 'all frames in line')
" trump punch
```

## Known art defects

- **The white halo (fixed downstream 2026-08-29).** artpipeline's cut-out keeps
  a ragged near-white shell around the subject — measured 25-42% of the
  silhouette on every painted Trump frame, 4-8% on Carney. It is not a sealed
  pocket: the flood runs from the frame border at `flood_tolerance` 12 and stops
  at the bright rim, so the rim ships as subject.

  The cause is in the prompt. Trump's `video_suffix` override asks for
  "dramatic rim lighting" and "glossy specular highlights" against a "plain
  white background" — a bright halo hugging the subject is exactly what was
  requested. **Drop the rim-lighting clause before regenerating**; the flat
  vector roster never had this because flat art has a hard edge on flat white.

  Until then `tools/pipeline/matte.strip_halo` removes it on battlefi's side, in
  the `has_cutout` path, by connectivity: near-white opaque pixels that can walk
  out to a transparent pixel were never enclosed by the fighter. His shirt
  cannot walk out, so it stays. This runs inside `pack_fighter_frames.py`; there
  is nothing to invoke.


- **White motion crescent** around the fist on punch frames 8–11. Correctly
  matted drawn content, not a background bug — the model draws a cartoon
  "whoosh". Left in deliberately; it reads as an impact effect. Mask it later
  if it crunches badly at 64px.

## Background removal

battlefi does **not** own background removal. `tools/pipeline/matte.py`
delegates to artpipeline's matte. Do not add a local flood fill and do not
reach for `rembg` — both have been tried and both are recorded failures. See
`docs/truths.md`.

One battlefi-specific addition: `matte.frame_tolerance` widens the flood
tolerance per frame to span that frame's own backdrop, because the SDXL masters
have 50-level gradient backdrops where artpipeline's flat 12 leaves a slab.
