import os
os.environ['DISABLE_TELEMETRY']='true'
os.environ['BLENDER_HOST']='127.0.0.1'
os.environ['BLENDER_PORT']='9876'
os.environ['BLENDERMCP_ADDONS_DIR']="./seoul-city-gameready-render-blender-pbr/_work/blender-mcp/venv/Lib/site-packages/blender_mcp/bundled"
from blender_mcp.server import main
main()
