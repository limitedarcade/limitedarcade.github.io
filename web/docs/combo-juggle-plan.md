# Basic combos, juggles, effects, and teaching

Implementation plan · 2026-09-20 · **C01-C09 implemented.**

Implementation evidence is recorded in `artifacts/combos/c01-c05-evidence.json` and
`artifacts/combos/c06-c09-evidence.json`. The final focused 202-test combat, route, playback, practice,
effects, CPU/demo, audio, and simulation suite passes, and the production build completes. The complete
repository suite now has three unrelated failures; both pre-existing `meteorKick` CPU-coverage failures
were resolved in C08 without weakening the coverage assertions.

## Outcome and scope

Players can learn a few reliable two- and three-hit button sequences, launch an opponent, and time a short airborne follow-up. Hits, launches, and landings have distinct visual and sound cues. Practice teaches and verifies the complete sequence; the title-menu vignette and full-screen Demo use the same routes in their CPU fights.

Build on the existing combat rules and assets. The first release uses current attack clips, contact boxes, input bindings, VFX pools, and audio. No new buttons, asset downloads, cinematic combo attacks, wall/ground bounces, air dashes, combo breakers, or unlimited aerial strings are required.

Planning defaults:

- Ship the shared routes for Carney, Trump, and Officer Flock, with timings tuned per kit. Test the standard training kit too.
- Preserve Carney's three existing assisted chains and Polar Reversal's one-stock cost.
- Preserve Lang's deliberately weak kit: it currently disables cancels, launches, and aerial hits. Do not advertise unsupported combo lessons or give him a launcher as a side effect. He remains a valid training partner. Adding his own combo is separate character design work.
- Keep the current CPU exhibition format, Carney pairing rules, Cold Cut finale, and complete result ending. Integrate combos into the fights. Do not restore the retired inter-match showcase playlist.
- Practice and demonstrations remain excluded from profile statistics and achievements.

## Verified starting point

Abbreviated source paths below are relative to `web/game/src/`; test, artifact, and documentation paths are relative to `web/`. These observations describe the working tree inspected on the plan date, which already contains unrelated uncommitted changes.

| Area | Present behavior | Work needed |
| --- | --- | --- |
| `engine/commands.js`, `engine/fighter.js` | Three-frame chord arbitration; six-frame queued action; input edges captured through hitstop; cancels require `moveLanded` and a legal `cancelInto` window. | Specify boundaries and test them across sequences. Preserve chord and directional-command priority. |
| `fighters/combatKits.js`, `fighters/carney/moves.js` | Carney has assisted mappings for `LP, LP, LP`, `LP, LK, LK`, and `LP, LP, HK`. | Move lesson descriptions and playback into shared route data; retain actual kit behavior. |
| `engine/frameData.js`, `engine/match.js`, `engine/fighter.js` | Uppercuts/rising knees launch; airborne hits re-pop with less lift, extra gravity, and damage scaling. Five airborne contacts maximum, counting the launcher. Throws cannot catch airborne victims. | Author reliable short routes and protect these limits. Do not rebuild launch physics. |
| `engine/match.js::decayCombos` | Counts persist for up to six actionable frames; floor contact clears them. | Separate true combo continuity from cosmetic display linger so an escapable sequence cannot pass a lesson. |
| `game/practice.js`, `render/practicePanel.js`, `main.js` | Watch/Try/reset, replenishing health/meter, dummy behaviors, input history, quarter/half speed, contact boxes. One uppercut-to-jab lesson; Carney entries use fixed 12-frame tap spacing. | Route catalog, complete attempt tracking, reliable playback, useful failure feedback, side switching. |
| `game/attract.js`, `engine/ai.js` | Attract runs CPU exhibitions. `showcaseDeck()` remains a tooling helper, not the active demo flow. CPU chooses individual moves without a dedicated route controller. | Shared route execution, hit-confirmed CPU follow-ups, measurable demo coverage. |
| `render/vfx.js`, `combatVfx.js`, `impact.js`, `game/fightAudio.js`, `announcer.js` | Existing pooled effects, contact audio, recoil, hitstop, camera response, combo HUD and announcer tiers. Hit events already expose `launched`, `juggle`, and `juggleHits`. | Layer small combo cues into this pipeline. Add an authoritative juggle-landing event; current `land` only covers transitions to `landing`, not `juggle → knockdown`. |

