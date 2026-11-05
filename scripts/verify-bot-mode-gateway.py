"""Exercise the Bot Mode Rust request shapes against the locked native Gateway.

Disposable homes and a loopback fake model keep user profiles and credentials untouched.
"""

import asyncio
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from http.server import ThreadingHTTPServer

from websockets.asyncio.client import connect

REPO = Path(__file__).resolve().parents[1]
UPSTREAM = REPO / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))

from tests.gateway.fixtures.local_recovery_probe import Model, child_env, daemon, rpc
from tests.gateway.test_normal_runtime_boot import control


def production_shapes(root):
    members = [
        {"member_id": "default", "profile": "default", "handle": "hermes", "display_name": "Hermes"},
        {"member_id": "writer", "profile": "writer", "handle": "writer", "display_name": "Writer"},
    ]
    room_id, event_id, thread_id = (str(uuid.uuid4()) for _ in range(3))
    operations = [
        {"name": "capabilities", "operation": "capabilities", "params": {}},
        {"name": "group_list", "operation": "list", "params": {}},
        {"name": "group_create", "operation": "create", "params": {"room_id": room_id, "name": "Desktop team", "members": members}},
        {"name": "group_send", "operation": "send", "params": {"room_id": room_id, "event_id": event_id, "thread_id": thread_id, "text": "@writer hello"}},
        {"name": "group_state", "operation": "state", "params": {"room_id": room_id}},
        {"name": "group_log", "operation": "log", "params": {"room_id": room_id, "since_seq": 0}},
        {"name": "group_stop", "operation": "stop", "params": {"room_id": room_id, "cancel_id": str(uuid.uuid4())}},
        {"name": "group_disband", "operation": "disband", "params": {"room_id": room_id, "cancel_id": str(uuid.uuid4())}},
        {"name": "invalid_create", "operation": "create", "params": {"room_id": str(uuid.uuid4()), "name": "Invalid", "members": [members[0], {"member_id": "missing", "profile": "missing", "handle": "missing"}]}},
        {"name": "missing_send", "operation": "send", "params": {"room_id": str(uuid.uuid4()), "event_id": str(uuid.uuid4()), "thread_id": str(uuid.uuid4()), "text": "hello"}},
    ]
    source, output = root / "bot-request-input.json", root / "bot-request-shapes.json"
    source.write_text(json.dumps({"request_id": str(uuid.uuid4()), "operations": operations}), encoding="utf-8")
    command = ["cargo", "test", "--manifest-path", str(REPO / "apps/desktop/src-tauri/Cargo.toml"), "--locked", "production_bot_request_shapes_for_gateway", "--", "--nocapture"]
    env = os.environ | {"HERMESS_BOT_SHAPE_INPUT": str(source), "HERMESS_BOT_SHAPE_OUTPUT": str(output)}
    subprocess.run(command, cwd=REPO, env=env, check=True, capture_output=True, text=True)
    return json.loads(output.read_text(encoding="utf-8"))


