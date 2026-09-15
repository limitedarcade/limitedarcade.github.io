"""Compare two review captures: silhouette IoU and CIE76 ΔE in the intersection."""
import json
import sys

import numpy as np
from PIL import Image

BG = np.array([0x22, 0x25, 0x2C], np.int16)


def load(path):
    return np.asarray(Image.open(path).convert("RGB"))


def silhouette(im):
    return np.abs(im.astype(np.int16) - BG).sum(-1) > 18


def srgb_to_lab(rgb):
    x = rgb.astype(np.float64) / 255.0
    a = np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124564, 0.3575761, 0.1804375],
                  [0.2126729, 0.7151522, 0.0721750],
                  [0.0193339, 0.1191920, 0.9503041]])
    xyz = a @ M.T
    xyz /= np.array([0.95047, 1.0, 1.08883])
    d = np.where(xyz > 0.008856, np.cbrt(xyz), (903.3 * xyz + 16.0) / 116.0)
    L = 116.0 * d[..., 1] - 16.0
    A = 500.0 * (d[..., 0] - d[..., 1])
    B = 200.0 * (d[..., 1] - d[..., 2])
    return np.stack([L, A, B], -1)


def stats(a, b, mask):
    n = int(mask.sum())
    if n < 16:
        return {"n": n, "de50": None, "de95": None}
    da = srgb_to_lab(a[mask])
    db = srgb_to_lab(b[mask])
    de = np.sqrt(((da - db) ** 2).sum(-1))
    return {"n": n, "de50": float(np.median(de)), "de95": float(np.percentile(de, 95))}


def head_mask(sil):
    ys, xs = np.where(sil)
    if len(ys) == 0:
        return sil
    y0, y1 = ys.min(), ys.max()
    cut = y0 + int(0.28 * (y1 - y0 + 1))
    m = np.zeros_like(sil)
    m[:cut] = sil[:cut]
    return m


def main(path_a, path_b):
    a, b = load(path_a), load(path_b)
    if a.shape != b.shape:
        b = np.asarray(Image.fromarray(b).resize((a.shape[1], a.shape[0]), Image.NEAREST))
    sa, sb = silhouette(a), silhouette(b)
    inter = sa & sb
    union = sa | sb
    iou = float(inter.sum() / max(int(union.sum()), 1))
    body = stats(a, b, inter)
    head = stats(a, b, head_mask(sa) & head_mask(sb) & inter)
    json.dump({
        "kind": "capture-gate",
        "iou": iou,
        "de50": body["de50"],
        "de95": body["de95"],
        "headDE50": head["de50"],
        "headDE95": head["de95"],
        "intersectionPx": body["n"],
        "headPx": head["n"],
        "a": path_a,
        "b": path_b,
    }, sys.stdout, indent=2)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
