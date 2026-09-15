# Carney GLB pilot — September 9, 2026

This records the earlier pilot and its validation at that time. Current task
status, test counts and the movement milestone live in
[`FIGHTER_PROGRESS.md`](FIGHTER_PROGRESS.md).

Launch with `npm run dev`. On the title screen choose **Watch: Vote of No Confidence**. It runs the real practice command and finishing sequence. Open **Show panel** to replay, select quarter speed, or try the inputs. **Explore the fighter lab** compares the original and textured export, with camera presets, animation scrubbing and wireframe.

## What changed

- Carney now loads `game/public/fighters/carney/carney-hero.glb` through Three.js GLTFLoader. The matching original textured sculpt was baked onto the existing animated model in Blender. Six UV texture maps, all 25 original bones and all 32 exported animations survive. Editable source: `fighters/carney/carney-hero.blend`. Rebuild: Blender in background mode with `--python tools/build_carney_hero.py`.
- `engine/simulationClock.js` advances the existing simulation at 60 Hz. Match consumes gameplay hitstop; visual effect clocks cannot alter its duration. Render catch-up is bounded after stalls.
- `render/clipTiming.js` maps normal attacks through startup, contact and recovery markers. Custom clips without markers retain their existing total-duration mapping; they still need authored markers.
- **Vote of No Confidence** is a 6.5-second, seven-shot presentation proof: windup, body slash, second windup, head cut and victory. `engine/fatalities.js` owns shot and impact frames. `confidenceClips.js` retimes existing skeletal animation; `confidenceProps.js` positions the stick from the posed hand. These are replaceable presentation assets, separate from combat rules.
- Cinematic cuts no longer use random low-health limb selection. Majority-weighted vertices are fully removed, and shadow passes follow the removal. The previous system could leave a bloodied head visible after severance.

## Adding the next fighter with AI assistance

1. Start from an approved sculpt and editable Blender file. Ask the AI to inspect topology and rig limitations before generating more attacks.
2. Export a GLB with named bones and clips, UVs, embedded textures and any supported expression channels. Bake constraints into animation.
3. Add a roster definition using `runtime: 'gltf'`, `runtimeAsset`, `preserveMaterials: true`, `authoredHeight` and `facingRotationY`. Clone the structure of `game/src/fighters/carney.js`, supplying a distinct combat kit.
4. Put balance in the combat kit and frame data. Put clip contact times in `contactMarkers`, keyed by clip name. For example, `heavyPunch: [0.26, 0.36]` means contact and release in seconds; these are animation measurements, not balance frame counts.
5. Inspect guard, punch, kick, crouch and recoil in-engine before expanding. Finishers also need the opponent's reactions, weapon grip, impact locations, wound geometry and camera framing reviewed together.

## Validation and limits

Automated validation: 174 tests pass, five existing tests skip; production build includes both game and fighter lab. Tests compare actual combat/hitstop at 30/60/144 Hz, check the GLB's textures/skin/clip contract, and sever/reset the real Trump model. Browser review covered model comparison and finisher playback. The Vite build still warns about the shared Three.js/loader chunk size.

This is a production-route pilot, not a finished AAA character. The GLB is about 14 MB, versus 9.45 MB for the original untextured GLB. It retains the original topology and rig: no new facial, finger, twist or garment controls. Finisher animation reuses existing poses, and the grip has no finger IK. Proper cut caps and textured detached anatomy remain unfinished. Performance under a sustained full-effects match, all opponent proportions and both facing directions still needs visual profiling. Next investment: a corrected shoulder/hand/face rig and one deliberately authored Blender finisher.
