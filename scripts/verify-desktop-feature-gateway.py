"""Send production Rust request shapes to an isolated daemon at the product's locked SHA."""

import asyncio
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from http.server import ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import uuid

import httpx
from PIL import Image
from websockets.asyncio.client import connect

PRODUCT = Path(__file__).resolve().parents[1]
UPSTREAM = PRODUCT / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))

from tests.gateway.fixtures.local_recovery_probe import Model, child_env, daemon, rpc
from tests.gateway.test_normal_runtime_boot import control


def production_shapes():
    lock = json.loads((PRODUCT / "runtime/upstream.lock.json").read_text(encoding="utf-8"))
    head = subprocess.check_output(["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"], text=True).strip()
    assert head == lock["commit"], "Gateway checkout does not match the product lock"
    result = subprocess.run([
        "cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
        "--locked", "print_production_gateway_feature_", "--", "--ignored", "--nocapture",
    ], check=True, capture_output=True, encoding="utf-8", errors="replace")
    rows = [json.loads(line.split("FEATURE_SHAPE=", 1)[1])
            for line in result.stdout.splitlines() if "FEATURE_SHAPE=" in line]
    return {row["id"]: row for row in rows}


def request(client, shapes, shape_id, headers, job_id=None):
    shape = shapes[shape_id]
    path = shape["path"].replace("123456abcdef", job_id) if job_id else shape["path"]
    return client.request(shape["method"], path, headers=headers, json=shape.get("body"))


def checked(response):
    assert response.status_code == 200, (response.request.url.path, response.status_code, response.text)
    return response.json()


def verify_cron(client, shapes, headers, home):
    created = checked(request(client, shapes, "cron-create", headers))
    assert created["catch_up"] is True
    assert created["timezone"] == "Asia/Shanghai" and created["grace_minutes"] == 0
    invalid = request(client, shapes, "cron-invalid-timezone", headers)
    assert invalid.status_code == 400 and "Unknown timezone" in invalid.text, invalid.text
    job = created["id"]
    updated = checked(request(client, shapes, "cron-edit", headers, job))
    assert updated.get("catch_up") is None
    assert updated.get("timezone") is None and updated.get("grace_minutes") is None
    assert request(client, shapes, "cron-stop", headers).status_code == 404
    assert checked(request(client, shapes, "cron-stop", headers, job))["cancelled"] is False

    with ThreadPoolExecutor(max_workers=1) as pool:
        running = pool.submit(request, client, shapes, "cron-trigger", headers, job)
        deadline = time.monotonic() + 15
        while not (home / "scripts" / "started").exists() and time.monotonic() < deadline:
            if running.done():
                raise AssertionError(running.result().text)
            time.sleep(0.1)
        assert (home / "scripts" / "started").is_file(), "scheduled script never started"
        stopped = checked(request(client, shapes, "cron-stop", headers, job))
        assert stopped["job_id"] == job and stopped["cancelled"] is True
        terminal = checked(running.result(timeout=15))
        assert terminal["last_status"] == "cancelled", terminal
        assert terminal["schedule"] == updated["schedule"] and terminal["enabled"] is True


def verify_skills(client, shapes, native_headers, default_headers):
    for shape_id, locked in (("skill-lock", True), ("skill-unlock", False)):
        response = checked(request(client, shapes, shape_id, native_headers()))
        assert response == {"ok": True, "name": "desktop-probe", "locked": locked}
        rows = checked(client.get("/api/skills", headers=native_headers()))
        assert next(row for row in rows if row["name"] == "desktop-probe")["locked"] is locked
        rows = checked(client.get("/api/skills", headers=default_headers))
        assert next(row for row in rows if row["name"] == "desktop-probe")["locked"] is False
    shape = shapes["skill-lock"]
    missing = client.request(shape["method"], shape["path"], headers=native_headers(),
                             json={**shape["body"], "name": "not-a-skill"})
    assert missing.status_code == 404


