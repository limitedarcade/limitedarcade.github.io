# Battle for Independence — combat prototype

A standalone Vite + Three.js fighting game. Confirm Player 1's fighter, then Player 2's fighter, then choose an arena. Neither default preview reserves a fighter. Choose Human or CPU independently for either seat; CPU difficulty is independent for each side.

For ongoing fighter work, start with [FIGHTER_PROGRESS.md](FIGHTER_PROGRESS.md)
for current status, evidence and small helper tasks, then
[FIGHTER_PLAYBOOK.md](FIGHTER_PLAYBOOK.md) for production rules and verified facts.

## Run

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5176/. Choose Play, confirm both fighters, then Enter the arena.

The main menu runs a live combat vignette beside its button rail. **Demo** expands it to a full-screen attract mode, also entered after 30 seconds of menu inactivity. Any key, pointer button or gamepad input returns to the menu without activating a menu choice. Options, Profile, Practice setup and inactive tabs suspend the countdown. Exhibition bouts rotate through every ordered fighter pairing and unlocked arena (currently Lake America), alternating with a persistent playlist of movement, combos, signature moves, weapons, supers and complete finishers. Demonstrations use the real combat inputs and leave match configuration, profile statistics and achievements unchanged. The full showcase gradually covers each fighter's entire move list.

For a guided demo, choose **Practice · Learn every move** on the title or pause menu. Pick a fighter, partner and arena, then select a lesson or move. **Watch move** performs the real inputs; **Try it** restores control and the required starting conditions. All specials and finishers are revealed. Practice has an unlimited clock, replenishing health, full meter, dummy behaviors, input history, slow motion and contact boxes. Overkill sets up the first two combo hits so you can practice its final uppercut. Practice does not award match statistics. Pause → Back to versus restores the previous match setup.

The **How this game was made** link opens `/made` in a new tab. Vite serves the existing interactive page and includes it in production builds. Restart a dev server that was already running before the Vite configuration was added.

```powershell
npm test
npm run build
```

The asset-pipeline tests require Python with NumPy and Pillow. If the original Claude pipeline environment is unavailable, set `FIGHTER_PYTHON` to an installed Python that has those packages. The game itself needs no Python.

## Controls

| Action | Player 1 keyboard | Standard gamepad |
|---|---|---|
| Move / jump / crouch | A D / W / S | Left stick or D-pad |
| Sprint | Double-tap forward, then hold | Double-tap forward, then hold |
| Back hop | Double-tap back | Double-tap back |
| Stay down after knockdown | No input, or hold down | No input, or hold down |
| Rise / recovery roll | Up or Block / forward or back | Up or Block / forward or back |
| Light punch / heavy punch | U / I | West / North (X/Y or Square/Triangle) |
| Light kick / heavy kick | J / K | South / East (A/B or Cross/Circle) |
| Grab | U + I | Both punches, or RB/R1 |
| Throw | J + K | Both kicks, or RT/R2 |
| Block | Space (remappable) | LB/L1 or LT/L2 |
| Secret finisher | Character-specific direction sequence + attack; see Pause → Move list → Finish | Same relative directions + face button |
| Pause | Escape | Start |

In single-player, WASD or arrows control the human fighter on either side; the first gamepad follows that fighter too. In local two-player, Player 2 uses arrow keys, numpad 4/5 for punches, numpad 1/2 for kicks, and numpad 0 for block, or a second gamepad. Back retreats while guarding; explicit block holds position. Diagonal jumps follow the direction you press on either side.

Forward and back are relative to your opponent. Double-tap within 12 simulation frames (0.2 seconds at normal speed): forward starts a sprint while held; back commits to a short airborne hop. Release forward, block, crouch or attack to leave the sprint. After knockdown, wait as long as you want before choosing to rise in place or roll forward/back; holding Down overrides the other recovery choices. The HUD shows arrow prompts while a human fighter is down. Rising takes 22 frames; a directional roll takes 28.

Uppercuts and rising knees launch opponents into juggles. A launched fighter cannot act until landing and recovering; place the next strike so its hitbox reaches the falling opponent. Combo damage and available lift diminish as gravity increases, with a five-hit airborne limit including the launcher. Only designated sweeps hit grounded opponents, at reduced damage without restarting their recovery timer. Practice lessons 04–07 teach sprinting, back hops, delayed recovery and an uppercut-to-jab juggle through real inputs.

