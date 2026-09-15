# Gameplay handoff — sprite budget and animation facts

Written 2026-08-29 for whoever picks up gameplay. Everything here is measured,
not assumed. Where a number matters, the check that produced it is named.

## What the art is

Fighter frames come from the **artpipeline** repo (`C:\source\repos\artpipeline`),
which animates one locked reference into a closed loop with MiniMax H3 video —
running locally in ComfyUI, no cloud API. battlefi keeps the back end: Color
Bible remap → gfx4snes → LoRom `.sfc`.

This matters because the alternative failed: generating each pose as its own
SDXL sample re-rolls the character every time. Trump's idle and his punch came
out as two visibly different men, which is what "old version of Trump" in the
ROM meant. **Do not generate a fighter pose as a one-off image.** See
`docs/truths.md`, "The real consistency limit".

| | |
|---|---|
| Animations per fighter | 4 — `idle`, `punch`, `kick`, `hit` |
| Frames per animation | **21** |
| Frames per fighter | **84** |
| Total, both fighters | **168** |
| Source frame rate | 24 fps (21 frames ≈ 0.9 s) |
| Sprite size | 64×64, 4bpp, 16 colours |
| Bytes per frame | **2048** |

## Timing

Clips are generated and exported at 24 fps; the SNES runs at ~60 Hz. Each
source frame therefore wants a hold of 2–3 display frames:

- hold 2 → 42 fields → 0.70 s per animation
- hold 3 → 63 fields → 1.05 s per animation

**Idle loops seamlessly with no special case.** The clips are closed loops by
construction — first and last frame are the same pose — and the exporter drops
the duplicate. That is why 22 frames are generated and 21 shipped. Just wrap
from frame 20 back to frame 0.

## The VRAM constraint — read this before writing the animation code

OBJ VRAM is **16 KB**, so at 2048 bytes a frame only **8 frames of 64×64 can be
resident at once**. All 168 frames are 336 KB: they fit in ROM comfortably
(488 KB free after the current build) but nowhere near VRAM.

The current `rom/src/main.c` uploads all six old frames at boot and only changes
OAM tile indices in-fight. **That design does not survive the move to 21-frame
animations.** Frames have to be DMA'd into VRAM as the animation plays, which
turns this into a VBlank budget question:

- A 2048-byte DMA is comfortable in one VBlank; the risk is doing several.
- Double-buffering two frame slots per fighter (4 slots, 8 KB) and uploading the
  next frame during the current one is the obvious shape.
- Cheaper alternative if VBlank gets tight: decimate to ~8–10 frames per
  animation and hold each longer. The clips are 24 fps of real motion, so
  dropping every other frame still reads as animation.

## How a fighter is drawn — do not skip this

A fighter is 64×64 of art but is drawn as **four 32×32 sprites**, not one 64×64.

`gfx4snes -s 64` pads every name-table row to stride 16, so a frame costs 4096
bytes instead of 2048 and six frames alone would want 24 KB against 16 KB of OBJ
VRAM. `-s 32` instead lays the frame out as four 32×32 blocks at tile offsets
**+0, +4, +8, +12** = top-left, top-right, bottom-left, bottom-right.

`draw_fighter()` in `rom/src/main.c` assembles them, including the flip (mirroring
the whole 64-wide sprite puts the left-hand blocks on the right, and each block
carries its own hflip bit). Drawing a single `OBJ_SMALL` at the frame base — which
is what the code did before 2026-08-29 — shows the top-left block only, i.e. just
the fighter's head. If sprites come out as floating heads, this is why.

`#define FRAME_BYTES` must equal the measured `.pic` size. Measure it, do not
guess: `-s 32` on a 64×64 bitmap → 2048 bytes / 64 tiles. A wrong `FRAME_BYTES`
uploads a fraction of each sprite and attack frames read mid-idle garbage, which
looks like flicker between two broken poses rather than like a sizing bug.

## Known art defects

- **White motion crescent** around the fist on punch frames 8–11 (measured: those
  frames sit ~39% above the clip's median alpha coverage). It is correctly matted
  drawn content, not a background bug. Left in deliberately — it reads as an
  impact effect. Mask it later if it crunches badly at 64px.

## Which clips actually exist

**Not all of them.** As of 2026-08-29 only Carney's idle/punch/kick and Trump's
punch have been generated; Trump's idle/kick/hit and Carney's hit are missing,
because the generator runs out of host RAM partway through a batch.

`docs/art-pipeline-status.md` holds the live table, the one-clip-at-a-time
workaround, and how to verify a clip. **Check it before assuming a frame set is
on disk** — code written against 4 animations × 21 frames will not find them all
yet.

## Pipeline commands

```bash
# regenerate a fighter's clips (artpipeline repo, uses its own .venv)
./.venv/Scripts/python.exe -m pipeline.cli run --only trump,carney

# battlefi: masters -> rom/res
python tools/pipeline/process_assets.py

# build (WSL; build path must have no spaces)
tools/wsl_build_rom.sh
```

Background removal is **not** battlefi's job — `tools/pipeline/matte.py`
delegates to artpipeline. Do not add a local flood fill and do not reach for
`rembg`; both have been tried and both are recorded as failures.
