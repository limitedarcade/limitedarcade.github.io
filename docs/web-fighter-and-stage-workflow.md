# Web fighters: concept to combat

This is the current 3D web workflow. The older `fighter-workflow.md` describes the SNES sprite pipeline; its fighting-stance image requirement does not apply to generating a riggable 3D character.

## Consistent concept art

1. Choose one approved fighter render as the style reference. Use the same reference for every new character, rather than referencing the most recently generated character (which accumulates style drift).
2. Lock a short visual brief: exaggerated fighting-game proportions, sculpted facial planes, readable silhouette, broad clothing folds, restrained material shine, and the palette in `web/COLOR_BIBLE.md`. Record the unique costume, build, height and identifying details separately.
3. Generate a full-body front T-pose on a plain light background, with even neutral lighting. Keep both arms, hands, legs and feet separate and visible. Avoid props in the hands, floor shadows, scenery, action effects and perspective foreshortening. Open relaxed hands are appropriate when finger rigging is available; close them after rigging.
4. Approve that design first. Generate side and back views as edits of the approved image, keeping clothing seams, belt placement and proportions identical. Check the views together. Feed separate views to a multi-view input; do not send a collage as a single-character input.
5. Compare the resulting model to the same style reference under identical game lighting. Texture density, material response, proportions and silhouette matter more than repeating a style adjective in the prompt.

Reusable image prompt:

> Use the attached approved fighter as the style reference. Create [NAME], [BUILD AND DISTINCTIVE FEATURES], wearing [EXACT COSTUME]. Match the reference's exaggerated arcade-fighter proportions, sculpted shapes, broad clothing folds, texture detail and restrained material finish. Single full-body character, front orthographic view, symmetrical T-pose, separated legs, unobscured relaxed hands, all extremities visible with margin. Plain light-gray background, neutral even studio lighting, crisp costume details. No weapons, scene, text, interface, motion, glow or baked directional shadows. Preserve [IDENTITY CHECKLIST].

## Hi3D and importing

Keep Hi3D as the image-to-textured-mesh step if its results match the approved design. It is already supported by this project's fighter tool. Its output is a source asset, not a finished combat rig. Keep UVs and texture maps; do not discard fine uniform detail by baking everything into low-density vertex colors.

For unrigged Hi3D humanoids, use `web/fighter-tool`: validate the textured GLB, optionally include the matching six-part export, bake/split, reduce geometry, measure joints, tune that character's guard, rig, and export the shared clips. Review shoulders, elbows, knees and hands in motion before registration. The existing canonical pack is optimized for the six named parts and 25-bone rig.

For an already rigged imported character, preserve its hierarchy, skin weights, materials and rigid attachments, and retarget the shared clips. Officer Flock uses this route because he has a Mixamo-style rig. Do not run a T-pose body slicer on arbitrary posed or multi-rig assemblies.

Rebuild Flock from the repository root:

```powershell
node web/tools/build-officer-flock.mjs
```

His standard kit is declared in `web/game/src/fighters/officer_flock.js`. It intentionally has no bespoke move definitions or projectile behavior. The builder closes his grouped finger chains, preserves the head attachments, and exports 32 shared clips. A loose gun handle outside the body is exported separately so it cannot skew fighter bounds or portraits.

His helmet and the surveillance camera over his face are authored as children of the head in the source sculpt; they are not stray props the builder picked up. The source also carries a swastika armband on the right sleeve, painted into the 1024² albedo — worth deciding about deliberately, since storefront policies are strict and it is cheaper to edit the texture than to rebuild later.

## Retargeting: how it works and where the knobs are

Animations are **baked in Node, not in a DCC app**. `web/tools/retarget.mjs` opens the source rig, plays each clip through a real `AnimationMixer`, samples it at 30 fps, and writes fresh keyframe tracks onto the imported skeleton. Nothing is hand-animated per character.

The practical consequence: **adding an animation to every retargeted fighter is one clip on the source rig.** Add it to `trump-rigged.glb`, re-run each fighter's builder, and everyone inherits it. Trump's rig is the animation library; treat it as the asset it is.

A fighter builder is a config file, not a program. `build-officer-flock.mjs` is the template — paths, a fist table, and expectations. Everything general belongs in `retarget.mjs`.

### The knobs, and what each one actually moves

| Want to change | Edit | Then |
| --- | --- | --- |
| How tightly the fists close | `fist` in the fighter's builder | Re-run the builder |
| Wrist / arm rest orientation | `restCorrections()` in `retarget.mjs` | Re-run the builder |
| Animation sample rate | `fps` in the builder (default 30) | Re-run the builder |
| Which props follow the head | `attachToHead` / the source hierarchy | Re-run the builder |
| Silhouette rim colour and strength | `RIM` in `render/rimLight.js` | Live; no rebuild |
| Cloth relief, shine, self-lit lift | `dress()` in `render/fighterView.js` | Live; no rebuild |

Rebuild and review:

```powershell
node web/tools/build-officer-flock.mjs
npm --prefix web run dev   # then open /flock-review.html
```

### Rules that came from real breakages