async def verify_chat(ws, home, shapes, env, model):
    async def call(method, **params):
        response = await rpc(ws, method, **params)
        assert "result" in response, response
        return response["result"]

    session = await call("session.create", source="gui", request_id="desktop-model-reset-test", cwd=str(home), toolsets=[])
    session_id = session["session_id"]
    await call("prompt.submit", session_id=session_id, submission_id="model-reset-history", text="MODEL_RESET_HISTORY")
    history = None
    for _ in range(100):
        snapshot = await call("session.resume", session_id=session_id)
        messages = snapshot.get("messages", [])
        if any(row.get("role") == "assistant" and "RECOVERY_ACK_MODEL_RESET_HISTORY" in str(row.get("content")) for row in messages):
            history = [(row.get("role"), row.get("content")) for row in messages]
            break
        await asyncio.sleep(0.1)
    assert history, "loopback model did not create a conversation"

    async def mutate(shape_id):
        snap = await call("session.resume", session_id=session_id)
        shape = shapes[shape_id]
        return await rpc(ws, shape["method"], **{
            **shape["params"], "session_id": session_id, "expected_revision": snap["revision"],
            "expected_generation": snap["execution_generation"],
        })

    override = await mutate("model-override")
    assert override.get("result", {}).get("model") == "desktop-model-override", override
    invalid = await mutate("model-reset-invalid")
    assert "error" in invalid, invalid
    reset = await mutate("model-reset")
    assert reset.get("result", {}).get("model") == "desktop-default", reset
    restored = await call("session.resume", session_id=session_id)
    assert [(row.get("role"), row.get("content")) for row in restored["messages"]] == history

    def refresh(target):
        args = [arg.replace("desktop-fixture", target) for arg in shapes["session-prompt-refresh"]["args"]]
        return subprocess.run([sys.executable, "-m", "hermes_cli.main", *args], cwd=UPSTREAM, env=env,
                              capture_output=True, text=True, encoding="utf-8", timeout=20)

    assert refresh("unknown-desktop-session").returncode != 0
    (home / "SOUL.md").write_text("PROMPT_REFRESH_NEW_SOUL\n", encoding="utf-8")
    refreshed = refresh(session_id)
    assert refreshed.returncode == 0, (refreshed.stdout, refreshed.stderr)
    assert json.loads(refreshed.stdout)["session_id"] == session_id
    await call("prompt.submit", session_id=session_id, submission_id="prompt-refresh-next-turn", text="PROMPT_REFRESH_PROBE")
    for _ in range(100):
        for body in model.requests:
            messages = body.get("messages", [])
            if any(row.get("role") == "user" and row.get("content") == "PROMPT_REFRESH_PROBE" for row in messages):
                assert any(row.get("role") == "system" and "PROMPT_REFRESH_NEW_SOUL" in str(row.get("content")) for row in messages)
                await verify_history_actions(ws, session_id, shapes, call)
                return
        await asyncio.sleep(0.1)
    raise AssertionError("the refreshed turn did not reach the loopback model")


async def verify_history_actions(ws, session_id, shapes, call):
    async def settled(text):
        for _ in range(100):
            snapshot = await call("session.resume", session_id=session_id, source="desktop")
            if not snapshot.get("running") and any(row.get("role") == "assistant" and text in str(row.get("content"))
                                                    for row in snapshot["messages"]):
                return snapshot
            await asyncio.sleep(.1)
        raise AssertionError(f"turn {text} did not settle")

    def mutation(shape_id, snapshot, row_id):
        shape = shapes[shape_id]
        params = {**shape["params"], "session_id": session_id, "expected_revision": snapshot["revision"],
                  "expected_generation": snapshot["execution_generation"]}
        field = next(iter(params["payload"]))
        return shape["method"], {**params, "payload": {field: row_id}}

    parent = await settled("RECOVERY_ACK_PROMPT_REFRESH_PROBE")
    boundary = next(row["row_id"] for row in parent["messages"] if row.get("content") == "RECOVERY_ACK_MODEL_RESET_HISTORY")
    method, branch = mutation("history-branch", parent, boundary)
    branch_receipt = await call(method, **branch)
    child = await call("session.resume", session_id=branch_receipt["branched_session_id"], source="desktop")
    assert [row["content"] for row in child["messages"]] == ["MODEL_RESET_HISTORY", "RECOVERY_ACK_MODEL_RESET_HISTORY"]
    assert await call(method, **branch) == branch_receipt
    assert "error" in await rpc(ws, method, **{**branch, "request_id": str(uuid.uuid4())})

    parent = await call("session.resume", session_id=session_id, source="desktop")
    assert any(row.get("content") == "PROMPT_REFRESH_PROBE" for row in parent["messages"])
    method, invalid = mutation("history-rewind", parent, boundary)
    assert "error" in await rpc(ws, method, **{**invalid, "request_id": str(uuid.uuid4())})
    user_row = next(row["row_id"] for row in parent["messages"] if row.get("content") == "PROMPT_REFRESH_PROBE")
    method, rewind = mutation("history-rewind", parent, user_row)
    receipt = await call(method, **rewind)
    assert receipt["rewound_count"] >= 2 and await call(method, **rewind) == receipt
    await call("prompt.submit", session_id=session_id, submission_id=str(uuid.uuid4()), text="EDITED_RESEND_PROBE", clarify_batch=True)
    edited = await settled("RECOVERY_ACK_EDITED_RESEND_PROBE")
    assert [row["content"] for row in edited["messages"] if row.get("role") == "user"] == ["MODEL_RESET_HISTORY", "EDITED_RESEND_PROBE"]


