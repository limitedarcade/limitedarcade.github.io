# CivitAI model data & verified image-prompting notes

Source project: **Battle for Independance** (SNES fighter asset pipeline).  
Local stack: Comfy Desktop → Juggernaut XL V8 + Pixel Art XL → downscale/remap → PVSnesLib.

This file records **what was pulled from CivitAI (and linked author guides)** plus **what we verified by actually generating** assets for this game. Speculative advice is marked; everything else was observed or quoted from the model pages.

---

## 1. Checkpoint — Juggernaut XL V8 + RunDiffusion

| Field | Value |
|-------|--------|
| CivitAI | https://civitai.com/models/133005?modelVersionId=288982 |
| Version label | V 8 + RunDiffusion |
| Local file | `juggernautXL_v8Rundiffusion.safetensors` |
| Type | Checkpoint (trained) |
| Base | SDXL 1.0 |
| Creator | KandooAI / RunDiffusion |
| Published (V8 page) | Jan 6, 2024 |
| Training steps (page) | 1,620,000 |
| Hash (page) | AutoV2 `AEB7E9E689` |
| VAE | Baked in (author: do not need a separate VAE) |
| Version focus (author blurb) | Hands, feet, skin details, photographic output |

### Author-recommended settings (from CivitAI version page)

| Setting | Author value |
|---------|----------------|
| Resolution | `832×1216` for portraits; **any SDXL res works** |
| Sampler | **DPM++ 2M SDE** (also commonly listed: DPM++ 2M Karras) |
| Steps | **30–40** |
| CFG | **3–6** (“less is a bit more realistic”) |
| Negative prompt | **Start with none**; only add what you do not want to see |
| HiRes (optional) | 4xNMKD-Siax_200k, 15 steps, denoise 0.3, ~1.5× upscale |

### Prompting guidance tied to Juggernaut (CivitAI + RunDiffusion guides)

Verified from the model page and RunDiffusion/Juggernaut prompting material linked from it:

1. **Natural language or tags both work**; keep prompts **concise**.
2. **First sentence matters most** — it sets the foundation for the image.
3. Useful structure: **subject → action/pose → environment → style/look → lighting → technical cues**.
4. Author preference on negatives: **minimal first**, then append failure modes (blur, text, bad anatomy, etc.) only as needed.
5. V8 is tuned toward **photographic / cinematic** output. Style LoRAs fight that bias; see §4.

Related public guides referenced from the Juggernaut ecosystem (not re-fetched line-by-line here):

- https://storage.googleapis.com/run-diffusion-public-assets/Prompting_Juggernaut_X.pdf  
- https://learn.rundiffusion.com/prompting-guide-for-juggernaut-x/  
- https://www.rundiffusion.com/juggernaut-xl-rundiffusion-guide  

---

## 2. LoRA — Pixel Art XL v1.1 (NeriJS)

| Field | Value |
|-------|--------|
| CivitAI | https://civitai.com/models/120096/pixel-art-xl |
| Version | v1.1 |
| Local file | `pixel-art-xl-v1.1.safetensors` |
| Type | LoRA (style) |
| Base | SDXL 1.0 |
| Creator | NeriJS |
| Size (page) | ~162.64 MB |
| Hash (page) | AutoV2 `BBF3D8DEFB` |
| Trigger word | **None** (author: no trigger required) |

### Author tips (verbatim intent from the CivitAI model page)

