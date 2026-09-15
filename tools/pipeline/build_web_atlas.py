"""Build full-res web atlases from artpipeline clips.

Collects every available animation for a fighter, fits them together with
fit_group at 512 (LANCZOS), packs a grid atlas, and writes a JSON sidecar the
Three.js billboard reads.

    python tools/pipeline/build_web_atlas.py
    python tools/pipeline/build_web_atlas.py --slug trump
    python tools/pipeline/build_web_atlas.py --slug carney --cell-w 640 --cell-h 512

Does NOT apply the Color Bible. The web port is full-colour
(docs/web-port-plan.md Phase 1).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "pipeline"))

from fit_fighter import fit_group  # noqa: E402
from import_clip import place  # noqa: E402

ARTPIPELINE = Path(os.environ.get("ARTPIPELINE_ROOT", r"C:\source\repos\artpipeline"))
OUT_DIR = ROOT / "web" / "public" / "fighters"
FIT_DIR = ROOT / "art" / "px" / "_web_fit"
MASTER_DIR = ROOT / "art" / "raw"

ACTIONS = ("idle", "punch", "kick", "hit")
FRAMES = 21
DEFAULT_CELL_W = 640
DEFAULT_CELL_H = 512


def clip_frames(slug: str, action: str) -> list[Path]:
    d = ARTPIPELINE / "out" / "sprites" / slug / action
    if not d.is_dir():
        return []
    fs = sorted(d.glob("*.png"))
    return fs[:FRAMES]


def pack_atlas(cells: list[Path], cell_w: int, cell_h: int, cols: int) -> Image.Image:
    rows = math.ceil(len(cells) / cols)
    atlas = Image.new("RGBA", (cols * cell_w, rows * cell_h), (0, 0, 0, 0))
    for i, path in enumerate(cells):
        img = Image.open(path).convert("RGBA")
        if img.size != (cell_w, cell_h):
            raise SystemExit(f"{path.name} is {img.size}, expected {(cell_w, cell_h)}")
        col, row = i % cols, i // cols
        atlas.paste(img, (col * cell_w, row * cell_h), img)
    return atlas


def build_one(slug: str, cell_w: int, cell_h: int) -> Path:
    labels: list[tuple[str, int]] = []
    masters: list[Path] = []
    master_root = MASTER_DIR / slug / "frames"
    master_root.mkdir(parents=True, exist_ok=True)

    for action in ACTIONS:
        fs = clip_frames(slug, action)
        if not fs:
            print(f"  skip {slug}/{action}: no clip")
            continue
        if len(fs) < FRAMES:
            raise SystemExit(f"{slug}/{action}: expected {FRAMES} frames, found {len(fs)}")
        for i, f in enumerate(fs):
            dest = master_root / f"{slug}_{action}_{i:02d}.png"
            place(f, dest)
            masters.append(dest)
            labels.append((action, i))
        print(f"  {slug}/{action}: {len(fs)} frames")

    if not masters:
        raise SystemExit(f"no clips for {slug}")

    fit_root = FIT_DIR / slug
    fit_root.mkdir(parents=True, exist_ok=True)
    outs = [
        fit_root / f"{slug}_{action}_{i:02d}_fit.png"
        for action, i in labels
    ]

    meta = fit_group(
        masters,
        outs,
        size=(cell_w, cell_h),
        resample=Image.Resampling.LANCZOS,
    )

    cols = 12
    atlas = pack_atlas(outs, cell_w, cell_h, cols)
    rows = atlas.size[1] // cell_h
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    png_path = OUT_DIR / f"{slug}.png"
    json_path = OUT_DIR / f"{slug}.json"
    atlas.save(png_path, format="PNG", optimize=True)

    anims: dict[str, dict] = {}
    for idx, (action, _) in enumerate(labels):
        if action not in anims:
            anims[action] = {
                "start": idx,
                "count": 0,
                "loop": action in ("idle",),
            }
        anims[action]["count"] += 1

    sidecar = {
        "slug": slug,
        "cell": [cell_w, cell_h],
        "cols": cols,
        "rows": rows,
        "groundY": meta["groundY"],
        "footX": meta["footX"],
        "anims": anims,
        "frameCount": len(labels),
    }
    json_path.write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")
    print(f"OK  {png_path.relative_to(ROOT)}  {atlas.size[0]}x{atlas.size[1]}")
    print(f"OK  {json_path.relative_to(ROOT)}  anims={list(anims)}")
    if meta["overflow"] > 1.0:
        print(f"WARN overflow={meta['overflow']:.2f} — widen --cell-w")
    return png_path


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--slug", action="append", help="fighter slug; default both")
    p.add_argument("--cell-w", type=int, default=DEFAULT_CELL_W)
    p.add_argument("--cell-h", type=int, default=DEFAULT_CELL_H)
    args = p.parse_args()
    slugs = args.slug or ["trump", "carney"]
    for slug in slugs:
        print(f"=== {slug} ===")
        build_one(slug, args.cell_w, args.cell_h)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