The README's claim that exhibitions alternate with a persistent move playlist is stale relative to `attract.js` and its tests. Update that description when implementing demo integration.

### Baseline checks run

```powershell
node --test --test-reporter=spec test/combat.test.js test/carney-flow.test.js test/juggle.test.js test/practice.test.js test/movement-practice.test.js test/attract.test.js test/simulation-clock.test.js test/impact.test.js test/model-vfx.test.js
```

Result: **89 tests, 87 passed, 2 failed**. Both failures are in `test/combat.test.js`:

- `CPU reaches the whole move list, not just the buttons it can press alone` — `CPU never used: meteorKick`.
- `the CPU exercises the whole move list, including kit projectiles` — `CPU never used meteorKick`.

These predate this plan. Resolve their cause during CPU integration; do not delete the move or weaken the coverage assertions to make the suite green. This baseline does not validate proposed routes, browser presentation, audio playback, or controller feel. No full build or full repository test run was performed for this planning change.

## Initial route catalog

Notation: `→` means separate presses with a release between them. `+` means held together. Direction-plus-button steps retain their direction through command resolution. Display remapped keyboard and gamepad controls using the existing command icon helpers.

| Stable route ID | Inputs | Expected hit moves | Purpose |
| --- | --- | --- | --- |
| `basic-one-two` | LP → HP | `lightPunch, heavyPunch` | First two-hit cancel. |
| `basic-three-hit` | LP → LK → HK | `lightPunch, lightKick, heavyKick` | Three distinct taps ending in knockdown. |
| `juggle-first` | Down + HP → release/wait → LP | `uppercut, lightPunch` | Keep and improve the current launch lesson. |
| `juggle-three-hit` | Down + HP → release/wait → LP → HP | `uppercut, lightPunch, heavyPunch` | Two follow-ups before the natural fall. |
| `easy-carney-roundhouse` | LP → LP → LP | `lightPunch, bodyCheck, heavyKick` | Preserve Carney's existing three-tap route. |
| `easy-carney-axe` | LP → LK → LK | `lightPunch, lightKick, heelDrop` | Preserve the overhead branch. |
| `easy-carney-spin` | LP → LP → HK | `lightPunch, bodyCheck, spinKick` | Preserve the one-stock branch. |

The first four are authored targets for the three capable roster fighters, not claims that all currently work at every spacing. The last three already have passing real-input tests. Their existing lesson IDs remain stable.

Launchers are a **link** into the first jab: wait through launcher recovery. Subsequent light-to-heavy transitions use the normal hit-confirmed cancel rules. Do not add a launcher cancel solely to hide incorrect lesson timing. The three-hit aerial route ends by allowing the existing fall and knockdown; it does not introduce a new spike mechanic.

For each kit, calibrate:

- A demonstrated starting gap of 0.85 m, with a beginner acceptance range of 0.75–1.0 m at center stage. If a target route needs tuning, prefer opener pushback, hitstun, or a narrowly scoped cancel-window change. Preserve Flock's strong pushback on the ending hit and each kit's recognizable attack speed.
- A documented raw-input interval for every transition, including chord-resolution delay. Each basic ground transition must accept a contiguous window of at least four simulation ticks. Each launcher follow-up must have at least four viable input ticks after recovery. These are implementation acceptance targets, to be measured rather than inferred from frame data.
- A reproducible nominal schedule plus early/late schedules within that window. Retain Carney's existing 6/8/10/12/14-frame three-tap regression cases.
- Initial balance ceilings at full health, without counter hits: meterless listed routes below 300/1000 health, one-stock listed routes below 350/1000. Preserve the tighter existing Carney roundhouse test of less than 210 damage. Record exact measured totals after tuning; lessons display measured damage, not the sum of unscaled move damage.

Never auto-reposition a victim, enlarge hitboxes only during a lesson, add invisible hits, or refill a resource mid-route outside practice to satisfy these targets.

## Combat and data contracts

### One route catalog, existing move authority

Add `game/src/engine/comboRoutes.js`, a renderer-free catalog and selector. Each route declares:

