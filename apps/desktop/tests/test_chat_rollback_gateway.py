"""Exercise the Rust rollback request shapes against the locked Gateway owner."""
import asyncio
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import pytest

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))

from tests.gateway.test_session_busy_controls import owner, settled
from tests.gateway.fixtures.local_recovery_probe import rpc, websocket
from tests.gateway.test_session_tui_ops import _checkpoint


async def gateway_request(ws, method, params):
    await ws.send(json.dumps({"jsonrpc": "2.0", "id": method, "method": method, "params": params}))
    async with asyncio.timeout(120):
        while True:
            reply = json.loads(await ws.recv())
            if reply.get("id") == method:
                return reply


def production_shapes(session_id, checkpoint_hash):
    environment = dict(
        os.environ,
        HERMESS_TEST_SESSION_ID=session_id,
        HERMESS_TEST_CHECKPOINT_HASH=checkpoint_hash,
        HERMESS_TEST_ROLLBACK_FILE="a.txt",
    )
    command = [
        "cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
        "--locked", "print_production_rollback_shapes", "--", "--ignored", "--nocapture",
    ]
    result = subprocess.run(command, env=environment, capture_output=True, text=True,
                            encoding="utf-8", errors="replace")
    assert result.returncode == 0, result.stderr
    match = re.search(r"PRODUCTION_ROLLBACK_SHAPES=(\{[^\r\n]+\})", result.stdout)
    assert match, result.stdout
    return json.loads(match.group(1))


@pytest.mark.skipif(sys.platform == "win32", reason="locked checkpoint Gateway integration is Linux-only")
def test_production_rollback_shapes_list_diff_restore_and_refresh_history(tmp_path):
    with owner(tmp_path) as (home, _peer, description):
        work = tmp_path / "work"
        work.mkdir()
        target = work / "a.txt"
        target.write_text("original\n", encoding="utf-8")

        async def probe():
            async with websocket(home, description) as ws:
                created = await rpc(ws, "session.create", request_id="product-rollback", source="gui",
                                    toolsets=[], cwd=str(work), checkpoints=True)
                assert "result" in created, created
                session_id = created["result"]["session_id"]
                await rpc(ws, "prompt.submit", session_id=session_id, input_id="first", text="FIRST")
                await settled(home)
                await rpc(ws, "prompt.submit", session_id=session_id, input_id="second", text="SECOND")
                await settled(home)
                await asyncio.to_thread(_checkpoint, home, work, "before write_file")
                listed = await gateway_request(ws, "rollback.list", {"session_id": session_id})
                checkpoint = listed["result"]["checkpoints"][0]
                shapes = await asyncio.to_thread(production_shapes, session_id, checkpoint["hash"])

                list_method, list_params = shapes["list"]
                product_list = await gateway_request(ws, list_method, list_params)
                assert product_list["result"]["enabled"] is True
                assert product_list["result"]["checkpoints"][0]["message"] == "before write_file"

                target.write_text("edited\n", encoding="utf-8")
                diff_method, diff_params = shapes["diff"]
                diff = await gateway_request(ws, diff_method, diff_params)
                assert "a.txt" in diff["result"]["stat"] and "edited" in diff["result"]["diff"]

                file_method, file_params = shapes["file"]
                restored_file = await gateway_request(ws, file_method, file_params)
                assert restored_file["result"]["success"] is True
                assert "history_removed" not in restored_file["result"]
                assert target.read_text(encoding="utf-8") == "original\n"

                target.write_text("edited again\n", encoding="utf-8")
                before = (await rpc(ws, "session.resume", session_id=session_id))["result"]["messages"]
                safe_method, safe_params = shapes["safe"]
                restored = await gateway_request(ws, safe_method, safe_params)
                assert restored["result"]["success"] is True and restored["result"]["history_removed"] == 2
                after = (await rpc(ws, "session.resume", session_id=session_id))["result"]["messages"]
                assert [row.get("content") for row in after] == [row.get("content") for row in before[:-2]]

                all_method, all_params = shapes["all"]
                assert all_params["all"] is True
                forced = await gateway_request(ws, all_method, all_params)
                assert forced["result"]["success"] is True

                invalid = await gateway_request(ws, "rollback.diff", {"session_id": session_id})
                assert invalid["error"]["message"] == "invalid_params"

        asyncio.run(probe())
