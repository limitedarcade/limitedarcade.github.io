# Three.js port — plan

A browser build of **Battle for Independance** in a new `web/` subdirectory,
matching the reference mock (`image.jpg`): TRUMP vs MARK CARNEY on frozen Lake
America, CN Tower skyline, LAKE AMERICA sign, SNES-fighter HUD.

The ROM stays the canonical game. `web/` is a second front end over the **same**
art masters and the **same** fight rules — not a rewrite of either.

## Why Three.js at all

The fighters are pre-rendered RGBA frames from artpipeline, so this is a 2.5D
billboard game, not a 3D one. Three.js earns its place on the things a 2D canvas
context cannot do cheaply, all of which the mock implies:

- fighters reflected in the ice, faded and rippling
- a lit stage — rim light on the billboards, an impact flash that actually lights
  the other fighter
- parallax depth between skyline / flag / sign / ice
- snow particles, hit sparks, a shockwave post pass, screen shake, hit-stop
- optional CRT / scanline / chromatic-aberration post chain

If a phase below does not need any of that, it should be plain DOM. The HUD is.

## Hard constraints inherited from the existing project

Read these before writing code; each one is a recorded failure in
`docs/truths.md` and `docs/gameplay-handoff.md`.

1. **Frames of one fighter must be crunched together.** `fit_group` normalises
   every frame of a character onto ONE scale, ground line and foot anchor. Fit
   per frame and the fighter shrinks and slides the moment he attacks. The web
   build must call `fit_group` across **all 84 frames of a fighter at once**
   (idle + punch + kick + hit together), not per animation.
2. **battlefi does not own background removal.** The atlas builder reuses
   `tools/pipeline/matte.py`, which delegates to artpipeline. No flood fill, no
   `rembg` — both are recorded failures.
3. **Never generate a fighter pose as a one-off image.** Missing clips come from
   artpipeline's H3 pipeline (`docs/art-pipeline-status.md`), one clip per
   process.
4. **Art lives outside this repo.** `ARTPIPELINE_ROOT` (default
   `C:\source\repos\artpipeline`) is the existing env var; reuse it. The built
   atlases get committed into `web/public/` so the app builds with artpipeline
   absent.
5. **Palette source of truth is `docs/color-bible/rows/ui_hud.json`.** Do not
   sample HUD colours from renders or stage art.

## Asset inventory (measured 2026-08-29)

`$ARTPIPELINE_ROOT/out/sprites/<fighter>/<anim>/<fighter>_<anim>_NNN.png`,
21 frames each, RGBA, tightly cropped per clip:

| fighter | idle | punch | kick | hit |
|---|---|---|---|---|
| trump | 21 @ 265x561 | 21 @ 432x561 | 21 @ 419x565 | 21 @ 541x571 |
| carney | 21 @ 254x558 | 21 @ 469x561 | 21 @ 386x562 | **missing** |

Stage: `art/raw/lake_america/lake_america_1024_01.png`, 1024x576.

Carney's hit clip has never been generated. The web build must not block on it
(see Phase 4 fallback), and generating it is the one art task on the critical
path to parity.

## Coordinate system — decide this once

**The world is 256 x 224 SNES units.** An orthographic camera covers exactly
that box; the CSS size is a multiplier on top. This is not nostalgia: it means
every constant in `rom/src/main.c` (x bounds 8..216, walk speed 2, reach 36,
ground line 128) transfers unchanged and the two builds stay comparable when
they disagree. Fighters occupy 64x64 units, drawn from a much higher-res texture.

## Layout

