# Jake Lang

Fourth fighter (`lang`), with the Flincher kit. All 22 move commands have custom
animation: drooping wrists, looking away during a swat, tiny toe kicks, wobbling
recoveries, panicked face guards and stumbling retreats. Legacy attack clip
names also use the weak animations, so the pose board matches the game.

Attacks do 4–28 damage, have no chip, launch or knockdown, and cannot chain.
Panic Block, Cover And Cower and Emergency Duck protect only on frames 14–22;
they have no strike. Retreat moves give up a short distance with no damage or
invulnerability. Personal Space is a weak swat, not the universal squeeze grab.
Ordinary back/block controls retain the familiar blocking rules.

## Assets and rebuild

`web/fighters/lang/lang_stylized.glb` supplies the textured surface;
`lang.glb` supplies the six named body parts. Original files are unchanged.
The exported runtime is `web/game/public/fighters/lang/fighter.bin`: 150,000
triangles, 25 bones, 55 clips, about 4.74 MiB. It loads through the same binary
worker as Trump and Carney. No extra combat pack or network service is needed.

Full rebuild (Python requires numpy and Pillow):

```powershell
$env:FIGHTER_PYTHON = 'path/to/python.exe'
node web/tools/build-lang.mjs
```

Animation-only iteration after a full build:

```powershell
node web/tools/build-lang.mjs --from-rig
```

Authoring source: `web/fighter-tool/tools/langClips.mjs`.
Combat source: `web/game/src/fighters/langMoves.js`.
Pose review: `http://127.0.0.1:5176/flock-review.html?fighter=lang`.
The custom `lang_` clips correspond directly to the kit's moves.