```js
{
  id, name, kind,                    // ground | juggle | assisted
  kits,                             // explicit supported kits
  steps: [
    { keys: ['down', 'hp'], expectedMove: 'uppercut', contact: 'launch' },
    { keys: ['lp'], expectedMove: 'lightPunch', contact: 'air' }
  ],
  timingByKit,                      // cancel/link gates, bounded waits, tested input windows
  setup: { distance: 0.85, stocks: 0, dummy: 'idle' },
  expectedHits: 2,
  description, tips,
  demoEligible: true
}
```

Keep damage, hitboxes, costs, cooldowns, `cancelInto`, and `easyChains` authoritative in move/kit data. Catalog validation resolves each route against a supplied fighter/kit; the catalog must not import `combatKits.js` and create a dependency cycle. Reject missing moves, incompatible contact requirements, unavailable cancels, bad timing windows, duplicate IDs, and incorrect resource declarations.

`keys` is an array per step, so simultaneous chords cannot be confused with successive taps. `timingByKit` describes playback and teaching windows; it grants no extra cancel permission. Preserve legal attacks and improvised combos that are absent from the catalog.

### Inputs and cancel behavior

1. Preserve the current chord resolver and finisher-phase rules. Sequential buttons inside its chord window can legitimately form a chord; lessons explain and show that result instead of reinterpreting it as a string.
2. Resolve directions and stance when committing the command, then retain that intent in the six-frame action buffer. Neutral assisted-chain mappings apply only where currently allowed; a held direction must not silently become a neutral assisted attack.
3. Allow a cancel only after a successful hit and inside the move's inclusive cancel window. Block, whiff, insufficient meter, or cooldown cannot unlock a route or skip recovery. A failed assisted transition never awards route progress.
4. Held buttons create one press. Expired or consumed buffer entries cannot repeat. Hitstop still samples press/release edges; combat timers and the action-buffer lifetime freeze. Pause and hidden-tab suspension do not generate queued attacks.
5. Reset command, route, and playback state on round changes, practice reset/selection, mode exit, and interruption. Preserve ordinary input buffering for an attack after natural recovery; that attack is not automatically part of a confirmed combo.

Keep the current three-frame chord window and six-frame action buffer initially. Boundary tests must pin down exact inclusive/exclusive behavior before any proposed timing change.

### Honest combo identity and route recognition

Add a small pure `game/src/engine/comboTracker.js` integrated at match resolution. Give an attacking move instance and an uninterrupted combo stable IDs within a match. Expose the identity in relevant snapshots/events without removing existing fields.

- A true combo continues while the defender cannot act between confirmed hits. End the authoritative sequence on the first actionable opportunity, landing, interruption of the attacker, or round termination. Check the opportunity before resolving another hit on that tick, so a same-tick return to idle cannot hide a gap.
- Keep the last total visible briefly in the HUD using presentation state, not the current six-frame gameplay grace. Damage scaling, route qualification, and profile combo statistics use the authoritative sequence.
- Track expected hit moves in order for one attacker/defender and one combo ID. Ground routes require grounded hit reactions; juggle routes require a real launch followed by airborne contacts before landing. Grabs, floor hits, stage hazards, projectiles, and unrelated hits cannot fill a basic route step.
- Require the route to begin with the combo opener. A later matching suffix or the final move on its own is not completion. Shared prefixes may advance several candidates; emit each route's completion once and present only the most specific completed result.
- A player's attempt checks committed input steps as well as confirmed moves. Raw presses can drive feedback but cannot mark a step successful before contact. Wrong input, block, whiff, interruption, timeout, or a recovery gap ends that attempt.
- Keep current `hit`, `block`, and `comboEnd` consumers compatible. Add identity/progress metadata and a small `comboRouteComplete` event carrying route ID, side, combo ID, hit count, and actual damage. Do not emit extra synthetic `hit` events for UI or effects.
- Emit `juggleLand` exactly once on `juggle → knockdown`, with defender, position, and the ending combo identity/count captured before reset. It is a presentation cue with no damage or new recovery delay.

