# Fighter workflow — concept sheet to playable SNES character

One command, six stages, gates between them. This supersedes the scattered
instructions in `fighter-pipeline.md`, `art-pipeline-status.md` and
`regen-rollback.md`; those stay as the record of *why* each gate exists.

```powershell
python tools\make_fighter.py --slug carney --sheet carney_concept.png --crop 0,0,878,1402
```

Everything it runs already existed. What did not exist was the order and the
checks between stages — and every recorded failure in this project so far has
been a stage boundary that looked like success.

## The stages

| stage | does | gate |
|---|---|---|
| `sheet` | character sheet → 1024 reference on flat white | 1024×1024, corner ≥ 240 white |
| `install` | reference → `artpipeline/sources/<slug>.png` | hash recorded to `art/refs/<slug>/source.sha256` |
| `prep` | `pipeline.cli prep` | **prepped hash must change when the source did** |
| `generate` | one H3 clip per animation, one process each | 21 frames, coverage spread, reach vs idle |
| `pack` | 84 frames → `art/px` + `rom/res/frames` | fits all 84 as ONE group |
| `build` | WSL + PVSnesLib | `.pic` size must equal `FRAME_BYTES` |

Slice it with `--from` / `--to`, or run one stage with `--only`:

```powershell
python tools\make_fighter.py --slug trump --only generate --anims punch,kick
python tools\make_fighter.py --slug trump --from pack
```

## The four gates, and the failure each one catches

**`prep` — the stale prepped copy.** `pipeline.cli run` reads
`work/prepped/<id>.png` and never `sources/<id>.png`. There is no prep step
inside `run` and no flag to force one. Measured 2026-08-29: the source was
replaced at 11:12, `run` reported "accepted in 114s" at 11:15, and all 21
frames were the *previous* character. Nothing in the output says so. The gate
hashes the prepped file before and after and fails if it did not move.

**`generate` — one clip per process.** H3 is 19.5 GB UNET + 14.6 GB text
encoder against 32 GB of host RAM. A batch survives three or four clips, then
host memory fragments and the loader dies with `HostBuffer.read_file_slice
failed`. Retrying inside the same process does not help. The stage runs each
clip in its own process and POSTs `/free` to ComfyUI between them.

**`generate` — reach.** A painted reference can return head-sway instead of a
thrown fist, and coverage, loop seam and identity all stay clean while it does.
Reach is the max distance from the planted feet to the silhouette edge, in body
heights, and it is the number that separates the two. Current clips:

| | idle | punch | kick | hit |
|---|---|---|---|---|
| trump | 0.43 | 0.46 (1.07×) | 0.66 (1.53×) | 0.58 (1.35×) |
| carney | 0.31 | 0.48 (1.55×) | 0.78 (2.52×) | 0.32 (1.03×) |

Trump's punch at 1.07× idle is the weak one — that is `regen-rollback.md`'s
"subtle" flag showing up as a number. Carney's hit barely moves either.
Reported, not enforced: the honest threshold is not known, and a gate that fires
on a correct clip is worse than a number a human reads.

Both numbers are measured **after `matte.strip_halo`**. They have to be: the raw
artpipeline cut-out carries a near-white shell worth 25-42% of the silhouette on
the painted clips, and it moves frame to frame, so anything measured on the raw
alpha is mostly measuring that.

**`generate` — coverage spread.** Frames of one fighter are the same body in
different poses, so opaque coverage should sit near the clip median. Far above
it means kept backdrop; far below means the matte ate into him. Both ship
silently. Anything more than 25% off median is named. Current state: **all eight
clips clean, zero outliers.**

They were not clean before the halo strip: `carney/hit` measured 8 outliers on a
10.5% median and `carney/punch` 4. Both were the halo, not the clip — his hit
median went 10.5% -> 37.1% once the shell came off. A matte defect upstream of a
coverage gate reads as a bad clip.

**`pack` — one fit group.** `pack_fighter_frames.py` fits all 84 frames on a
shared scale, ground line and foot anchor. `process_assets.py` is the wrong
tool here: it works on per-action 1024 masters and re-introduces the per-pose
rescale, where the fighter shrinks and hops sideways the moment the state
changes.

## What the workflow cannot do for you

**It cannot re-pose the character.** H3 animates whatever pose the reference
is in, and the local ComfyUI has no IPAdapter / InstantID / PuLID and only
photoreal SDXL checkpoints. A sheet drawn in a celebration pose animates a
celebration. **The guard stance has to come from wherever the sheet was drawn.**

So a usable concept sheet needs, in the main figure:

- three-quarter view facing right (side-on is right for a gait and wrong for a
  fighter; front-on makes the model resolve a camera-axis punch as a T-pose)
- both fists up in front of the chest, feet planted, weight even
- full body in frame with margin, no cropped feet
- no environment under the feet if it can be avoided — ice, shadow and FX
  attach to the shoes and `largest_piece` keeps them as part of the subject.
  `sheet_to_reference.py` removes them, but it is easier to not draw them.

**It cannot make a painted source animate like a flat one.** `manifest.yaml`
carries a per-subject `video_suffix` override; trump has the painted one,
carney does not yet. Add it when his sheet is converted, or his painted
reference gets flattened back to vector on every clip.