The move archive still describes the current prototype moves; a bespoke character move list and descriptions come next. Future violence should emphasize exaggerated, comedic spectacle and physical impact, with persistent limb loss offering new play choices. Further dismemberment work is deferred until that move design is established.

Open **Pause → Move list** for the complete command archive: all six two-button chords, four three-button chords, the four-button burst, directional attacks, and finisher requirements. Touch players can open **CHORDS** for one-button access to the same combinations. Directional moves use held directions relative to the opponent, not quarter-circle motions. Multi-button commands use a three-frame chord window. Meter moves spend one or two stocks only when they start.

## Debug studio

Press backtick (the key below Escape) to open the debug studio. The match pauses. Switch each fighter independently between the **Packed Three.js** conversion and **Rigged GLB**, toggle wireframe and collision boxes, adjust simulation speed, or preview Intro, KO, Flawless, Double KO and Fatality reels. Model switches preserve match state; reel previews intentionally reset the match. Closing the panel restores the previous pause state.

The Three.js surfaces and rigs correspond to the conversions under `fighter-tool/output/{fighter}/threejs`. Authoring factories remain under `game/src/fighters`; the game loads worker-decoded binary packs. The twelve new move animations are an animation-only supplement shared by both formats. Regenerate them with `npm run export-specials` after changing `fighter-tool/tools/specialClips.mjs`.

## Sound, music and visual identity

The supplied 77 effects and announcer clips are prepared as mono 32 kHz PCM WAVs under `game/public/audio` (about 5.5 MB). `tools/prepare-audio.py` regenerates them using Python and NumPy; original source files are untouched. Effects use a bounded voice pool, stereo positioning, slight pitch variation, and an announcer ducking mix. The pause menu has master, music, effects and announcer sliders; settings persist locally. Sound starts after a browser user gesture. Mute and mix live under Options.

- **Stage Cleared!**: title and character selection.
- **Stage Two: Odd Odds**: battles, deciding rounds and the pre-fight reel.
- **Victory Fanfare**: one-shot cue for round victory and match results.

Music crossfades between scenes and pauses with the match. Announcer clips retain their original words; the supplied “Finality” voice accompanies the visual Fatality card.

`COLOR_BIBLE.md` defines the palette and font roles. `palette.js` supplies shared CSS and canvas color tokens. Fatal Fighter handles round slams and titles; Great Fighter handles names; Single Fighter handles panel headings. Instructions retain a readable system font.

## Round ceremony

The existing match phases drive a locked reel: two-model versus shot, intro clips, round announcement, Fight slam, then live input. KO holds the impact state through 32 slow-motion frames, a freeze and the KO card before victory poses. Flawless, Double KO, Fatality, Draw and ordinary Victory have distinct end cards. The final two-shot and fictional fighter quip linger before result buttons appear. Reduced motion removes scaling slams and camera kicks.

## Current features

- Configurable matches, standing/crouching guard, aerial attacks, combinations, throws, knockdown and recovery, and an earned finisher window.
- Stylized blood particles and ground decals, hit flashes, guard effects, hitstop, camera shake, and round/result overlays.
- Placeholder portraits and replaceable display names, supplied sound effects, announcer cues and music.
- Both fighters have the 32 base clips plus twelve move-specific animation variants, shared between packed Three.js and GLB formats.
- The replacement closed-fist source pair is already incorporated in the current runtime fighter. Original source GLBs remain untouched.

## Where the interrupted work stopped

The prior pass had implemented combat, CPU controllers, input, HUD, effects, and stage alignment. It then added `fighter-tool/tools/combatClips.mjs` and connected it to the canonical rig, but stopped before re-exporting the runtime fighters. The runtime GLBs still contained the four practice clips, making many moves fall back to `jab`.

The continuation exports the full set, bakes interpolated poses at 60 Hz with body-joint floor correction, synchronizes attack playback with simulation frames, freezes animation during hitstop, and connects touch input to either human side. Regression tests cover input chords, CPU match completion, runtime clip coverage, and sampled joint floor clearance for both rigs.

## Continue animation work

Edit `fighter-tool/tools/combatClips.mjs`, then run:

```powershell
npm run export-combat
node --test test/combat.test.js
npm run build
```

The export reuses local optimized meshes, joint measurements, and pose sidecars in `fighter-tool/build/{fighter}/`; it does not repeat texture baking or decimation. It updates both playable GLBs and their clip manifests. These intermediate assets are ignored by Git and must be generated by the fighter pipeline on a fresh checkout.