- **The bake owns finger pose. The runtime never re-poses fingers.** A load-time counter-pose means the asset you review and the asset the game renders are two different poses. `fighterView.place()` used to do this and it hid a bad bake for weeks.
- **Grouped finger chains curl far less than a real hand.** Flock's rig has only thumb and index chains, and the index is skinned to all four fingers as one mitten. A mitten has no gaps to nest into, so a real hand's 250-plus degrees folds it through the palm. Flock sits at about 112° total and looks like a fist.
- **Local X is the flexion axis.** Middle and tip joints carry pure local-X rotations in bind; a Z component on a knuckle is its authored *spread*, not a bend.
- **Wrists cannot be aligned by matching bone directions.** The source rig has no fingers, so its hand's only child is a tip bone, while an imported hand's first bone child is usually the thumb — matching them aims the wrist at the thumb. Instead the wrist inherits the forearm's correction and cancels the difference between the two bind orientations, which lands it on the source rig's neutral exactly. This is what removes a grip the character was sculpted holding. The gate verifies it reads 0.0°.
- **The bind pose stays as the artist sculpted it.** Corrections live in the baked tracks, so the skin weights still mean what they meant. Anything measuring the rig must measure a clip, not the bind.
- **A packed roughness/metalness map with no albedo has to go — but replace it, don't just drop it.** Those maps carry near-black channels that beat a high scalar roughness and make the surface crawl with specular moire under the stage's coloured keys; Flock's helmet (127k triangles, 95% of his mesh) was the worst of it. `dress()` strips the packed maps from *every* Flock material now, and for the ones with no albedo it then sets `roughness` / `metalness` / a steel-grey `color` by hand so the shell reads as steel rather than the flat grey putty it became the first time this was tried without the hand-set fallback.
- **Flock's uniform albedo is painted almost black** (linear ~0.02), so the stage's warm key barely lifts it off the backdrop and the shadow side crushes to a cut-out. `dress()` gains the albedo up (`color.multiplyScalar(2.0)`), holds `roughness` at 0.95 so the coloured lights stay diffuse, and keeps a sliver of `emissiveIntensity` (0.16) as self-fill. Tune those three together, per-fighter, rather than pushing the scene lights — the stage is lit for the painting.
- **Screen exposure and the Lake America grade were both set too dark.** `renderer.toneMappingExposure` is 1.13 and `GRADES.lakeAmerica` lifts the shadows slightly positive; `uVignette` default dropped to 0.34. These lift every character, not just Flock. Retune against the painted backdrop so the city doesn't blow out.
- **Rim light is not free on low-poly bodies.** The fresnel in `rimLight.js` is tuned for smooth meshes. Flock's uniformed body is 4,871 triangles with hard normals at every seam, so the term fires on interior seams as well as the silhouette — the red lines down his arms and legs. Lower `RIM.strength`, raise `RIM.power`, or cut `normalScale` further in `dress()` (Flock now takes an extra `*0.55` on top of the shared halving).
- **Triangle budgets are usually inverted on imports.** Check where the triangles actually are before optimising. On Flock the entire uniformed body is 4,871 and a single helmet is 127,450.
- **Blood is a per-vertex attribute.** On a low-density body it interpolates across huge faces, so wounds read as scattered speckle rather than a mark. Wound density is bounded by mesh density.

### The build gate

`retarget.mjs` refuses to write an asset that fails its checks, and prints what it measured. Every check exists because that exact failure once shipped unnoticed:

- every clip the move table needs is present, and each one passes `validate()`
- both wrists sit within tolerance of their forearm in the T pose
- the expected number of bones mapped, naming any that are missing
- triangle count against `expect.triangles` or `expect.maxTriangles`
- materials with no albedo are listed by name, so `dress()`'s hand-set steel fallback can be checked against the list

Tighten a fighter by adding to `expect` in its builder. A build that fails is a build that does not overwrite a working asset.

## Asset audit, September 5, 2026

| Asset | Source triangles | Current result / remaining work |
| --- | ---: | --- |
| Officer Flock | 134,541 | Playable standard kit; 134,431 body triangles plus a separate 110-triangle handle. Original textured materials retained. |
| Angel | 1,036,253 | Three.js conversion preserves 20 meshes, 11 skin definitions (12 skinned meshes), and one `anim` clip. Needs geometry reduction, review of the multiple rigs and appendages, and combat retargeting. Not registered. |
| Silent Ash | 34,444 | Three.js conversion works as a static model. No skin or animations; needs rigging. Texture-heavy: source is 38.7 MB with several 4K maps. Not registered. |
| Carney stick | 332 | Lightweight and suitable for a hand-held prop; grip position and orientation still need authoring. |
| Carney skates | 91,792 | Pair of skates across 30 meshes; separate left/right assemblies, reduce geometry, and author grip/foot pivots. |
| Flock shuriken | 61,931 | Excessively detailed for a small projectile; reduce geometry and 4K texture sizes before gameplay use. |
| Flock thrown weapon | 9,906 | Suitable starting point; normalize size, orientation and center of rotation. |

