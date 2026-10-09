# Roadmap and wave status

Web game only; the SNES ROM and `take2/` are parked. Waves run in order and each
leaves the game publishable. Update this file at the end of every wave.
Detailed rules live in the docs each item links to; this file tracks *status*.

| Wave | Scope | Status |
|---|---|---|
| 0 | Stabilize finisher tests, commit demo work, exclude local assistant stores | **Completed 2026-10-09** — see release preparation below |
| 1 | Launch polish | **Implemented 2026-09-22** — see below |
| 2 | Balance lab, finishers for Flock/Lang, Lang combo, contact markers, Carney template, personality | Planned |
| 3 | Split `main.js`, Arcade ladder, combo trials, training tools | Planned |
| 4 | Stage kit, then Capitol After Dark, Executive Lawn, Reflecting Pool | Planned |
| 5 | Input replays, instant replay/photo mode, clip export | Planned |
| 6 | Online versus (rewindable engine, rollback, WebRTC, lobby) | Planned |
| 7 | New fighters (after Carney is approved as the template) | Planned |

## Wave 1 — what landed

- **1.1 Downloads.** First fight 25.5 MB (was >100 MB), menu 0.55 MB, `dist/`
  65 MB (was 173 MB); music re-encoded to 96 kbps (15.6 → 9.9 MB). Build-time pipeline (`web/tools/asset-pipeline.json`,
  `optimize-glb.mjs`, `pack-scene.mjs`), per-match loading of weapons/drone/gore,
  pre-rendered portraits, byte progress on the loading screen, `npm run
  check-budget`. Rules: "Asset budget" in `docs/web-fighter-and-stage-workflow.md`.
- **1.2 Release.** `npm run release` (dry run) / `-- --publish`. See `web/README.md`.
- **1.3 Smoke test.** `npm run smoke` (desktop) and `-- --phone`; evidence in
  `web/artifacts/smoke/`.
- **1.4 Storefront.** README screenshots + GIF, social card, OpenGraph tags,
  favicon, `made.html` updated (its viewer now reads the compressed assets).
- **1.5 Devices.** Phone layout fixes (title hint overlapped the menu; Block and
  Chords overlapped the face buttons; pause covered P2's portrait). "Automatic"
  quality already picks performance on touch devices. Hands-on checklist below.
- **1.6 Sound.** Every music track has one cue (see `web/README.md`); announcer
  captions option.
- **1.7 Content.** Gore off now removes all blood, not just severing. The two
  decisions below are still yours.

## Open items that need a person

- **Release gates:** publishing requires committed source, passing tests,
  build, asset budget and browser smoke checks, and a clean privacy scan.
  The release command verifies the `limitedarcade` account and uses its
  no-reply commit identity for both public branches.
- **Flock's armband texture** (a swastika). It is in his model and his
  pre-rendered portrait. After changing it: `npm run render-portraits`. The
  storefront finisher deliberately uses Trump as the opponent.
- **First-launch content note:** not added; needs your wording.
- **Hands-on device checklist** (automation can't cover these):
  - Xbox, PlayStation and a generic pad in Chrome, Firefox and Safari: menus,
    all four attacks, block, both macros (RB, RT), Start to pause, a second pad
    joining mid-session, and rumble.
  - A real phone and tablet, both orientations: touch stick, Chords tray,
    FINISH IT button, frame rate on Lake America with effects.
  - Safari (macOS and iOS): audio unlock on first tap, captions when muted.

## Demo release preparation — October 9, 2026

- Verified GitHub authentication as `limitedarcade`, repository push access,
  and Pages deployment from `main` at the repository root. A no-change Git
  push dry run succeeded.
- Fixed stale finisher test fixtures without changing gameplay: both authored
  cold-cut timelines now hold through the handoff and hero pose, both timelines
  replay identically at 30/60/144 Hz, and the clip contract includes slapshot.
  The ice-arm variant remains disabled.
- `npm test` explicitly runs `test/*.test.js`; browser utilities run through
  the separate smoke gate. Result: 443 passed, 4 intentionally skipped, 0 failed.
- Production build and desktop/phone title-to-results smoke checks passed.
  Static output is 64.39 MB against an 80 MB cap; measured menu/first-fight
  downloads are 0.55/25.52 MB. Browser checks do not establish physical-device
  touch, controller behavior, audio quality or sustained performance.
- Preserved the inspiration credit added on the public branch. Local assistant
  coordination, memory stores and source-review snapshots stay outside Git.
