# Severance performance — 2026-10-12

Severance now resolves bone and active morph transforms once per pose, visits only the triangles incident to the cut chain, and builds clipped output in typed buffers. Region tissue templates and complete head buffers are prepared during loading. A separate rehearsal pool exercises the cut builders without leaving live damage, debris, or queued blood events.

The wound continues to fit its live animated seam. Its angular lookup and coordinate transform are reused, while normal generation uses direct buffer math with the same Float32 accumulation and normalization as Three. The detached surface, wound, outgoing tissue, hanging strands, materials, UVs and authored detail remain intact.

## Measured result

Chrome, NVIDIA RTX 4060 / ANGLE D3D11, 1280 × 720, DPR 1. Both runs played the full title exhibition through the Carney finisher without screenshots during measurement. The original implementation ran on an isolated Vite server using Git revision `269ddc0cafca7d6c8f21f7aa10a9379aebfe9e77`; the optimized implementation used the same isolated server configuration and current stage assets.

| Recorded work | Original | Optimized | Reduction |
| --- | ---: | ---: | ---: |
| Arm severance CPU, fight frame 161 | 112.2 ms | 28.7 ms | 74% |
| Head severance CPU, finisher frame 218 | 94.4 ms | 49.3 ms | 48% |
| Worst finisher frame interval | 116.7 ms | 66.7 ms | 43% |

The median frame interval remained 16.7 ms. The largest cut still exceeds the 16.7 ms frame budget. Separate battle spikes around fight frames 1264–1279 remain: the overall worst fight interval was approximately 216 ms in both runs. These measurements demonstrate reduced severance cost, not hitch-free gameplay or a physical-device performance guarantee.

Raw reports: [original](../web/artifacts/performance-2026-10-12/severance-baseline-final.json), [optimized](../web/artifacts/performance-2026-10-12/severance-final.json). The separate [finisher capture](../web/artifacts/performance-2026-10-12/severance-visual-cut.png) shows the detached head, neck tissue and blood, and is excluded from these timing claims.

## Detail and lifecycle verification

`node tools/verify-severance.mjs 269ddc0cafca7d6c8f21f7aa10a9379aebfe9e77` compared 144 cuts across Carney, Trump, Lang and Officer Flock, both facings, ordinary and cinematic cuts, isolated regions and a sequential arm/arm/head sequence. It compared all detached and cap geometry attributes, normals, indices, material groups, sever masks, wound paint, active wound fields, seam samples and strand counts. Maximum numeric difference: **0**. See [geometry-parity.json](../web/artifacts/severance-2026-10-12/geometry-parity.json).

44 focused tests passed using:

```powershell
node --test test/severance-preparation.test.js test/gore-seam.test.js test/stump-flesh.test.js test/gore-surface.test.js test/gore-off.test.js test/gore-settling.test.js test/axe-gore.test.js test/render-performance.test.js test/finisher-director.test.js
```

Coverage includes exact normal generation for indexed, flat and degenerate surfaces; four-weight skinning and morph targets with nonuniform world transforms; clipping and UV parity; moving seams on all four fighters; outgoing tissue attachment; gore-off behavior; axe cuts; finisher event timing; round resets; rehearsal isolation; and disposal of consumed and unused prepared buffers.

`npm run build` passed. Existing warnings about `/art/arena-night.webp` and large chunks remain. `git diff --check` passed. Stage and gore source assets were untouched by this runtime pass; unrelated scene and demo changes were preserved.

Reproduce measurements from `web/`:

```powershell
node tools/profile-battle.mjs severance-baseline-final --baseline=269ddc0cafca7d6c8f21f7aa10a9379aebfe9e77
node tools/profile-battle.mjs severance-final --isolated
```

The `--baseline=REVISION` switch reads the original runtime modules from Git without replacing working files; plain `--baseline` uses HEAD. Both isolated servers close when their profiler run finishes. For a visual capture, add `--finisher --capture` using a different report label. The local game preview is available at http://127.0.0.1:5176/ while `npm run dev` is running.
