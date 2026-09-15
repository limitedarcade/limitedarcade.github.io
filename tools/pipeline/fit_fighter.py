"""Crop fighter to a tight square and letterbox into size×size.

Background removal lives in `matte.py`, which delegates to artpipeline. This
file used to carry its own corner-key flood fill; it was a weaker duplicate of
the same idea and it assumed one flat backdrop per character, which the locked
masters do not have. See `matte.py` for the measurements.

What stays here is the part that is genuinely battlefi's: an SNES sprite has to
be ONE connected piece, and every frame of a character has to be crunched on a
shared scale, ground line and foot anchor.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

import matte


def largest_piece(alpha: np.ndarray, threshold: float = 0.0625) -> np.ndarray:
    """Zero everything that is not part of the biggest connected blob.

    The fighter is always one piece; anything else is a scrap of scenery that
    survived the matte. Sprite-specific, so it stays here rather than upstream —
    artpipeline ships whole animals and takes a union bbox instead.

    Connectivity is judged on a DILATED copy. Dithered pixel-art edges leave
    hairline gaps, and judging the raw mask disowns a whole limb over a
    one-pixel break — that is how a kicking leg goes missing.
    """
    solid = alpha > threshold
    if not solid.any():
        return alpha
    linked = ndimage.binary_dilation(solid, ndimage.generate_binary_structure(2, 2), iterations=2)
    labels, count = ndimage.label(linked)
    if count <= 1:
        return alpha
    sizes = ndimage.sum_labels(solid, labels, index=range(1, count + 1))
    keep = int(np.argmax(sizes)) + 1
    dropped = int(solid.sum() - sizes[keep - 1])
    if dropped:
        print(f"  dropped {dropped}px in {count - 1} detached blob(s)")
    out = alpha.copy()
    out[(labels != keep) & solid] = 0.0
    return out


def clear_background(img: Image.Image) -> Image.Image:
    """Cut the fighter out of a 1024 master. RGBA, straight (un-premultiplied)."""
    rgb, alpha = matte.matte(img)
    return matte.to_image(rgb, largest_piece(alpha))


def tight_bbox(img: Image.Image, pad: int = 8) -> tuple[int, int, int, int]:
    """Tightest box round the opaque pixels, padded and clamped."""
    alpha = np.array(img.convert("RGBA"))[:, :, 3]
    ys, xs = np.nonzero(alpha >= 16)
    if not len(xs):
        return 0, 0, img.width, img.height
    return (
        max(0, int(xs.min()) - pad),
        max(0, int(ys.min()) - pad),
        min(img.width, int(xs.max()) + pad + 1),
        min(img.height, int(ys.max()) + pad + 1),
    )


def _foot_anchor_x(img: Image.Image, box: tuple[int, int, int, int]) -> float:
    """Mean x of the opaque pixels in the bottom band — i.e. where the feet are.

    The feet are the one part of a fighter that stays put across idle/punch/kick,
    so they anchor the frames far more stably than the bounding-box centre (which
    a thrown fist or an extended leg drags sideways).
    """
    x0, y0, x1, y1 = box
    band = max(1, int((y1 - y0) * 0.15))
    alpha = np.array(img.convert("RGBA").crop((x0, y1 - band, x1, y1)))[:, :, 3]
    ys, xs = np.nonzero(alpha >= 16)
    if not len(xs):
        return (x0 + x1) / 2.0
    return x0 + float(xs.mean())


def report_group_coverage(names: list[str], alphas: np.ndarray) -> None:
    """Warn when one frame's silhouette is wildly out of step with its siblings.

    Frames of one character are the same body in different poses, so their
    coverage should sit within a stone's throw of each other. A frame far ABOVE
    the group kept backdrop (its border was not uniform, so the flood could not
    reach all of it); a frame far BELOW it lost subject (the backdrop was close
    to the fighter's own colours and the matte ate into him). Both ship silently:
    the first is a slab welded to the sprite, the second a fighter with no shoes.

    Reported, not enforced — the honest threshold is not known yet, and a gate
    that fires on a correct frame is worse than a number a human reads.
    """
    cover = (alphas > 0.5).mean(axis=(1, 2))
    median = float(np.median(cover))
    for name, c in zip(names, cover):
        flag = "  <-- CHECK" if median > 0 and abs(c - median) / median > 0.5 else ""
        print(f"  coverage {name}: {100 * c:5.1f}% (group median {100 * median:.1f}%){flag}")


def fit(src: Path, out: Path, size: int = 64) -> None:
    """Fit ONE frame on its own. Use fit_group for a character's frame set."""
    img = clear_background(Image.open(src))
    x0, y0, x1, y1 = tight_bbox(img)
    crop = img.crop((x0, y0, x1, y1))
    cw, ch = crop.size
    scale = min(size / cw, size / ch)
    nw, nh = max(1, int(cw * scale)), max(1, int(ch * scale))
    scaled = crop.resize((nw, nh), Image.Resampling.NEAREST)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    # Bottom-align fighters so feet sit on the ground line
    canvas.paste(scaled, ((size - nw) // 2, size - nh), scaled)
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)
    opaque = int((np.array(canvas)[:, :, 3] >= 16).sum())
    print(f"fit {src.name} -> {out} crop={cw}x{ch} opaque={opaque}/{size * size}")


def fit_group(
    srcs: list[Path],
    outs: list[Path],
    size: int | tuple[int, int] = 128,
    temporal_radius: int = 0,
    resample: Image.Resampling = Image.Resampling.NEAREST,
) -> dict:
    """Fit every frame of ONE character on a shared scale, ground line and anchor.

    `size` is the sprite box: an int for a square, or (width, height). The box is
    WIDER than the fighter is tall on purpose — measured across all 84 frames, a
    thrown fist reaches 0.54 body-heights left of the planted feet and an extended
    leg 1.23 right, so a square box clips limbs the moment an attack extends. See
    docs/sprite-geometry.md.

    Fitting each frame on its own (see `fit`) rescales it to its own bounding box:
    a kick is wider than an idle, so the fighter shrinks and jumps sideways the
    moment the state changes. Here every frame is normalised to the same standing
    height and the same foot position, so only the limbs move.

    The frames are also MATTED together, which matters more than it sounds: the
    backdrop is measured per frame (the masters of one fighter genuinely do not
    share one), and the coverages are then compared against each other, which is
    what catches a frame the matte got wrong.

    `temporal_radius` must stay 0 for idle/punch/kick — see matte.stabilise.

    `resample` defaults to NEAREST so ROM output stays bit-identical. The web
    atlas builder passes LANCZOS when fitting at 512px (docs/web-port-plan.md).

    Returns a small dict with groundY / footX measured from the fitted cells so
    atlas builders do not have to re-scan pixels.
    """
    box_w, box_h = (size, size) if isinstance(size, int) else size
    images = [Image.open(s) for s in srcs]
    rgbs, alphas = [], []
    for src, img in zip(srcs, images):
        rgb, alpha = matte.matte(img)
        if matte.has_cutout(img):
            print(f"  {src.name}: already cut out, keeping its alpha")
        rgbs.append(rgb)
        alphas.append(alpha)

    stack = matte.stabilise(np.stack(alphas).astype(np.float32), temporal_radius)
    stack = np.stack([largest_piece(a) for a in stack])
    report_group_coverage([s.name for s in srcs], stack)

    frames = []
    for rgb, alpha in zip(rgbs, stack):
        img = matte.to_image(rgb, alpha)
        box = tight_bbox(img, pad=0)
        frames.append((img, box, _foot_anchor_x(img, box)))

    # Equalise standing height (head to planted foot) — kills the model's framing drift.
    # Height fills the box; width is where the poses are allowed to spread.
    target_h = box_h * 0.98
    scales = [target_h / max(1, (b[3] - b[1])) for _, b, _ in frames]

    half = box_w / 2.0
    left = max((a - b[0]) * sc for (_, b, a), sc in zip(frames, scales))
    right = max((b[2] - a) * sc for (_, b, a), sc in zip(frames, scales))
    overflow = max(left / half, right / half, 1.0)
    if overflow > 1.0:
        print(
            f"fit_group: widest pose overflows by {overflow:.2f}x — "
            f"clipping extended limbs. Needs a box {2 * max(left, right):.0f}px wide "
            f"at this standing height; the box is {box_w}px."
        )
    else:
        print(
            f"fit_group: widest pose uses {max(left, right) / half:.2f} of the half-box "
            f"({box_w}x{box_h}) — nothing clipped"
        )

    baseline = box_h - 1
    for (img, box, anchor), scale, out in zip(frames, scales, outs):
        x0, y0, x1, y1 = box
        nw = max(1, round((x1 - x0) * scale))
        nh = max(1, round((y1 - y0) * scale))
        scaled = img.crop(box).resize((nw, nh), resample)
        canvas = Image.new("RGBA", (box_w, box_h), (0, 0, 0, 0))
        # anchor the feet to the canvas centre-x, and the ground to the baseline
        ox = round(half - (anchor - x0) * scale)
        oy = baseline - nh
        canvas.paste(scaled, (ox, oy), scaled)
        out.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out)
        opaque = int((np.array(canvas)[:, :, 3] >= 16).sum())
        print(
            f"fit_group {out.name} scale={scale:.3f} anchor_x={anchor:.0f} "
            f"opaque={opaque}/{box_w * box_h}"
        )

    # Feet sit on the last pixel row by construction (baseline = box_h - 1).
    # footX is the shared centre-x fraction after anchoring.
    return {
        "groundY": 1.0,
        "footX": 0.5,
        "cell": [box_w, box_h],
        "overflow": overflow,
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--size", type=int, default=64)
    args = p.parse_args()
    fit(args.input, args.out, args.size)


if __name__ == "__main__":
    main()
