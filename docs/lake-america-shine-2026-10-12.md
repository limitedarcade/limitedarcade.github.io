# Lake America surface finish · October 12, 2026

The Blender master and runtime export now have baked soft contact shading, cooler snow and shoreline ice, warmer cedar, deeper evergreen needles, and refined enamel, steel, and bronze. The bronze bell catches broad highlights while retaining its patina and physical split. No gameplay or renderer code changed.

All Blender authoring, backup loading, baking, and export ran through the native Blender MCP tools. The recipe is `web/tools/shine-lake-america-mcp.py`. The editable master remains `web/stages/lake_america/blender/lake-america.blend`.

## Review

- Live artist review: <http://127.0.0.1:5176/lake-america.html>
- Local matched comparison: `web/artifacts/lake-america/shine-2026-10-12/comparison.html` (local review evidence).
- Production preview: <http://127.0.0.1:4176/>
- Captures, authoring data, asset comparison, and summarized profiling: `web/artifacts/lake-america/shine-2026-10-12/`.
- Original `.blend`, source GLB, and manifest: that directory's `before/` folder. Blender's incoming default scene also has a separate recovery copy.

The six comparison cameras are combat, waterfront, bell, axe, Freedom machine, and aerial. Captures use the game's actual stage renderer at 1600 × 900 with animation paused, identical cameras, and identical canvas dimensions. The axe preview threw the actual pickup and restored it on round reset in both captures. The artifact and game remain local.

## Budget and asset checks

| Item | Before | After |
| --- | ---: | ---: |
| Exported triangles | 236,871 | 236,871 |
| Mesh primitives | 244 | 244 |
| Materials | 38 | 38 |
| Embedded images | 29 | 29 |
| Source GLB bytes | 26,898,032 | 26,509,188 |
| Matched aerial stage draw calls | 425 | 425 |
| Stage review shader programs | 28 | 28 |

Contact shading uses 1,383,012 offline hemisphere rays across 198 existing color-bearing meshes. It is stored in their vertex colors; six existing packed roughness images were refined at their existing dimensions. No extra runtime lights, meshes, images, or material variants were introduced.

The GLB comparison confirmed unchanged vertex positions, normals, UVs, and node transforms. Two Freedom-machine hardware primitives received different index arrays during Blender re-export; their position, normal, and UV arrays and the total triangle count remain unchanged. Named pickups, floe pivots, sign parents, and the clear combat corridor passed the asset checks.

The existing asset pipeline converts the source GLB to meshopt geometry and WebP textures. The optimized scene served by development and packaged in production matched byte-for-byte at 8,390,704 bytes. The larger editable source GLB is intentionally different from that optimized file. The release exception is 8.01 MiB: this completed asset exceeds 8 MiB by 2,096 bytes, so the narrow allowance preserves its finished textures and geometry. The total-site and first-fight caps remain unchanged.

## Performance

Matched full exhibition → finisher replays used local Chrome, hardware WebGL on NVIDIA RTX 4060, 1280 × 720, DPR 1. Neither run took screenshots during measurement. No Blender render or build ran during either recording. Blender stayed open in both runs.

| Metric | Before | After |
| --- | ---: | ---: |
| Battle median frame | 16.7 ms | 16.7 ms |
| Battle 95th percentile | 16.8 ms | 16.8 ms |
| Battle median draws | 419 | 420 |
| Battle largest interval | 199.9 ms | 183.3 ms |
| Finisher median frame | 16.7 ms | 16.7 ms |
| Finisher 95th percentile | 16.8 ms | 16.8 ms |
| Finisher median draws | 509 | 509 |
| Finisher largest interval | 100.0 ms | 100.0 ms |

The one-draw battle median difference comes from sampling a moving exhibition; matched static stage counts are identical. There was no measurable frame-time regression in this host run. Existing severance work still caused brief hitches in both recordings: three battle intervals and two finisher intervals exceeded 50 ms in each run. This is not a claim of perfectly even frame pacing or phone/headset performance.

Detailed recordings: `web/artifacts/performance-2026-10-12/shine-before.json` and `shine-after.json`.

## Validation

From `web/`:

```powershell
node --test test/lake-assets.test.js test/lake-atmosphere.test.js test/lake-edges.test.js test/lake-endings.test.js test/stage-axe.test.js test/render-performance.test.js
npm run build
node tools/capture-lake-shine.mjs after
node tools/profile-battle.mjs shine-after
```

All 28 focused checks passed. Coverage includes actual GLB geometry and material decoding, arena floor and corridor clearance, pickup and floating pivots, weapon restoration, atmosphere lifecycle, HDR targets, stage changes, endings/sign restoration, static batching, and finisher presentation. The build passed with the existing missing `/art/arena-night.webp` and large-chunk warnings. Both capture runs and both full profiling runs reported no page errors.

The built game was also opened through the normal Play → fighter selection → Lake America flow. The local comparison's camera buttons and reveal slider were checked in the in-app browser. Visual review covered the exported scene; final artistic acceptance remains with the user.

## Replaying the Blender recipe

Use Blender MCP exclusively. Open `before/lake-america.blend` in its own MCP call, then let Blender finish switching file context before the next call. Execute the recipe into a namespace, call `prepare()`, `bake_range(0, 198)`, and `refine_surfaces()`. Store the namespace in `bpy.app.driver_namespace` if calls are split. Call `export_pass()` from the next MCP call. The pass refuses to bake an already-finished master. Do not run the old procedural scene builder over this finished master.
