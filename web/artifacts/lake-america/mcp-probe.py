import bpy
import json

payload = {
    "filepath": bpy.data.filepath,
    "is_dirty": bool(bpy.data.is_dirty),
    "scene": bpy.context.scene.name if bpy.context.scene else None,
    "scenes": [scene.name for scene in bpy.data.scenes],
    "objects": len(bpy.data.objects),
    "collections": len(bpy.data.collections),
    "cameras": [obj.name for obj in bpy.data.objects if obj.type == "CAMERA"],
}
print("MCP_PROBE=" + json.dumps(payload, sort_keys=True))
