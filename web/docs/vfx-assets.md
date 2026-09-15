# Runtime VFX assets

The selected pack contains five assets totaling **3,534,260 bytes (3.37 MiB)**. Original files in `vfx/` remain untouched. Files in `game/public/vfx/` are exact copies with stable, short names; geometry, textures, material distinctions, skeletons, animation clips and attribution metadata are preserved.

## Rebuild and verify

From the repository root, after installing the project's dependencies:

```sh
node tools/prepare-vfx.mjs
node tools/prepare-vfx.mjs --check
```

The first command writes the selected GLBs, `manifest.json` and `ATTRIBUTION.md`. The second command is read-only and fails if any generated file differs from its reproducible result. The manifest has no timestamp or machine-specific paths. It includes exact source asset metadata, SHA-256 checksums, embedded resource checks, bytes, triangle counts, skins, clips and measured bounds. The script uses the project's installed Three.js loader to verify that each scene, skin and complete clip can be parsed.

Only the five explicit source filenames are selected. The large lightning, a-bomb, ultrako and explosion downloads are excluded from this pack. Selection avoids shipping roughly 180 MB of additional source models with much higher geometry or texture cost; the original files remain available for a future optimization pass.

## Assets and orientation

Coordinates below include all source node transforms. The game uses X for the direction of combat and Y for height.

| ID | Runtime file | Bytes | Triangles | Animation |
| --- | --- | ---: | ---: | --- |
| `fireball` | `vfx/fireball.glb` | 211,168 | 5,093 | None |
| `laser` | `vfx/laser.glb` | 299,084 | 4 | None |
| `shield` | `vfx/shield.glb` | 1,075,488 | 1,152 | None; contains a skin |
| `appearance` | `vfx/appearance.glb` | 420,428 | 8 | `Take 001`, 1.6666666 seconds |
| `burst` | `vfx/burst.glb` | 1,528,092 | 72 | `Take 001`, 12.5999117 seconds |

- **Fireball:** Nearly spherical, approximately 1.90 × 1.95 × 1.89 units. Its source center is `[-0.1425, 0.7535, -0.0083]`, so recenter before scaling or spinning. It has emissive materials and no textures. Movement, spin and fade come from the runtime.
- **Laser:** Two intersecting textured planes, 2 units long along Z and approximately 0.0866 units wide. Rotate its wrapper `+PI/2` about Y to point along +X. Scale local Z separately from X/Y when controlling beam length and thickness.
- **Shield:** A disc in XY facing Z, approximately 19.9277 units across and 3.3211 deep. Scale near `0.1` yields a disc about 2 units wide. Its source center has a small Z offset. This is a skinned mesh despite the absence of clips; clone the skeleton with `SkeletonUtils.clone` before using independent instances.
- **Appearance:** Four textured layers oriented horizontally in XZ. Its title says light beam, but the model is only about 0.536 units high. Its animated footprint spans approximately 4.28 units. Leave it horizontal for a ground summon or rotate its wrapper `+PI/2` about X to make an upright effect. The clip scales in during the first 0.27–0.37 seconds and then rotates the layers. Supply a runtime fade.
- **Burst:** A layered ground sigil with rotating rings and a shallow volume. Its animated footprint spans approximately 2.915 units. Several single-key animation tracks set layer poses immediately at time zero; initialize the mixer before displaying it. Leave it horizontal for a ground effect or rotate its wrapper `+PI/2` about X for an upright impact. The 12.6-second clip is mainly rotation, not a baked explosion. Runtime expansion and opacity envelopes turn it into a short burst; it can also be a looping sigil.

## Reuse and playback

Load each GLB once and share geometry and textures. Clone materials for per-instance colors and fades; clone the shield's skeleton for each independently transformed instance. Apply runtime positioning, rotation and scaling to an outer wrapper so animation tracks can continue controlling the original nodes. Reset animation state and material values when returning pooled instances to use.

Preserve texture alpha and the distinction between base-color and emissive textures. Multiplying a strongly colored source texture by a new tint cannot produce every hue; retain source color detail and use a suitable shader color transform for broad recoloring. Bright effects can use unlit rendering or controlled emissive intensity without forcing opaque layers into the same blending mode.

Duration, playback speed, fade and looping are separate controls. A complete clip can be fit to a chosen lifetime using `clip.duration / lifetime` as the playback speed. Repeating a sustained sigil can instead use the natural clip rate and a longer runtime lifetime. Fade the enclosing effect independently of animation timing.

`manifest.json` contains rest bounds measured from actual transformed vertices, including the shield's skin pose. Animation bounds include the rest bounds plus every authored key time and uniform samples at 60 Hz. This is a sampled visual envelope for normalization, not a mathematical collision or interpolation bound.

## Attribution

The embedded metadata in all five source files declares `CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)`. Exact titles, author strings and source URLs are reproduced in the distributed `game/public/vfx/ATTRIBUTION.md` and `manifest.json`. Keep that attribution available alongside the game when publishing the pack. Runtime transformations may alter size, orientation, color, opacity and timing; the distributed GLB binaries are unchanged. No artist endorsement is implied.
