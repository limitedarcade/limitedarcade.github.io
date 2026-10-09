# Local combat polish — October 7, 2026

Implemented the four agreed presentation improvements: closer safe framing,
basic attack body mechanics, coordinated impact reactions/sound/shake, and
faster rematches/repeat rounds. No commit or push was performed. The checkout
already contained extensive unrelated changes; their contents were retained.
Exact pre-change source copies for affected existing files are in
`baseline-source/` with `.snapshot` extensions so test discovery ignores them.

## Result

- At close desktop range, settled camera distance changes from about 7.16 m to
  5.21 m. Saved poses show fighters occupying roughly 60% of screen height,
  up from about 44%, with their feet and heads visible.
- Camera fitting accounts for both fighters, jumps, both arena edges, portrait
  screens and landscape control space. Faster outward fitting prevents a jump
  or resize from being cropped during inward easing.
- Light contacts have short small impulses; heavy/counter/KO contacts carry
  more weight. Blocks have a distinct restrained response. The strongest recent
  shake wins rather than accumulating indefinitely. Real time settles shake
  during simulation hitstop; pause holds it; reduced motion clears it.
- Basic punches/kicks retain the existing authored clips, with additive
  anticipation, drive and support-foot planting. Flock's actual imported rig
  resolves both feet and `mixamorigHead_63` for reactions. Lang's intentionally
  weak attacks retain smaller drive and response. Specials remain authored.
- First encounters use the existing 410-frame entrance. Rematches and repeat
  rounds use 96 frames (1.6 simulation seconds). Round/Fight cues still run,
  input is locked during the entrance and the fight begins with a fresh timer.
  Demo and practice retain full entrances. Exact authored finisher camera cuts
  remain unchanged.

## Automated verification

Commands run from `web/`:

```powershell
node --test test/polish.test.js test/combat-presentation.test.js test/impact.test.js test/ceremony.test.js test/simulation-clock.test.js
$polishSuites = @(rg --files test -g '*.test.js')
node --test @polishSuites
npm run build
npm run check-budget -- --static
node tools/polish-review.mjs --preview --both-facings
node tools/polish-flow.mjs
node tools/polish-flow.mjs --phone
node tools/polish-flow.mjs --reduced
node tools/polish-gallery.mjs
```

Focused camera/combat presentation/impact/ceremony/simulation-clock checks:
**60 passed, zero failed** (`focused-tests.log`). These cover safe projected
framing, real-time bounded shake at 30/60/144 Hz, pause/reset/reduced motion,
exact authored camera positions, restorative imported-rig recoil, coordinated
audio profiles, intro gates and identical combat outcomes after full/short
entrances for the same subsequent inputs.

Full named test suites before this pass: **414 passed, 3 failed, 4 skipped**
(`baseline-tests.log`). After: **438 passed, 3 failed, 4 skipped**
(`full-tests.log`). The same failures occur in both records:

1. `match does not end during the beaver handoff`
2. `cinematic clip edits sample finite poses, and the last camera pose holds after the result`
3. `ramped finisher has identical event order and progress at 30, 60 and 144 Hz`

This is not a claim that the complete suite is green. Explicit named-suite
discovery avoids Node treating executable browser utilities as unit tests.

Production build passed: 136 game modules, 408.35 kB game JS bundle. Existing
large-bundle and runtime art-path warnings remain. Static asset budget passed:
64.39 MB against an 80 MB cap. `sandbox-build-error.log` records an initial
sandbox-only EPERM; the approved production build completed successfully.
Scoped `git diff --check` passed.

## Running-game checks and visual evidence

All three `flow-*/report.json` records have `ok: true` and no browser/resource
errors. They use the production `dist/` renderer in isolated browser storage.
The menu and selection flow, first entrance, actual keyboard/touch punch, real
contact/KO/result transition and rematch were exercised. Desktop also checks
guarding an opposing heavy and loading every other arena. Fixtures use two
human seats and lower the opponent's health for the KO; combat still processes
the real input and hit. They do not imply a complete manual match was played.
Rematches retained the roster/stage and restored timer 99, full health and
zero round wins. Reduced-motion preference was read back from the DOM and real
contact left camera shake at zero.

`after/report.json` records 46 captures: all four fighters' four basic attacks
in both facings, close/wide/edge/jump framing and two phone shapes. Captures use
fixed review poses with the actual renderer/camera and include rig metrics.
The four `review-*.png` contact sheets, desktop jump, imported-rig close view,
phone/portrait layouts and all arena views were visually inspected. The
[comparison gallery](comparison.html) lets a user scrub saved before/after
images; animation phase and environmental timing vary slightly between runs.
Reversed poses added during final QA are after-only where no baseline exists.

Browser emulation and automated checks do not establish physical phone touch,
speaker audibility, controller rumble, sustained performance or user approval.
The next acceptance step is playing the local result and judging its feel.
