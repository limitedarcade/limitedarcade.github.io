# Sprite geometry — why limbs clip, and what the box can cost

Measured 2026-08-29. Two separate complaints, one shared cause: the sprite box
is 64×64 and the fighter is fitted to 98% of it, so there is no room left for
either a longer limb or a taller character.

## Why Trump's leg gets cut off

`fit_group` scales every frame so the standing height fills the canvas, then
anchors the **feet to the canvas centre-x**. A fighting pose is not
symmetric about its feet, so the canvas is wasted on one side and clipped on
the other. Measured across all 84 frames, as a fraction of standing height:

| set | max left of feet | max right of feet | box width needed |
|---|---|---|---|
| trump (flat vector, in the ROM) | 0.538 | 0.321 | **1.08 × height** |
| trump (painted) | 0.872 | 0.500 | 1.74 × height |
| carney | 0.626 | 1.226 | 2.45 × height |

The box is 1.00 × height. Trump's flat-vector punch overruns it by 8% on the
left on frames 14–17 — that is the clipped limb, and it is the mildest case in
the table. Carney's 2.45 comes from `hit_09`, which is a fall, not a stance.

Two ways out, and they are not equivalent:

1. **Centre the union of poses instead of the feet.** Needed width drops to
   `left + right` = 0.86 × height for trump, 0.82 for carney's punch — under
   1.0, so even a 64×64 box stops clipping. But the feet are then off-centre by
   a fixed amount, and `draw_fighter` mirrors the whole sprite on a facing flip,
   which would teleport the fighter sideways by twice that offset every time he
   turns. Fixable with a per-fighter constant, but it is a new thing to get
   wrong.
2. **Make the box wider than tall.** Feet stay centred, flips stay free.
   Costs VRAM. See below.

## What a bigger box actually costs

`gfx4snes -s 32` packs 32×32 blocks in reading order into a 16-tile-wide OBJ
name table, four blocks per band. Measured by encoding one solid palette index
per block and decoding the `.pic`:

| box | blocks | bytes | wasted | block tile offsets |
|---|---|---|---|---|
| 64×64 | 4 | 2048 | 0 | 0, 4, 8, 12 |
| 128×64 | 8 | 4096 | 0 | 0,4,8,12 / 64,68,72,76 |
| 64×96 | 6 | 4096 | 1024 | 0,4,8,12 / 64,68 |
| 96×96 | 9 | 6144 | 1536 | 0,4,8,12 / 64,68,72,76 / 128 |
| 128×96 | 12 | 6144 | 0 | 0,4,8,12 / 64,68,72,76 / 128,132,136,140 |

96×96 and 128×96 cost the same 6144 bytes, so there is no reason to choose
96 wide.

OBJ VRAM is **16 KB, hard** (512 tiles; the two OBJ name halves can sit at
different addresses but the total does not grow). That is the whole budget:

| box | bytes/frame | 4 slots (double-buffered) | 2 slots (single) |
|---|---|---|---|
| 64×64 | 2048 | 8 KB ✓ | — |
| 128×64 | 4096 | **16 KB ✓ exactly full** | — |
| 128×96 | 6144 | 24 KB ✗ | **12 KB ✓** |

And the DMA side. NTSC 224-line VBlank is ~38 scanlines × 1364 master cycles =
51,832 cycles; DMA moves one byte per 8 cycles, so **~6,479 bytes per VBlank**,
before PVSnesLib's own OAM upload (544 bytes) and any dirty HUD rows.

- 4096 bytes = 63% of VBlank. Fits, and can be split over two VBlanks into a
  back buffer if it ever gets tight.
- 6144 bytes = 95% of VBlank. Does not fit alongside OAM. With only two slots
  there is no back buffer to split it into, so a 96-tall fighter means either a
  torn frame or a redesign.

## The partial-upload idea does not work

Uploading only the blocks that changed between consecutive frames would rescue
96-tall. Measured on the shipped frames: **every 32×32 block changes on every
frame of every clip**, including idle. At 16×16 granularity it is still 8–12 of
16 blocks.

The reason is not motion — only **3.4% of pixels differ between consecutive
idle frames** (5.8% on punch). The changes are scattered single pixels: dither
and quantisation crawl from the video model, spread thin enough to dirty every
block.

That kills partial upload, and it flags something else: at 64px that crawl is
visible as a shimmering, boiling sprite even when the character is standing
still. A temporal index-lock in the remap step — keep the previous frame's
palette index when the source colour has not moved past a threshold — would
settle it, and would make partial upload viable as a side effect.

## The stage is the other half of the scale problem

The fighters are drawn at y=128 with feet at y=192. `rom/res/lake.png` puts its
shoreline at roughly y=155 and wave-textured water below it, so the fighters
stand *in* the foreground water in front of a fence, rather than on a floor.
The signpost is ~55px against a 64px fighter.

A fighter stage wants a flat arena floor under the whole fighter band, a
horizon well above it, and props sized to the fighter. Whatever the sprite box
ends up being, the stage has to be re-composed around the ground line.

## What shipped (2026-08-29)

**128×64.** Chosen over 128×96 because 96-tall leaves room for only two VRAM
slots — one buffer per fighter — and a 6144-byte upload cannot finish inside a
VBlank, so a taller fighter costs a torn frame. 128×64 keeps the four slots and
the double buffer that already work.

| | before | after |
|---|---|---|
| sprite box | 64×64 | 128×64 |
| bytes/frame | 2048 | 4096 |
| OBJ VRAM used | 8 KB of 16 | 16 KB of 16 |
| DMA per VBlank | 32% | 63% |
| sprites per fighter | 4 | 8 |
| fitted frames touching a canvas edge | punch 14–17 clipped | **0 of 84, both fighters** |
| ROM | 512 KB | 1 MB (`.ROMBANKS 32`, `ROMSIZE $0A`) |

168 frames × 4096 = 672 KB, so the 512 KB ROM ran out during link
(`No room for section "fr_carney_punch_18"`). At 1 MB the build finishes with
31% free.

`x1`/`x2` in `main.c` now mean **the fighter's feet**, not the sprite's left
edge — the box hangs 64px either side of them. All the distance comparisons in
the hit code were already differences, so they did not change. A block whose x
leaves 0..255 is hidden rather than drawn; those outer columns are transparent
margin in all but the widest poses.

Two things this did NOT fix:

- **Per-scanline OBJ budget.** Two fighters overlapping vertically now put
  32 of the allowed 34 8×8 tiles on every scanline in the fighter band. It
  works, and there is no headroom left for a projectile or an impact spark.
  A build-time "which blocks are non-empty" mask would drop it to about half.
- **The stage.** See the last section above; the ground line is still wrong.
