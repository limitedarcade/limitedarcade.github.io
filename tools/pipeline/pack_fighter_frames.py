"""Pack artpipeline 21-frame clips into SNES BMPs for ROM animation streaming.

Reads `$ARTPIPELINE_ROOT/out/sprites/<slug>/<action>/*.png` (21 frames each),
fits ALL frames of a fighter together (idle+punch+kick+hit = 84), remaps onto
the Color Bible row, and writes:

  rom/res/frames/<slug>_<action>_NN.bmp   (128x64 indexed, NN = 00..20)
  rom/res/<slug>_idle.pal is left to gfx4snes from frame 00

Also writes `rom/res/frames/manifest.txt` listing every frame path.

    python tools/pipeline/pack_fighter_frames.py
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from PIL import Image

from bible import load_row
from fit_fighter import fit_group
from import_clip import place
from remap import integer_downscale, remap_image, write_pal_preview
from to_snes_bmp import to_indexed_bmp

ROOT = Path(__file__).resolve().parents[2]
ARTPIPELINE = Path(os.environ.get("ARTPIPELINE_ROOT", r"C:\source\repos\artpipeline"))

FIGHTERS = (
    ("trump", "char_trump"),
    ("carney", "char_carney"),
)
ACTIONS = ("idle", "punch", "kick", "hit")
FRAMES = 21

# The sprite box, in pixels. WIDER than tall: a square box clips a thrown fist
# (measured 0.54 body-heights left of the planted feet) and an extended leg.
# 128x64 is also the largest box that keeps four VRAM slots inside OBJ's 16 KB
# and pads to nothing under gfx4snes -s 32 (4096 bytes, 8 blocks, no waste).
# docs/sprite-geometry.md carries the measurements.
BOX_W = 128
BOX_H = 64


def clip_frames(slug: str, action: str) -> list[Path]:
    d = ARTPIPELINE / "out" / "sprites" / slug / action
    if not d.is_dir():
        raise SystemExit(f"missing clip {d} — see docs/art-pipeline-status.md")
    fs = sorted(d.glob("*.png"))
    if len(fs) < FRAMES:
        raise SystemExit(f"{slug}/{action}: expected {FRAMES} frames, found {len(fs)}")
    return fs[:FRAMES]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--width", type=int, default=BOX_W)
    p.add_argument("--height", type=int, default=BOX_H)
    p.add_argument("--size", type=int, help="square box; shorthand for --width N --height N")
    args = p.parse_args()
    if args.size:
        args.width = args.height = args.size
    for name, v in (("width", args.width), ("height", args.height)):
        if v % 32:
            raise SystemExit(f"--{name} {v} is not a multiple of 32; gfx4snes -s 32 needs one")

    out_dir = ROOT / "rom" / "res" / "frames"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest: list[str] = []

    for slug, row in FIGHTERS:
        labels: list[tuple[str, int]] = []
        masters: list[Path] = []
        master_dir = ROOT / "art" / "raw" / slug / "frames"
        master_dir.mkdir(parents=True, exist_ok=True)

        # Place every artpipeline frame onto a shared 1024 canvas so fit_group
        # can stack alphas (clips are tightly cropped to different sizes).
        for action in ACTIONS:
            for i, f in enumerate(clip_frames(slug, action)):
                dest = master_dir / f"{slug}_{action}_{i:02d}.png"
                place(f, dest)
                masters.append(dest)
                labels.append((action, i))

        print(f"=== {slug}: fitting {len(masters)} frames together ===")
        fit_dir = ROOT / "art" / "px" / slug / "frames_fit"
        fit_dir.mkdir(parents=True, exist_ok=True)
        fitted = [fit_dir / f"{slug}_{action}_{i:02d}_fit.png" for action, i in labels]
        # Fit at 2x the sprite box, then integer-halve into it.
        fit_group(masters, fitted, size=(args.width * 2, args.height * 2))
        row_data = load_row(row)
        px_dir = ROOT / "art" / "px" / slug / "frames"
        px_dir.mkdir(parents=True, exist_ok=True)

        for (action, i), fit_png in zip(labels, fitted):
            img = Image.open(fit_png).convert("RGBA")
            scaled = integer_downscale(img, (args.width, args.height))
            remapped, used = remap_image(
                scaled, row_data, key=(1, 2, 3), key_tolerance=0, keep_index0_transparent=True
            )
            px = px_dir / f"{slug}_{action}_{i:02d}.png"
            remapped.save(px)
            bmp = out_dir / f"{slug}_{action}_{i:02d}.bmp"
            to_indexed_bmp(px, row, bmp)
            manifest.append(str(bmp.relative_to(ROOT / "rom")))
            if i == 0 and action == "idle":
                write_pal_preview(row_data, px.with_suffix(".pal.txt"))
                print(f"  {slug} idle0 used={used}")

        # Keep legacy single-frame BMPs in sync with frame 0 / peak for tools that still expect them
        for action in ACTIONS:
            src = out_dir / f"{slug}_{action}_00.bmp"
            dst = ROOT / "rom" / "res" / f"{slug}_{action}.bmp"
            if action in ("punch", "kick"):
                # Prefer mid-extension frame for the still thumbnail; animation uses the full set.
                peak = out_dir / f"{slug}_{action}_09.bmp"
                if peak.exists():
                    src = peak
            dst.write_bytes(src.read_bytes())
            print(f"  synced {dst.name} <- {src.name}")

    (out_dir / "manifest.txt").write_text("\n".join(manifest) + "\n", encoding="utf-8")
    print(f"wrote {len(manifest)} frames -> {out_dir}")


if __name__ == "__main__":
    main()