async def verify_room_delivery(ws, client, headers, shapes):
    target = shapes["cron-room-create"]["body"]["deliver"]
    room_id = target.removeprefix("room:").split("@", 1)[0]
    created = await rpc(ws, "groups.create", room_id=room_id, name="Cron delivery probe", members=[
        {"member_id": owner, "profile": owner, "handle": owner} for owner in ("default", "reviewer")
    ])
    assert created.get("result", {}).get("room", {}).get("room_id") == room_id, created
    listed = await rpc(ws, "groups.list")
    assert any(room["room_id"] == room_id for room in listed["result"]["rooms"])
    job = checked(request(client, shapes, "cron-room-create", headers))
    assert job["deliver"] == target
    run = checked(await asyncio.to_thread(request, client, shapes, "cron-trigger", headers, job["id"]))
    assert run["last_status"] == "ok", run
    log = await rpc(ws, "groups.log", room_id=room_id, since_seq=0)
    assert any(event["kind"] == "message.user" and event["payload"].get("text") == "CRON_ROOM_PROBE"
               for event in log["result"]["events"]), log

    async def room_request(shape_id, **updates):
        shape = shapes[shape_id]
        return await rpc(ws, shape["method"], **{**shape["params"], "room_id": room_id, **updates})

    refused = await room_request("room-lead", lead_member_id="missing-member", event_id=str(uuid.uuid4()))
    assert "error" in refused, refused
    for routing in ("lead", "auto", "everyone"):
        context = await room_request(f"room-{routing}")
        assert context.get("result", {}).get("context", {}).get("routing") == routing, context
    state = await rpc(ws, "groups.state", room_id=room_id)
    assert state["result"]["context"]["notes"] == "ROOM_SHARED_PROBE"
    assert isinstance(state["result"]["driver_status"]["member_activity"], list)
    refused = await room_request("room-continue")
    assert "error" in refused, refused

    sent = await rpc(ws, "groups.send", room_id=room_id, event_id=str(uuid.uuid4()), payload={
        "text": "Discuss the cron report.", "thread_id": str(uuid.uuid4()),
    })
    discussion = sent["result"]["event"]["event_id"]
    deadline = time.monotonic() + 30
    while True:
        log = await rpc(ws, "groups.log", room_id=room_id, since_seq=0)
        if any(event["kind"] == "room.activity" and event["payload"].get("status") == "bounded"
               and event["payload"].get("discussion_event_id") == discussion for event in log["result"]["events"]):
            break
        assert time.monotonic() < deadline, log
        await asyncio.sleep(.2)
    continued = await room_request("room-continue", discussion_event_id=discussion)
    assert continued.get("result", {}).get("event", {}).get("kind") == "room.continued", continued


