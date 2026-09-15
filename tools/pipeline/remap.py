"""Downscale and remap an image onto a Color Bible 16-slot row."""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

from bible import ROOT, load_row, pack_bgr555, row_rgb8, snes5_to_8


KEY_MAGENTA = (255, 0, 255)


def integer_downscale(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    """Stepwise nearest resize for 1024→SNES crunch (prefer integer halvings)."""
    img = img.convert("RGBA")
    w, h = img.size
    tw, th = size
    while w > tw * 2 and h > th * 2:
        w //= 2
        h //= 2
        img = img.resize((w, h), Image.Resampling.NEAREST)
    if img.size != size:
        img = img.resize(size, Image.Resampling.NEAREST)
    return img


def nearest_index(rgb: tuple[int, int, int], palette: list[tuple[int, int, int]], start: int = 0) -> int:
    best_i = start
    best_d = 1 << 30
    for i in range(start, len(palette)):
        pr, pg, pb = palette[i]
        d = (rgb[0] - pr) ** 2 + (rgb[1] - pg) ** 2 + (rgb[2] - pb) ** 2
        if d < best_d:
            best_d = d
            best_i = i
    return best_i


def color_dist2(a: tuple[int, int, int], b: tuple[int, int, int]) -> int:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2


def detect_key_from_corners(img: Image.Image) -> tuple[int, int, int]:
    """ComfyUI often fails exact #FF00FF — sample corners for the real backdrop."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    samples = [
        rgb.getpixel((0, 0)),
        rgb.getpixel((w - 1, 0)),
        rgb.getpixel((0, h - 1)),
        rgb.getpixel((w - 1, h - 1)),
        rgb.getpixel((w // 2, 0)),
        rgb.getpixel((w // 2, h - 1)),
        rgb.getpixel((0, h // 2)),
        rgb.getpixel((w - 1, h // 2)),
    ]
    # median per channel is robust to one bad corner
    rs, gs, bs = zip(*samples)
    return (
        sorted(rs)[len(rs) // 2],
        sorted(gs)[len(gs) // 2],
        sorted(bs)[len(bs) // 2],
    )


def is_key_pixel(
    rgb: tuple[int, int, int],
    key: tuple[int, int, int],
    tolerance: int,
) -> bool:
    # Chebyshev distance keeps a simple tunable ball around the key color
    return (
        abs(rgb[0] - key[0]) <= tolerance
        and abs(rgb[1] - key[1]) <= tolerance
        and abs(rgb[2] - key[2]) <= tolerance
    )


def remap_image(
    img: Image.Image,
    row: dict,
    *,
    key: tuple[int, int, int] = KEY_MAGENTA,
    key_tolerance: int = 40,
    keep_index0_transparent: bool = True,
) -> tuple[Image.Image, list[int]]:
    palette = row_rgb8(row)
    src = img.convert("RGBA")
    out = Image.new("RGBA", src.size)
    used = [0] * 16

    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = src.getpixel((x, y))
            if a < 16 or is_key_pixel((r, g, b), key, key_tolerance):
                out.putpixel((x, y), (*palette[0], 0 if keep_index0_transparent else 255))
                used[0] += 1
                continue
            idx = nearest_index((r, g, b), palette, start=1 if keep_index0_transparent else 0)
            pr, pg, pb = palette[idx]
            out.putpixel((x, y), (pr, pg, pb, 255))
            used[idx] += 1
    return out, used


def write_pal_preview(row: dict, path: Path) -> None:
    """Write a tiny GPL-like sidecar listing BGR555 words for ROM tooling."""
    lines = [f"# Emberveil row {row['id']}", f"# usage {row.get('usage')}"]
    for i, c in enumerate(row["colors"]):
        word = pack_bgr555(c["r"], c["g"], c["b"])
        lines.append(
            f"{i:02d} {c['name']} r={c['r']} g={c['g']} b={c['b']} "
            f"hex={c.get('hex')} bgr555=0x{word:04X}"
        )
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="source PNG (often 1024 ComfyUI output)")
    parser.add_argument("--row", required=True, help="Color Bible row id, e.g. area_harbor")
    parser.add_argument("--width", type=int, help="target width")
    parser.add_argument("--height", type=int, help="target height")
    parser.add_argument("--size", type=int, help="square target size (alternative to w/h)")
    parser.add_argument(
        "--out",
        type=Path,
        help="output PNG (default: art/px/<row>/<input_stem>_px.png)",
    )
    parser.add_argument(
        "--no-key-transparent",
        action="store_true",
        help="do not force palette index 0 for magenta/alpha",
    )
    parser.add_argument(
        "--key-auto",
        action="store_true",
        default=True,
        help="detect backdrop from image corners (default on; ComfyUI rarely emits exact #FF00FF)",
    )
    parser.add_argument("--no-key-auto", action="store_true", help="use exact/near #FF00FF only")
    parser.add_argument(
        "--key-tolerance",
        type=int,
        default=48,
        help="per-channel tolerance for chroma key after downscale",
    )
    args = parser.parse_args()

    row = load_row(args.row)
    img = Image.open(args.input)

    if args.size:
        target = (args.size, args.size)
    elif args.width and args.height:
        target = (args.width, args.height)
    else:
        target = img.size

    # Key on the full-res image first conceptually: detect key pre-scale, then
    # downscale (1024 model output → SNES px), then remap with tolerance.
    use_auto = args.key_auto and not args.no_key_auto
    key = detect_key_from_corners(img) if use_auto else KEY_MAGENTA
    print(f"chroma key rgb={key} tolerance={args.key_tolerance} auto={use_auto}")

    scaled = integer_downscale(img, target)
    remapped, used = remap_image(
        scaled,
        row,
        key=key,
        key_tolerance=args.key_tolerance,
        keep_index0_transparent=not args.no_key_transparent,
    )

    if args.out:
        out = args.out
    else:
        out = ROOT / "art" / "px" / row["id"] / f"{args.input.stem}_px.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    remapped.save(out)
    write_pal_preview(row, out.with_suffix(".pal.txt"))

    unique = sum(1 for n in used if n)
    print(f"wrote {out}")
    print(f"row={row['id']} size={remapped.size[0]}x{remapped.size[1]} unique_slots_used={unique}/16")
    print("slot usage:", used)


if __name__ == "__main__":
    main()
