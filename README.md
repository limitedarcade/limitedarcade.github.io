# Battle for Independance
Satirical SNES 1v1 fighter -- **TRUMP** vs **MARK CARNEY** on frozen **Lake America** (CN Tower skyline, Canadian flag).
Real LoROM `.sfc` built with **PVSnesLib**. Art is generated in local **ComfyUI** (Juggernaut XL V8 @ 1024 + Pixel Art XL LoRA), then downscaled and remapped through a 16-color Color Bible.
## Controls
| Input | Action |
|-------|--------|
| D-Pad | Move |
| Y / B | Punch |
| A / X | Kick |
| Start | Begin / pause / next round / rematch |
P1 = pad 0 (Trump). P2 = pad 1, or CPU if pad 1 is idle. First to 2 round wins.
The SNES-native interface frames health as **APPROVAL**, uses a 99-second
debate clock, shows first-to-two win marks, and keeps all UI on BG1 so fighter
sprites retain the full OBJ budget. Visual rules live in `docs/ui-style.md` and
the palette source of truth is `docs/color-bible/rows/ui_hud.json`.
## Pipeline
```
ComfyUI 1024 -> art/raw -> remap/downscale -> art/px + rom/res -> gfx4snes -> battlefi.sfc
```

**Add a fighter:** `docs/fighter-workflow.md` + `python tools/make_fighter.py --slug <name> --sheet <concept>.png`
Sprite box / VRAM / stage scale: `docs/sprite-geometry.md`
Model / prompting notes: `docs/civitai-prompting-guide.md`, `docs/comfy-model-notes.md`
Hard-won pipeline truths: `docs/truths.md`
ControlNet weights: `docs/controlnet-manifest.md`
### Generate art
```powershell
# Comfy Desktop must be running on :8188
python tools\comfy\client.py --job all
```
### Crunch to SNES assets
```powershell
cd tools\pipeline
python process_assets.py --size 64
```
### Build ROM (WSL + PVSnesLib)
```powershell
$script = wsl -d Ubuntu -- wslpath -a (Resolve-Path tools\wsl_build_rom.sh)
wsl -d Ubuntu -- bash $script
```
Open `battlefi.sfc` in Mesen or snes9x.
## Web fighter (separate build)
A from-scratch browser-native sibling lives in **`web-fight/`** --
**Vite + Three.js + vanilla JS**, 60 fps, no SNES, no ComfyUI, no political
roster.
- Two generic archetypes (RYU-like vs KEN-like), 12 animations each,
  procedural sprite atlases rendered into `THREE.CanvasTexture`.
- Tick-based fight logic (round / clock / cancel rules / KO / match), pattern
  AI opponent, DOM HUD overlay.
- Independent of the SNES build -- `web-fight/` ships its own `package.json`,
  `vite.config.js`, and `src/` tree.
```bash
cd web-fight
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest suite (core/fight, core/input, core/cpu)
npm run build        # production bundle into web-fight/dist/
```
Full details, controls, move list, AI summary, and architecture map:
[`web-fight/README.md`](web-fight/README.md).
The earlier satirical Vite build at `web/` is **frozen** and not part of this
project -- treat the new tree as a clean rebuild.
---
## Layout
```
art/comfy/     prompts + saved ComfyUI API workflows
art/raw/       1024 ComfyUI masters
art/px/        downscaled + Color Bible remapped previews
docs/          color bible + model notes
rom/           PVSnesLib sources + converted CHR
tools/comfy/   ComfyUI client
tools/pipeline/ downscale / remap / stage converter
web-fight/     separate Vite + Three.js rebuild (see above)
```
