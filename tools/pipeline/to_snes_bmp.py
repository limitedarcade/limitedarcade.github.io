"""Convert a remapped RGBA sprite to 8bpp indexed BMP for gfx4snes."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

from bible import load_row, snes5_to_8


def to_indexed_bmp(src: Path, row_id: str, out: Path) -> None:
    row = load_row(row_id)
    palette_rgb = [(snes5_to_8(c["r"]), snes5_to_8(c["g"]), snes5_to_8(c["b"])) for c in row["colors"]]
    # gfx4snes wants a 256-color image; pad remaining slots with black
    full_pal = palette_rgb + [(0, 0, 0)] * (256 - len(palette_rgb))

    img = Image.open(src).convert("RGBA")
    indexed = Image.new("P", img.size)
    flat = []
    for r, g, b in full_pal:
        flat.extend([r, g, b])
    indexed.putpalette(flat)

    px = indexed.load()
    src_px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = src_px[x, y]
            if a < 16:
                px[x, y] = 0
                continue
            # nearest among first 16
            best_i, best_d = 0, 1 << 30
            for i, (pr, pg, pb) in enumerate(palette_rgb):
                if i == 0:
                    continue
                d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
                if d < best_d:
                    best_d = d
                    best_i = i
            px[x, y] = best_i

    out.parent.mkdir(parents=True, exist_ok=True)
    indexed.save(out, format="BMP")
    print(f"wrote {out} size={img.size} row={row_id}")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("input", type=Path)
    p.add_argument("--row", required=True)
    p.add_argument("--out", type=Path, required=True)
    args = p.parse_args()
    to_indexed_bmp(args.input, args.row, args.out)


if __name__ == "__main__":
    main()
