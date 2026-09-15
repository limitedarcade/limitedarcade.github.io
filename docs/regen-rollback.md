# Rollback notes — `web/regen_trump.bat` run on 2026-08-29

## What was run

The full regen flow against the painted `trump_concept.png` (a.k.a. the
"DEAL MAKER / Powerhouse" reference art). Output:

- artpipeline regenerated all four Trump anims: idle, punch, kick, hit.
  Each accepted on attempt 1, ~110 s each, ~7.3 GB peak VRAM.
- `tools/pipeline/pack_fighter_frames.py` synced the 84 frames through
  `fit_group`, remapped to the `char_trump` Color Bible row, wrote the
  ROM BMPs and the `art/px/trump/frames_fit/` set.
- `npm run atlas` rebuilt the web atlas from the new fit output.

## What went wrong

The painted source broke the punch animation. The H3 video model returned
subtle head-sway / tie-flick motion rather than a thrown fist; coverage
was clean (all four anims sat within ±5% of the group median, no `<-- CHECK`
flags), but the actual frames show almost no body movement on `punch`,
`kick`, or `hit`. The artpipeline yield table even flagged it:
`peak d(t) 6.25 at position 0.24 -- well-formed but subtle; fine for
idle/alert, thin for a gait`.

Root cause: the painted `sources/trump.png` (the one in the artpipeline
roster as of this commit) is a hi-fi painted illustration. H3 is tuned
on flat-vector art; with a heavy-painted source, it picks subtle
internal motion as the safest match for an attack prompt.

## What was rolled back

The new painted fit output was *not* deleted. It was moved to
`art/px/trump/frames_fit_new_painted/` (84 PNGs, kept on disk as the
artifact of the experiment). The web atlas was rebuilt from the *old*
flat-vector fit output, recovered from the `*_pre_h3.png` masters that
`pack_fighter_frames.py` had stashed in `art/raw/trump/frames/`.

If you re-run `regen_trump.bat` today, it will *overwrite the flat-vector
fit again* with new painted output. Don't do that until either:

- the artpipeline prompt or source has been changed to drive real body
  motion from the painted reference, or
- the painted concept is no longer the source of truth.

## Recovery procedure that worked

```python
# Backup the (broken) painted fit
import shutil
from pathlib import Path
shutil.copytree(
    Path('art/px/trump/frames_fit'),
    Path('art/px/trump/frames_fit_new_painted'),
)

# Restore from the pre-h3 masters
import sys
sys.path.insert(0, 'tools/pipeline')
sys.path.insert(0, r'C:\source\repos\artpipeline')
from fit_fighter import fit_group
masters = sorted(Path('art/raw/trump/frames').glob('trump_*_pre_h3.png'))
assert len(masters) == 84, f'expected 84 pre-h3 masters, got {len(masters)}'
outs = [Path(f'art/px/trump/frames_fit/{p.name.replace("_pre_h3", "")}')
        for p in masters]
fit_group(masters, outs, size=128)

# Rebuild the atlas
# cd web && npm run atlas
```

## What to fix before this becomes a problem again

1. **Source selection.** `regen_trump.bat` should refuse to run if
   `sources/trump.png` does not look like the flat-vector reference.
   A pragmatic gate: hash the file and check against the known good
   hash; refuse to proceed if the hash is not on the allowlist. (Not
   done in this commit — flagged for a follow-up.)
2. **Yield-table gate.** `artpipeline` writes `out/yield.md` per run.
   The script could parse it and refuse to continue if any `punch` /
   `kick` / `hit` row carries the `subtle` flag. (Not done — flagged.)
3. **Document the painted-vs-vector tradeoff in `manifest.yaml`**
   alongside the `video_suffix` override, so the next person to look
   at it knows the painted source is a still-only reference, not a
   source for fighter anims.
