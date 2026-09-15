# Lake America — session handoff

Updated 2026-09-12. **Active task:** finish the Blender artwork and make Lake America a complete playable level, including the existing arena axe. The user specifically wants documentation sufficient to resume after usage limits.

## Read first

- Work in `web/`, the existing Vite / Three.js game. The root README's statement that this tree is frozen is outdated for this task. Do not switch to another game tree or touch the SNES art pipeline.
- Preserve existing uncommitted work. This session began with substantial changes to cinematic timing, Carney's finisher, stage rendering, camera, and tests. Do not reset them.
- Prior cinematic behavior and validation: [lake-america-cinematics.md](lake-america-cinematics.md).
- Blender source: `web/stages/lake_america/blender/lake-america.blend`; reproducible builder: `web/tools/build-lake-america.py`; runtime: `web/game/src/render/lakeAmerica3d.js`.
- Axe behavior: near simulation X=-5, Down + LP + HP (Down + Grab), one shared throw each round, available with hazards disabled. Keep that gameplay anchor and existing practice demonstrations.

## Current work / checkpoint

This section is a live checkpoint, not a claim that unfinished work has passed validation.

- Blender scenery rebuild in progress: correct primitive normals and substrate, add a local-pivot 3D axe and separate stump, curated waterfront dressing, optimize distant geometry, preserve an archive before replacing the generated master.
- Axe runtime in progress: child-material readiness highlighting, centered spinning 3D projectile, visibility/reset and cleanup. Fix outdated eight-second cooldown text.
- Runtime atmosphere and level lifecycle under review: water/frost/light, bounded ambient motion, impact reactions, safe pause/reset/disposal.
- Development art review in progress: camera presets, orbit/pause, axe demonstration, performance display, and a playable match link.
- Final focused tests, production build and visual acceptance have **not yet been run for this session**.

## Run / rebuild

From the repository root:

```powershell
npm --prefix web run dev
# http://127.0.0.1:5176/
# Existing cinematic review: http://127.0.0.1:5176/?review=finisher
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --python web/tools/build-lake-america.py
npm --prefix web run build
```

The Vite port 5176 was already running when this session inspected it. Sandbox esbuild can fail with “Cannot read directory”; retry the same local build/server with approved elevation if needed. Do not start duplicate servers if the port is in use.

## Validation baseline

Previous session documented 38 focused passes. Its broader suite had four known baseline failures: two CPU meteorKick expectations, confidence-clip count, and Carney roundhouse practice demonstration. See the cinematic document for exact scope. These are historical results, not verification of the current edits.

## Resume protocol

Read this document and `git status --short`, then inspect the changed files and generated manifest. Finish pending checks rather than redoing or reverting completed work. Record the final asset budget, actual checks/results, visual findings, limitations and next art options here before ending the task.