The new non-playable conversions are in `web/fighters/converted/`. They are lossless Three.js ObjectLoader JSON assets with embedded images, materials, transforms, skinning and existing animation. They are review/source conversions, not optimized shipping packs: JSON can be considerably larger than the source GLB. Original GLBs remain intact. Existing Trump and Carney already use packed Three.js data in ordinary gameplay; their GLBs remain measurement/debug sources.

Convert another embedded-texture GLB:

```powershell
node web/tools/convert-scene.mjs input.glb output.json
```

Load the converted asset with `new THREE.ObjectLoader().loadAsync(url)`. Do not run static props through the canonical humanoid rig codec.

Two dev-only review pages. `web/game/asset-review.html` takes `?asset=` and loads any converted JSON directly, for props and unregistered conversions. `flock-review.html` is the pose board and takes `?fighter=`: it goes through the real `FighterView`, so materials, rim light and damage shaders are exactly what the game renders. One button per clip, each looping alone from frame zero; a global pause, frame steppers and a scrubber for stopping on a contact frame and orbiting around it. Use the pose board to judge stances and tune the `fist` table.

## Weapons and the Carney references

Use a small attachment system: an asset id, hand/foot bone, grip transform, visible frame window, and optional secondary-hand target. A two-handed stick should have one parent hand; the other hand follows an IK target on the stick. The weapon mesh is visual; simulation hitboxes, hit timing and collision remain explicit data.

The reference images combine a stick sweep/thrust, a thick orange-gold trail, impact flash, hitstop, victim recoil and a short camera push/orbit. The stick GLB supplies only the prop. A skate-blade special needs an authored hand-held or foot-worn pose and timing. These moves have not been implemented by this asset-import pass.

For throws/projectiles, detach a cloned prop into world space on a specified frame. Store position, velocity, lifetime, owner, collision size and hit-once state in the fixed-tick simulation. Decide whether it is blockable, reflectable, recoverable or a returning weapon. Render interpolation and spin belong in the view. This lets future objects reuse one projectile implementation instead of embedding game rules in each model.

## Stages and moving cameras

Use a hybrid environment: a skybox or seamless 2:1 equirectangular panorama for the distant sky, simplified skyline geometry in the middle distance, and genuine 3D ground and foreground props. A skybox responds to camera rotation but has no translational parallax; nearby scenery needs geometry to move convincingly relative to the fighters.

Current stages mix procedural 3D architecture/ground with flat painted panels and cutout props. The camera already has an orbit parameter for cinematic shots. Wider orbit angles will reveal the flat panels and cutout edges. Converting a painting's file format cannot supply missing side/back geometry.

Start with Lake America: keep the fighting floor, replace the flat sky with a seamless panorama, build a simple skyline/shoreline ring, and replace nearby tree/monument cutouts with 3D objects. Test an orbit of roughly 10–15 degrees in each direction, then expand only where the environment holds up. Keep ordinary combat on the same simulation plane and reserve larger camera swings for deliberate cinematic beats.

Use a neutral asset-review light rig for model QA, then the stage's coordinated key, fill, environment light and fog. The background image and lighting environment can be different textures. Keep a stable horizon and avoid putting close buildings into the skybox.

Primary references: [Hi3D documentation](https://docs.hitem3d.ai/en/), [Three.js background guide](https://threejs.org/manual/en/backgrounds.html).

## Where a kit's moves land in the practice list

The practice panel groups a fighter's moves into five tabs — Learn, Basics,
Specials, Supers, Finishers — and `shelveMove` in `web/game/src/game/practice.js`
decides which tab and which sub-heading each move lands under. It reads what a
move costs and what it does before it reads the move's id, in this order:

1. `cost >= 2` → Supers / Two stocks
2. `cost >= 1` → Supers / One stock
3. `projectile` → Specials / At range
4. `overwatch` → Specials / Summon
5. one of the universal ids in the `SHELF` table → Basics, under Normals,
   Crouching, In the air, Command or Clinch
6. anything else → Specials, under Two buttons if the chord table performs it,
   otherwise Signature

That order is what lets a kit repurpose a universal id without the move showing
up in the wrong place. Flock's `lungePunch` is a shuriken, so it files under
Specials / At range rather than beside the jab under Command; Carney's
`spinKick` costs a stock, so it joins the Supers whether or not the universal
order has heard of it. Rows sort by cost and then by the `ORDER` list, so the
two-stock burst always closes the Supers tab.

When authoring a kit:

- **Name every move you inherit.** `extendMoves` keeps the universal name when a
  kit does not override it, so an unnamed move prints "Heel Drop" next to the
  kit's own vocabulary. `Object.values(kit.moves).filter(m => MOVES[m.id].name === m.name)`
  lists what still needs naming.
- **Keep names unique inside one fighter.** A special and a fatality that share a
  word read as the same move in the list.
- **Declare kit-only commands in `kit.commands`**, not in `DIRECTIONAL` — the
  practice list, the pause screen and the CPU all merge the two, and a signature
  move in the universal table gets offered to fighters who do not have it.
- **Easy chains carry `ends`**, the id of the move the chain finishes on. A chain
  entry has no move id of its own, so `ends` is what the panel's copy and the
  demonstration test use to tell whether the lesson actually landed.
