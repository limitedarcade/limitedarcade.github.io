import bpy, runpy, sys
from pathlib import Path
root=Path(bpy.data.filepath).parents[3]
script=root/'tools/build-lake-america.py'
old_args=sys.argv[:]
try:
    sys.argv=[str(script),'--no-render']
    runpy.run_path(str(script),run_name='__main__')
finally:
    sys.argv=old_args
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.region_3d.view_perspective='CAMERA'
            area.spaces.active.overlay.show_overlays=False
bpy.context.scene['last_authoring_pass']='Live Blender MCP: winter festival absurdity, goose marshal, moose lifeguard, maple Zamboni and curling chaos'
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
assert bpy.data.objects.get('lake-america-rescue-ring')
assert bpy.data.objects.get('lake-america-trail-sign')
for prefix in ('07 Goose safety committee','02 Moose lifeguard','10 Maple Zamboni parade','10 Curling catastrophe','10 Festival bunting'):
    assert any(collection.name.startswith(prefix) for collection in bpy.data.collections), prefix
assert bpy.data.objects.get('CAM Absurdity')
print('LAKE_AMERICA_MCP_EXPORT_VERIFIED')