```
web/
  index.html
  package.json                  vite + three, no other runtime deps
  vite.config.js
  public/
    atlas/trump.png trump.json carney.png carney.json
    stage/lake_america.png      (+ split parallax layers)
  src/
    main.js                     bootstrap, resize, RAF, fixed-step driver
    core/
      constants.js              SNES units, HP, timings — one place
      fight.js                  the rules, ported from main.c, pure + testable
      input.js                  keyboard + Gamepad API -> SNES pad bitmask
      cpu.js                    the P2 AI, ported
    render/
      stage.js                  backdrop planes, parallax, ice reflection
      fighter.js                billboard + atlas frame player
      effects.js                sparks, snow, shake, hit-stop, flash
      post.js                   optional CRT / scanline / aberration chain
    ui/
      hud.js                    DOM overlay
      hud.css                   colours straight from ui_hud.json
```

The atlas builder is Python and lives with the rest of the pipeline, in
`tools/pipeline/` — see Phase 1.

## Phases

### Phase 1 — atlas builder (everything else is blocked on it)

New `tools/pipeline/build_web_atlas.py`. Python, not Node, specifically so it
reuses `fit_fighter.fit_group` and `matte` instead of reimplementing the two
things this project has already got wrong once.

- Collect all frames of a fighter across all available animations into ONE
  `fit_group` call at `size=512`.
- `fit_group` resamples `NEAREST` — correct for the 64px SNES crunch, wrong at
  512. Add a `resample=` kwarg defaulting to `Image.Resampling.NEAREST` so ROM
  output stays bit-identical, and pass `LANCZOS` from the web builder.
- Pack into a grid atlas. 84 cells at 256x288 is 12 cols x 7 rows = 3072x2016,
  inside the 4096 floor for WebGL2. If a fighter ever exceeds 4096, fall back to
  one atlas per animation.
- Emit `<fighter>.json`:

```json
{"cell": [256, 288], "cols": 12, "groundY": 0.94, "footX": 0.5,
 "anims": {"idle":  {"start": 0,  "count": 21, "loop": true},
           "punch": {"start": 21, "count": 21, "loop": false}}}
```

  `groundY` and `footX` come from `fit_group`'s own baseline and anchor, so the
  renderer never re-guesses where the feet are.
- Print per-frame opaque coverage against the group median, as `fit_group`
  already does. A frame far off the median means the matte failed on that frame.
  Read those numbers; do not skip them.
- Commit the outputs.

**Done when:** flipping through `trump.png` in an image viewer shows a fighter
whose feet do not move and whose height does not change between animations.

### Phase 2 — scaffold and stage

Vite + Three, orthographic camera on the 256x224 box, letterboxed to the window.

- Backdrop plane with `lake_america_1024_01.png`.
- Split the stage into parallax layers (skyline + flag / sign / ice), either by
  cutting the master in an image editor or by depth-slicing with a hand-painted
  mask. The mock's sign sits clearly in front of the skyline; one flat plane
  loses that read.
- Ice reflection: draw the fighter billboards a second time, mirrored below the
  ground line, into a plane with a vertical alpha fade and a small sine UV
  wobble. Ship the cheapest version first (mirrored sprite at 0.25 alpha), refine
  after it is on screen.
- `LinearFilter`, full-res frames — the web build is **not** pixel art. The
  16-colour Color Bible remap is a SNES constraint and must not be applied here.
  A retro look, if wanted, comes from the optional post chain in Phase 6.

### Phase 3 — fighter billboards

`fighter.js`: a `PlaneGeometry` + `MeshBasicMaterial` (upgraded to a custom
shader in Phase 6 for flash and lighting) with `map.repeat` / `map.offset` driven
from the atlas JSON.

- Frame advance is decoupled from render. The clips are 24 fps of real motion;
  hold each source frame for 2 display frames at 60 Hz — 21 frames = 0.70 s per
  animation, the number already worked out in `gameplay-handoff.md`.
- Idle loops seamlessly by construction: the clips are closed loops and the
  exporter drops the duplicate frame. Wrap 20 back to 0, no special case.
- Facing is a negative X scale. Because `footX` is the anchor, flip about the
  foot — flipping about the plane centre makes the fighter step sideways as he
  turns.

### Phase 4 — the fight, ported from `rom/src/main.c`

