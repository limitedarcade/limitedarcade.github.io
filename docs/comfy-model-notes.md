# ComfyUI model notes (from CivitAI)

Full write-up (CivitAI page data + verified prompting lessons):
**[`civitai-prompting-guide.md`](./civitai-prompting-guide.md)**

## Checkpoint: Juggernaut XL V8 + RunDiffusion

- CivitAI: https://civitai.com/models/133005?modelVersionId=288982
- File: `juggernautXL_v8Rundiffusion.safetensors`
- Base: SDXL 1.0, VAE baked in
- Focus: hands, feet, skin detail, photographic output

### Recommended settings (author)

| Setting | Value |
|--------|--------|
| Sampler | DPM++ 2M SDE (or DPM++ 2M Karras) |
| Steps | 30–40 |
| CFG | 3–6 (lower = more realistic) |
| Resolution | any SDXL res (1024² / 832×1216 / 1216×832) |
| Negatives | start empty; only add what you do **not** want |

### Prompting

- Natural language or tags both work; keep prompts concise.
- Structure: subject → action/pose → setting → style cues → lighting.
- First sentence carries the most weight.

## LoRA: Pixel Art XL v1.1 (NeriJS)

- CivitAI: https://civitai.com/models/120096/pixel-art-xl
- File: `pixel-art-xl-v1.1.safetensors`
- Strength used here: ~0.85

### Author tips (critical)

1. **Best results without putting “pixel art” in the prompt** — the LoRA already forces the style.
2. No trigger keyword.
3. No style prompt required.
4. Don’t use the SDXL refiner.
5. Downscale **8× with nearest-neighbor** for pixel-perfect crunch (1024 → 128), then remap.
6. Pair with Astropulse PixelDetector when cleaning sprites (optional).

## Pipeline for this game

1. Generate at 1024 (fighters square / stage 1024×576) with Juggernaut + Pixel Art XL.
2. Positive prompts describe the subject only — no “pixel art xl” spam.
3. Negatives stay short: photo, blur, text, UI, wrong camera, scenery under sprites.
4. Downscale + Color Bible remap → SNES 16-color assets.

## What worked in practice

| Asset | Approach |
|-------|----------|
| Dutchie idle / Tourist / Canal stage | Juggernaut V8 + Pixel Art XL @ strength 0.85 |
| Dutchie punch (action pose) | **Juggernaut alone (no LoRA)** — Pixel Art XL kept collapsing to idle/hands-in-pockets |
| Dutchie kick | Best early txt2img result; later LoRA runs failed to keep the kick |
| Sampler / CFG / steps | `dpmpp_2m_sde`, CFG **5**, **32–34** steps (CivitAI V8 range) |

Action poses: lead the prompt with the verb (“Throwing a powerful straight punch…”), keep “ONE single character”, and drop the pixel LoRA if the pose won’t commit.