The tracker observes combat and validates catalog routes; it cannot start moves or change physics. Define simultaneous trade ordering and test that one side's interruption cannot credit the other side's unfinished route. Preserve existing brutality behavior, updating its setup/tests where the stricter combo lifetime requires it.

### Keep juggle limits shared by every contact path

Retain `maxJuggleHits = 5`, shrinking re-pop velocity, rising gravity, and both combo and airborne damage scaling. The launcher counts as hit one. The cap rejects further melee and projectile hits until landing; a second projectile in the same tick cannot bypass it. A repeat launcher during an existing juggle consumes the same budget and never resets it.

Grounded sweeps remain a separate reduced-damage interaction: they cannot reopen the aerial route or extend the knockdown timer. Throws, grab conversion, invulnerability, and recovery choices retain their current restrictions. Basic route authoring must not accidentally make Lang or cinematic/prop attacks juggle-capable.

## Effects and presentation

Extend the current event-to-presentation path; no separate effects implementation for practice or demos.

| Moment | Visual / motion | Sound / UI |
| --- | --- | --- |
| Confirmed second/third hit | Small contact spark; modest increase in accent strength. Keep the existing recoil and attack arc visible. | Existing hit sound, bounded accent variation; hit count and total damage update immediately. |
| Launcher contact (`hit.launched`) | Short upward streak and compact lift ring at the actual contact. Reuse the existing juggle pose/rotation. | Low launch accent layered under the hit; brief `LAUNCH` cue in practice. |
| Airborne follow-up | Compact spark at the actual elevated contact, with a short fading trail. | Slightly rising accent pitch within a capped range; `AIR 2`, `AIR 3` in practice. |
| Listed route completion | One small accent on the confirmed final hit; optional route-name line beside the combo readout. | Brief completion cue. No new spoken line needed for every two-hit string. |
| Juggle landing | Low dust/impact ring and a bounded landing response at floor position. | One landing thud; hold final combo count/damage for 0.8 seconds of unpaused presentation time. |
| Block / whiff / failed attempt | Existing block effect or ordinary attack motion. | Practice explains the failed step. No launch, route-success, or aerial-hit cue. |

Use `vfx.js` sprite pools and `combatVfx.js` accents first. Existing model VFX have a total cap of 12 and per-asset cap of 4; added accents must obey the configured performance budget, and sprite/trail effects must use bounded pools too. Prefer 0.12–0.25-second contact accents and at most one active trail per airborne fighter. Reuse existing audio samples rather than adding dependencies.

Spawn contact cues once on the event frame, including during hitstop. World effects advance only with the existing `worldDt`; snapshot-driven trails/poses freeze with the simulation. Route completion must not add gameplay hitstop on top of the move's hitstop. Camera framing must keep both fighters and the airborne victim in view without a new cinematic cut.

Reduced motion removes added shake, streak motion, and zoom; retain readable contact flashes and text. Gore-off keeps neutral impact cues. Performance mode reduces decoration. Effects must clear on every practice/demo/match reset, mode exit, and delayed-load cancellation.

Centralize combo voice decisions in `Announcer`: `fightAudio.js` currently also triggers a four-hit voice. Prevent duplicate calls and retain KO/finisher priority. A completion accent must not interrupt the announcer or replay after an audio unlock/load completes.

## Practice integration

Add a **Combos** category with **Ground**, **Launch & follow up**, and **Carney chains** subsections. Generate it from supported catalog routes. Migrate the current juggle lesson and existing Carney entries without leaving duplicate lessons in Fundamentals; maintain aliases for callers using `lesson-juggle`.

Each route shows its input steps, actual character move names, cost, expected hit count, starting range, and one timing tip. The current step is highlighted; confirmed steps receive a check. Colors supplement text/icons. Keep controls readable on narrow screens and accessible through keyboard navigation.

