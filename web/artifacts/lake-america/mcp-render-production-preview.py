import bpy
from pathlib import Path

stage_scene = bpy.data.scenes.get("Scene")
if stage_scene is None:
    raise RuntimeError("Missing Lake America stage scene")

root = Path(bpy.data.filepath).parents[3]
output = root / "game" / "public" / "stages" / "lake-america-3d" / "preview.png"
camera = bpy.data.objects.get("CAM Combat")
if camera is None:
    raise RuntimeError("Missing CAM Combat")

window = bpy.context.window
original_scene = window.scene if window else None
original_camera = stage_scene.camera
original_path = stage_scene.render.filepath
try:
    if window:
        window.scene = stage_scene
    stage_scene.camera = camera
    stage_scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)
    print(f"MCP_PRODUCTION_PREVIEW={output}")
finally:
    stage_scene.camera = original_camera
    stage_scene.render.filepath = original_path
    if window and original_scene:
        window.scene = original_scene
