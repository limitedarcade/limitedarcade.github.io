"""Generate Color Bible swatch PNGs and refresh master.palette.json."""

from __future__ import annotations

import argparse

from PIL import Image

from bible import SWATCH_DIR, iter_rows, row_rgb8, write_master


def make_strip(row: dict, cell: int = 16) -> Image.Image:
    colors = row_rgb8(row)
    img = Image.new("RGB", (cell * 16, cell))
    for i, rgb in enumerate(colors):
        for y in range(cell):
            for x in range(cell):
                img.putpixel((i * cell + x, y), rgb)
    return img


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cell", type=int, default=16, help="swatch cell size in px")
    args = parser.parse_args()

    SWATCH_DIR.mkdir(parents=True, exist_ok=True)
    for row in iter_rows():
        out = SWATCH_DIR / f"{row['id']}.png"
        make_strip(row, cell=args.cell).save(out)
        print(f"wrote {out.relative_to(out.parents[2])}")

    master = write_master()
    print(f"wrote {master.relative_to(master.parents[2])}")


if __name__ == "__main__":
    main()