async def verify_socket(home, descriptor, shapes, env, model, client, headers):
    # The product's scoped RPC adapter shares the launch-profile socket and adds a selector.
    ticket = control(home, "session-ticket", {"profile_id": str(home), "purpose": "interactive",
                                               "scope": "host", "instance_id": descriptor["instance_id"]})["ticket"]
    url = descriptor["api_origin"].replace("http:", "ws:") + "/api/ws"
    async with connect(url, subprotocols=["hermes-gateway-v1", "hermes-gateway-ticket." + ticket], proxy=None) as ws:
        for owner in ("default", "reviewer"):
            shape = shapes[f"mcp-{owner}"]
            response = await rpc(ws, shape["method"], **shape["params"])
            assert "result" in response, response
            rows = response["result"]["servers"]
            assert {row["name"] for row in rows} == {f"{owner}-mcp"}, rows
            assert all(row["needs_auth"] is False for row in rows), rows
        missing = await rpc(ws, shape["method"], profile="missing-desktop-probe")
        assert "error" in missing, missing
        for suffix, enabled in (("default", False), ("read", False), ("enable", True), ("read", True),
                                ("default", False), ("disable", False)):
            daybreak = shapes[f"daybreak-{suffix}"]
            response = await rpc(ws, daybreak["method"], **daybreak["params"])
            assert response.get("result", {}).get("value") is enabled, response
        invalid_daybreak = await rpc(ws, "config.set", key="daybreak", value=True, profile="missing-desktop-probe")
        assert "error" in invalid_daybreak, invalid_daybreak
        await verify_room_delivery(ws, client, headers, shapes)
        await verify_chat(ws, home, shapes, env, model)
        await verify_tool_image(ws, home, model.image)


async def verify_tool_image(ws, home, image):
    frames = deque()

    async def call(method, **params):
        await ws.send(json.dumps({"jsonrpc": "2.0", "id": method, "method": method, "params": params}))
        async with asyncio.timeout(20):
            while True:
                frame = json.loads(await ws.recv())
                if frame.get("id") == method:
                    assert "result" in frame, frame
                    return frame["result"]
                frames.append(frame)

    created = await call("session.create", source="gui", request_id="desktop-tool-image-test",
                         cwd=str(home), toolsets=["vision"])
    session_id = created["session_id"]
    await call("session.resume", session_id=session_id, source="desktop")
    await call("prompt.submit", session_id=session_id, submission_id="tool-image", text="TOOL_IMAGE_PROBE")
    async with asyncio.timeout(25):
        while True:
            frame = frames.popleft() if frames else json.loads(await ws.recv())
            params = frame.get("params", {})
            if frame.get("method") != "event" or params.get("session_id") != session_id:
                continue
            payload = params.get("payload", {})
            if params.get("type") == "tool.complete" and payload.get("name") == "vision_analyze":
                assert Path(payload.get("image_path") or "") == image, payload
                return
            if params.get("type") == "message.complete":
                raise AssertionError("the image tool did not complete")


class FeatureModel(Model):
    def do_POST(self):
        # Inspect only the image turn. The shared loopback fixture handles the other turns.
        raw = self.rfile.read(int(self.headers["Content-Length"]))
        body = json.loads(raw)
        messages = body.get("messages", [])
        if not any(row.get("role") == "user" and row.get("content") == "TOOL_IMAGE_PROBE" for row in messages) or any(
            row.get("role") == "tool" for row in messages
        ):
            self.rfile = io.BytesIO(raw)
            return super().do_POST()
        assert any(row["function"]["name"] == "vision_analyze" for row in body["tools"]), body.get("tools")
        tool = {"id": "desktop-vision-probe", "type": "function", "function": {
            "name": "vision_analyze", "arguments": json.dumps({"image_url": str(self.server.image), "question": "Describe it"}),
        }}
        message = {"role": "assistant", "content": None, "tool_calls": [tool]}
        choice = {"index": 0, "message": message, "finish_reason": "tool_calls"}
        kind = "application/json"
        if body.get("stream"):
            tool["index"] = 0
            choice["delta"] = choice.pop("message")
            kind = "text/event-stream"
        payload = json.dumps({"id": "local-vision-probe", "choices": [choice]}).encode()
        if body.get("stream"):
            payload = b"data: " + payload + b"\n\ndata: [DONE]\n\n"
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


@contextmanager
def loopback_model():
    with ThreadingHTTPServer(("127.0.0.1", 0), FeatureModel) as server:
        server.requests = []
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            yield server
        finally:
            server.shutdown()
            worker.join(timeout=5)


