"""Turn a 1024x576 ComfyUI stage into a Bible-locked SNES BG PNG (256x224)."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

from bible import load_row, snes5_to_8
from remap import integer_downscale


def remap_opaque(img: Image.Image, row: dict) -> tuple[Image.Image, list[int]]:
    palette = [
        (snes5_to_8(c["r"]), snes5_to_8(c["g"]), snes5_to_8(c["b"])) for c in row["colors"]
    ]
    src = img.convert("RGB")
    out = Image.new("RGB", src.size)
    used = [0] * 16
    for y in range(src.height):
        for x in range(src.width):
            r, g, b = src.getpixel((x, y))
            best_i, best_d = 0, 1 << 30
            for i, (pr, pg, pb) in enumerate(palette):
                d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
                if d < best_d:
                    best_d = d
                    best_i = i
            out.putpixel((x, y), palette[best_i])
            used[best_i] += 1
    return out, used


def to_indexed_png(rgb: Image.Image, row: dict, out: Path) -> None:
    palette = [
        (snes5_to_8(c["r"]), snes5_to_8(c["g"]), snes5_to_8(c["b"])) for c in row["colors"]
    ]
    full = palette + [(0, 0, 0)] * (256 - 16)
    indexed = Image.new("P", rgb.size)
    flat = []
    for r, g, b in full:
        flat.extend([r, g, b])
    indexed.putpalette(flat)
    lut = {palette[i]: i for i in range(16)}
    px = indexed.load()
    src = rgb.load()
    for y in range(rgb.height):
        for x in range(rgb.width):
            px[x, y] = lut[src[x, y]]
    out.parent.mkdir(parents=True, exist_ok=True)
    indexed.save(out, format="PNG")
    print(f"wrote {out} {rgb.size}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path)
    p.add_argument("--row", default="area_canal")
    p.add_argument("--width", type=int, default=256)
    p.add_argument("--height", type=int, default=224)
    p.add_argument("--png-out", type=Path, required=True)
    p.add_argument("--preview-out", type=Path)
    args = p.parse_args()

    row = load_row(args.row)
    img = Image.open(args.input).convert("RGB")
    w, h = img.size
    target_aspect = args.width / args.height
    src_aspect = w / h
    if src_aspect > target_aspect:
        new_w = int(h * target_aspect)
        left = (w - new_w) // 2
        crop = img.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_aspect)
        top = (h - new_h) // 2
        crop = img.crop((0, top, w, top + new_h))

    scaled = integer_downscale(crop.convert("RGBA"), (args.width, args.height)).convert("RGB")
    # Pad to 256x256 map for gfx4snes 32x32 tilemap if needed
    canvas = Image.new("RGB", (256, 256), palette_bottom(row))
    canvas.paste(scaled, (0, 0))
    final, used = remap_opaque(canvas, row)
    print("slot usage:", used)

    if args.preview_out:
        args.preview_out.parent.mkdir(parents=True, exist_ok=True)
        final.crop((0, 0, args.width, args.height)).save(args.preview_out)
        print(f"preview {args.preview_out}")
    to_indexed_png(final, row, args.png_out)


def palette_bottom(row: dict) -> tuple[int, int, int]:
    # cobble-ish fill under the visible 224 rows
    c = row["colors"][11]
    return snes5_to_8(c["r"]), snes5_to_8(c["g"]), snes5_to_8(c["b"])


if __name__ == "__main__":
    main()