- **Watch combo:** reset to the declared setup and execute real held inputs. Highlight presses and confirmed hits separately. Show the final measured total; then offer Watch again/Try it. Watching does not count as the user's completion.
- **Try it:** restore player control, clear the previous attempt, and set the same starting conditions. Mark success only after the required inputs and hits complete in order within one true combo. Keep the result until reset or the next attempt.
- **Feedback:** identify the failing step using observed facts: `Too early: still recovering`, `Too late: opponent recovered/landed`, `Blocked`, `Out of range`, `Different move`, or `Need 1 stock`. Do not infer “too late” merely because no hit has arrived yet.
- **Reset:** clear held inputs, action buffers, playback, combo state, effects, damage state, and history. Reapply the route setup. Automatic repetition is optional and off by default.
- **Resources:** keep existing unlimited resources for free practice. Add an explicit `Route cost` meter option: start with the route's required stock and disable replenishment for the attempt. A zero-stock negative test must demonstrate that the metered ending is unavailable.
- **Dummy:** Watch temporarily uses the route's neutral dummy setup and restores the chosen behavior afterward. Try respects standing/blocking/crouch-blocking/repeat-jab selections; a defensive interruption is a real failure, never a forced success.
- **Sides:** add a side-swap control and route all practice helpers through a player-side parameter instead of hardcoded `match.left` / `match.right` and side zero. Preserve the user's fighter and remapped controls; only arena side changes.
- Quarter, half, and normal speed have identical simulation-frame success windows. Changing speed never resets the attempt; pausing freezes it.

Extract attempt logic from `main.js` into `game/src/game/comboPractice.js`. Keep `main.js` responsible for mode lifecycle and wiring, and `practicePanel.js` responsible for presentation.

## Playback and CPU demo integration

Add a pure `game/src/engine/comboPlayback.js` state machine shared by Watch and CPU combo intents. Its inputs are a route, actor side, public snapshots, and observed combat events; its only gameplay output is held-button flags. It cannot call `startMove`, `applyContact`, reposition fighters, or set combo/health/meter values.

Playback has explicit press, release, wait-for-contact, wait-for-recovery, and finished/aborted states. Chord steps hold directions until command resolution. Every expected contact has a bounded timeout. Reject stale contact events by attack instance and combo identity. Follow-up gates use simulation state and calibrated route windows, not a universal `frame / 12` schedule.

Track input-sampling ticks separately from advancing combat ticks: chord resolution may finish during hitstop, while move recovery and follow-up deadlines do not advance. After emitting a press, emit its release even if a freeze begins; never issue the next route step just because wall time passed. Replays at different render rates must produce the same combat event trace.

CPU integration:

1. Add a route intent to `engine/ai.js`. Select a route only when spacing, kit, meter, cooldown, and current state allow it. Abort on a blocked/missed opener, wrong state, interruption, dropped juggle, or match phase change.
2. Feed public post-step events to active controllers through a small `observe(events, snapshot)` seam. `main.js` owns event delivery; `AttractDirector` forwards to its controllers. Do not let the shared runner inspect mutable fighters or future inputs.
3. Retain difficulty-based reactions and variety. Rookie occasionally attempts the two-hit route; normal/hard may choose longer routes. All use the same legal input/cancel rules. An already started route uses its authored timing rather than waiting another full CPU decision interval between hits.
4. Give attract controllers a bounded preference for an as-yet-unseen ground route and juggle route, while retaining the opponent's real AI and existing finale behavior. A failed attempt returns to normal fighting; it must not freeze a dummy or force contact.
5. Measure completion from route events. For a fixed six-match Carney/opponent/side demo cycle, require at least one completed ground route and one completed juggle for each eligible attacking fighter represented in the cycle. Across additional seeds report attempts, confirmations, and drops; do not assume every competitive round will land every route.
6. Keep single-move variety, including metered specials and projectiles. Investigate the existing `meteorKick` coverage failures while adding route selection so combo preference cannot starve the rest of the move list.
7. Add a compact route label only after successful completion in full-screen Demo. Keep the menu vignette unobstructed. Any existing demo exit input still exits without activating a menu item, and input/effect/controller state clears on return.

`showcaseDeck()` may derive combo entries from the catalog for tooling, but editing it alone does not satisfy demo integration. Both live demo surfaces must visibly perform the new routes.

## Implementation phases and ownership

Owners describe responsibility boundaries, not a requirement to spawn agents. Work can be done sequentially. The integration owner controls shared `main.js` edits; other owners expose tested interfaces instead of adding independent mode branches there.

