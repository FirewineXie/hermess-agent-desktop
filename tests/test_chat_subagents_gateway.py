"""Exercise the desktop subagent request shapes against the locked Gateway."""
import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import weakref


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "upstream/hermes-agent"


def test_chat_subagent_roster_tail_and_controls(tmp_path):
    home = tmp_path / "state"
    user = tmp_path / "user"
    home.mkdir()
    user.mkdir()
    env = os.environ.copy()
    env.update(HERMES_HOME=str(home), HOME=str(user), USERPROFILE=str(user),
               PYTHONPATH=str(UPSTREAM), PYTHONUTF8="1", PYTHONUNBUFFERED="1")
    run = subprocess.run([sys.executable, __file__, "--probe"], cwd=UPSTREAM,
                         env=env, capture_output=True, text=True, encoding="utf-8", timeout=90)
    assert run.returncode == 0, run.stdout + run.stderr
    receipt = json.loads((home / "receipt.json").read_text(encoding="utf-8"))
    assert [row["subagent_id"] for row in receipt["roster"]["subagents"]] == ["owned"]
    assert receipt["tail"] == {"subagent_id": "owned", "available": True,
                               "text": "child activity", "truncated": False}
    assert receipt["foreign_tail"]["available"] is False
    assert receipt["steer"]["status"] == "queued"
    assert receipt["stop"]["found"] is True
    assert receipt["foreign_steer"]["status"] == "rejected"
    assert receipt["foreign_stop"]["found"] is False
    assert receipt["delivered"] == [["check the result"], 1]


async def probe():
    sys.path.insert(0, str(UPSTREAM))
    from gateway.run import GatewayRunner
    from gateway.session_authority import initialize_session_authority
    from gateway.run_api import start_gateway_api, stop_gateway_api
    from hermes_cli import web_server
    from hermes_cli.dashboard_auth.ws_tickets import mint_ticket
    from tests.gateway.fixtures.local_recovery_probe import rpc
    from tools.delegate_tool_child_run import _register_child
    from tools.delegate_tool_registry import _unregister_subagent
    from websockets.asyncio.client import connect

    home = Path(os.environ["HERMES_HOME"])
    (home / "config.yaml").write_text(
        "gateway:\n  multiplex_profiles: false\nmodel:\n  provider: custom\n"
        "  default: no-inference\n  base_url: http://127.0.0.1:1/v1\n"
        "auxiliary:\n  title_generation:\n    enabled: false\n", encoding="utf-8")
    runner = GatewayRunner()
    authority = await initialize_session_authority(runner, profile_id=str(home), instance_id="desktop-subagents")
    api = await start_gateway_api(runner)
    web_server.app.state.auth_required = True

    class Agent:
        def __init__(self):
            self.steered = []
            self.stopped = []

        def steer(self, text):
            self.steered.append(text)
            return True

        def hard_interrupt(self, message=None):
            self.stopped.append(message)
            return True

    child = None
    try:
        ticket = mint_ticket(user_id="owner", provider="fixture")
        async with connect(api.api_origin.replace("http:", "ws:") + "/api/ws?ticket=" + ticket) as ws:
            created = await rpc(ws, "session.create", request_id="desktop-subagents-owner", source="gui", toolsets=[])
            sid = created["result"]["session_id"]
            parent = Agent()
            parent.session_id = sid
            with runner._agent_cache_lock:
                runner._agent_cache[authority.sessions[sid].route] = (parent, "fixture")
            child = Agent()
            child._subagent_id = "owned"
            child._delegate_parent_ref = weakref.ref(parent)
            child._parent_session_id = sid
            path = home / "child.log"
            path.write_text("child activity", encoding="utf-8")
            child._live_transcript_path = str(path)
            _register_child(child, parent, "inspect results", owner_session_id=None,
                            owner_transport=None, owner_session_record=None)

            async def call(method, **fields):
                result = await rpc(ws, method, session_id=sid, **fields)
                assert "result" in result, result
                return result["result"]

            receipt = {
                "roster": await call("subagent.list"),
                "tail": await call("subagent.tail", subagent_id="owned"),
                "foreign_tail": await call("subagent.tail", subagent_id="foreign"),
                "steer": await call("subagent.steer", subagent_id="owned", text="check the result"),
                "stop": await call("subagent.interrupt", subagent_id="owned"),
                "foreign_steer": await call("subagent.steer", subagent_id="foreign", text="wrong child"),
                "foreign_stop": await call("subagent.interrupt", subagent_id="foreign"),
                "delivered": [child.steered, len(child.stopped)],
            }
            (home / "receipt.json").write_text(json.dumps(receipt), encoding="utf-8")
    finally:
        if child is not None:
            _unregister_subagent("owned", agent=child)
        await stop_gateway_api(api)


if __name__ == "__main__" and sys.argv[1:] == ["--probe"]:
    try:
        asyncio.run(probe())
    except BaseException:
        import traceback
        traceback.print_exc()
        os._exit(1)
    os._exit(0)
