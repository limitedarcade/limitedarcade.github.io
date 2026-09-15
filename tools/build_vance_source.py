"""Build art/refs/vance/source_1024.png from vance_idle_1024_01.png.

Vance's locked idle is a clean SDXL cut-out inside a magenta frame (not a solid
magenta fill). The artpipeline `sheet` stage expects a 1024 RGB image on flat
WHITE with the subject centred and full-body in frame. This script:
  1. Connected-components on ~is_magenta to find the inner non-magenta region
     (the white box Vance is drawn on top of).
  2. Crops to that inner box.
  3. Within the crop, finds Vance's bbox (anything not magenta).
  4. Scales Vance to ~88% canvas height with a 5% foot margin.
  5. Pastes him onto a 1024x1024 white square.
"""

from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "art" / "raw" / "vance" / "vance_idle_1024_01.png"
DST_DIR = ROOT / "art" / "refs" / "vance"
DST = DST_DIR / "source_1024.png"
SIZE = 1024
HEIGHT_FRAC = 0.88
FOOT_MARGIN = 0.05
MAGENTA = np.array([255, 0, 255], dtype=np.int16)


def main() -> None:
    img = Image.open(SRC).convert("RGB")
    print(f"source {SRC.name} -> {img.size}")
    assert img.size == (SIZE, SIZE), f"expected 1024x1024, got {img.size}"

    arr = np.array(img, dtype=np.int16)
    diff = np.abs(arr - MAGENTA).sum(axis=2)
    is_magenta = diff <= 30
    print(f"  magenta coverage: {is_magenta.mean():.3f} of frame")

    labels, n = ndimage.label(~is_magenta)
    sizes = ndimage.sum(~is_magenta, labels, range(1, n + 1))
    inner_idx = int(np.argmax(sizes)) + 1
    inner = labels == inner_idx

    inner_eroded = ndimage.binary_erosion(inner, iterations=6)
    print(f"  inner non-magenta region (largest piece): {inner.mean():.3f} of frame")
    print(f"  inner after 6px erosion: {inner_eroded.mean():.3f} of frame")

    ys, xs = np.nonzero(inner_eroded)
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    inner_crop = img.crop(box)
    print(f"  inner bbox {inner_crop.size}")

    arr2 = np.array(inner_crop, dtype=np.int16)
    diff2 = np.abs(arr2 - MAGENTA).sum(axis=2)
    fg = diff2 > 30
    print(f"  vance foreground in inner crop: {fg.mean():.3f} of frame")

    ys, xs = np.nonzero(fg)
    if not len(xs):
        raise SystemExit("nothing survived after inner crop")
    box2 = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    sub_w, sub_h = box2[2] - box2[0], box2[3] - box2[1]
    print(f"  vance bbox {sub_w}x{sub_h}")
    sub = inner_crop.crop(box2)

    scale = (SIZE * HEIGHT_FRAC) / sub_h
    nw, nh = round(sub_w * scale), round(sub_h * scale)
    if nw > SIZE * 0.94:
        scale *= (SIZE * 0.94) / nw
        nw, nh = round(sub_w * scale), round(sub_h * scale)
        print(f"  wide pose, scaled down to fit: {scale:.3f}")
    sub = sub.resize((max(1, nw), max(1, nh)), Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", (SIZE, SIZE), (255, 255, 255))
    canvas.paste(sub, ((SIZE - nw) // 2, SIZE - nh - int(SIZE * FOOT_MARGIN)))

    DST_DIR.mkdir(parents=True, exist_ok=True)
    canvas.save(DST)
    print(f"wrote {DST} {canvas.size}")

    corner = np.array(canvas)[:8, :8, :3].reshape(-1, 3).mean(axis=0)
    print(f"  corner mean RGB: ({corner[0]:.0f}, {corner[1]:.0f}, {corner[2]:.0f}) - must be white-ish")
    assert corner.min() > 240, f"corner not white: {corner}"
    print("QA: corner white OK")


if __name__ == "__main__":
    main()
