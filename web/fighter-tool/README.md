# Fighter pipeline

A local app that turns two Hitem3D exports into a **Three.js factory** for the web practice build.

It is a **pipeline runner**, not an agent. The method lives in `../FIGHTER_PLAYBOOK.md` (Route C), then a force-measured encode packs the rigged result into JavaScript. This folder is the product that stops you re-typing either step.

## Run the GUI

Double-click `quickstart.bat`. It installs packages on first run, starts the server, and opens `http://127.0.0.1:5179/`. Leave that window open.

```powershell
cd web/fighter-tool
npm install
npm start
```

1. Check the environment badges (Python venv + numpy, meshoptimizer, tools).
2. Drop **one textured GLB**, or the textured GLB plus the six-part Hitem3D export. One file is enough: the tool splits Head / Torso / arms / legs from a T-pose and samples the atlas. Two files still give a cleaner cut if you have them.
3. Validate. Fail closed — a bake will not start against a file that cannot run.
4. Build. Bake is ~4 minutes; everything after that is seconds.
5. Review the gate table against Trump’s shipped numbers.
6. Guard: click a fist or elbow for X/Y/Z arrows, or type the metres in the panel beside it.
7. **Pack into Three.js.** This copies the measured verts, colours, weights, 25-bone tree and clips into JavaScript. The parity table must show equal vertex and triangle counts. Drag **Explode** to pull the six named parts apart.
8. Export writes `fighter-tool/output/<id>/threejs/` (`createFighterModel.js` + packed surface). Optionally register it in the practice game.

The game never loads a `.glb`. The rigged GLB is kept next to the factory as the measurement source.

## The guard is per fighter, the clips are not

Wrist targets are absolute viewer metres. Trump's do not fit Carney -- his chin
is 8 cm higher and his reach 4 cm shorter, so Trump's guard drops Carney's hands
and pushes his lead arm past its own reach. So each fighter carries his own
`rig.guard.aim` and `rig.elbowPole` in `configs/<id>.json`.

Clips do **not** name wrist positions. They move the fist *relative* to whatever
the guard put it at (`da` in `CLIPS`), which is why setting one guard sets the
whole clip family. A clip key that named absolute metres would haul every
fighter back onto Trump's stance the moment it played.

Two numbers to read in the panel:

- **extension %** -- how much of that arm's own span the target uses. A guard
  wants 50-70%; 100% means the arm is locked straight and the target is outside
  the shoulder's reach. Drags clamp to the reach so the handle keeps tracking;
  typed numbers do not, and the readout flags it.
- **trunk clearance** -- signed metres from the measured trunk shell. Negative
  is an elbow inside the body. The elbow swing angle is what buys it back.

## CLI

```powershell
node runner/validate.mjs <a.glb> <b.glb>
node runner/build-fighter.mjs --config configs/trump.json
node runner/encode.mjs --id trump
node runner/build-fighter.mjs --config configs/carney.json --publish
```

Python must be the skill venv (numpy + Pillow). Override with `FIGHTER_PYTHON` if needed:

`%USERPROFILE%\.claude\skills\img2threejs\integrations\glb_character_pipeline\.venv\Scripts\python.exe`

System `python` has no numpy and the bake **exits 0 writing nothing**.

## Output

Every character pack is written to:

```
web/fighter-tool/output/<id>/
  threejs/
    createFighterModel.js   prewarm() + createFighter()
    surfaceData.js          packed verts / colours / weights / indices
    rigData.js              25 bones + clips
    meshCodec.js            decoder (copy this with the factory)
    parity.json             gate numbers vs the GLB
  <id>-rigged.glb           measurement source — do not load in the game
  asset.json
  README.md
```

Use it:

```js
import { prewarm, createFighter } from './threejs/createFighterModel.js';

await prewarm();
const { group, play, update, explode } = createFighter();
scene.add(group);
play('idle');
```

Registering it in this repo’s practice game (`game/src/fighters/<id>/`) is optional.

## Layout

```
runner/   headless orchestrator + validator + gates + encode
tools/    playbook kernels + encode_force_measured.mjs
runtime/  meshCodec.js (shared decoder)
ui/       studio (drop, build, drag-fists, pack, export)
output/   exported character packs
configs/  per-character record; shipped defaults come from the first fighter
```
