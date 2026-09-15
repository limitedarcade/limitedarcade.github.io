import bpy
import json

scene = bpy.data.scenes.get("Scene")
if scene is None:
    raise RuntimeError("Lake America scene named 'Scene' was not found")
bpy.context.window.scene = scene

by_type = {}
for obj in scene.objects:
    by_type[obj.type] = by_type.get(obj.type, 0) + 1

collections = []
for collection in bpy.data.collections:
    scene_names = sorted(obj.name for obj in collection.objects if obj.name in scene.objects)
    if scene_names:
        collections.append({"name": collection.name, "count": len(scene_names), "objects": scene_names})

payload = {
    "scene": scene.name,
    "camera": scene.camera.name if scene.camera else None,
    "frame": scene.frame_current,
    "render": [scene.render.resolution_x, scene.render.resolution_y, scene.render.engine],
    "world": scene.world.name if scene.world else None,
    "object_count": len(scene.objects),
    "by_type": by_type,
    "collections": sorted(collections, key=lambda item: item["name"]),
    "custom_properties": {key: scene[key] for key in scene.keys()},
}
print("MCP_STAGE=" + json.dumps(payload, default=str, sort_keys=True))
