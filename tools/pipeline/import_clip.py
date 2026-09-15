"""Import one frame of an artpipeline clip as a battlefi 1024 master.

artpipeline exports each clip tightly cropped to that clip's own union bbox and
already matted (RGBA). battlefi's masters are 1024x1024, so a frame is centred
onto a transparent 1024 canvas with its feet on a fixed ground line.

The alpha survives: `matte.has_cutout` sees a real cut-out and skips re-matting,
so the frame reaches the ROM exactly as artpipeline cut it. That is the point —
re-mattting an already-transparent frame can only lose pixels.

Scale is NOT normalised here. Every clip has its own union bbox, so a punch
(arm out) crops wider than an idle. `fit_group` normalises the whole set on
standing height and foot anchor when it crunches them, which is where that
belongs — doing it per frame here would fight it.

    python tools/pipeline/import_clip.py --slug trump --action idle
    python tools/pipeline/import_clip.py --slug trump --action punch --frame 9
"""

from __future__ import annotations

import argparse
import os
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ARTPIPELINE = Path(os.environ.get("ARTPIPELINE_ROOT", r"C:\source\repos\artpipeline"))
CANVAS = 1024
GROUND = 0.94  # bottom of the fighter as a fraction of canvas height


def clip_dir(slug: str, action: str) -> Path:
    d = ARTPIPELINE / "out" / "sprites" / slug / action
    if not d.is_dir():
        raise SystemExit(
            f"no clip at {d}\n"
            f"It has not been generated yet — see docs/art-pipeline-status.md."
        )
    return d


def frames(slug: str, action: str) -> list[Path]:
    fs = sorted(clip_dir(slug, action).glob("*.png"))
    if not fs:
        raise SystemExit(f"clip {slug}/{action} is empty")
    return fs


def pick_peak(fs: list[Path]) -> int:
    """Frame where the fighter is most extended — the readable attack pose.

    Widest opaque bounding box, measured on the FIGHTER ONLY. H3 draws a white
    motion crescent off the fist on the fastest frames, and it is detached from
    the body, so a plain bbox measures the effect rather than the punch: on
    Trump it picked frame 14, whose arm is half-retracted behind a big whoosh,
    and the sprite then moved 186px of 726 against the idle — a non-animation.
    Dropping detached blobs first picks the actual apex.

    Measured on the body, not the middle frame by index: the model does not
    reliably put the apex in the middle of the clip.
    """
    from fit_fighter import largest_piece

    best, best_w = 0, -1
    for i, f in enumerate(fs):
        a = np.array(Image.open(f).convert("RGBA"))[:, :, 3].astype(np.float32) / 255.0
        body = largest_piece(a) > 0.0625
        xs = np.nonzero(body.any(axis=0))[0]
        w = int(xs.max() - xs.min()) if len(xs) else 0
        if w > best_w:
            best, best_w = i, w
    return best


def place(src: Path, out: Path) -> None:
    """Centre the frame on a 1024 canvas, feet on the ground line."""
    img = Image.open(src).convert("RGBA")
    a = np.array(img)[:, :, 3]
    ys, xs = np.nonzero(a >= 16)
    if not len(xs):
        raise SystemExit(f"{src.name} is fully transparent")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    crop = img.crop(box)

    limit = int(CANVAS * GROUND)
    scale = min(limit / crop.height, limit / crop.width, 1.0)
    nw, nh = max(1, round(crop.width * scale)), max(1, round(crop.height * scale))
    if (nw, nh) != crop.size:
        crop = crop.resize((nw, nh), Image.LANCZOS)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.paste(crop, ((CANVAS - nw) // 2, limit - nh), crop)

    if out.exists():
        bak = out.with_name(out.stem + "_pre_h3.png")
        if not bak.exists():
            shutil.copy2(out, bak)
            print(f"  kept previous master as {bak.name}")
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--slug", required=True)
    p.add_argument("--action", required=True, help="idle / punch / kick / hit")
    p.add_argument("--frame", type=int, help="frame index; default 0 for idle, peak otherwise")
    args = p.parse_args()

    fs = frames(args.slug, args.action)
    idx = args.frame
    if idx is None:
        idx = 0 if args.action == "idle" else pick_peak(fs)
    if not 0 <= idx < len(fs):
        raise SystemExit(f"frame {idx} out of range (clip has {len(fs)})")

    out = ROOT / f"art/raw/{args.slug}/{args.slug}_{args.action}_1024_01.png"
    place(fs[idx], out)
    print(f"{args.slug}/{args.action}: frame {idx} of {len(fs)} -> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