def main():
    shapes = production_shapes()
    with (tempfile.TemporaryDirectory(prefix="hermess-gateway-features-", ignore_cleanup_errors=True) as directory,
          loopback_model() as model):
        model_url = f"http://127.0.0.1:{model.server_port}/v1"
        root = Path(directory)
        home, user = root / "state", root / "user"
        user.mkdir()
        model.image = root / "tool-probe.png"
        Image.new("RGB", (4, 4), "blue").save(model.image)
        reviewer = home / "profiles" / "reviewer"
        for owner, profile_home in (("default", home), ("reviewer", reviewer)):
            skill = profile_home / "skills" / "testing" / "desktop-probe"
            skill.mkdir(parents=True)
            (skill / "SKILL.md").write_text(
                "---\nname: desktop-probe\ndescription: Isolated Gateway probe.\n---\nCheck the lock.\n",
                encoding="utf-8",
            )
            config = {"gateway": {"multiplex_profiles": True, "managed_workers": False},
                      "model": {"provider": "custom", "default": "desktop-default", "base_url": model_url},
                      "hosted_rooms": {"discussion": {"max_rounds": 3, "max_messages": 1}},
                      "platform_toolsets": {"gui": ["vision"], "bot_room": []},
                      "auxiliary": {"title_generation": {"enabled": False}, "vision": {
                          "provider": "custom", "model": "desktop-vision", "base_url": model_url, "api_key": "loopback-only",
                      }},
                      "mcp_servers": {f"{owner}-mcp": {"command": "unused-desktop-probe", "enabled": False}}}
            (profile_home / "config.yaml").write_text(json.dumps(config), encoding="utf-8")
        scripts = home / "scripts"
        scripts.mkdir()
        (scripts / "stop-probe.py").write_text(
            "from pathlib import Path\nimport time\nPath(__file__).with_name('started').touch()\ntime.sleep(25)\n",
            encoding="utf-8",
        )
        (scripts / "room-probe.py").write_text("print('CRON_ROOM_PROBE')\n", encoding="utf-8")
        token = secrets.token_urlsafe(32)
        env = child_env()
        env.update(HOME=str(user), USERPROFILE=str(user), HERMES_HOME=str(home), PYTHONPATH=str(UPSTREAM),
                   OPENAI_API_KEY="loopback-only", OPENAI_BASE_URL=model_url,
                   HERMES_DASHBOARD_SESSION_TOKEN=token, HERMES_DESKTOP="1", HERMESS_DESKTOP_PRIVATE_API="1",
                   HERMES_DISABLE_LAZY_INSTALLS="1", HERMES_GATEWAY_LOCK_DIR=str(root / "locks"))
        with daemon(UPSTREAM, home, env, barrier=False) as (_, descriptor):
            def named_headers():
                ticket = control(home, "session-ticket", {"profile_id": str(reviewer), "purpose": "native-http", "scope": "profile",
                                                          "instance_id": descriptor["instance_id"]})["ticket"]
                return {"X-Hermes-Gateway-Ticket": ticket}

            default_headers = {"X-Hermes-Session-Token": token}
            with httpx.Client(base_url=descriptor["api_origin"], trust_env=False, timeout=40) as client:
                verify_skills(client, shapes, named_headers, default_headers)
                for headers in (default_headers, named_headers()):
                    assert checked(request(client, shapes, "plugin-batch", headers)) == {
                        "results": [], "skipped": [], "current": 0,
                    }
                assert request(client, shapes, "plugin-batch", {}).status_code in (401, 403)
                assert checked(request(client, shapes, "plugin-auto-read", named_headers()))["auto_apply"] is False
                assert checked(request(client, shapes, "plugin-auto-enable", named_headers()))["auto_apply"] is True
                assert checked(request(client, shapes, "plugin-auto-read", named_headers()))["auto_apply"] is True
                assert checked(request(client, shapes, "plugin-auto-read", default_headers))["auto_apply"] is False
                assert request(client, shapes, "plugin-auto-disable", {}).status_code in (401, 403)
                assert checked(request(client, shapes, "plugin-auto-disable", named_headers()))["auto_apply"] is False
                verify_cron(client, shapes, default_headers, home)
                asyncio.run(verify_socket(home, descriptor, shapes, env, model, client, default_headers))
    print("Verified locked Hermes cron scheduling and room delivery, skill lock, plugin updates, MCP status, model reset, prompt refresh, history actions, Daybreak, room controls, and tool image events.")


if __name__ == "__main__":
    main()
