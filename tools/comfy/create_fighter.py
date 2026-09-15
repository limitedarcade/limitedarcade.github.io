"""Create satirical Street Fighter character options via ComfyUI (1024-native).

Examples:
  python tools/comfy/create_fighter.py --slug trump --count 6
  python tools/comfy/create_fighter.py --slug trump --lock options/trump_opt03_01.png
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

from client import (
    DEFAULT_BASE,
    DEFAULT_CKPT,
    DEFAULT_LORA,
    NEG_SPRITE,
    ROOT,
    build_img2img,
    build_txt2img,
    collect_and_copy,
    queue_prompt,
    wait_prompt,
)

CHARS_DIR = ROOT / "art" / "comfy" / "characters"
PROMPTS_DIR = ROOT / "art" / "comfy" / "prompts"
REFS_DIR = ROOT / "art" / "comfy" / "refs"
RAW_DIR = ROOT / "art" / "raw"
WF_DIR = ROOT / "art" / "comfy" / "workflows"
MANIFEST = ROOT / "art" / "comfy" / "characters" / "manifest.json"


def load_traits(slug: str) -> dict:
    path = CHARS_DIR / f"{slug}.traits.json"
    if not path.exists():
        raise SystemExit(f"Missing traits sheet: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def build_positive(traits: dict) -> str:
    trait_line = "; ".join(traits["traits"])
    pose = traits.get("idle_pose", "idle fighting stance, side view facing right")
    return (
        f"Full body side-view Street Fighter character sprite facing right, {pose}.\n"
        f"Satirical arcade boss caricature of {traits['display_name']}: {trait_line}.\n"
        "Chunky 16-bit SNES fighter proportions, oversized readable silhouette, "
        "thick dark outline, flat cel shading, limited saturated palette, "
        "head to toe visible, centered with padding.\n"
        "Solid flat magenta background #FF00FF, no floor, no shadow, no scenery, "
        "no text, no watermark, no photo."
    )


def build_negative(traits: dict) -> str:
    forbid = ", ".join(traits.get("forbid", []))
    return (
        f"{NEG_SPRITE}, different character, wrong outfit, {forbid}"
    )


def ensure_1024_ref(src: Path, dest_name: str) -> str:
    """Return Comfy input filename; writes 1024² magenta-padded RGB."""
    im = Image.open(src).convert("RGB")
    w, h = im.size
    scale = min(960 / max(w, 1), 960 / max(h, 1))
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    scaled = im.resize((nw, nh), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1024, 1024), (255, 0, 255))
    canvas.paste(scaled, ((1024 - nw) // 2, (1024 - nh) // 2))
    out_refs = REFS_DIR / dest_name
    inp = Path.home() / "AppData/Local/Comfy-Desktop/ComfyUI-Shared/input" / dest_name
    out_refs.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out_refs)
    canvas.save(inp)
    print(f"ref 1024 {out_refs} from {src.name} ({w}x{h})")
    return dest_name


def save_prompt(slug: str, text: str) -> Path:
    PROMPTS_DIR.mkdir(parents=True, exist_ok=True)
    path = PROMPTS_DIR / f"{slug}_idle.txt"
    path.write_text(text.strip() + "\n", encoding="utf-8")
    return path


def generate_options(traits: dict, count: int, seed: int, base: str) -> list[Path]:
    slug = traits["slug"]
    pos = build_positive(traits)
    neg = build_negative(traits)
    save_prompt(slug, pos)
    WF_DIR.mkdir(parents=True, exist_ok=True)
    out_dir = RAW_DIR / slug / "options"
    out_dir.mkdir(parents=True, exist_ok=True)

    ref_path = None
    if traits.get("reference"):
        rp = ROOT / traits["reference"]
        if rp.exists():
            ref_path = ensure_1024_ref(rp, f"{slug}_satire_1024.png")

    saved: list[Path] = []
    # Mix: half img2img from satire ref (if any), half txt2img
    for i in range(count):
        n = i + 1
        stem = f"{slug}_opt{n:02d}"
        this_seed = seed + i
        use_i2i = bool(ref_path) and i < max(2, count // 2)
        if use_i2i:
            denoise = 0.40 + i * 0.06
            graph = build_img2img(
                positive=pos,
                negative=neg,
                prefix=f"bfi/{stem}",
                seed=this_seed,
                image_name=ref_path,
                denoise=min(denoise, 0.65),
                lora=DEFAULT_LORA,
                lora_strength=0.55 + i * 0.05,
                steps=34,
                cfg=5.0,
                width=1024,
                height=1024,
            )
            mode = f"img2img d={min(denoise, 0.65):.2f}"
        else:
            graph = build_txt2img(
                positive=pos,
                negative=neg,
                prefix=f"bfi/{stem}",
                seed=this_seed,
                ckpt=DEFAULT_CKPT,
                lora=DEFAULT_LORA,
                lora_strength=0.85,
                steps=34,
                cfg=5.0,
                width=1024,
                height=1024,
            )
            mode = "txt2img"
        (WF_DIR / f"wf_{stem}.json").write_text(json.dumps(graph, indent=2) + "\n", encoding="utf-8")
        print(f"queue {stem} {mode} seed={this_seed}")
        pid = queue_prompt(base, graph)
        entry = wait_prompt(base, pid, timeout_s=600)
        if entry.get("status", {}).get("status_str") == "error":
            raise RuntimeError(entry.get("status"))
        paths = collect_and_copy(base, entry, out_dir, stem)
        for p in paths:
            im = Image.open(p)
            print(f"  saved {p.name} {im.size}")
            if im.size != (1024, 1024):
                raise RuntimeError(f"{p} is {im.size}, expected 1024x1024")
            saved.append(p)
    return saved


def lock_option(traits: dict, rel: str) -> Path:
    slug = traits["slug"]
    src = RAW_DIR / slug / rel
    if not src.exists():
        # also allow bare filename under options/
        alt = RAW_DIR / slug / "options" / Path(rel).name
        src = alt if alt.exists() else src
    if not src.exists():
        raise SystemExit(f"Cannot lock missing file: {src}")
    im = Image.open(src)
    if im.size != (1024, 1024):
        raise SystemExit(f"Refusing to lock non-1024 image: {im.size}")

    raw_dir = RAW_DIR / slug
    raw_dir.mkdir(parents=True, exist_ok=True)
    idle = raw_dir / f"{slug}_idle_1024_01.png"
    master = REFS_DIR / f"{slug}_idle_master_1024.png"
    Image.open(src).convert("RGB").save(idle)
    Image.open(src).convert("RGB").save(master)

    # Comfy input for later ControlNet
    inp = Path.home() / "AppData/Local/Comfy-Desktop/ComfyUI-Shared/input" / f"{slug}_idle_ref.png"
    Image.open(src).convert("RGB").save(inp)

    meta = {
        "slug": slug,
        "display_name": traits["display_name"],
        "locked_idle": str(idle.relative_to(ROOT)).replace("\\", "/"),
        "source_option": str(src.relative_to(ROOT)).replace("\\", "/"),
        "locked_at": datetime.now(timezone.utc).isoformat(),
        "traits": traits,
    }
    (CHARS_DIR / f"{slug}.locked.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    man = {}
    if MANIFEST.exists():
        man = json.loads(MANIFEST.read_text(encoding="utf-8"))
    man[slug] = meta
    MANIFEST.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")
    print(f"LOCKED {slug} -> {idle}")
    return idle


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--slug", required=True)
    ap.add_argument("--count", type=int, default=6)
    ap.add_argument("--seed", type=int, default=29500001)
    ap.add_argument("--base", default=DEFAULT_BASE)
    ap.add_argument("--lock", help="Relative path under art/raw/<slug>/ to lock as idle")
    ap.add_argument("--ref", help="Override reference image path")
    args = ap.parse_args()

    traits = load_traits(args.slug)
    if args.ref:
        traits["reference"] = str(Path(args.ref).resolve().relative_to(ROOT)).replace("\\", "/")

    if args.lock:
        lock_option(traits, args.lock)
        return

    print("=== fighter create ===")
    print("slug:", traits["slug"], "|", traits["display_name"])
    print("traits:", "; ".join(traits["traits"]))
    paths = generate_options(traits, args.count, args.seed, args.base)
    print("\nOPTIONS (QA each against satire reference before locking):")
    for p in paths:
        print(" ", p.relative_to(ROOT))
    print(f"\nLock with:\n  python tools/comfy/create_fighter.py --slug {args.slug} --lock options/<file>.png")


if __name__ == "__main__":
    main()
