"""Process ComfyUI 1024 masters → SNES-ready BMP/PNG for Battle for Independance.

Applies Pixel Art XL guidance: nearest downscale (prefer 8× path 1024→128→64).
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image

from bible import write_master
from remap import detect_key_from_corners, integer_downscale, remap_image, write_pal_preview
from to_snes_bmp import to_indexed_bmp

ROOT = Path(__file__).resolve().parents[2]


def process_group(
    srcs: list[Path], row: str, size: int, out_pxs: list[Path], out_bmps: list[Path]
) -> None:
    """Crunch every frame of one character together.

    The frames MUST be fitted as a group: fitting each to its own bounding box
    rescales and re-centres it per pose, which reads as the fighter pulsing and
    sliding instead of animating.
    """
    from bible import load_row
    from fit_fighter import fit_group

    row_data = load_row(row)
    fitted = [op.with_name(op.stem + "_fit.png") for op in out_pxs]
    for f in fitted:
        f.parent.mkdir(parents=True, exist_ok=True)
    fit_group(srcs, fitted, size=max(size * 2, 128))  # fit at 128 then crunch

    for src, fit_png, out_px, out_bmp in zip(srcs, fitted, out_pxs, out_bmps):
        img = Image.open(fit_png).convert("RGBA")
        # Already keyed to alpha by fit_fighter — use impossible key so only alpha matters
        scaled = integer_downscale(img, (size, size))
        remapped, used = remap_image(
            scaled, row_data, key=(1, 2, 3), key_tolerance=0, keep_index0_transparent=True
        )
        print(f"{src.name}: used={used}")
        out_px.parent.mkdir(parents=True, exist_ok=True)
        remapped.save(out_px)
        write_pal_preview(row_data, out_px.with_suffix(".pal.txt"))
        to_indexed_bmp(out_px, row, out_bmp)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--size", type=int, default=64)
    args = p.parse_args()

    write_master()

    fighters = [
        ("trump", "char_trump"),
        ("carney", "char_carney"),
    ]
    actions = ("idle", "punch", "kick")

    for slug, row in fighters:
        srcs, pxs, bmps = [], [], []
        for action in actions:
            src = ROOT / f"art/raw/{slug}/{slug}_{action}_1024_01.png"
            if not src.exists():
                # Prefer latest regenerated file if numbered higher
                candidates = sorted(src.parent.glob(f"{slug}_{action}_1024_*.png"))
                if not candidates:
                    print(f"SKIP missing {src}")
                    continue
                src = candidates[-1]
                print(f"using latest {src.name}")
            srcs.append(src)
            pxs.append(ROOT / f"art/px/{slug}/{slug}_{action}_px.png")
            bmps.append(ROOT / f"rom/res/{slug}_{action}.bmp")
        if not srcs:
            continue
        process_group(srcs, row, args.size, pxs, bmps)

    # Stage
    from stage_to_bg import main as stage_main
    import sys

    # Lake America stage → area_canal palette row reused as winter ice tones for now
    # (dedicated area_lake row can replace later)
    stage_src = ROOT / "art/raw/lake_america/lake_america_1024_01.png"
    if stage_src.exists():
        # Map to a lake-friendly bible row if present, else canal
        lake_row = "area_lake" if (ROOT / "docs/color-bible/rows/area_lake.json").exists() else "area_canal"
        sys.argv = [
            "stage_to_bg.py",
            str(stage_src),
            "--row",
            lake_row,
            "--png-out",
            str(ROOT / "rom/res/lake.png"),
            "--preview-out",
            str(ROOT / "art/px/lake_america/lake_preview.png"),
        ]
        stage_main()
    else:
        print("SKIP lake stage")


if __name__ == "__main__":
    main()
