import bpy, importlib.util, json, os, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
STATE=ROOT/'artifacts/lake-america'
SCENE_FILE=ROOT/'stages/lake_america/blender/lake-america.blend'
ADDON=Path("./seoul-city-gameready-render-blender-pbr/_work/blender-mcp/venv/Lib/site-packages/blender_mcp/bundled/addon.py")
bpy.ops.wm.open_mainfile(filepath=str(SCENE_FILE))
# Register the upstream UI without allowing its default-port autostart.
# A raw scene ID property is insufficient: RNA registration resets its value.
spec = importlib.util.spec_from_file_location("lake_blender_mcp", ADDON)
addon = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = addon
spec.loader.exec_module(addon)
original_start = addon.BlenderMCPServer.start
addon.BlenderMCPServer.start = lambda self: None
try:
    addon.register()
finally:
    addon.BlenderMCPServer.start = original_start
bpy.context.scene.blendermcp_auto_start_server = False
prefs = bpy.context.preferences.addons.new()
prefs.module = spec.name
prefs.preferences.telemetry_consent = False
addon.sync_edit_capture_handlers()
for feature in ("polyhaven", "hyper3d", "sketchfab", "polypizza", "hunyuan3d"):
    setattr(bpy.context.scene, "blendermcp_use_" + feature, False)
port = int(os.environ.get("BLENDER_PORT", "9876"))
bpy.context.scene.blendermcp_port = port
server = addon.BlenderMCPServer(host="127.0.0.1", port=port)
bpy.types.blendermcp_server = server
server.start()
bpy.context.scene.blendermcp_server_running = server.running
if not server.running:
    raise RuntimeError("The project Blender MCP server did not start")
(STATE / "ready.json").write_text(json.dumps({
    "pid": os.getpid(), "root": str(ROOT), "port": port,
    "blender": bpy.app.version_string, "scene": str(SCENE_FILE),
    "addon_protocol": addon.ADDON_PROTOCOL_VERSION, "telemetry": False,
}, indent=2), encoding="utf-8")
print("LAKE_BLENDER_MCP_READY", flush=True)

for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.overlay.show_overlays=False
