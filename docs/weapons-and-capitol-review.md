# Combat and art pass

- Flock: Forward + HP throws a shuriken; HP + HK throws a knife. Shared 100 simulation-frame cooldown, 22/28 startup frames, 32/36 recovery frames, zero chip, 55/70 base damage. Crouch underneath, jump over, or stand-block; interrupt startup to prevent release. Hitstop pauses cooldowns and projectiles together.
- Carney: LP + HP + HK (one stock) summons Phantom Slapshot. The stick swings independently in front of him; contact uses the special's overhead hitbox.
- Lake America: near the axe at the far left, Down + LP + HP activates the axe throw. 24-frame windup, 35-frame recovery, 110 damage, blockable, and limited to one throw per round shared by both fighters. A landed axe severs a limb outright, at any health, unlike ordinary hits which only take a limb once the victim is below a region's threshold. Available with or without random stage hazards. The original background cutout is reused as the spinning projectile; a future 3D axe would improve close-up angles.
- Matte fighter surfaces, restrained normal-map detail, less glossy blood stains, relaxed Flock finger tips and tucked thumbs, and a 17-degree opening toward the camera.
- Blood uses more small, sharp, velocity-stretched droplets that land as floor stains. Existing wound, bruise, costume damage and finisher systems remain the foundation for gore.

## Capitol files

These depict the interior rotunda, while the current Capitol stage is an outdoor courtyard. Treat them as an interior variant or deliberately redesign the stage around them.

`panorama-63ba9436-8750-45db-851c-e7a1e2d30b10.png` is the strongest panorama candidate. Check its wrap seam, horizon and poles in a spherical preview before committing. For the fixed fighting camera, a curved background wall may preserve the paintings better. Use actual floor geometry for feet, shadows and blood; align its marble pattern with the picture and avoid displaying a second photographic floor beneath the fighters. Grade the warm photograph to match the game's painted style and tune warm interior lighting.

`skybox.png` packs six views in a 3-by-2 layout (floor, ceiling and four walls). It cannot be assigned directly as an equirectangular panorama. Extract square faces, determine their directions, rotate them correctly and inspect all cube seams.

All six `pirxcy_skybox_spread/sky512_*.tex` files were checked: they have PNG signatures and are 1024 × 1024. They are image files with a misleading extension, not a browser-ready `.tex` format. Copy/export them as PNG, preview each to verify direction and rotation, then wire right/left/up/down/front/back to a cube background. Filenames alone are not enough to certify orientation. Check the asset's source/attribution record before shipping it.

## Next hit-effect art

The current procedural pipeline can produce sharp contact stars, blade crescents, blood spray and ice fragments without buying an effect pack. A useful next custom art set is a transparent 6–8-frame sheet for each of: blunt impact, blade cut, guard spark, blood fan and ice burst. Keep the brightest contact flash to the first two frames, use dark red silhouettes for blood, and anchor each effect to the actual contact point. Export clean alpha with no baked black rectangle or soft full-screen glow. Use a narrow silver slash for Flock, a broad icy crescent for Carney, and a heavier red fan for the axe.
