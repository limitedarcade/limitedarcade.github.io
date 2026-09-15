import bpy
from pathlib import Path

scene = bpy.context.scene
root = Path(bpy.data.filepath).parents[3]
out = root / "artifacts" / "lake-america"
out.mkdir(parents=True, exist_ok=True)
original_camera = scene.camera
original_path = scene.render.filepath
try:
    for camera_name, filename in (
        ("CAM Combat", "absurdity-combat.png"),
        ("CAM Absurdity", "absurdity-hero.png"),
        ("CAM Establishing", "absurdity-establishing.png"),
    ):
        camera = bpy.data.objects.get(camera_name)
        if camera is None:
            raise RuntimeError(f"Missing review camera: {camera_name}")
        scene.camera = camera
        scene.render.filepath = str(out / filename)
        bpy.ops.render.render(write_still=True)
        print(f"MCP_RENDERED={camera_name}|{scene.render.filepath}")
finally:
    scene.camera = original_camera
    scene.render.filepath = original_path
