import asyncio, base64, os, sys
from pathlib import Path
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
async def run():
    params=StdioServerParameters(command=sys.executable,args=[str(Path(__file__).with_name('server.py'))],env={**os.environ,'DISABLE_TELEMETRY':'true'})
    async with stdio_client(params) as (read,write):
        async with ClientSession(read,write) as client:
            init=await client.initialize()
            print('MCP CONNECTED:',init.serverInfo.name)
            if len(sys.argv)>1 and sys.argv[1]=='--screenshot':
                result=await client.call_tool('get_viewport_screenshot',{'max_size':1400})
                for item in result.content:
                    if item.type=='image':
                        Path('artifacts/lake-america/mcp-viewport.png').write_bytes(base64.b64decode(item.data))
                        print('MCP_VIEWPORT_SAVED')
                return
            result=await client.call_tool('execute_blender_code',{'code':Path(sys.argv[1]).read_text(encoding='utf-8')}) if len(sys.argv)>1 else await client.call_tool('get_scene_info',{'user_prompt':'Verify Lake America live Blender MCP'})
            for item in result.content:
                if item.type=='text': print(item.text)
            if result.isError: raise RuntimeError('MCP tool failed')
asyncio.run(run())
