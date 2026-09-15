"""Turn a painted character sheet into an artpipeline reference.

A GPT-Image character sheet is not a fighter reference. It carries side panels,
portrait insets, title plates and — the part that actually breaks things — a
rendered environment: ice floor, shatter FX, cast shadow. artpipeline's matte
cuts a *subject on a clean ground*, so the environment has to come off before
the sheet is any use as `sources/<fighter>.png`.

    python tools/pipeline/sheet_to_reference.py \
        --sheet "ChatGPT Image ... (2).png" --crop 0,0,878,1402 \
        --out art/refs/trump_v2/04_source_1024.png

What this does NOT do is re-pose the subject. A sheet drawn in a celebration
pose stays in a celebration pose; the guard stance has to come from whatever
drew the sheet. See docs/web-port-plan.md.

## Why there is a region rule at all

Measured on the Trump sheet, 2026-08-29. artpipeline's matte cuts the *figure*
beautifully — crisp silhouette, no halo, the white shirt correctly kept as an
enclosed hole. Painted art is not the problem. What it retains is scenery:

- The ice floor, because the floor touches his shoes, so `largest_piece` keeps
  it as part of the subject blob.
- The FX wedge between his legs, because the floor seals it off from the border
  and a flood fill only reaches what it can walk to. This is the documented
  "flat pocket" failure in docs/truths.md wearing a different hat.

Border flood measured `frame_tolerance` 12 -> **64**, the cap, and matte.py
already says what that means: "a frame whose border genuinely varies by 64
levels has scenery in it, and the answer to that is a better master, not a
tolerance that eats a navy suit". This module is that better master.

## The rule, and the numbers behind it

Above the waist there is no retained scenery — the flood reaches it fine. Below
the waist the subject is trousers and shoes, which are dark and/or saturated,
and the scenery is pale blue. Sampled on the Trump sheet:

| region        | V (HSV value)  |
|---------------|----------------|
| shoes         | 0.04 - 0.32    |
| trousers      | 0.14 - 0.29    |
| ice floor     | 0.47 - 0.62    |

So a value test separates them with a wide margin — but only in the bottom band,
and only because that band contains no pale subject. Do not lift it higher: the
white shirt lives above the waist and measures V ~0.95.

One more step is needed. The ice floor is *cracked*, and the cracks are dark
lines that pass the value test, survive as a web across the bottom, bridge to
the shoes and re-seal the wedge. They are thin, and the shoes are not, so a
morphological opening removes them and leaves the shoes. That is the whole
reason `--open-radius` exists.

Hole filling is capped by area for the same reason: an uncapped
`binary_fill_holes` puts the entire leg wedge straight back (measured: subject
coverage 0.46 -> 0.60).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parent))

import matte as M  # noqa: E402
from fit_fighter import largest_piece  # noqa: E402


def disk(r: int) -> np.ndarray:
    y, x = np.ogrid[-r : r + 1, -r : r + 1]
    return (x * x + y * y) <= r * r


def fill_small_holes(mask: np.ndarray, max_frac: float) -> np.ndarray:
    """Fill enclosed pockets, but only ones small enough to be real detail.

    Uncapped filling is wrong here: the gap between a fighter's legs is enclosed
    the moment the scenery under it is removed, and filling it welds a slab of
    background back onto the sprite.
    """
    inv = ~mask
    lab, n = ndimage.label(inv)
    if n == 0:
        return mask
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
    cap = max_frac * mask.size
    out = mask.copy()
    filled = 0
    for i in range(1, n + 1):
        if i in border:
            continue
        piece = lab == i
        if piece.sum() <= cap:
            out[piece] = True
            filled += 1
    print(f"  filled {filled} enclosed pocket(s) under {max_frac:.0%} of frame")
    return out


def cut_out(
    img: Image.Image,
    waist_frac: float,
    floor_frac: float,
    sat_min: float,
    dark_max: float,
    floor_value_max: float,
    open_radius: int,
    close_radius: int,
    hole_max_frac: float,
) -> Image.Image:
    """Matte the sheet, then strip the retained scenery. Returns RGBA."""
    rgb, alpha = M.matte(img)
    h = alpha.shape[0]
    hsv = np.array(Image.fromarray(rgb).convert("HSV")).astype(np.float32) / 255.0
    S, V = hsv[:, :, 1], hsv[:, :, 2]

    fg = alpha > 0.5
    print(f"  matte kept {fg.mean():.3f} of frame")

    lower = np.zeros_like(fg)
    lower[int(h * waist_frac) :, :] = True
    floor = np.zeros_like(fg)
    floor[int(h * floor_frac) :, :] = True

    # Below the waist: keep saturated (navy) or dark (black) — drop pale ice.
    fg = np.where(lower, fg & ((S > sat_min) | (V < dark_max)), fg)
    # In the floor band the margin is wider still; see the table in the docstring.
    fg = np.where(floor, fg & (V < floor_value_max), fg)
    print(f"  after scenery test {fg.mean():.3f}")

    # Cracks in the ice are thin and dark; shoes are neither.
    fg = np.where(lower, ndimage.binary_opening(fg, disk(open_radius)), fg)
    fg = ndimage.binary_closing(fg, disk(close_radius))
    fg = largest_piece(fg.astype(np.float32)) > 0
    fg = fill_small_holes(fg, hole_max_frac)
    print(f"  final subject coverage {fg.mean():.3f}")

    return M.to_image(rgb, alpha * fg)


def fit_square(cut: Image.Image, size: int, height_frac: float, foot_margin: float) -> Image.Image:
    """Centre the subject on a flat white square with a generous margin.

    White and not transparent: artpipeline's own references are RGB on white,
    and `matte.has_cutout` would otherwise short-circuit re-mattting downstream.
    """
    arr = np.array(cut)
    mask = arr[:, :, 3] > 16
    if not mask.any():
        raise SystemExit("nothing survived the cut-out — loosen the thresholds")
    ys, xs = np.where(mask)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    sub = cut.crop(box)
    print(f"  subject bbox {sub.width}x{sub.height}")

    scale = (size * height_frac) / sub.height
    nw, nh = round(sub.width * scale), round(sub.height * scale)
    if nw > size * 0.94:  # a wide pose (arms out) must not run off the canvas
        scale *= (size * 0.94) / nw
        nw, nh = round(sub.width * scale), round(sub.height * scale)
        print(f"  wide pose, scaled down to fit: {scale:.3f}")

    sub = sub.resize((max(1, nw), max(1, nh)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    canvas.alpha_composite(sub, ((size - nw) // 2, size - nh - int(size * foot_margin)))
    return canvas.convert("RGB")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sheet", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--crop", help="x0,y0,x1,y1 — isolate the main figure from side panels")
    p.add_argument("--size", type=int, default=1024)
    p.add_argument("--height-frac", type=float, default=0.88)
    p.add_argument("--foot-margin", type=float, default=0.05)
    p.add_argument("--waist-frac", type=float, default=0.585, help="scenery test starts here")
    p.add_argument("--floor-frac", type=float, default=0.785, help="stricter value test starts here")
    p.add_argument("--sat-min", type=float, default=0.45)
    p.add_argument("--dark-max", type=float, default=0.35)
    p.add_argument("--floor-value-max", type=float, default=0.40)
    p.add_argument("--open-radius", type=int, default=6)
    p.add_argument("--close-radius", type=int, default=4)
    p.add_argument("--hole-max-frac", type=float, default=0.02)
    p.add_argument("--qa", action="store_true", help="also write a magenta composite next to --out")
    args = p.parse_args()

    img = Image.open(args.sheet)
    if args.crop:
        img = img.crop(tuple(int(v) for v in args.crop.split(",")))
    print(f"sheet {args.sheet.name} -> {img.size}")

    cut = cut_out(
        img,
        args.waist_frac,
        args.floor_frac,
        args.sat_min,
        args.dark_max,
        args.floor_value_max,
        args.open_radius,
        args.close_radius,
        args.hole_max_frac,
    )
    final = fit_square(cut, args.size, args.height_frac, args.foot_margin)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    final.save(args.out)
    print(f"wrote {args.out} {final.size}")

    if args.qa:
        qa = args.out.with_name(args.out.stem + "_magenta.png")
        mag = Image.new("RGBA", cut.size, (255, 0, 255, 255))
        mag.alpha_composite(cut)
        mag.convert("RGB").save(qa)
        print(f"wrote {qa} — check the silhouette on magenta before shipping it")


if __name__ == "__main__":
    main()