Port the rules into `core/fight.js` as a pure `step(state, pad1, pad2) -> state`,
driven by a **fixed 60 Hz accumulator** so the SNES constants stay literally true
regardless of display refresh:

| rule | value |
|---|---|
| start positions / HP | x1 48, x2 160, hp 96 each |
| walk speed | 2 units/tick, clamped 8..216 |
| punch | 20 ticks, 8 damage |
| kick | 24 ticks, 12 damage |
| hit stun | 16 ticks |
| active window | attacker `t > 8` |
| reach | `abs(x1 - x2) < 36` |
| clock | 99, one tick per 60 frames |
| match | first to 2 rounds |

The CPU (`cpu.js`) is the same: close to within 48, then punch on
`tick & 31 == 3`, kick on `tick & 31 == 17`.

Two deliberate deviations, both to be flagged in code:

- **Carney has no hit clip.** Until artpipeline generates it, his hit state plays
  the idle clip with a red flash and a knockback offset. It reads as a hit; it is
  a placeholder, not a design choice.
- The ROM has one pose per state; the web build has 21 frames per state, so
  attack animation length is now genuinely tied to the art. Keep the tick counts
  above and map them across the 21 frames rather than retiming to taste.

Input: arrows to move, `Z`/`X` punch, `A`/`S` kick, `Enter` for Start (P1); P2 on
`WASD` + `F`/`G`. Gamepad API sits on top of both and maps to the same bitmask.

### Phase 5 — HUD (DOM, not Three.js)

Text stays crisp, and the copy is already written in `docs/ui-style.md`. Colours
come from `ui_hud.json`. Against the mock:

**In the mock and in the ROM** — name plates (TRUMP orange `#FF8421`, MARK CARNEY
teal `#31B5B5`), approval bars stepping green `#42D631` to yellow `#FFD621` at 64
HP and red `#E62121` at 32, the gold `99` timer, round-win pips.

**In the mock but not in the ROM** — the three stars per side, the `BURST`
labels, the `MAX 3` meters along the bottom, the portrait inset top right, and
the `HAHAHA HAA` speech bubble. Build these **decorative first**: they belong to
the broadcast-graphics look and cost nothing to draw. Wiring any of them to a
real mechanic is a separate scope decision, not part of the port.

Screen copy: `BATTLE FOR INDEPENDANCE` / `THE GREAT LAKE DEBATE`, `PRESS START TO
DEBATE`, `RECOUNT IN PROGRESS`, `DEBATE OVER`, `MANDATE SECURED`. The title keeps
its intentional `Independance` spelling.

### Phase 6 — juice (the part that justifies Three.js)

In rough order of payoff per hour: hit-stop (freeze ~4 frames on connect), screen
shake, impact flash as a real light that hits both billboards, hit sparks
(instanced points), snow, shockwave ring post pass, parallax on camera sway, and
an optional CRT/scanline toggle.

The punch clip's white motion crescent on frames 8–11 is deliberate drawn content
(recorded in `gameplay-handoff.md`), not a matte bug. At web resolution it reads
as intended — do not mask it out.

### Phase 7 — wrap up

`web/README.md`, `npm run build` to static files, a short section in the root
README pointing at `web/`, and a note in `docs/art-pipeline-status.md` that the
web atlases are now a consumer of the clip table.

## Risks

- **Carney's hit clip is missing**, and the H3 generator dies partway through a
  batch on host RAM (34 GB of weights against 32 GB). Run one clip per process
  with a `/free` flush between — the loop is in `docs/art-pipeline-status.md`.
- **`fit_group` at 512 with NEAREST will look bad.** The `resample` kwarg above
  is the fix, and adding it must not change ROM output.
- **Atlas size.** 3072x2016 per fighter is roughly 6 MB of PNG each. If load time
  hurts, split per animation and lazy-load, or decimate to every other frame —
  24 fps of real motion survives it.
- **Scope creep from the mock.** BURST and MAX meters are a different game. They
  are drawn, not simulated, unless that gets decided separately.
