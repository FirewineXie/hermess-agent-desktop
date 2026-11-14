"""Verify Rust-produced chat connection RPCs on the locked Gateway's real WebSocket."""

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
UPSTREAM = REPO / "upstream" / "hermes-agent"
ENV_KEYS = {"PATH", "LANG", "TZ", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "TEMP", "TMP",
            "PATHEXT", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA"}


def wire_shapes():
    result = subprocess.run([
        "cargo", "test", "--manifest-path", str(REPO / "apps/desktop/src-tauri/Cargo.toml"),
        "--locked", "production_chat_connection_requests", "--", "--nocapture",
    ], cwd=REPO, capture_output=True, text=True, timeout=300, check=False)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return json.loads(next(line.removeprefix("CHAT_CONNECTION_WIRE=") for line in result.stdout.splitlines()
                           if line.startswith("CHAT_CONNECTION_WIRE=")))


async def verify_catalog(home, authority, session_id, socket, rpc, wire, events, profile):
    from gateway import local_desktop_ui
    from gateway.run import _profile_runtime_scope
    from hermes_cli.plugin_catalog import load_catalog
    from tools.connectors.catalog_tool import manage_catalog

    entry = next(entry for entry in load_catalog(UPSTREAM / "plugin-catalog") if entry.name == "openviking")

    class Installer:
        installs = []

        def plugin_entry(self, name):
            assert name == entry.name
            return entry

        def refuse(self, _entry):
            pass

        def install_plugin(self, name, *, force, enable, ref, on_step):
            self.installs.append((name, force, enable, ref))
            return {"ok": True, "plugin_name": name}

    installer = Installer()
    live_session = authority.sessions[session_id]
    agent = SimpleNamespace()
    turn = SimpleNamespace(
        _approval_owner=(authority, session_id),
        _ctx=SimpleNamespace(session_id=session_id, session_key=live_session.route),
        _publish_execution=lambda kind, payload: live_session.event_stream.publish(
            session_id, payload, event_type=kind),
    )
    bridge = local_desktop_ui.wire(turn, agent)

    def start():
        with _profile_runtime_scope(home):
            return json.loads(manage_catalog(
                {"action": "install", "items": [{"kind": "plugin", "id": "openviking"}]},
                session_id=live_session.route, tool_call_id="fixture-tool",
                connection_callback=agent.connection_callback,
                card_surface=True, installer=installer,
            ))

    try:
        task = asyncio.create_task(asyncio.to_thread(start))
        async with asyncio.timeout(20):
            while True:
                frame = json.loads(await socket.recv())
                if frame.get("params", {}).get("type") == "connection.request":
                    card = frame["params"]["payload"]
                    break
        assert not installer.installs and card["targets"][0]["name"] == "openviking", card
        approve = {**wire["approve"], "op_id": card["op_id"],
                   "owner": {**wire["approve"]["owner"], "session_id": session_id}, **profile}
        accepted = await rpc("connection.respond", approve)
        assert accepted.get("result", {}).get("status") == "ok", accepted
        outcome = await asyncio.wait_for(task, 20)
        assert installer.installs == [("openviking", False, True, None)], outcome
        assert outcome["targets"][0]["state"] == "connected", outcome
        async with asyncio.timeout(10):
            while not any(event.get("op_id") == card["op_id"] and event.get("settled") for event in events):
                frame = json.loads(await socket.recv())
                if frame.get("params", {}).get("type") == "connection.update":
                    events.append(frame["params"]["payload"])
    finally:
        local_desktop_ui.release(bridge)


async def verify(home, wire):
    from gateway.run import GatewayRunner, _profile_runtime_scope
    from gateway.run_api import start_gateway_api, stop_gateway_api
    from gateway.session_authority import initialize_session_authority
    from hermes_cli import web_server
    from hermes_cli.dashboard_auth.ws_tickets import mint_ticket
    from tools import connectors
    from tools.connectors import live, run
    from tools.connectors.contract import Actor, TargetState
    from tools.connectors.operation import ConnectionOperation, Target
    from websockets.asyncio.client import connect

    (home / "config.yaml").write_text(
        "model:\n  provider: custom\n  default: fixture\n  base_url: http://127.0.0.1:1/v1\n"
        "  context_length: 8192\n"
        "auxiliary:\n  title_generation:\n    enabled: false\n", encoding="utf-8")
    (home / "models_dev_cache.json").write_text(
        '{"fixture":{"id":"fixture","env":[],"models":{}}}', encoding="utf-8")
    runner = GatewayRunner()
    authority = await initialize_session_authority(runner, profile_id=str(home), instance_id="chat-connection")
    api = await start_gateway_api(runner)
    web_server.app.state.auth_required = True
    ticket = mint_ticket(user_id="connection-fixture", provider="fixture")
    profile = {"profile": home.name} if home.parent.name == "profiles" else {}
    try:
        async with connect(api.api_origin.replace("http:", "ws:") + "/api/ws?ticket=" + ticket) as socket:
            events = []

            async def rpc(method, params):
                await socket.send(json.dumps({"jsonrpc": "2.0", "id": method, "method": method, "params": params}))
                async with asyncio.timeout(30):
                    while True:
                        reply = json.loads(await socket.recv())
                        if reply.get("id") == method:
                            return reply
                        if reply.get("params", {}).get("type") == "connection.update":
                            events.append(reply["params"]["payload"])

            created = await rpc("session.create", {
                "source": "gui", "request_id": "connection-fixture", "toolsets": ["connections"], "cwd": str(home),
                **profile,
            })
            session_id = created["result"]["session_id"]
            with _profile_runtime_scope(home):
                operation = ConnectionOperation([Target("linear", "mcp", "install")],
                                                session_key=authority.sessions[session_id].route)
                live.open(operation)

            def params(key, op_id=operation.op_id):
                value = {**wire[key], **profile, "owner": {**wire[key]["owner"], "session_id": session_id}}
                if "op_id" in value:
                    value["op_id"] = op_id
                return value

            resume = await rpc("session.resume", {"session_id": session_id, "source": "desktop",
                                                  "defer_history": True, "omit_messages": True, **profile})
            assert resume["result"]["pending_connection"]["op_id"] == operation.op_id, resume
            result = await rpc("connectors.operation.status", params("status"))
            assert result["result"]["targets"][0]["state"] == "pending", result
            wake = await rpc("connectors.operation.wake", params("status"))
            assert wake.get("result") == {"status": "ok"}, wake
            denied = await rpc("connection.respond", params("respond", "unknown-operation"))
            assert denied["error"]["data"]["reason"] == "UNKNOWN_OPERATION", denied
            other_profile = params("respond_named")
            if profile:
                other_profile["profile"] = "foreign"
            wrong_profile = await rpc("connection.respond", other_profile)
            assert "error" in wrong_profile and not operation.settled, wrong_profile
            skipped = await rpc("connection.respond", params("respond"))
            assert skipped.get("result") == {"status": "ok", "settled": True}, skipped
            assert operation.target("linear").state.value == "skipped"
            stale = await rpc("connectors.connect", params("retry"))
            assert stale["error"]["data"]["reason"] == "UNKNOWN_OPERATION", stale
            after = await rpc("session.resume", {"session_id": session_id, "source": "desktop",
                                                 "defer_history": True, "omit_messages": True, **profile})
            assert after["result"].get("pending_connection") is None, after
            await verify_catalog(home, authority, session_id, socket, rpc, wire, events, profile)

            with _profile_runtime_scope(home):
                retry = ConnectionOperation([Target("linear", "connector", "connect")],
                                            session_key=authority.sessions[session_id].route)
                live.open(retry)
            retry.transition("linear", TargetState.failed, Actor.backend_watcher)

            def reissue(current, names):
                assert current is retry and names == ["linear"]
                current.transition("linear", TargetState.initiated, Actor.user)

            with patch.object(connectors, "connectors_available", return_value=True), patch.object(run, "reissue", reissue):
                retried = await rpc("connectors.connect", params("retry"))
            assert retried["result"]["targets"][0]["state"] == "initiated", retried
            live.close(retry)
    finally:
        await stop_gateway_api(api)
    print(f"Locked Gateway ({profile.get('profile', 'default')}) accepted status, wake, skip, retry and catalog approval; "
          "refused a stale operation and a foreign profile.")


def main():
    wire = wire_shapes()
    with tempfile.TemporaryDirectory(prefix="hermess-connection-") as temporary:
        root = Path(temporary)
        user = root / "user"
        user.mkdir()
        env = {key: value for key, value in os.environ.items() if key.upper() in ENV_KEYS}
        env.update(HOME=str(user), USERPROFILE=str(user), HERMES_DISABLE_LAZY_INSTALLS="1",
                   PYTHONUTF8="1", PYTHONPATH=str(UPSTREAM))
        for home in (root / "state", root / "state" / "profiles" / "reviewer"):
            home.mkdir(parents=True)
            subprocess.run([sys.executable, __file__, "--fixture"], cwd=UPSTREAM, env={**env, "HERMES_HOME": str(home)},
                           input=json.dumps(wire), text=True, timeout=90, check=True)


if __name__ == "__main__":
    if sys.argv[1:] == ["--fixture"]:
        asyncio.run(verify(Path(os.environ["HERMES_HOME"]), json.load(sys.stdin)))
    else:
        main()
