"""Author OpenPose skeletons directly instead of generating a donor and hoping.

Asking SDXL for a "straight punch" donor is a dice roll — it returned a guard
stance twice and a kick once. A ControlNet pose map is just 18 COCO keypoints and
17 coloured bones, so we draw the pose we actually want. Deterministic, art
directable, and free to iterate on: no GPU, no preprocessor.

Keypoints are normalised to the fighter's bounding box (0..1, origin top-left of
the box) so a pose can be retargeted onto any character's framing.

    python tools/comfy/pose_rig.py --preview
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image, ImageDraw

# COCO-18 order, matching controlnet_aux.open_pose.util.draw_bodypose
NAMES = [
    "nose", "neck", "rshoulder", "relbow", "rwrist", "lshoulder", "lelbow", "lwrist",
    "rhip", "rknee", "rankle", "lhip", "lknee", "lankle", "reye", "leye", "rear", "lear",
]
IDX = {n: i for i, n in enumerate(NAMES)}

LIMB_SEQ = [
    (1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10),
    (1, 11), (11, 12), (12, 13), (1, 0), (0, 14), (14, 16), (0, 15), (15, 17),
]
COLORS = [
    (255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0),
    (85, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170), (0, 255, 255),
    (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255), (170, 0, 255),
    (255, 0, 255), (255, 0, 170), (255, 0, 85),
]

# Fighter faces RIGHT. x grows right, y grows down, both 0..1 across the body box.
# "l" limbs are the lead (camera-side) ones, "r" the far side.
POSES: dict[str, dict[str, tuple[float, float]]] = {
    "punch": {
        "nose": (0.50, 0.09), "leye": (0.53, 0.08), "lear": (0.45, 0.09),
        "neck": (0.45, 0.16),
        "rshoulder": (0.40, 0.19), "relbow": (0.30, 0.28), "rwrist": (0.26, 0.38),
        "lshoulder": (0.50, 0.19), "lelbow": (0.70, 0.20), "lwrist": (0.93, 0.20),
        "rhip": (0.40, 0.52), "rknee": (0.30, 0.72), "rankle": (0.26, 0.97),
        "lhip": (0.52, 0.52), "lknee": (0.66, 0.73), "lankle": (0.76, 0.97),
    },
    "kick": {
        "nose": (0.34, 0.09), "leye": (0.37, 0.08), "lear": (0.29, 0.09),
        "neck": (0.31, 0.17),
        "rshoulder": (0.27, 0.20), "relbow": (0.18, 0.30), "rwrist": (0.14, 0.41),
        "lshoulder": (0.36, 0.20), "lelbow": (0.46, 0.30), "lwrist": (0.38, 0.40),
        "rhip": (0.30, 0.53), "rknee": (0.30, 0.74), "rankle": (0.30, 0.98),
        "lhip": (0.40, 0.53), "lknee": (0.64, 0.50), "lankle": (0.96, 0.46),
    },
}


def draw_bodypose(points: dict[str, tuple[float, float]], size: int = 1024,
                  box: tuple[float, float, float, float] = (0.16, 0.03, 0.84, 0.99)) -> Image.Image:
    """Render a COCO-18 skeleton the way controlnet_aux does: alpha'd bone stalks,
    solid joint dots, on black. `box` places the body inside the canvas (0..1)."""
    bx0, by0, bx1, by1 = (v * size for v in box)
    bw, bh = bx1 - bx0, by1 - by0

    def xy(name: str) -> tuple[float, float] | None:
        p = points.get(name)
        return None if p is None else (bx0 + p[0] * bw, by0 + p[1] * bh)

    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    stalk_w = max(3, round(size * 0.006))
    dot_r = max(3, round(size * 0.005))

    # Bones on their own layer, then blended down — overlapping bones stay readable
    # and the whole skeleton sits at the ~0.6 intensity OpenPose maps are trained on.
    bones = Image.new("RGB", (size, size), (0, 0, 0))
    bd = ImageDraw.Draw(bones)
    for i, (a, b) in enumerate(LIMB_SEQ):
        pa, pb = xy(NAMES[a]), xy(NAMES[b])
        if pa is None or pb is None:
            continue
        bd.line([pa, pb], fill=COLORS[i % len(COLORS)], width=stalk_w, joint="curve")
    canvas = Image.blend(canvas, bones, 0.6)

    d = ImageDraw.Draw(canvas)
    for name, i in IDX.items():
        p = xy(name)
        if p is None:
            continue
        d.ellipse((p[0] - dot_r, p[1] - dot_r, p[0] + dot_r, p[1] + dot_r), fill=COLORS[i % len(COLORS)])
    return canvas


def render(action: str, size: int = 1024) -> Image.Image:
    if action not in POSES:
        raise SystemExit(f"Unknown pose {action!r}; have {sorted(POSES)}")
    return draw_bodypose(POSES[action], size=size)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out-dir", type=Path, default=Path("art/comfy/poses"))
    ap.add_argument("--size", type=int, default=1024)
    args = ap.parse_args()
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for action in POSES:
        img = render(action, args.size)
        dest = args.out_dir / f"authored_{action}.png"
        img.save(dest)
        print(f"wrote {dest}")


if __name__ == "__main__":
    main()
