"""Concept sheet -> playable SNES fighter, in one command.

    python tools/make_fighter.py --slug carney --sheet carney_concept.png --crop 0,0,878,1402

Every stage this runs already existed as a separate script. What did not exist
was the ORDER, and the checks between the stages. Three of the four recorded
failures in docs/ are stage-boundary failures that each looked like success:

  * `pipeline.cli run` reads work/prepped/<slug>.png, never sources/<slug>.png.
    Swap a source without prepping and it regenerates the OLD character, reports
    "accepted in 114s", and the clip looks fine on its own.
    -> stage `prep` hashes the prepped file before and after and FAILS if it did
       not change when the source did.

  * The H3 weights are 34 GB against 32 GB of host RAM. A batch survives three
    or four clips and then the loader dies mid-run.
    -> stage `generate` runs ONE clip per process and flushes ComfyUI between.

  * A painted source can return subtle head-sway instead of a thrown fist. The
    coverage numbers stay clean, so nothing downstream notices.
    -> stage `generate` measures reach (how far the silhouette actually extends
       past the idle) per clip and prints it. Attacks that do not out-reach idle
       are named in the summary.

  * Frames of one fighter fitted separately rescale per pose, so the character
    shrinks and hops sideways when the state changes.
    -> stage `pack` always goes through pack_fighter_frames.py, which fits all
       84 frames as one group. process_assets.py is the wrong tool here.

Stages, in order:

    sheet     character sheet -> 1024 reference on flat white   (sheet_to_reference.py)
    install   reference -> artpipeline/sources/<slug>.png
    prep      artpipeline prep + proof that it re-prepped
    generate  one H3 clip per animation, one process each, + QA
    pack      84 frames -> art/px + rom/res/frames  (pack_fighter_frames.py)
    build     WSL + PVSnesLib -> battlefi.sfc       (tools/wsl_build_rom.sh)

Run a slice with --from / --to, or a single stage with --only:

    python tools/make_fighter.py --slug trump --only generate --anims punch,kick
    python tools/make_fighter.py --slug trump --from pack

See docs/fighter-workflow.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "pipeline"))
try:
    from matte import strip_halo
except Exception:  # scipy / artpipeline missing: QA still runs, just on raw alpha
    strip_halo = None

ARTPIPELINE = Path("C:/source/repos/artpipeline")
COMFY = "http://127.0.0.1:8188"

STAGES = ("sheet", "install", "prep", "generate", "pack", "build")
ACTIONS = ("idle", "punch", "kick", "hit")
FRAMES = 21

# A fighter's frames are the same body in different poses, so their opaque
# coverage should sit near the clip median. Far above it = kept backdrop, far
# below = the matte ate into him. Both ship silently. (docs/art-pipeline-status.md)
COVERAGE_SPREAD_MAX = 0.25


class Fail(SystemExit):
    def __init__(self, msg: str) -> None:
        super().__init__(f"\nFAILED: {msg}\n")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def run(cmd: list[str], cwd: Path | None = None) -> None:
    print(f"  $ {' '.join(str(c) for c in cmd)}")
    r = subprocess.run([str(c) for c in cmd], cwd=cwd)
    if r.returncode != 0:
        raise Fail(f"command exited {r.returncode}")


def venv_python() -> Path:
    p = ARTPIPELINE / ".venv" / "Scripts" / "python.exe"
    if not p.exists():
        raise Fail(f"artpipeline venv not found at {p}")
    return p


def free_comfy() -> None:
    """Unload models between clips. Without this the third or fourth clip dies."""
    body = json.dumps({"unload_models": True, "free_memory": True}).encode()
    req = urllib.request.Request(
        f"{COMFY}/free", data=body, headers={"Content-Type": "application/json"}
    )
    try:
        urllib.request.urlopen(req, timeout=30).read()
        print("  flushed ComfyUI memory")
    except (urllib.error.URLError, OSError) as e:
        print(f"  WARNING: could not flush ComfyUI ({e}) - the next clip may OOM")


# --------------------------------------------------------------------------- QA


def silhouette(path: Path) -> tuple[int, int, int, int, float, float]:
    """(x0, y0, x1, y1, foot_anchor_x, coverage) of one clip frame.

    Measured AFTER strip_halo. artpipeline's cut-out keeps a near-white shell
    that is 25-42% of the silhouette on the painted clips and varies frame to
    frame, so coverage measured on the raw frame is mostly measuring the defect.
    """
    rgba = np.array(Image.open(path).convert("RGBA"))
    a = rgba[:, :, 3]
    if strip_halo is not None:
        a = (strip_halo(rgba[:, :, :3], a.astype(np.float32) / 255.0) * 255).astype(np.uint8)
    ys, xs = np.nonzero(a >= 16)
    if not len(xs):
        return 0, 0, 0, 0, 0.0, 0.0
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1
    band = max(1, int((y1 - y0) * 0.15))
    sub = a[y1 - band : y1, x0:x1]
    _, bx = np.nonzero(sub >= 16)
    anchor = x0 + float(bx.mean()) if len(bx) else (x0 + x1) / 2.0
    return x0, y0, x1, y1, anchor, float((a >= 16).mean())


def qa_clip(slug: str, action: str) -> dict:
    """Coverage spread + reach. Reported as numbers; only the unambiguous fails."""
    d = ARTPIPELINE / "out" / "sprites" / slug / action
    fs = sorted(d.glob("*.png"))
    if len(fs) < FRAMES:
        raise Fail(f"{slug}/{action}: {len(fs)} frames on disk, want {FRAMES} ({d})")
    fs = fs[:FRAMES]

    cov, reach = [], []
    for f in fs:
        x0, y0, x1, y1, anchor, c = silhouette(f)
        h = max(1, y1 - y0)
        cov.append(c)
        # How far the silhouette reaches from the planted feet, in body heights.
        # This is the number that separates a thrown fist from a head-sway.
        reach.append(max(anchor - x0, x1 - anchor) / h)

    med = float(np.median(cov))
    outliers = [
        (i, c) for i, c in enumerate(cov) if med > 0 and abs(c - med) / med > COVERAGE_SPREAD_MAX
    ]
    return {
        "frames": len(fs),
        "coverage_median": med,
        "coverage_outliers": outliers,
        "reach_max": float(max(reach)),
        "reach_peak_frame": int(np.argmax(reach)),
    }


# ----------------------------------------------------------------------- stages


def stage_sheet(slug: str, sheet: Path | None, crop: str | None) -> None:
    if sheet is None:
        raise Fail("--sheet is required for the `sheet` stage")
    if not sheet.exists():
        raise Fail(f"sheet not found: {sheet}")
    out = ROOT / "art" / "refs" / slug / "source_1024.png"
    cmd = [
        sys.executable,
        ROOT / "tools" / "pipeline" / "sheet_to_reference.py",
        "--sheet", sheet,
        "--out", out,
        "--qa",
    ]
    if crop:
        cmd += ["--crop", crop]
    run(cmd)

    img = Image.open(out)
    if img.size != (1024, 1024):
        raise Fail(f"{out} is {img.size}, want (1024, 1024)")
    a = np.array(img.convert("RGBA"))
    corner = a[:8, :8, :3].reshape(-1, 3).mean(axis=0)
    if corner.min() < 240:
        raise Fail(
            f"{out} corner is {tuple(int(v) for v in corner)}, not white - "
            "artpipeline's matte needs a flat white ground. Re-crop the sheet."
        )
    print(f"  reference OK: {out}  (corner {tuple(int(v) for v in corner)})")
    print("  LOOK AT IT. A sheet drawn in a celebration pose stays in a")
    print("  celebration pose - H3 animates whatever pose the reference has.")


def stage_install(slug: str) -> None:
    ref = ROOT / "art" / "refs" / slug / "source_1024.png"
    if not ref.exists():
        raise Fail(f"no reference at {ref} - run the `sheet` stage first")
    dst = ARTPIPELINE / "sources" / f"{slug}.png"
    before = sha(dst) if dst.exists() else None
    shutil.copy2(ref, dst)
    print(f"  {dst}  {before} -> {sha(dst)}")
    (ROOT / "art" / "refs" / slug / "source.sha256").write_text(sha(dst), encoding="utf-8")


def stage_prep(slug: str) -> None:
    """artpipeline prep, plus proof that the prepped copy actually changed.

    `run` reads work/prepped/<slug>.png and there is no flag to force a prep.
    Skipping this regenerates the previous character and says "accepted".
    """
    prepped = ARTPIPELINE / "work" / "prepped" / f"{slug}.png"
    src = ARTPIPELINE / "sources" / f"{slug}.png"
    if not src.exists():
        raise Fail(f"no source at {src} - run the `install` stage first")
    before = sha(prepped) if prepped.exists() else None

    run([venv_python(), "-m", "pipeline.cli", "prep"], cwd=ARTPIPELINE)

    if not prepped.exists():
        raise Fail(f"prep did not write {prepped}")
    after = sha(prepped)
    print(f"  prepped {prepped.name}: {before} -> {after}")
    if before is not None and before == after and sha(src) != before:
        raise Fail(
            f"prep left {prepped} unchanged while {src} differs from it.\n"
            "  Every clip generated from here would be the PREVIOUS character.\n"
            "  See docs/art-pipeline-status.md, 'Swapping a source'."
        )


def stage_generate(slug: str, anims: tuple[str, ...], retries: int) -> dict:
    """One clip per process, ComfyUI flushed between. QA each clip as it lands."""
    reports: dict[str, dict] = {}
    for action in anims:
        print(f"\n  --- {slug} / {action} ---")
        t0 = time.time()
        for attempt in range(1, retries + 1):
            try:
                run(
                    [venv_python(), "-m", "pipeline.cli", "run",
                     "--only", slug, "--animation", action],
                    cwd=ARTPIPELINE,
                )
                break
            except SystemExit:
                if attempt == retries:
                    raise
                print(f"  attempt {attempt} failed; flushing and retrying")
                free_comfy()
        free_comfy()
        reports[action] = qa_clip(slug, action)
        r = reports[action]
        print(
            f"  {action}: {r['frames']} frames in {time.time() - t0:.0f}s, "
            f"coverage median {100 * r['coverage_median']:.1f}%, "
            f"reach {r['reach_max']:.2f} body-heights (peak frame {r['reach_peak_frame']})"
        )
        for i, c in r["coverage_outliers"]:
            print(f"    frame {i:02d} coverage {100 * c:.1f}%  <-- CHECK the matte")
    return reports


def summarise(slug: str, reports: dict[str, dict]) -> None:
    """The reach comparison. Reported, not enforced - read it before you build."""
    if "idle" not in reports:
        return
    idle = reports["idle"]["reach_max"]
    print(f"\n  reach vs idle ({slug}) - idle reaches {idle:.2f} body-heights")
    for action in ("punch", "kick", "hit"):
        if action not in reports:
            continue
        r = reports[action]["reach_max"]
        verdict = "ok" if r >= idle * 1.15 else "SUBTLE - this attack barely moves"
        print(f"    {action:5s} {r:.2f}  ({r / idle:.2f}x idle)  {verdict}")
    print(
        "  A painted reference can return head-sway instead of a thrown fist and\n"
        "  every other number stays clean. See docs/regen-rollback.md."
    )


def stage_pack(box: str | None) -> None:
    cmd = [sys.executable, ROOT / "tools" / "pipeline" / "pack_fighter_frames.py"]
    if box:
        w, h = (int(v) for v in box.lower().split("x"))
        cmd += ["--width", w, "--height", h]
    run(cmd)


def stage_build() -> None:
    script = subprocess.run(
        ["wsl", "-d", "Ubuntu", "--", "wslpath", "-a", str(ROOT / "tools" / "wsl_build_rom.sh")],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    run(["wsl", "-d", "Ubuntu", "--", "bash", script])


# ------------------------------------------------------------------------ main


def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--slug", required=True, help="fighter id, e.g. trump / carney")
    p.add_argument("--sheet", type=Path, help="character sheet PNG (the `sheet` stage)")
    p.add_argument("--crop", help="x0,y0,x1,y1 - isolate the main figure from side panels")
    p.add_argument("--anims", default=",".join(ACTIONS))
    p.add_argument("--box", help="sprite box WxH passed to pack; default is the packer's")
    p.add_argument("--retries", type=int, default=2)
    p.add_argument("--from", dest="start", choices=STAGES, default="sheet")
    p.add_argument("--to", dest="end", choices=STAGES, default="build")
    p.add_argument("--only", choices=STAGES)
    args = p.parse_args()

    if args.only:
        args.start = args.end = args.only
    todo = STAGES[STAGES.index(args.start) : STAGES.index(args.end) + 1]
    anims = tuple(a.strip() for a in args.anims.split(",") if a.strip())
    for a in anims:
        if a not in ACTIONS:
            raise Fail(f"unknown animation {a!r}; known: {', '.join(ACTIONS)}")

    print(f"=== make_fighter: {args.slug} ===")
    print(f"  stages:     {' -> '.join(todo)}")
    print(f"  animations: {', '.join(anims)}")

    reports: dict[str, dict] = {}
    for stage in todo:
        print(f"\n[{stage}]")
        if stage == "sheet":
            stage_sheet(args.slug, args.sheet, args.crop)
        elif stage == "install":
            stage_install(args.slug)
        elif stage == "prep":
            stage_prep(args.slug)
        elif stage == "generate":
            reports = stage_generate(args.slug, anims, args.retries)
            summarise(args.slug, reports)
        elif stage == "pack":
            stage_pack(args.box)
        elif stage == "build":
            stage_build()

    print("\n=== done ===")
    if "build" in todo:
        print("  battlefi.sfc rebuilt - open it in Mesen or snes9x.")


if __name__ == "__main__":
    main()
