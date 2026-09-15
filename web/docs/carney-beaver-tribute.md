# Carney's beaver presentation

Cold Cut keeps its existing lethal strike. The actual head lands and slides on the ice; three rigged beavers enter in separate lanes, gather around it, bring it to Carney, and remain in a spread formation while he places it on the Lake Ontario signpost. The finisher owns the entire presentation and hero hold before the result screen.

The source beaver is `medium_beaver_standing_realistic.glb`. Its optimized runtime export is `game/public/props/beaver/beaver.glb`: 29,618 triangles, one mesh, one skeleton, three animations, approximately 1.51 MB. The three runtime copies share mesh and texture data but use independent skeletons. Attribution is in the adjacent `CREDITS.txt`.

Asset work was executed through the project's Blender MCP client:

```powershell
& './seoul-city-gameready-render-blender-pbr/_work\blender-mcp\venv\Scripts\python.exe' tools/blender-mcp/call.py tools/blender-mcp/build-beaver.py
& './seoul-city-gameready-render-blender-pbr/_work\blender-mcp\venv\Scripts\python.exe' tools/blender-mcp/call.py tools/blender-mcp/build-tribute-sign.py
```

The beaver's editable scene and three animation tracks are saved in `artifacts/beaver/beaver-workshop.blend`. The original source asset and stage scene remain intact. The wooden sign is authored in Blender; its readable lettering is added by the game.

The deterministic timeline is `game/src/engine/beaverTribute.js`; presentation, shared asset loading, head ownership, temporary hand/knee constraints, and camera framing are in `game/src/render/beaverTribute.js`. No animation depends on wall-clock time. Replay resets release the scripted head and restore constraints before returning to combat poses.

Cinematic head cuts detach the complete authored `Head` mesh where one exists, including Trump's facial vertices weighted to his chest. The presentation keeps Carney left of the sign during the handoff, lifts the head above the board before crossing onto the post, and raises his supporting elbow to clear the board. Regression checks cover the complete head and the placement path; the handoff, placement, and final pose were also checked in the running review.

Attract-mode exhibitions featuring Carney now reserve the finale for `carney-cold-cut`, including when he fights on the right. This is confined to `AttractDirector`: Carney cannot be knocked out in those exhibitions, retains finisher meter, and enters the normal finisher command in range after KO or timeout. Other showcase segments restore their normal demo restrictions. Player matches are unaffected.

Open `/?review=finisher` and use Head slide, Beaver pickup, Head handoff, Signpost, or Hero shot to replay to a marker. Opponent and Mirror sides exercise the other cases.

Validation: production build; targeted tests for both timeline variants, both sides, all three current opponents in attract mode, rigid bone attachments, repeated severing, head placement/reset, camera bounds and asset constraints. Full-suite logs are in `artifacts/beaver/test-results.txt`; unrelated failures remain in two CPU move-coverage checks and the older assertion that expects three confidence clips where the existing builder produces four.
