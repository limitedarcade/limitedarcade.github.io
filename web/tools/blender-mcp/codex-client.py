"""Call the Blender server registered in Codex through the MCP SDK only."""
import argparse
import asyncio
import base64
import json
import os
from pathlib import Path
import tempfile
import tomllib

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--code", type=Path, help="Python payload executed inside Blender by MCP")
    group.add_argument("--screenshot", type=Path, help="Save the MCP viewport image")
    group.add_argument("--list", action="store_true", help="List MCP tools and schemas")
    parser.add_argument("--timeout", type=float, default=300)
    args = parser.parse_args()
    config_path = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")) / "config.toml"
    with config_path.open("rb") as source:
        config = tomllib.load(source)["mcp_servers"]["blender"]
    if not config.get("enabled", True):
        raise RuntimeError("The Blender MCP server is disabled in Codex")
    params = StdioServerParameters(
        command=config["command"], args=config.get("args", []),
        env={**os.environ, **config.get("env", {}), "DISABLE_TELEMETRY": "true"},
        cwd=config.get("cwd"),
    )
    with tempfile.TemporaryFile(mode="w+", encoding="utf-8") as log:
        try:
            async with stdio_client(params, errlog=log) as (reader, writer):
                async with ClientSession(reader, writer) as client:
                    initialized = await client.initialize()
                    print("MCP_CONNECTED=" + initialized.serverInfo.name, flush=True)
                    if args.list:
                        for tool in (await client.list_tools()).tools:
                            print(json.dumps({"name": tool.name, "schema": tool.inputSchema}))
                        return
                    if args.code:
                        name = "execute_blender_code"
                        arguments = {"code": args.code.read_text(encoding="utf-8"),
                                     "user_prompt": "Lake America graphics pass, exclusively through MCP"}
                    elif args.screenshot:
                        name, arguments = "get_viewport_screenshot", {"max_size": 1600}
                    else:
                        name, arguments = "get_scene_info", {"user_prompt": "Verify live Blender MCP"}
                    result = await asyncio.wait_for(client.call_tool(name, arguments), args.timeout)
                    for content in result.content:
                        if content.type == "text":
                            print(content.text)
                        elif content.type == "image" and args.screenshot:
                            args.screenshot.parent.mkdir(parents=True, exist_ok=True)
                            args.screenshot.write_bytes(base64.b64decode(content.data))
                            print("MCP_IMAGE=" + str(args.screenshot.resolve()))
                    if result.isError:
                        raise RuntimeError("Blender MCP reported a tool failure")
        except BaseException:
            log.seek(0)
            print(log.read()[-6000:])
            raise


if __name__ == "__main__":
    asyncio.run(main())
