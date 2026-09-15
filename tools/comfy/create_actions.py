"""Generate punch/kick frames from locked idles via OpenPose ControlNet.

  python tools/comfy/create_actions.py --slug trump
  python tools/comfy/create_actions.py --slug carney
  python tools/comfy/create_actions.py --all
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image

from client import (
    DEFAULT_BASE,
    DEFAULT_LORA,
    ROOT,
    build_openpose_img2img,
    build_pose_txt2img,
    build_txt2img,
    collect_and_copy,
    queue_prompt,
    wait_prompt,
)
from create_fighter import build_negative, build_positive, load_traits
from pose_rig import render as render_pose

WF_DIR = ROOT / "art" / "comfy" / "workflows"
RAW = ROOT / "art" / "raw"
INP = Path.home() / "AppData/Local/Comfy-Desktop/ComfyUI-Shared/input"


ACTION_POSES = {
    "punch": (
        "Throwing a straight punch. The lead arm is COMPLETELY straight and horizontal, "
        "elbow locked, fist reaching far out beyond the body at shoulder height. "
        "Rear fist pulled back to the hip, torso twisted into the blow, weight on the front foot. "
        "Arm fully extended, not bent, not guarding."
    ),
    "kick": (
        "Mid roundhouse kick. One leg is raised and COMPLETELY straight out to the side at hip "
        "height, foot reaching far beyond the body. Supporting leg planted straight, "
        "arms out for balance. Leg fully extended, not bent, not standing."
    ),
}

# Framing is what makes a sprite sheet usable: every donor must show the whole
# fighter, feet included, or the fitted frames jump around the canvas.
DONOR_FRAMING = (
    "Full body from head to toe, both feet visible and planted on the ground, "
    "entire figure inside the frame with generous empty margin on all sides, "
    "no cropping, camera far back, whole body shot."
)


def ensure_authored_pose(action: str, size: int = 1024) -> str:
    """Draw the OpenPose map ourselves and drop it in Comfy's input dir.

    Beats generating a donor: asking the model for a "straight punch" reference
    returned a guard stance twice and a kick once, and every reroll costs a
    minute of GPU. An authored skeleton is exact and reproducible.
    """
    fname = f"authored_{action}.png"
    img = render_pose(action, size=size)
    img.save(INP / fname)
    local = ROOT / "art" / "comfy" / "poses" / fname
    local.parent.mkdir(parents=True, exist_ok=True)
    img.save(local)
    print(f"authored pose {fname}")
    return fname


def ensure_pose_donor(action: str, base: str, seed: int) -> str:
    """txt2img a generic side-view action donor; return Comfy input filename."""
    fname = f"pose_donor_{action}.png"
    out_local = RAW / "_pose_donors" / f"{action}_1024.png"
    out_local.parent.mkdir(parents=True, exist_ok=True)
    if out_local.exists() and Image.open(out_local).size == (1024, 1024):
        Image.open(out_local).save(INP / fname)
        print(f"reuse pose donor {fname}")
        return fname

    pos = (
        f"Full body side-view fighting game character facing right. {ACTION_POSES[action]} "
        f"{DONOR_FRAMING} "
        "Generic male fighter in a plain dark suit silhouette, clear limb read, "
        "chunky proportions, thick outline. "
        "Solid flat magenta background #FF00FF, no scenery, no text."
    )
    neg = (
        "photo, blurry, text, watermark, cropped limbs, missing feet, cut off, close-up, "
        "zoomed in, hands in pockets, idle standing, guard stance, fists at chest, "
        "bent arms, front view"
    )
    g = build_txt2img(
        positive=pos,
        negative=neg,
        prefix=f"bfi/pose_donor_{action}",
        seed=seed,
        lora=None,  # pose clarity first
        steps=28,
        cfg=5.0,
        width=1024,
        height=1024,
    )
    (WF_DIR / f"wf_pose_donor_{action}.json").write_text(json.dumps(g, indent=2) + "\n")
    print(f"queue pose donor {action}")
    pid = queue_prompt(base, g)
    entry = wait_prompt(base, pid, timeout_s=480)
    paths = collect_and_copy(base, entry, out_local.parent, f"{action}_1024")
    Image.open(paths[0]).convert("RGB").save(out_local)
    Image.open(paths[0]).convert("RGB").save(INP / fname)
    print(f"saved donor {out_local} {Image.open(out_local).size}")
    return fname


def run_action(
    slug: str,
    action: str,
    base: str,
    seed: int,
    control_net: str,
    denoise: float,
    control_strength: float,
    authored: bool = True,
) -> Path:
    traits = load_traits(slug)
    idle_ref = f"{slug}_idle_ref.png"
    if not (INP / idle_ref).exists():
        idle_src = RAW / slug / f"{slug}_idle_1024_01.png"
        if not idle_src.exists():
            raise SystemExit(f"Missing locked idle for {slug}: {idle_src}")
        Image.open(idle_src).convert("RGB").save(INP / idle_ref)

    if authored:
        pose_img = ensure_authored_pose(action)
    else:
        pose_img = ensure_pose_donor(action, base, seed=29000000 + (0 if action == "punch" else 1))
    # Reuse the exact template the locked idle was generated from, swapping only the
    # pose line. Same wording, same style clauses, same background instruction — that
    # template is all the identity an empty-latent render gets, so it has to carry it.
    action_traits = dict(traits)
    action_traits["idle_pose"] = f"{ACTION_POSES[action]} {DONOR_FRAMING}"
    pos = build_positive(action_traits)
    neg = (
        build_negative(traits)
        + ", hands in pockets, idle standing still, arms at sides, guard stance,"
        " cropped, cut off feet, close-up, zoomed in, two heads, extra limbs, extra arms,"
        # every one of these has actually come back from a run and had to be thrown away
        " boxing gloves, ground, floor, sand, dirt, grass, platform, stage,"
        " bare legs, shorts, shirtless, no jacket"
    )

    stem = f"{slug}_{action}"
    if authored:
        g = build_pose_txt2img(
            positive=pos,
            negative=neg,
            prefix=f"bfi/{stem}",
            seed=seed,
            pose_map_image=pose_img,
            control_strength=control_strength,
            control_net=control_net,
            lora=DEFAULT_LORA,
            lora_strength=0.85,  # match the idle's LoRA weight so the style lines up
        )
    else:
        g = build_openpose_img2img(
            positive=pos,
            negative=neg,
            prefix=f"bfi/{stem}",
            seed=seed,
            idle_image=idle_ref,
            pose_donor_image=pose_img,
            preprocess=not authored,
            denoise=denoise,
            control_strength=control_strength,
            control_end=1.0,
            control_net=control_net,
            lora=DEFAULT_LORA,
            lora_strength=0.65,
            steps=34,
            cfg=5.0,
        )
    WF_DIR.mkdir(parents=True, exist_ok=True)
    (WF_DIR / f"wf_{stem}.json").write_text(json.dumps(g, indent=2) + "\n")
    print(f"queue {stem} cn={control_net}")
    pid = queue_prompt(base, g)
    entry = wait_prompt(base, pid, timeout_s=600)
    if entry.get("status", {}).get("status_str") == "error":
        raise RuntimeError(entry.get("status"))
    dest = RAW / slug
    paths = collect_and_copy(base, entry, dest, f"{slug}_{action}_raw")
    # Pose preprocessor also saves a skeleton map (often 512²). Keep it for debugging —
    # a blank map means OpenPose found no body and the action frame will just be the idle.
    best = None
    for p in paths:
        with Image.open(p) as im:  # context manager: Windows will not rename an open file
            size = im.size
        print(f"  candidate {p.name} {size}")
        if size == (1024, 1024) and best is None:
            best = p
        else:
            p.replace(dest / f"{slug}_{action}_posemap{p.suffix}")
    if best is None:
        raise RuntimeError(f"No 1024 output for {slug} {action}: {paths}")
    canon = dest / f"{slug}_{action}_1024_01.png"
    with Image.open(best) as im:
        im.convert("RGB").save(canon)
    print(f"ACTION {slug} {action} -> {canon}")
    return canon


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--slug", help="trump | carney")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument(
        "--control-net",
        default="xinsir_xl_openpose.safetensors",
        help="OpenPose ControlNet filename in Comfy models/controlnet",
    )
    ap.add_argument("--seed", type=int, default=29800101)
    ap.add_argument(
        "--denoise",
        type=float,
        default=0.82,
        help="Below ~0.85 the idle latent keeps its own pose and ControlNet cannot move the limbs",
    )
    ap.add_argument("--control-strength", type=float, default=1.0)
    ap.add_argument(
        "--donor-pose",
        action="store_true",
        help="Generate a pose donor and run OpenPose on it, instead of the authored skeleton",
    )
    args = ap.parse_args()

    slugs = ["trump", "carney"] if args.all else [args.slug]
    if not slugs or slugs[0] is None:
        raise SystemExit("Pass --slug or --all")

    seed = args.seed
    for slug in slugs:
        for action in ("punch", "kick"):
            run_action(
                slug,
                action,
                args.base,
                seed,
                args.control_net,
                args.denoise,
                args.control_strength,
                authored=not args.donor_pose,
            )
            seed += 11
    print("done")


if __name__ == "__main__":
    main()