| Task | Depends on | Owner / files | Deliverable and pass gate | Negative gate |
| --- | --- | --- | --- | --- |
| C01: catalog and baseline | — | Combat: new `engine/comboRoutes.js`; new `test/combo-routes.test.js` | Register the seven route definitions; validate kit availability; record current timing/damage traces and the two CPU failures. Existing Carney IDs and input behavior remain valid. | Missing moves, duplicate IDs, impossible contact requirements, or Lang launch routes fail validation. |
| C02: reliable inputs and routes | C01 | Combat: `commands.js`, `fighter.js`, kit move files only as needed; `test/combo-input.test.js` | Measured per-kit schedules and four-tick acceptance windows; all required ground/juggle routes work through raw inputs on both sides and specified starting gaps. Existing Carney cadence tests pass. | Held inputs, stale buffer entries, blocked/whiffed openers, chord overlaps, insufficient meter, and cooldown cannot create a free route. |
| C03: true combo lifecycle | C01, C02 | Combat: `match.js`, `fighter.js`, new `comboTracker.js`; `test/combo-lifecycle.test.js` | Stable identities, ordered route events, accurate damage totals, one landing event. Split gameplay continuity from HUD linger. | Escapable gaps, a lone final move, unrelated hits, duplicate events, trades, and post-landing hits cannot complete a route. |
| C04: bounded juggle regression | C02, C03 | Combat: existing `test/juggle.test.js`, new route fixtures | All three fighters perform two/three-hit aerial routes; fifth airborne hit caps the session; scaling and recovery remain correct. | Melee/projectile same-tick contacts, repeated launchers, corners, ground sweeps, and throws cannot bypass the cap or sustain an infinite. |
| C05: shared playback | C01–C04 | Teaching: new `engine/comboPlayback.js`; `test/combo-playback.test.js` | Watch/CPU-compatible button-only runner; mirrored inputs; pause freezes playback; identical traces at 30/60/144 Hz and all practice speeds. | Bounded abort on misses, failed cost/cooldown, interruption, reset, and phase changes; no hidden state mutation or queued phantom press. |
| C06: impact cues | C03, C04 | Presentation: `vfx.js`, `combatVfx.js`, `impact.js`, `movementPose.js`, `camera.js`, `hud.js`, `fightAudio.js`, `announcer.js` as needed; `test/combo-effects.test.js` | Launch/air-hit/landing distinguishable; exactly-once cues; pooled effects; completed total readable. Reuse existing animation and sound assets. | No cues on block/whiff; no stacked hitstop or duplicate voice; no stale effects after reset; reduced-motion/gore/performance options honored. |
| C07: practice experience | C03, C05, C06 | Teaching + integration: `practice.js`, new `comboPractice.js`, `practicePanel.js`, `practice.css`, command helpers; integration-owned `main.js`; `test/combo-practice.test.js` | Catalog-driven tab, step feedback, Watch/Try/reset, side swap, resource options. Both raw input and contacts prove completion. | Watching, wrong sequences, dropped combos, unsupported kits, and metered endings without stock cannot report user success. |
| C08: CPU and demo adoption | C03, C05, C06 | CPU + integration: `ai.js`, `attract.js`, integration-owned `main.js`; `test/combo-ai.test.js`, existing attract/combat tests | Measurable completed ground/juggle routes in the fixed demo cycle; preserve full Cold Cut/result flow and move variety; resolve both baseline coverage failures. | No forced hits or route-specific health edits, endless retries, stolen player controls, profile writes, skipped ending, or unavailable kit moves. |
| C09: integration release gate | C04–C08 | Integration: docs, regression run, browser review, evidence | All automated gates pass; browser captures/audio/input checks complete; update README controls, combo lessons, and actual demo behavior. | Any missing runtime evidence, unexplained failing required check, clipped airborne fighter, or broken mode transition blocks completion. |

Recommended first vertical slice: migrate `easy-carney-roundhouse` and `juggle-first` through catalog → tracker → Watch/Try → launch/landing cues → one CPU route intent. Prove that slice with real inputs before adding the other routes and per-kit tuning. Complete C01–C05 for all routes before final practice and demo rollout.

## Validation and evidence

### Automated acceptance matrix

