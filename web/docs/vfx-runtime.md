# Reusable effects and the studio

Run `npm run dev` and open [Effects Studio](http://127.0.0.1:5176/vfx-studio.html).
The studio is also included in the production build at `vfx-studio.html`.

Choose Fireball, Laser, Shield, Appearance, or Energy burst. Adjust size,
color, glow, opacity, duration, playback speed, delay, and orientation. Drag
the preview to orbit, switch to Front to judge the combat silhouette, and
scrub Preview position to inspect a precise frame. Space toggles playback
when the page, rather than a form control, has focus.

The studio saves each effect's settings locally and can copy a JSON preset.
Its initial 2 metre size and 2 second duration make inspection easier;
gameplay uses the smaller, faster settings in `combatVfx.js`. Studio edits do
not silently change a match. Copy a preset into an effect call to use it.

## Runtime

`game/src/render/modelVfx.js` loads GLBs once and pools instances. Geometry
and textures are shared; colors, opacity, mixers, and skeletons are private
to each instance. `clear()` returns active instances to their pools.
`dispose()` releases all owned GPU resources, including assets that finish
loading after disposal. Asset failures leave the original sprite effects
available; a missed contact is never replayed when a download finishes.

```js
import { ModelVfx } from './render/modelVfx.js';

const effects = new ModelVfx(scene);
await effects.preload(['fireball']);
const fire = effects.spawn('fireball', {
  x: 1, y: 1.2, z: 0.3,
  size: 0.9, color: '#88ddff', glow: 1.2, opacity: 0.8,
  duration: 0.4, speed: 1.5, delay: 0,
  fadeIn: 0, // visible immediately on contact, including hitstop
});
effects.update(worldDt); // once per frame; use 0 during pause/hitstop
fire?.stop();
```

- Size is the longest dimension in metres before any `stretch: [x,y,z]`.
- Duration is authored lifetime; actual playback is `duration / speed`.
- Delay uses world seconds. Animation clips fit the requested lifetime.
- Rotation is `[x,y,z]` in radians. `velocity: [x,y,z]` uses playback time.
- `clipStart` / `clipEnd` select fractions of a clip, useful for short sigil impacts.
- `loop: true` repeats until stopped. `manual: true` lets a snapshot-driven
  owner call `handle.seek(progress)` and `handle.setPosition(x,y,z)`.
- `fadeIn` and `fadeOut` are fractions of lifetime; their opacity envelopes
  also work on assets without clips. `grow` controls expansion and `spin`
  controls rotation around the viewing axis.
- Texture brightness is retinted while retaining base-map alpha and emission
  detail, so colors are usable across hues. Glow is capped and adds no lights.
- Defaults cap active instances at 12 and each asset at 4. Performance mode
  lowers the active budget; reduced motion dims effects and removes added
  spin/expansion. Pool reuse also resets all transforms and material settings.

## Combat use

`Vfx` owns `ModelVfx` and `CombatVfx`, so normal round, practice, demo,
and match resets clear both sprites and model effects.

| Combat cue | Effect |
| --- | --- |
| Trump's Main Event contact | Compact amber fireball with instant onset |
| Carney's Absolute Zero contact | Cyan expanding sigil using a short clip segment |
| Ground-breaker specials | A low, expanding ring in the fighter's palette |
| Flock's Riot Shield / No-Knock | Honeycomb shield with a thin readable rim, attached to snapshot attack progress |
| Overwatch summon | A short amber appearance effect at the drone muzzle |
| Overwatch beam | Existing authored laser and authoritative beam geometry retained |

Physical thrown weapons, ordinary attacks, and authored finishers keep their
existing effects. Contact visuals use the same world clock as the sprite
system; shield placement comes directly from fighter snapshots.

## Assets and checks

`npm run prepare-vfx` reproduces the five-file pack; `npm run check-vfx`
verifies it without writing. The original downloads remain in `vfx/`.
See [asset inventory and attribution](vfx-assets.md), and
`game/public/vfx/ATTRIBUTION.md` for the exact author/license metadata.

Run `node --test test/model-vfx.test.js` for pool, animation, skeleton,
failure, disposal, combat-mapping, and shipped-asset checks. Run
`npm test` and `npm run build` for repository-wide validation.