def production_marker(home):
    command = ["cargo", "test", "--manifest-path", str(REPO / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "production_bot_marker_for_gateway", "--", "--nocapture"]
    env = os.environ | {"HERMESS_BOT_MARKER_HOME": str(home)}
    subprocess.run(command, cwd=REPO, env=env, check=True, capture_output=True, text=True)


async def verify(home, desc, model, shapes):
    # Same host-scoped ticket as runtime/gateway_control.rs::ticket.
    grant = control(home, "session-ticket", {
        "profile_id": str(home), "instance_id": desc["instance_id"],
        "purpose": "interactive", "scope": "host",
    })
    url = desc["api_origin"].replace("http:", "ws:") + "/api/ws"
    async with connect(url, subprotocols=["hermes-gateway-v1", "hermes-gateway-ticket." + grant["ticket"]]) as ws:
        async def call(method, **params):
            reply = await rpc(ws, method, **params)
            assert "result" in reply, reply
            return reply["result"]

        async def call_shape(name):
            shape = shapes[name]
            return await call(shape["method"], **shape["params"])

        # runtime/bots.rs::list_bots, then open_bot_chat's named-profile roster/create shapes.
        roster = await call("profiles.list", include_sessions=True)
        assert {row["name"] for row in roster["profiles"]} >= {"default", "writer"}, roster
        writer = next(row for row in roster["profiles"] if row["name"] == "writer")
        assert not writer.get("ui_meta", {}).get("hermes-bots"), writer
        # open_bot_chat writes this marker after Gateway startup and after a roster read.
        await asyncio.to_thread(production_marker, home / "profiles" / "writer")
        activated = await call("profiles.list", include_sessions=True)
        writer = next(row for row in activated["profiles"] if row["name"] == "writer")
        assert writer["ui_meta"]["hermes-bots"]["title"] == "Writer", writer
        created = await call_shape("chat_create")
        session_id = created["session_id"]
        after = await call("profiles.list", include_sessions=True)
        writer = next(row for row in after["profiles"] if row["name"] == "writer")
        assert writer["canonical_session"]["resolved_id"] == session_id, writer
        resumed = await call("session.resume", profile="writer", session_id=session_id, source="desktop")
        assert resumed["session_id"] == session_id, resumed
        wrong_profile = await rpc(ws, "session.resume", profile="default", session_id=session_id, source="desktop")
        assert "error" in wrong_profile, wrong_profile

        # A real fake-model turn proves the marker exposes message_agent in the canonical chat.
        submitted = await call("prompt.submit", profile="writer", session_id=session_id,
                               submission_id=str(uuid.uuid4()), text="Say ready", clarify_batch=True)
        admission_id = submitted["admission_id"]
        deadline = time.monotonic() + 40
        while True:
            receipt = await call("prompt.receipt", profile="writer", session_id=session_id,
                                 admission_id=admission_id)
            if receipt["status"] == "terminal":
                assert receipt["outcome"] == "completed", receipt
                break
            assert time.monotonic() < deadline, receipt
            await asyncio.sleep(.2)
        assert any(tool.get("function", {}).get("name") == "message_agent"
                   for request in model.requests for tool in request.get("tools", [])), model.requests

        # runtime/bots.rs::bot_groups_request mapping and exact create/send payload.
        caps = await call_shape("capabilities")
        assert caps["driver"] and "writer" in caps["seatable_profiles"], caps
        room_id = shapes["group_create"]["params"]["room_id"]
        room = await call_shape("group_create")
        assert room["room"]["room_id"] == room_id, room
        room_retry = await call_shape("group_create")
        assert room_retry["room"]["idempotent"], room_retry
        listed = await call_shape("group_list")
        assert any(item["room_id"] == room_id for item in listed["rooms"]), listed
        sent = await call_shape("group_send")
        assert sent["accepted"] and sent["event"]["kind"] == "message.user", sent
        send_retry = await call_shape("group_send")
        assert send_retry["event"]["idempotent"], send_retry
        deadline = time.monotonic() + 40
        while True:
            log = await call_shape("group_log")
            if any(event["kind"] == "turn.settled" for event in log["events"]):
                break
            assert time.monotonic() < deadline, log
            await asyncio.sleep(.2)
        state = await call_shape("group_state")
        assert state["room"]["room_id"] == room_id, state
        assert any(event["kind"] == "message.member" and event["payload"].get("member_id") == "writer"
                   for event in log["events"]), log
        assert not any(event["kind"] == "message.member" and event["payload"].get("member_id") == "default"
                       for event in log["events"]), log
        invalid_shape = shapes["invalid_create"]
        invalid = await rpc(ws, invalid_shape["method"], **invalid_shape["params"])
        assert "error" in invalid, invalid
        missing_shape = shapes["missing_send"]
        missing = await rpc(ws, missing_shape["method"], **missing_shape["params"])
        assert "error" in missing, missing
        # The canonical retry requires member/generation; a missing field is rejected and
        # a structurally valid but stale request reaches the owner and is fenced.
        retry = await rpc(ws, "groups.retry", room_id=room_id, task_id="missing-task")
        assert retry.get("error", {}).get("message") == "invalid_params", retry
        retry_extra = await rpc(ws, "groups.retry", room_id=room_id, task_id="missing-task",
                                member_id="writer", execution_generation=1)
        assert retry_extra.get("error", {}).get("message") == "stale_generation", retry_extra
        await call_shape("group_stop")
        await call_shape("group_disband")
        assert not (await call_shape("group_list"))["rooms"]


def main():
    with tempfile.TemporaryDirectory(prefix="hermess-bot-mode-") as directory:
        root = Path(directory)
        home, user = root / "state", root / "user"
        home.mkdir()
        user.mkdir()
        named = home / "profiles" / "writer"
        named.mkdir(parents=True)
        (named / "profile.yaml").write_text("display_name: Writer\n", encoding="utf-8")
        model = ThreadingHTTPServer(("127.0.0.1", 0), Model)
        model.requests = []
        model.blocked = threading.Event()
        model.release = threading.Event()
        thread = threading.Thread(target=model.serve_forever, daemon=True)
        thread.start()
        endpoint = f"http://127.0.0.1:{model.server_port}/v1"
        config = {
            "gateway": {"multiplex_profiles": True, "managed_workers": False},
            "model": {"provider": "custom", "default": "fixture", "base_url": endpoint},
            "platform_toolsets": {"gui": [], "bot_room": []},
            "auxiliary": {"title_generation": {"enabled": False}},
        }
        (home / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
        (named / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
        env = child_env() | dict(HOME=str(user), USERPROFILE=str(user), HERMES_HOME=str(home),
                                 PYTHONPATH=os.pathsep.join([str(UPSTREAM), os.environ.get("PYTHONPATH", "")]),
                                 PYTHONUNBUFFERED="1", OPENAI_API_KEY="loopback-only")
        try:
            shapes = production_shapes(root)
            with daemon(UPSTREAM, home, env, barrier=False) as (_, desc):
                asyncio.run(verify(home, desc, model, shapes))
        finally:
            model.shutdown()
            model.server_close()
            thread.join(timeout=5)
    print("Locked Gateway Bot Mode: canonical chat, message_agent gate, group create/send/reply/log/stop/disband and rejections passed")


if __name__ == "__main__":
    main()
