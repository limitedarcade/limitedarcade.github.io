"""Background removal — delegates to artpipeline's matte, on purpose.

battlefi used to carry its own version (`fit_fighter.flood_clear_background`):
one key sampled from the corners, a tolerance ball of 48, flat-pocket clearing,
largest-blob keep. That is a strictly weaker subset of what artpipeline already
does, and the difference is visible in the ROM:

- **The background is measured per frame there, not assumed.** It has to be. The
  locked masters of ONE fighter do not share a backdrop: trump_idle sits on
  near-black (28,29,29), trump_punch on near-white (253), trump_kick on a
  gradient, carney_kick on cyan. A single key at tol 48 around *black* is a ball
  sitting on top of a navy suit and black shoes.
- **It decontaminates the edge.** Without that, every anti-aliased outline keeps
  a rim of whatever the backdrop was — so trump's idle carries a black fringe
  and his punch a white one. After the Color Bible remap those become opposite
  palette indices, and the fighter appears to flicker an outline on and off when
  he attacks. That is a background bug wearing an animation bug's clothes.
- It separates cast shadow by *saturation*, and it estimates fractional alpha in
  an edge band rather than thresholding.

Every one of those steps is there because something specific shipped broken
without it; see the module docstring of `pipeline/matte.py` in artpipeline and
its HISTORY.md. Do not reimplement any of it here — fix it there and both
projects get the fix.

`rembg`/`u2net` is not the alternative. It was tried in artpipeline first and
left a soft halo tens of pixels wide on clean line art, which at 32px is most of
a fighter.
"""

from __future__ import annotations

import os
import sys
from dataclasses import replace
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

DEFAULT_ARTPIPELINE = Path(r"C:\source\repos\artpipeline")

# artpipeline's measured config values (its config.yaml, matte block). Kept as a
# literal rather than parsed from its config.yaml so a tuning pass over there
# aimed at animals cannot silently change how fighters are cut out.
#
# hole_bg_tolerance stays at 10: artpipeline's MatteConfig refuses anything over
# 24, because looser punches holes through pale subjects and the failure is
# silent until three stages later.
SPRITE_MATTE = dict(
    flood_tolerance=12,
    hole_bg_tolerance=10,
    hole_max_fraction=0.50,
    shadow_sat_max=0.15,
    shadow_min_darkness=8,
    shadow_value_min=0.55,
    edge_band=2,
)

BG_DETECT_INSET = 4


class MatteUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _artpipeline():
    """Import artpipeline's matte + temporal modules, or say clearly why not."""
    root = Path(os.environ.get("ARTPIPELINE_ROOT", DEFAULT_ARTPIPELINE))
    if not (root / "pipeline" / "matte.py").exists():
        raise MatteUnavailable(
            f"artpipeline not found at {root}. battlefi's fighter frames come from "
            "it and it owns background removal for both projects. Set "
            "ARTPIPELINE_ROOT to its checkout."
        )
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from pipeline import matte as ap_matte  # noqa: E402
    from pipeline import temporal as ap_temporal  # noqa: E402
    from pipeline.config import MatteConfig  # noqa: E402

    return ap_matte, ap_temporal, MatteConfig(**SPRITE_MATTE)


def available() -> bool:
    try:
        _artpipeline()
    except MatteUnavailable:
        return False
    return True


def has_cutout(img: Image.Image, border_inset: int = 4) -> bool:
    """True if this image already carries a real alpha cut-out.

    artpipeline exports RGBA. Re-mattting an already-cut-out frame can only lose
    pixels — and it loses them badly, because `detect_key_from_corners` on a
    transparent corner reads whatever RGB happens to sit under alpha 0 (often
    black) and then a tolerance ball around black eats a dark suit.

    Two conditions, both required. Some transparency, so a flattened RGB frame
    saved as RGBA does not qualify; and a transparent border ring, so a frame
    that merely has a few soft pixels somewhere is not mistaken for a cut-out.
    """
    if img.mode not in ("RGBA", "LA", "PA"):
        return False
    alpha = np.array(img.convert("RGBA"))[:, :, 3]
    if (alpha < 16).mean() < 0.02:
        return False
    i = border_inset
    ring = np.concatenate(
        [alpha[i, i:-i], alpha[-1 - i, i:-i], alpha[i:-i, i], alpha[i:-i, -1 - i]]
    )
    return bool((ring < 16).mean() > 0.9)


def frame_tolerance(rgb: np.ndarray, bg: np.ndarray, margin: int = 8) -> int:
    """Flood tolerance for THIS frame: wide enough to span its own backdrop.

    artpipeline's flat 12 is right for its references, whose backgrounds measure
    251-255 and drift 2-6 levels across a clip. battlefi's masters are not that.
    Measured spread of the border ring from the frame's own median, per channel:

    | frame        | p95 | flood_tolerance 12 |
    |--------------|-----|--------------------|
    | trump_idle   |   1 | fine               |
    | trump_punch  |   1 | fine               |
    | carney_idle  |   0 | fine               |
    | carney_punch |   1 | fine               |
    | carney_kick  |  18 | **fails**          |
    | trump_kick   |  35 | **fails**          |

    The two kicks came back with 40% and 8% of the frame as retained backdrop --
    a white slab welded to the sprite -- because a gradient 50 levels wide is not
    crossable by a flood with a 12-level ball. This is what `report_group_coverage`
    catches, and this is the fix.

    p95, not max. The maxima are 199 and 232, which is the fighter's own foot
    resting on the border; a tolerance derived from that would swallow him.

    Only ever LOOSER than the configured floor, never tighter, and capped: a
    frame whose border genuinely varies by 64 levels has scenery in it, and the
    answer to that is a better master, not a tolerance that eats a navy suit.
    """
    i = BG_DETECT_INSET
    h, w = rgb.shape[:2]
    ring = np.concatenate(
        [rgb[i, i : w - i], rgb[h - 1 - i, i : w - i], rgb[i : h - i, i], rgb[i : h - i, w - 1 - i]]
    )
    spread = int(np.percentile(np.abs(ring.astype(np.int16) - bg.astype(np.int16)).max(axis=1), 95))
    return int(np.clip(spread + margin, SPRITE_MATTE["flood_tolerance"], 64))


