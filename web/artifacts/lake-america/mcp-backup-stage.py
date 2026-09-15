import bpy
from pathlib import Path

source = Path(bpy.data.filepath)
if source.name != "lake-america.blend":
    raise RuntimeError(f"Refusing to back up unexpected Blender file: {source}")
archive = source.parent / "archive"
archive.mkdir(parents=True, exist_ok=True)
target = archive / "lake-america-pre-absurdity-2026-09-14.blend"
bpy.ops.wm.save_as_mainfile(filepath=str(target), copy=True)
if not target.exists() or target.stat().st_size < 1_000_000:
    raise RuntimeError(f"Backup was not created correctly: {target}")
print(f"MCP_STAGE_BACKUP={target}|{target.stat().st_size}")
