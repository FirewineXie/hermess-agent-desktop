"""Verify Desktop composer requests against the locked Gateway authority.

Uses an isolated Hermes Home and the real WebSocket receiver. No user sessions are touched.
"""

import asyncio
import json
import os
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
UPSTREAM = REPO / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))

from tests.gateway.fixtures.local_recovery_probe import Model, child_env, daemon, rpc, websocket


async def verify(home: Path, desc: dict) -> None:
    async with websocket(home, desc) as ws:
        async def call(method: str, **params) -> dict:
            answer = await rpc(ws, method, **params)
            assert "result" in answer, answer
            return answer["result"]

        created = await call("session.create", source="gui", request_id="desktop-composer-test", cwd=str(home), toolsets=[])
        session_id = created["session_id"]
        catalog = await call("commands.catalog", session_id=session_id)
        assert "pending" in catalog["commands"]["/skills"]["desktop_subcommands"], catalog
        assert catalog["sub"].get("/reasoning") or catalog["sub"].get("reasoning"), catalog.keys()
        for command in ["/status", "/title 中文命令标题"]:
            result = await call("slash.exec", session_id=session_id, command=command)
            assert result.get("type") == "exec", result
            if command.startswith("/title "):
                assert "中文命令标题" in result.get("output", ""), result
        await call("slash.exec", session_id=session_id, command="/reasoning none")
        assert (await call("config.get", session_id=session_id, key="reasoning"))["value"] == "none"
        for command in ["/skills install example", "/voice tts"]:
            refused = await rpc(ws, "slash.exec", session_id=session_id, command=command)
            assert "error" in refused, refused


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="hermess-composer-") as directory:
        home = Path(directory) / "state"
        user = Path(directory) / "user"
        home.mkdir()
        user.mkdir()
        peer = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        peer.requests = []
        peer.blocked = threading.Event()
        peer.release = threading.Event()
        thread = threading.Thread(target=peer.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{peer.server_port}/v1"
        (home / "config.yaml").write_text(json.dumps({
            "gateway": {"multiplex_profiles": False, "managed_workers": False},
            "model": {"provider": "custom", "default": "delete-test", "base_url": url},
            "auxiliary": {"title_generation": {"enabled": False}},
            "platform_toolsets": {"cli": []},
        }), encoding="utf-8")
        env = child_env()
        env.update(HOME=str(user), USERPROFILE=str(user), HERMES_HOME=str(home),
                   PYTHONPATH=os.pathsep.join([str(UPSTREAM), os.environ.get("PYTHONPATH", "")]), PYTHONUNBUFFERED="1",
                   OPENAI_API_KEY="loopback-only", OPENAI_BASE_URL=url)
        try:
            with daemon(UPSTREAM, home, env, barrier=False) as (_, desc):
                asyncio.run(verify(home, desc))
        finally:
            peer.shutdown()
            peer.server_close()
            thread.join(timeout=5)
    print("Locked Gateway composer: catalog, text arguments and refusal passed")


if __name__ == "__main__":
    main()
