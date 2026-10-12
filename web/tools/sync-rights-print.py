"""Refresh only the packed paper image, in a background Blender process."""
import bpy
from pathlib import Path

root = Path(__file__).resolve().parents[1]
before = root / 'artifacts/intro-2026-10-10/before'
before.mkdir(parents=True, exist_ok=True)
images = [image for image in bpy.data.images if 'rights-scroll' in image.name]
assert images, 'The stage master must contain the parchment image'
for image in images:
    if image.packed_file:
        original = before / 'rights-scroll-original.png'
        if not original.exists():
            original.write_bytes(image.packed_file.data)
        image.unpack(method='REMOVE')
    image.filepath = str(root / 'stages/lake_america/blender/textures/rights-scroll_albedo.png')
    image.reload()
    image.pack()
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print('Updated packed parchment image; retained stage scene and all geometry.')