# Levels below pure white still counted as backdrop when stripping the halo.
# Measured on the painted Trump clips: the retained shell sits at 235-244, the
# shirt's lit face at 215-230. A sweep at 205/215/225/235/245 removed 36.6 /
# 35.9 / 35.0 / 33.2 / 1.4 percent of the silhouette — the cliff at 245 is the
# halo itself, so anything from 225 to 240 catches it and 20 keeps the widest
# margin over the shirt.
HALO_TOLERANCE = 20

# Below this the shell is edge noise, not a slab, and stripping is not worth the
# risk of biting a genuinely pale subject.
HALO_MIN_SHARE = 0.02


def strip_halo(rgb: np.ndarray, alpha: np.ndarray, tolerance: int = HALO_TOLERANCE):
    """Remove near-white opaque pixels that reach the outside of the cut-out.

    artpipeline floods the backdrop from the frame border at a tolerance of 12.
    That is right for the flat-vector animals and wrong for a painted fighter,
    because the painted `video_suffix` asks for "dramatic rim lighting" against a
    "plain white background" — which is a bright halo hugging the subject. The
    flood stops at the halo and the halo ships as subject. Measured on trump:
    25-42% of every silhouette, ragged, and it varies frame to frame, so it also
    wrecks the coverage numbers that are supposed to catch a bad matte.

    The test is connectivity, not colour alone. A near-white pixel that can walk
    to a transparent pixel through other near-white pixels was never enclosed by
    the fighter, so it is backdrop. His shirt cannot walk out — the jacket, tie
    and collar are in the way — so it stays, and anything the strip does enclose
    on its way in is put straight back.

    This is battlefi's, not artpipeline's: it only applies to a frame that
    arrives already cut out, which upstream never sees.
    """
    opaque = alpha > 0.5
    white = opaque & (rgb.min(axis=2) >= 255 - tolerance)
    share = white.sum() / max(1, opaque.sum())
    if share < HALO_MIN_SHARE:
        return alpha

    st = np.ones((3, 3), bool)
    seed = white & ndimage.binary_dilation(~opaque, st)
    if not seed.any():
        return alpha
    labels, _ = ndimage.label(white, st)
    outside = set(np.unique(labels[seed])) - {0}
    shell = np.isin(labels, sorted(outside)) & white

    # A shell that walks in through a thin bright bridge (a lit shoulder, the
    # collar) leaves a hole behind it. Whatever the subject encloses after the
    # strip was never backdrop, so restore it.
    enclosed = ndimage.binary_fill_holes(opaque & ~shell)
    cut = shell & ~enclosed
    out = alpha.copy()
    out[cut] = 0.0
    print(f"  stripped halo: {100 * cut.sum() / max(1, opaque.sum()):.1f}% of the silhouette")
    return out


def matte(img: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    """Cut one frame out. Returns (rgb uint8 [H,W,3], alpha float32 [H,W] in [0,1]).

    Short-circuits on an image that already has an alpha cut-out — see has_cutout —
    but still strips the halo that cut-out left behind. See strip_halo.
    """
    rgba = np.array(img.convert("RGBA"))
    if has_cutout(img):
        rgb = rgba[:, :, :3].copy()
        return rgb, strip_halo(rgb, rgba[:, :, 3].astype(np.float32) / 255.0)
    ap_matte, _, cfg = _artpipeline()
    rgb = rgba[:, :, :3]
    bg = ap_matte.measure_background(rgb, BG_DETECT_INSET)
    tol = frame_tolerance(rgb, bg)
    if tol != cfg.flood_tolerance:
        print(f"  backdrop varies; flood_tolerance {cfg.flood_tolerance} -> {tol}")
        cfg = replace(cfg, flood_tolerance=tol)
    return ap_matte.matte_frame(rgb, cfg, BG_DETECT_INSET)


def stabilise(alphas: np.ndarray, radius: int) -> np.ndarray:
    """Temporal median along the frame axis — ONLY for frames of one motion clip.

    This is artpipeline's `temporal.stabilise`, and its window WRAPS, because
    there the N frames are a closed loop sampled from a single H3 arc: the edge
    boils a pixel in and out between neighbours and the median settles it.

    It is wrong for battlefi's idle/punch/kick. Those are three unrelated key
    poses, not neighbouring samples of one motion, so their per-pixel median is
    approximately their intersection — it would shave off the thrown fist and
    the raised leg, which are exactly the pixels that make an attack frame read
    as an attack. `fit_group` therefore defaults radius=0. Turn it on only when
    the frames handed in are consecutive frames of one clip.
    """
    if radius <= 0:
        return alphas.astype(np.float32, copy=True)
    _, ap_temporal, _ = _artpipeline()
    return ap_temporal.stabilise(alphas, radius)


def to_image(rgb: np.ndarray, alpha: np.ndarray) -> Image.Image:
    a = np.clip(alpha * 255.0 + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([rgb, a]), "RGBA")