1. **Best results without using “pixel art” in the prompt** — the LoRA already pushes pixel style.
2. **No trigger keyword**.
3. **No style prompt required**.
4. **Don’t use the SDXL refiner**.
5. Works with one text encoder; works isometric and non-isometric; works with SDXL 0.9 / 1.0.
6. **Downscale 8× with nearest-neighbor** for pixel-perfect crunch (e.g. 1024 → 128).
7. Use a fixed VAE if you see artifacts (author notes 0.9 or fp16 fix); Juggernaut V8 has VAE baked in, so this mattered less for us.
8. Optional companion: [Astropulse PixelDetector](https://github.com/Astropulse/pixeldetector).

### Strength used in this project

- Default in client: **0.85** model + clip.
- Action img2img retries: tried **0.55–0.70** (still often failed to change pose; see §4).

---

## 3. ComfyUI settings we actually ran

Aligned to the CivitAI ranges above after reading the pages:

| Parameter | Value used |
|-----------|------------|
| Endpoint | `http://127.0.0.1:8188` (Comfy Desktop) |
| Checkpoint | `juggernautXL_v8Rundiffusion.safetensors` |
| LoRA | `pixel-art-xl-v1.1.safetensors` @ 0.85 (when enabled) |
| Sampler | `dpmpp_2m_sde` |
| Scheduler | `karras` |
| Steps | 32 (sometimes 34) |
| CFG | 5.0 |
| Fighter resolution | 1024×1024 |
| Stage resolution | 1024×576 |
| Sprite chroma intent | flat magenta `#FF00FF` (model often drifts; pipeline keys corners) |

Client: `tools/comfy/client.py`  
Prompt files: `art/comfy/prompts/*.txt`  
Workflow dumps: `art/comfy/workflows/wf_api_*.json`

---

## 4. Verified prompting lessons (from this project’s gens)

These are **empirical**, from comparing outputs under `art/raw/` and Comfy output history `…/ComfyUI-Shared/output/bfi/`.

### 4.1 Do not spam “pixel art” in the positive

Matches NeriJS’s CivitAI tip. Early prompts appended `pixel art xl, crisp pixel edges…`. After reading CivitAI we **removed** that suffix. Style still came from the LoRA.

### 4.2 Idle / standing characters + LoRA = strong

**Worked well** with Juggernaut + Pixel Art XL @ 0.85:

- Dutchie idle (smug, hands in pockets, orange tracksuit) — matched the reference screenshot closely.
- Tourist idle / punch (Hawaiian shirt, camera, sandals).
- Canal stage (brick houses, Dutch flag, cobbles, water, bikes).

### 4.3 Action poses fight the LoRA hard

**Repeated failure mode** with Pixel Art XL enabled:

- Prompts asked for punch / kick.
- Outputs stayed **idle / hands-in-pockets**, or produced nonsense (e.g. Dutchie holding a second Dutchie like a puppet).
- img2img from the good idle (`denoise` 0.62 → 0.65 → 0.82 → 0.85, LoRA 0.55–0.70) **preserved identity** but **would not commit** to a kick/punch.

**What finally produced a real punch:**

- **Same punch prompt, Juggernaut only (`lora=None`)**, seed `28083111`.
- Result: clear extended punching arm (more painted than chunky-pixel, but remappable).

**Kick:** best usable frame was an **early txt2img** (`dutchie_kick_00001_` in Comfy history). Later LoRA/img2img runs regressed to idle; we restored the early file.

### 4.4 Lead with the action verb

After CivitAI/Juggernaut “first sentence wins” guidance, punch/kick prompts were rewritten to **start with the action**:

- Good pattern: `Throwing a powerful straight punch, right arm fully extended forward…`
- Then identity / costume / “ONE single character only” / background.

This helped more once LoRA was off for action; with LoRA on, verb-first alone was not enough.

### 4.5 Negatives: short lists beat novels

Author tip (Juggernaut): start empty, add only blockers.

**Sprite negatives we settled on** (short):

```text
photo, photorealistic, blurry, soft focus, ground shadow, cast shadow,
text, watermark, ui, logo, top-down view, isometric, front view facing camera,
multiple characters, cropped limbs, missing feet, cut off head, purple background
```

For action retries we added: `hands in pockets, idle pose, standing still` (and for punch: `puppet, second character, clone`).

**Stage negatives:** no foreground fighters, no UI/health bars, no text.

### 4.6 Background / chroma key is unreliable

- Prompted solid magenta `#FF00FF`.
- Comfy often returned magenta, pink, gray, purple, or near-black (especially no-LoRA punch).
- Pipeline **must** detect key from corners (`remap.detect_key_from_corners`) rather than assuming exact `#FF00FF`.

### 4.7 “ONE single character only” is load-bearing

Without it, punch gens duplicated Dutchie. Explicit single-character language reduced (but did not eliminate) multi-subject failures.

### 4.8 Side-view fighting-game framing

Asking for **pure side view facing right, full body head-to-toe, centered with padding** improved fighter usability vs three-quarter / front-facing tourist drafts.

### 4.9 Generate large, crunch later

Aligned with both Pixel Art XL (8× nearest) and this repo’s SNES pipeline:

1. Generate at **1024** (never ask the model for native 16×16 / 64×64).
2. Fit / crop subject.
3. Nearest-neighbor downscale (128 → 64 for fighters).
4. Remap to a locked 16-color Color Bible row.
5. `gfx4snes` → ROM.

---

## 5. Prompt templates that shipped

Paths under `art/comfy/prompts/`. Shape used after CivitAI pass:

### Fighter (LoRA on — idle / non-action)

```text
Full body side view fighting game character facing right, <pose>.
<Name / identity + costume details>.
Chunky SNES fighter silhouette, thick dark outline, flat cel shading,
full body head to toes, centered with padding.
Solid flat magenta #FF00FF background, no floor, no shadow, no scenery, no text.
```

**Do not** append `pixel art` when Pixel Art XL is loaded.

### Fighter action (prefer LoRA off if pose collapses)

```text
<Verb-led action>, <limb fully extended>, classic fighting game attack frame.
ONE single <character> only, side view facing right: <costume>.
Chunky SNES fighter sprite, thick dark outline, flat cel shading,
full body head to toes, centered with padding.
Solid flat magenta #FF00FF background, no floor, no shadow, no scenery, no text.
```

### Stage

```text
Wide SNES fighting game stage background, empty arena, no characters.
<Location description, floor in lower third clear for fighters>.
Chunky 16-bit saturated environment, classic Street Fighter II stage composition.
No player characters, no UI, no health bars, no text.
```

---

## 6. Decision table (what to use when)

| Goal | Checkpoint | Pixel Art XL | Notes |
|------|------------|--------------|--------|
| Idle fighter sprite | Juggernaut V8 | On @ ~0.85 | No “pixel art” in prompt |
| Stage / environment | Juggernaut V8 | On @ ~0.85 | 1024×576 worked |
| Attack / kick / punch pose | Juggernaut V8 | **Off** if LoRA sticks to idle | Verb-first prompt |
| Identity lock + small pose nudge | Juggernaut V8 | Optional low | img2img; high denoise still may not break idle |
| SNES-ready pixels | — | — | Always 1024 → nearest downscale → palette remap |

---

## 7. Sources

| Source | URL / path | Used for |
|--------|------------|----------|
| Juggernaut XL V8 CivitAI | https://civitai.com/models/133005?modelVersionId=288982 | Settings, VAE, negatives policy, version focus |
| Pixel Art XL CivitAI | https://civitai.com/models/120096/pixel-art-xl | No-trigger, no “pixel art” in prompt, 8× downscale, no refiner |
| RunDiffusion Juggernaut guides | linked from CivitAI / RunDiffusion | Prompt structure, first-sentence weight, CFG/steps culture |
| Local Comfy runs | `art/raw/**`, Comfy `output/bfi/*` | Pose/LoRA failure modes, punch-without-LoRA success |
| Project client | `tools/comfy/client.py` | Exact sampler/CFG/steps/LoRA wiring |

---

## 8. Related project docs

- `docs/comfy-model-notes.md` — shorter operator cheat sheet  
- `docs/color-bible/` — SNES 16-slot palette authority after generation  
- `README.md` — full generate → remap → ROM build flow  

---

*Last updated from the Battle for Independance asset session (ComfyUI 0.34.x, Juggernaut V8 + Pixel Art XL v1.1).*
