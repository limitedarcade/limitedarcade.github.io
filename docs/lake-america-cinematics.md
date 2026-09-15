# Lake America and Carney's cinematic

Carney's Vote of No Confidence finisher now uses the full two-arm slapshot sequence against Officer Flock and Trump, on either side. Other opponents retain their original sequence.

## Review

Run `npm --prefix web run dev`, then open `http://127.0.0.1:5176/?review=finisher`.

Use **Opponent** to switch between Flock and Trump, **Mirror sides** to reverse the match, and the named beats to replay and pause at each contact. **Play finisher** runs the full sequence. Stage wide, Orbit 45°, Reverse and Aerial expose the scenery's real depth. These controls are development-only and do not award profile statistics.

## Blender source and runtime

- Editable source: `web/stages/lake_america/blender/lake-america.blend`.
- Rebuild script: `web/tools/build-lake-america.py`.
- Export: `web/game/public/stages/lake-america-3d/lake-america.glb` and its manifest.
- Runtime materials and animation: `web/game/src/render/lakeAmerica3d.js`.

Rebuild from the repository root with Blender 5.2:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --python web/tools/build-lake-america.py
```

The Blender master contains the modeled island, irregular frost slabs, rocks, snowy pines, headlands, Toronto skyline, CN Tower, stadium, flagpole and review cameras. Geometry surrounds the fight lane so reverse and orbit views have scenery. Runtime shaders provide water, sky/clouds, frost detail and waving flag cloth; the Blender file alone does not reproduce those animated effects. Rebuilding overwrites the generated master and export: preserve manual Blender edits under a separate filename or incorporate them into the script first.

## Choreography

Simulation contacts remain at frames 100/110 (arms), 200/246 (slapshots), and 391 (final strike), ending at 510. The existing `cold-cut-flock` script name is retained for compatibility and selected for both supported opponents.

`finisherTiming.js` applies time ramps to fixed simulation ticks. Fighter poses, props and effects use the resulting scene time. `finisherDirector.js` stages the windups and contacts, then follows the actual detached mesh centers. `coldCutIce.js` settles each opponent's own arm geometry above the floor and controls its ice trajectory. A reversible two-bone constraint keeps Carney's supporting hand on the stick without stretching bones or altering later animation.

Reduced motion and portrait layouts retain a stable wider view. Disabling gore skips detached-arm pursuit. This is a desktop-focused stylized stage; device-wide performance and screenshot-level character art are not established by these changes.

## Validation

Production build passed. All 38 focused tests passed:

```powershell
node --test --test-concurrency=1 web/test/cold-cut.test.js web/test/finisher-director.test.js web/test/simulation-clock.test.js web/test/stage-damage.test.js web/test/stage-hazards.test.js web/test/profile-options.test.js
```

Coverage includes both opponents/facings, Trump's two model formats, real detached geometry, floor clearance, cleanup, grip reach/restoration, mesh-centered cameras, gore-disabled framing, 30/60/144 Hz timing, stage switching and hazards.

End-to-end review also exposed missing winner-name and quote elements in the existing result screen. These elements are restored so normal match completion can display its result and rematch controls. Review playback abandons profile recording and does not use practice mode's automatic reset.

A broader suite run produced 202 passes, 4 failures and 5 skips. All four failures reproduced against unchanged HEAD: two combat CPU meteorKick expectations, the fighter-pipeline confidence-clip count, and the Carney roundhouse practice demonstration. They are pre-existing failures, not a clean full-suite pass.
