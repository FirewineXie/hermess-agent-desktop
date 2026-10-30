"""Verify Desktop's session delete request against the locked Gateway authority.

Uses an isolated Hermes Home and the real WebSocket receiver. No user sessions are touched.
"""

import asyncio
import json
import sqlite3
import sys
import tempfile
import threading
from contextlib import closing
from http.server import ThreadingHTTPServer
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
UPSTREAM = REPO / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))

from tests.gateway.fixtures.local_recovery_probe import Model, child_env, daemon, rpc, websocket
from tests.waiting import async_wait_until


async def verify(home: Path, desc: dict) -> None:
    async with websocket(home, desc) as ws:
        async def call(method: str, **params) -> dict:
            answer = await rpc(ws, method, **params)
            assert "result" in answer, answer
            return answer["result"]

        created = await call("session.create", source="gui", request_id="desktop-delete-test",
                             cwd=str(home), toolsets=[])
        session_id = created["stored_session_id"]
        await call("prompt.submit", session_id=created["session_id"], input_id="delete-test-turn",
                   text="test")
        def settled() -> bool:
            with closing(sqlite3.connect(f"file:{home / 'state.db'}?mode=ro", uri=True)) as db:
                return db.execute("SELECT count(*) FROM session_admissions WHERE request_id=? AND status='terminal'",
                                  ("delete-test-turn",)).fetchone()[0] == 1
        await async_wait_until(settled, timeout=30, what="delete test turn terminal")
        listed = await call("session.list", limit=200)
        assert any(row["id"] == session_id for row in listed["sessions"]), listed

        snapshot = await call("session.resume", session_id=session_id)
        refused = await rpc(ws, "session.mutate", session_id=session_id,
                            request_id="stale-delete", expected_revision=snapshot["revision"] + 1,
                            expected_generation=snapshot["execution_generation"],
                            operation="delete", payload={})
        assert refused["error"]["message"] == "revision_conflict", refused

        delete_params = dict(session_id=session_id, request_id="desktop-delete",
                             expected_revision=snapshot["revision"],
                             expected_generation=snapshot["execution_generation"],
                             operation="delete", payload={})
        deleted = await call("session.mutate", **delete_params)
        assert session_id in deleted["deleted_ids"], deleted
        # A new Desktop socket has no local owner cache; the authority receipt must still replay.
        async with websocket(home, desc) as retry_ws:
            replay = await rpc(retry_ws, "session.mutate", **delete_params)
            assert replay["result"]["deleted_ids"] == deleted["deleted_ids"], replay
        assert not any(row["id"] == session_id for row in
                       (await call("session.list", limit=200))["sessions"])
        with closing(sqlite3.connect(f"file:{home / 'state.db'}?mode=ro", uri=True)) as db:
            assert db.execute("SELECT count(*) FROM sessions WHERE id=?", (session_id,)).fetchone()[0] == 0


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="hermess-delete-authority-") as directory:
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
                   PYTHONPATH=str(UPSTREAM), PYTHONUNBUFFERED="1",
                   OPENAI_API_KEY="loopback-only", OPENAI_BASE_URL=url)
        try:
            with daemon(UPSTREAM, home, env, barrier=False) as (_, desc):
                asyncio.run(verify(home, desc))
        finally:
            peer.shutdown()
            peer.server_close()
            thread.join(timeout=5)
    print("Locked Gateway authority: live listing, fenced refusal and delete passed")


if __name__ == "__main__":
    main()