`pose_check.mjs` remains an authoring diagnostic for the raw key poses. Its warnings can differ from the corrected exported tracks. Floor regression tests measure body joints, not the complete deformed mesh surface; arm/trunk intersections, foot sliding, contact reach, and final finisher choreography still need visual polish. Physical gamepad and mobile performance testing remain outstanding.

## Runtime layout

```text
game/src/engine/       fixed-step combat, frame data, commands, CPU
game/src/input/        keyboard, gamepad, touch
game/src/render/       fighter animation, stage, HUD, camera, VFX
game/src/fighters/     replaceable roster and asset registration
game/src/main.js       screens and simulation/render wiring
game/public/fighters/ exported runtime GLBs
fighter-tool/          source-asset and animation pipeline
test/                  gameplay and asset regression tests
```

The existing Sites publication is separate from this local build. Local changes are not automatically deployed.


## Expanded arcade build · September 2026

The setup form is now an expandable roster and arena selector. An isolated portrait studio renders actual model portraits and a rotating full-body preview on the same GPU context; match rigs remain independent. Portraits also populate the HUD. New title/selection/pause artwork is in `game/public/art/arena-night.png`.

Options are available from title, selection and pause. They include the existing four audio buses, physical-key remapping for both seats, fullscreen, automatic/cinematic/performance rendering, reduced motion, rumble and damage numbers. Preferences and the local player archive survive reloads. The archive records completed matches, personal combo milestones, arena visits and discovered finishers; cosmetic badges/accents unlock from those achievements. CPU exhibitions are recorded as watched, rather than solo wins.

Each roster definition references an arcade combat kit extending the shared base moves. The kits differ in move timing, reach, travel and movement behavior; all numerical values describe fictional game mechanics. The move archive reads the selected kit instead of a global display-only table. Both kits retain every chord and directional command. Both start with equal health.

Secret finishers require a completed relative-direction sequence inside the displayed range during FINISH IT. There are two character routines per fighter, an arena routine for each stage, a nonviolent Friendship, and an uppercut combo-ending Brutality. The render bridge follows each routine's camera cuts, staged actor tracks and impact beats. On touch, SECRETS pauses and opens the finishing command archive; enter commands using the stick and attack buttons.

The four arenas are Lake America, Capitol After Dark, Gilded Palms and Executive Lawn. Each has its own lighting, grade, procedural ambience and reactive scenery. Arena hazards can be toggled during selection: their marked zones warn before striking, and can be avoided by moving clear or jumping. Cosmetic scenery reactions remain active independently of the hazard rule.

Impact profiles synchronize typed punch/kick/block/counter/KO sparks, 4–12 rendered frames of hitpause, a 0.4 metre heavy-hit dolly, a three-frame grade kick, bone flinch, controller rumble and sound. Only counters and KOs use slow motion. Pooled effects are bounded. Blood, bruises and fabric wear stay attached to the skinned surface and reset each round; clothing wear is a surface effect, not torn mesh topology.

### Binary runtime pipeline

After regenerating fighter surfaces/rigs or special clips, run `npm run pack-runtime`. The packer writes `game/public/fighters/{id}/fighter.bin` (mesh + base clips, about 4.25 MiB) and `combat.bin` (special clips, about 416 KiB). A module worker decodes the compact mesh off the main thread; animation values are typed-array views. The main application no longer imports the large numeric-data JS modules. The debug GLB alternative remains available. Original generated JS is retained for authoring and round-trip tests.

Validation includes binary sample/mesh equivalence, both model formats, rebound-free additive recoil, command/range gates, complete CPU matches, persistent stores, shader composition, stage cleanup and resource bounds. Run `npm test` with `FIGHTER_PYTHON` pointing to a Python environment with NumPy, then `npm run build`. Live visual/device/audio evaluation is separate from these automated checks.

Next high-value passes: replayable training scenarios with input history and punish feedback; editable instant replays with camera bookmarks; a consistent environment texture replacement pass; bespoke character-specific mocap and facial performance for the finishing routines.

### Reusable effects studio

Open [Effects Studio](http://127.0.0.1:5176/vfx-studio.html) while `npm run dev` is running to tune five GLB effects with size, color, glow, timing, orientation, playback, and frame scrubbing. Presets save locally and can be copied for reuse. The studio is included in production builds. See [runtime and combat integration](docs/vfx-runtime.md) and [asset inventory and credits](docs/vfx-assets.md). `npm run check-vfx` verifies the reproducible 3.37 MiB asset pack.
