"""ComfyUI HTTP client for Battle for Independance asset generation."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_BASE = "http://127.0.0.1:8188"
DEFAULT_CKPT = "juggernautXL_v8Rundiffusion.safetensors"
DEFAULT_LORA = "pixel-art-xl-v1.1.safetensors"
OUTPUT_HINT = Path.home() / "AppData/Local/Comfy-Desktop/ComfyUI-Shared/output"

# Juggernaut author tip: start minimal; only negate what must not appear.
# Pixel Art XL tip: do NOT put "pixel art" in the positive — LoRA handles style.
NEG_SPRITE = (
    "photo, photorealistic, blurry, soft focus, ground shadow, cast shadow, "
    "text, watermark, ui, logo, top-down view, isometric, front view facing camera, "
    "multiple characters, cropped limbs, missing feet, cut off head, purple background"
)

NEG_STAGE = (
    "photo, photorealistic, blurry, characters, fighters, people in foreground, "
    "UI, health bars, text, watermark, empty void, sprite sheet, top-down view"
)


def api(base: str, path: str, data: dict | None = None):
    url = base.rstrip("/") + path
    body = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode("utf-8")
        if not raw:
            return {}
        return json.loads(raw)


def _wire_model_clip(graph: dict, ckpt: str, lora: str | None, lora_strength: float):
    graph["1"] = {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": ckpt},
    }
    if lora:
        graph["2"] = {
            "class_type": "LoraLoader",
            "inputs": {
                "model": ["1", 0],
                "clip": ["1", 1],
                "lora_name": lora,
                "strength_model": lora_strength,
                "strength_clip": lora_strength,
            },
        }
        return ["2", 0], ["2", 1]
    return ["1", 0], ["1", 1]


def build_txt2img(
    *,
    positive: str,
    negative: str,
    prefix: str,
    seed: int,
    ckpt: str = DEFAULT_CKPT,
    lora: str | None = DEFAULT_LORA,
    lora_strength: float = 0.85,
    width: int = 1024,
    height: int = 1024,
    steps: int = 32,
    cfg: float = 5.0,
    sampler: str = "dpmpp_2m_sde",
    scheduler: str = "karras",
) -> dict:
    graph: dict = {
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": width, "height": height, "batch_size": 1},
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["1", 2]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["8", 0], "filename_prefix": prefix},
        },
    }
    model_ref, clip_ref = _wire_model_clip(graph, ckpt, lora, lora_strength)
    graph["6"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": positive, "clip": clip_ref},
    }
    graph["7"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": negative, "clip": clip_ref},
    }
    graph["3"] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": seed,
            "steps": steps,
            "cfg": cfg,
            "sampler_name": sampler,
            "scheduler": scheduler,
            "denoise": 1.0,
            "model": model_ref,
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["5", 0],
        },
    }
    return graph


def build_pose_txt2img(
    *,
    positive: str,
    negative: str,
    prefix: str,
    seed: int,
    pose_map_image: str,
    control_strength: float = 1.0,
    control_end: float = 1.0,
    control_net: str = "xinsir_xl_openpose.safetensors",
    ckpt: str = DEFAULT_CKPT,
    lora: str | None = DEFAULT_LORA,
    lora_strength: float = 0.85,
    width: int = 1024,
    height: int = 1024,
    steps: int = 32,
    cfg: float = 5.0,
    sampler: str = "dpmpp_2m_sde",
    scheduler: str = "karras",
) -> dict:
    """Pose from an authored OpenPose map, identity from the prompt. No idle latent.

    This is the only wiring that actually moves the limbs. Encoding the locked idle
    and denoising it (build_openpose_img2img) keeps the idle's composition at every
    denoise worth using — the ControlNet loses, and every "attack" frame comes back
    as the idle stance in slightly different shading. From an empty latent the same
    ControlNet and the same map reproduce the authored pose exactly.
    """
    graph = build_txt2img(
        positive=positive,
        negative=negative,
        prefix=prefix,
        seed=seed,
        ckpt=ckpt,
        lora=lora,
        lora_strength=lora_strength,
        width=width,
        height=height,
        steps=steps,
        cfg=cfg,
        sampler=sampler,
        scheduler=scheduler,
    )
    graph["13"] = {"class_type": "LoadImage", "inputs": {"image": pose_map_image}}
    graph["14"] = {
        "class_type": "ImageScale",
        "inputs": {
            "image": ["13", 0],
            "upscale_method": "lanczos",
            "width": width,
            "height": height,
            "crop": "center",
        },
    }
    graph["21"] = {"class_type": "ControlNetLoader", "inputs": {"control_net_name": control_net}}
    graph["22"] = {
        "class_type": "ControlNetApplyAdvanced",
        "inputs": {
            "positive": ["6", 0],
            "negative": ["7", 0],
            "control_net": ["21", 0],
            "image": ["14", 0],
            "strength": control_strength,
            "start_percent": 0.0,
            "end_percent": control_end,
        },
    }
    graph["3"]["inputs"]["positive"] = ["22", 0]
    graph["3"]["inputs"]["negative"] = ["22", 1]
    return graph


def build_img2img(
    *,
    positive: str,
    negative: str,
    prefix: str,
    seed: int,
    image_name: str,
    denoise: float = 0.62,
    ckpt: str = DEFAULT_CKPT,
    lora: str | None = DEFAULT_LORA,
    lora_strength: float = 0.7,
    steps: int = 32,
    cfg: float = 5.0,
    sampler: str = "dpmpp_2m_sde",
    scheduler: str = "karras",
    width: int = 1024,
    height: int = 1024,
) -> dict:
    """img2img for SDXL — ALWAYS scale input to width×height (default 1024²).

    Comfy VAEEncode keeps the source tensor size. Feeding a 161×257 photo
    yields 160×256 output; useless on a 1024-class checkpoint.
    """
    graph: dict = {
        "10": {
            "class_type": "LoadImage",
            "inputs": {"image": image_name},
        },
        # Force SDXL native size before encode (truths.md §15).
        "12": {
            "class_type": "ImageScale",
            "inputs": {
                "image": ["10", 0],
                "upscale_method": "lanczos",
                "width": width,
                "height": height,
                "crop": "center",
            },
        },
        "11": {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["12", 0], "vae": ["1", 2]},
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["1", 2]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["8", 0], "filename_prefix": prefix},
        },
    }
    model_ref, clip_ref = _wire_model_clip(graph, ckpt, lora, lora_strength)
    graph["6"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": positive, "clip": clip_ref},
    }
    graph["7"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": negative, "clip": clip_ref},
    }
    graph["3"] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": seed,
            "steps": steps,
            "cfg": cfg,
            "sampler_name": sampler,
            "scheduler": scheduler,
            "denoise": denoise,
            "model": model_ref,
            "positive": ["6", 0],
            "negative": ["7", 0],
            "latent_image": ["11", 0],
        },
    }
    return graph


def build_openpose_img2img(
    *,
    positive: str,
    negative: str,
    prefix: str,
    seed: int,
    idle_image: str,
    pose_donor_image: str,
    denoise: float = 0.55,
    control_strength: float = 0.85,
    control_end: float = 0.9,
    preprocess: bool = True,
    control_net: str = "thibaud_xl_openpose_256lora.safetensors",
    ckpt: str = DEFAULT_CKPT,
    lora: str | None = DEFAULT_LORA,
    lora_strength: float = 0.7,
    steps: int = 34,
    cfg: float = 5.0,
    sampler: str = "dpmpp_2m_sde",
    scheduler: str = "karras",
    width: int = 1024,
    height: int = 1024,
) -> dict:
    """Identity from idle + pose from donor via OpenPose ControlNet (SDXL 1024).

    With preprocess=False the second image is taken to be an OpenPose map already
    (see pose_rig.py) and fed to the ControlNet as-is — no detector in the loop,
    so the pose is exactly what was authored.
    """
    graph: dict = {
        "10": {"class_type": "LoadImage", "inputs": {"image": idle_image}},
        "13": {"class_type": "LoadImage", "inputs": {"image": pose_donor_image}},
        "12": {
            "class_type": "ImageScale",
            "inputs": {
                "image": ["10", 0],
                "upscale_method": "lanczos",
                "width": width,
                "height": height,
                "crop": "center",
            },
        },
        "14": {
            "class_type": "ImageScale",
            "inputs": {
                "image": ["13", 0],
                "upscale_method": "lanczos",
                "width": width,
                "height": height,
                "crop": "center",
            },
        },
        # replaced by a direct wire when preprocess=False
        "20": {
            "class_type": "OpenposePreprocessor",
            "inputs": {
                "image": ["14", 0],
                "detect_hand": "enable",
                "detect_body": "enable",
                "detect_face": "disable",
                "resolution": 512,
                "scale_stick_for_xinsr_cn": "enable"
                if "xinsir" in control_net
                else "disable",
            },
        },
        "21": {
            "class_type": "ControlNetLoader",
            "inputs": {"control_net_name": control_net},
        },
        "11": {
            "class_type": "VAEEncode",
            "inputs": {"pixels": ["12", 0], "vae": ["1", 2]},
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["1", 2]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["8", 0], "filename_prefix": prefix},
        },
        "19": {
            "class_type": "SaveImage",
            "inputs": {"images": ["20", 0], "filename_prefix": prefix + "_pose"},
        },
    }
    pose_ref = ["20", 0]
    if not preprocess:
        # The map was authored locally, so there is nothing to detect and nothing
        # worth saving back. Dropping the sidecar also leaves exactly one output
        # image, so callers cannot mistake the skeleton for the character frame.
        del graph["20"]
        del graph["19"]
        pose_ref = ["14", 0]
    model_ref, clip_ref = _wire_model_clip(graph, ckpt, lora, lora_strength)
    graph["6"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": positive, "clip": clip_ref},
    }
    graph["7"] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"text": negative, "clip": clip_ref},
    }
    graph["22"] = {
        "class_type": "ControlNetApplyAdvanced",
        "inputs": {
            "positive": ["6", 0],
            "negative": ["7", 0],
            "control_net": ["21", 0],
            "image": pose_ref,
            "strength": control_strength,
            "start_percent": 0.0,
            "end_percent": control_end,
            "vae": ["1", 2],
        },
    }
    graph["3"] = {
        "class_type": "KSampler",
        "inputs": {
            "seed": seed,
            "steps": steps,
            "cfg": cfg,
            "sampler_name": sampler,
            "scheduler": scheduler,
            "denoise": denoise,
            "model": model_ref,
            "positive": ["22", 0],
            "negative": ["22", 1],
            "latent_image": ["11", 0],
        },
    }
    return graph


def queue_prompt(base: str, graph: dict, client_id: str | None = None) -> str:
    client_id = client_id or str(uuid.uuid4())
    result = api(base, "/prompt", {"prompt": graph, "client_id": client_id})
    if "error" in result:
        raise RuntimeError(result)
    return str(result["prompt_id"])


def wait_prompt(base: str, prompt_id: str, timeout_s: float = 600.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        hist = api(base, f"/history/{prompt_id}")
        if isinstance(hist, dict) and prompt_id in hist:
            return hist[prompt_id]
        time.sleep(2.0)
    raise TimeoutError(f"ComfyUI prompt {prompt_id} timed out after {timeout_s}s")


def download_image(base: str, filename: str, subfolder: str, img_type: str, dest: Path) -> Path:
    qs = urllib.parse.urlencode(
        {"filename": filename, "subfolder": subfolder, "type": img_type}
    )
    url = f"{base.rstrip('/')}/view?{qs}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=120) as resp:
        dest.write_bytes(resp.read())
    return dest


def collect_and_copy(base: str, history_entry: dict, dest_dir: Path, stem: str) -> list[Path]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    copied: list[Path] = []
    outputs = history_entry.get("outputs", {})
    idx = 0
    for node_out in outputs.values():
        for img in node_out.get("images", []):
            idx += 1
            suffix = Path(img["filename"]).suffix or ".png"
            dest = dest_dir / f"{stem}_{idx:02d}{suffix}"
            download_image(
                base,
                img["filename"],
                img.get("subfolder") or "",
                img.get("type") or "output",
                dest,
            )
            copied.append(dest)
    return copied


def load_prompt_file(name: str) -> str:
    path = ROOT / "art" / "comfy" / "prompts" / name
    return path.read_text(encoding="utf-8").strip()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default=DEFAULT_BASE)
    parser.add_argument(
        "--job",
        choices=[
            "dutchie_idle",
            "dutchie_punch",
            "dutchie_kick",
            "tourist_idle",
            "tourist_punch",
            "canal_stage",
            "fighters",
            "actions",
            "all",
        ],
        default="all",
    )
    parser.add_argument("--seed", type=int, default=28082601)
    parser.add_argument("--ckpt", default=DEFAULT_CKPT)
    parser.add_argument("--lora", default=DEFAULT_LORA)
    parser.add_argument("--no-lora", action="store_true")
    parser.add_argument("--timeout", type=float, default=900.0)
    parser.add_argument("--denoise", type=float, default=0.62)
    args = parser.parse_args()

    lora = None if args.no_lora else args.lora
    jobs = {
        "dutchie_idle": (
            "dutchie_idle.txt",
            "bfi/dutchie_idle",
            ROOT / "art" / "raw" / "dutchie",
            "dutchie_idle_1024",
            args.seed,
            False,
        ),
        "dutchie_punch": (
            "dutchie_punch.txt",
            "bfi/dutchie_punch",
            ROOT / "art" / "raw" / "dutchie",
            "dutchie_punch_1024",
            args.seed + 1,
            False,
        ),
        "dutchie_kick": (
            "dutchie_kick.txt",
            "bfi/dutchie_kick",
            ROOT / "art" / "raw" / "dutchie",
            "dutchie_kick_1024",
            args.seed + 2,
            False,
        ),
        "tourist_idle": (
            "tourist_idle.txt",
            "bfi/tourist_idle",
            ROOT / "art" / "raw" / "tourist",
            "tourist_idle_1024",
            args.seed + 10,
            False,
        ),
        "tourist_punch": (
            "tourist_punch.txt",
            "bfi/tourist_punch",
            ROOT / "art" / "raw" / "tourist",
            "tourist_punch_1024",
            args.seed + 11,
            False,
        ),
        "canal_stage": (
            "canal_stage.txt",
            "bfi/canal_stage",
            ROOT / "art" / "raw" / "canal_stage",
            "canal_stage_1024",
            args.seed + 20,
            True,
        ),
    }

    # img2img action jobs keep character identity from idle refs
    action_jobs = {
        "dutchie_punch": ("dutchie_punch.txt", "dutchie_idle_ref.png", "bfi/dutchie_punch", ROOT / "art" / "raw" / "dutchie", "dutchie_punch_1024", args.seed + 101),
        "dutchie_kick": ("dutchie_kick.txt", "dutchie_idle_ref.png", "bfi/dutchie_kick", ROOT / "art" / "raw" / "dutchie", "dutchie_kick_1024", args.seed + 102),
        "tourist_punch": ("tourist_punch.txt", "tourist_idle_ref.png", "bfi/tourist_punch", ROOT / "art" / "raw" / "tourist", "tourist_punch_1024", args.seed + 111),
    }

    if args.job == "all":
        selected = list(jobs.keys())
        use_actions = False
    elif args.job == "fighters":
        selected = [k for k in jobs if k != "canal_stage"]
        use_actions = False
    elif args.job == "actions":
        selected = list(action_jobs.keys())
        use_actions = True
    else:
        selected = [args.job]
        use_actions = args.job in ("dutchie_punch", "dutchie_kick", "tourist_punch")

    try:
        stats = api(args.base, "/system_stats")
        print("ComfyUI", stats.get("system", {}).get("comfyui_version"), "ok")
    except urllib.error.URLError as e:
        raise SystemExit(f"ComfyUI not reachable at {args.base}: {e}") from e

    workflow_dir = ROOT / "art" / "comfy" / "workflows"
    workflow_dir.mkdir(parents=True, exist_ok=True)

    for key in selected:
        if use_actions and key in action_jobs:
            prompt_file, ref_img, prefix, dest_dir, stem, seed = action_jobs[key]
            positive = load_prompt_file(prompt_file)
            negative = NEG_SPRITE + ", hands in pockets, idle pose, standing still"
            graph = build_img2img(
                positive=positive,
                negative=negative,
                prefix=prefix,
                seed=seed,
                image_name=ref_img,
                denoise=args.denoise,
                ckpt=args.ckpt,
                lora=lora,
                lora_strength=0.7,
                steps=32,
                cfg=5.0,
            )
            print(f"queued img2img {key} denoise={args.denoise} ref={ref_img}")
        else:
            prompt_file, prefix, dest_dir, stem, seed, is_stage = jobs[key]
            positive = load_prompt_file(prompt_file)
            # Pixel Art XL (CivitAI): best results WITHOUT "pixel art" in the prompt.
            # Juggernaut V8: CFG 3-6, steps 30-40, DPM++ 2M SDE, minimal negatives.
            if is_stage:
                negative = NEG_STAGE
                width, height = 1024, 576
            else:
                negative = NEG_SPRITE
                width, height = 1024, 1024

            graph = build_txt2img(
                positive=positive,
                negative=negative,
                prefix=prefix,
                seed=seed,
                ckpt=args.ckpt,
                lora=lora,
                lora_strength=0.85,
                width=width,
                height=height,
                steps=32,
                cfg=5.0,
                sampler="dpmpp_2m_sde",
                scheduler="karras",
            )
            print(f"queued {key} seed={seed} {width}x{height}")

        wf_path = workflow_dir / f"wf_api_{key}.json"
        wf_path.write_text(json.dumps(graph, indent=2) + "\n", encoding="utf-8")
        prompt_id = queue_prompt(args.base, graph)
        print(f"  prompt_id={prompt_id}")
        entry = wait_prompt(args.base, prompt_id, timeout_s=args.timeout)
        status = entry.get("status", {})
        if status.get("status_str") == "error" or status.get("completed") is False:
            raise RuntimeError(f"{key} failed: {json.dumps(status)[:1000]}")
        copied = collect_and_copy(args.base, entry, dest_dir, stem)
        if not copied:
            raise RuntimeError(f"{key}: finished but no images in history outputs")
        for p in copied:
            print(f"  saved {p}")


if __name__ == "__main__":
    main()
