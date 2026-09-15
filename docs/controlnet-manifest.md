# ControlNet install manifest

Downloaded into Comfy Desktop shared models:

`%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Shared\models\controlnet\`

Verified visible to `ControlNetLoader` via `http://127.0.0.1:8188/object_info` (no restart required for weights).

| File | Role | Source | ~Size |
|------|------|--------|-------|
| `thibaud_xl_openpose.safetensors` | SDXL OpenPose ControlNet (primary classic) | [lllyasviel/sd_control_collection](https://huggingface.co/lllyasviel/sd_control_collection) ← thibaud | 2.4 GB |
| `thibaud_xl_openpose_256lora.safetensors` | Lighter OpenPose Control-LoRA (8 GB VRAM friendly) | same collection | 0.74 GB |
| `xinsir_xl_openpose.safetensors` | SDXL OpenPose often ranked strong for pose fidelity | [xinsir/controlnet-openpose-sdxl-1.0](https://huggingface.co/xinsir/controlnet-openpose-sdxl-1.0) (`diffusion_pytorch_model.safetensors` renamed) | 2.4 GB |
| `diffusers_xl_canny_mid.safetensors` | Canny / silhouette hold | lllyasviel collection | 0.52 GB |

## Preprocessor

- Cloned: `ComfyUI\custom_nodes\comfyui_controlnet_aux` ([Fannovel16/comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux))
- Needs **Comfy Desktop restart** before OpenPose/DWPose preprocessor nodes appear.
- Deps installed into Comfy `.venv` via that package’s `requirements.txt`.

## Suggested first A/B for Dutchie actions

1. Pose map from idle (or hand-authored stick figure) via OpenPose preprocessor.
2. img2img from `dutchie_idle_ref.png`, denoise ~0.5–0.65, Pixel Art XL ~0.7.
3. Try ControlNet models in order on 8 GB: **thibaud_256lora** → **xinsir** → **thibaud full**.
4. Strength start ~0.85; drop if costume melts, raise if pose ignored.

See `truths.md` for why this path exists.