- Every supported route × eligible kit × both sides × each distinct roster opponent × center gaps 0.75/0.85/1.0 m. Successful route evidence is an ordered raw-input/contact trace with no actionable defender gap, actual scaled damage, meter consumption, and finite landing/recovery.
- Pin command/cancel boundaries: inside/outside the three-frame chord arbitration, six-frame buffer expiry, earliest/latest cancel frames, and press/release during hitstop. Include a direction released before command commit and after commit.
- Guard/block from the beginning prevents a confirmed route. In a separate fixture, let the opener connect through real inputs, then have the defender hold block from that contact onward. If it can block an intermediate hit, the fixture is not a true combo.
- Wrong order, opener miss, final move alone, delayed button, button hold, accidental grab/throw chord, interruption/trade, insufficient stock, and cooldown all produce the expected failed attempt without corrupting the next one.
- Verify all proposed timing windows by sweeping input offsets, not by testing one ideal schedule. Every accepted timing must complete, and offsets outside the published window must not be misreported as success.
- Test both arena walls. At valid close spacing, mirror behavior stays finite and consistent; a route that drops for spacing must report the drop honestly. Repeated aerial strikes and multiple projectiles cannot exceed the shared five-hit limit or reset lift/knockdown protection.
- Replay representative routes through `SimulationClock` at 30/60/144 render Hz and practice speeds 1/0.5/0.25. Compare attack/hit/route/end event order, damage, resources, and landing state. Include pause, resume, reset during hitstop, and hidden-tab catch-up.
- Verify Watch and CPU only submit inputs after initial practice setup; no runtime writes to combat outcomes. Headless physics unit tests may construct states, but route/demo success tests must use real buttons from their declared start.
- Preserve existing movement, weapon/projectile, finisher, brutality, stage-hazard, profile-isolation, audio, and attract-ending tests. Add a raw-input fixture per route and retain seeded competitive simulations as a separate demo-quality check.

### Browser acceptance

1. Enter Practice through the actual menu. Watch a ground route and a juggle; Try both manually with keyboard, then a gamepad if available. Remap a key, swap sides, and repeat. Record hardware validation as untested if unavailable.
2. Intentionally hold a button, overlap a chord, whiff, block, run out of meter, and miss the air timing. Verify readable feedback, no false completion, and a clean retry.
3. Compare normal/half/quarter speed. Pause during launch and reset during an airborne follow-up. Confirm poses, trails, contact flash, combo total, and audio do not drift or leak into the next attempt.
4. Observe the title vignette and full-screen Demo long enough to capture completed ground and aerial routes, their landing effects, the entire finale, and the transition to the next match. Exit with keyboard, pointer, and gamepad; confirm configuration/profile remain intact.
5. Capture a launcher, second aerial hit, landing, successful practice result, and failed practice result at desktop and narrow viewport sizes. Verify that the panel, HUD, camera, and effects do not obscure the fighters or crop the airborne victim.
6. Inspect reduced-motion, gore-off, performance mode, and muted audio. Listen to an unmuted route for distinct but nonduplicated launch/hit/landing cues. Watch several repeated routes to confirm bounded effects and cleanup.

Store implementation evidence under `artifacts/combos/`: baseline and final test summaries, route traces/timing windows/damage measurements, seeded demo coverage, screenshots or short recordings, and a short environment/verification note. Do not generate placeholder evidence during planning or describe a passing unit test as visual verification.

Final commands after implementation:

```powershell
node --test test/combo-*.test.js test/carney-flow.test.js test/juggle.test.js test/practice.test.js test/movement-practice.test.js test/attract.test.js test/combat.test.js test/announcer.test.js test/menu-audio.test.js test/simulation-clock.test.js test/impact.test.js test/model-vfx.test.js
npm test
npm run build
```

Run `npm run check-vfx` if the shipped VFX pack changes. The full asset-pipeline suite needs Python with NumPy/Pillow; use the repository's documented `FIGHTER_PYTHON` override when necessary and report any unavailable prerequisite. A plan file, a successful build, or an isolated physics test is not evidence that the user-visible feature is complete.

**Done means:** the published routes work through real controls, practice truthfully teaches/verifies them, both demo surfaces perform them, accompanying effects/audio survive all mode transitions, and the required automated and browser evidence is present.
