"""I0 Windows smoke: owned isolated serve, private port and token-authenticated WS ping."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=Path, required=True, help="prepared Hermes venv Python")
    parser.add_argument("--hermes", type=Path, help="optional sealed payload launcher under the product .build")
    args = parser.parse_args()
    python = args.python.resolve(strict=True)
    hermes = args.hermes.resolve(strict=True) if args.hermes else python.with_name("hermes.exe" if os.name == "nt" else "hermes")
    if not hermes.is_file():
        parser.error(f"Hermes launcher is missing beside the selected Python: {hermes}")
    product = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(product / "upstream" / "hermes-agent"))
    if not python.is_relative_to(product / ".build"):
        parser.error("I0 smoke only accepts a prepared environment under the product .build directory")
    if args.hermes:
        if not hermes.is_relative_to(product / ".build") or not (hermes.parent.parent / "manifest.json").is_file():
            parser.error("--hermes must name a sealed payload launcher under the product .build directory")
    subprocess.run(["node", str(product / "scripts" / "verify-upstream.mjs")], check=True)

    from websockets.asyncio.client import connect
    from websockets.exceptions import ConnectionClosed, InvalidStatus
    from tests.fakes.fake_llm_provider import FakeLLMServer, MODEL_ID, Text, ToolCall, write_hermes_home

    scratch = product / ".build"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="中文 空格 gateway-smoke-", dir=scratch, ignore_cleanup_errors=True) as temp:
        root = Path(temp)
        home = root / "hermes-home"
        fixture = root / "notes.txt"
        fixture.write_text("Hermess file tool canary\n", encoding="utf-8")
        model = FakeLLMServer([Text("Hermess I0 local model reply", chunk_chars=4,
                                    reasoning="Hermess reasoning canary")])
        model.start()
        write_hermes_home(home, model.base_url)
        skill_dir = home / "skills" / "composer-canary"
        skill_dir.mkdir(parents=True, exist_ok=True)
        (skill_dir / "SKILL.md").write_text(
            "---\nname: composer-canary\ndescription: Verify the desktop skill picker.\n"
            "platforms: [windows, linux, macos]\n---\n\n# Composer Canary\n\nAnswer the user's request.\n",
            encoding="utf-8",
        )
        config_file = home / "config.yaml"
        config_file.write_text(config_file.read_text(encoding="utf-8").replace(
            f"  default: {MODEL_ID}\n", "  default: before-config-canary\n"), encoding="utf-8")
        ready = root / "ready.json"
        env = os.environ.copy()
        env.update({
            "HERMES_HOME": str(home),
            "HERMES_GATEWAY_LOCK_DIR": str(root / "gateway-locks"),
            "HERMES_DESKTOP_READY_FILE": str(ready),
            "HERMES_DESKTOP": "1",
            "HERMESS_DESKTOP_PRIVATE_API": "1",
            "HERMES_DASHBOARD_SESSION_TOKEN": secrets.token_urlsafe(32),
            "HERMES_PARENT_PID": str(os.getpid()),
            "HERMES_DISABLE_LAZY_INSTALLS": "1",
            "HTTP_PROXY": "http://127.0.0.1:9",
            "HTTPS_PROXY": "http://127.0.0.1:9",
            "ALL_PROXY": "http://127.0.0.1:9",
            "NO_PROXY": "127.0.0.1,localhost",
        })
        for key in ("HERMES_RUNTIME_DIR", "HERMES_INSTALL_ROOT", "PYTHONPATH"):
            env.pop(key, None)
        previous_home = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = str(home)
        try:
            with (root / "stdout.log").open("wb") as stdout, (root / "stderr.log").open("wb") as stderr:
                child = subprocess.Popen(
                    [str(hermes), "serve", "--host", "127.0.0.1", "--port", "0", "--isolated"],
                    env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
                try:
                    deadline = time.monotonic() + 60
                    while not ready.exists() and child.poll() is None and time.monotonic() < deadline:
                        time.sleep(0.2)
                    if not ready.exists() or child.poll() is not None:
                        raise RuntimeError(f"backend did not become ready; exit={child.poll()}")
                    port = json.loads(ready.read_text(encoding="utf-8"))["port"]
                    opener = build_opener(ProxyHandler({}))
                    try:
                        opener.open(f"http://127.0.0.1:{port}/", timeout=5)
                    except HTTPError as error:
                        if error.code != 404:
                            raise RuntimeError(f"private root returned HTTP {error.code}") from error
                    else:
                        raise RuntimeError("private root exposed a dashboard token page")

                    async def reject_browser_origin() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={env['HERMES_DASHBOARD_SESSION_TOKEN']}"
                        try:
                            async with connect(url, origin=f"http://127.0.0.1:{port}",
                                               open_timeout=5, proxy=None):
                                pass
                        except InvalidStatus:
                            return
                        raise RuntimeError("browser-origin WebSocket was accepted")

                    asyncio.run(reject_browser_origin())
                    async def ping() -> object:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={env['HERMES_DASHBOARD_SESSION_TOKEN']}"
                        async with connect(url, open_timeout=5, proxy=None, max_size=8 * 1024 * 1024) as ws:
                            await ws.send(json.dumps({"jsonrpc": "2.0", "id": 1, "method": "ping", "params": {}}))
                            while True:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                                if frame.get("id") == 1:
                                    return frame.get("result")

                    answer = asyncio.run(ping())
                    if answer != {"pong": True}:
                        raise RuntimeError(f"unexpected ping reply: {answer!r}")

                    async def tool_catalog(method: str) -> dict:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={env['HERMES_DASHBOARD_SESSION_TOKEN']}"
                        async with connect(url, open_timeout=5, proxy=None, max_size=8 * 1024 * 1024) as ws:
                            await ws.send(json.dumps({"jsonrpc": "2.0", "id": 2, "method": method,
                                                      "params": {"session_id": None}}))
                            while True:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                                if frame.get("id") == 2:
                                    if "error" in frame:
                                        raise RuntimeError(f"{method} failed: {frame['error']}")
                                    return frame.get("result") or {}

                    catalog = asyncio.run(tool_catalog("tools.list"))
                    groups = {row["name"]: row for row in catalog.get("toolsets", [])}
                    if "terminal" not in groups or "terminal" not in groups["terminal"].get("tools", []):
                        raise RuntimeError("tools.list omitted the terminal tool")
                    if "browser" not in groups or "browser_navigate" not in groups["browser"].get("tools", []):
                        raise RuntimeError("tools.list omitted browser navigation")
                    active_tools = asyncio.run(tool_catalog("tools.show"))
                    if not isinstance(active_tools.get("sections"), list):
                        raise RuntimeError("tools.show did not return active tool sections")

                    async def reject_wrong_token() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token=invalid-i0-probe"
                        try:
                            async with connect(url, open_timeout=5, proxy=None) as ws:
                                await asyncio.wait_for(ws.recv(), timeout=5)
                        except (ConnectionClosed, InvalidStatus):
                            return
                        raise RuntimeError("backend accepted a wrong WebSocket credential")

                    asyncio.run(reject_wrong_token())

                    assignment = json.dumps({"scope": "main", "provider": "custom", "model": MODEL_ID,
                                             "base_url": model.base_url, "api_key": "sk-fake-e2e"}).encode()
                    endpoint = f"http://127.0.0.1:{port}/api/model/set"
                    try:
                        opener.open(Request(endpoint, data=assignment, headers={"Content-Type": "application/json",
                                                                                  "X-Hermes-Session-Token": "wrong-token"}), timeout=10)
                    except HTTPError as error:
                        if error.code != 401:
                            raise RuntimeError(f"wrong model-config token returned HTTP {error.code}") from error
                    else:
                        raise RuntimeError("model configuration accepted a wrong credential")
                    with opener.open(Request(endpoint, data=assignment, headers={"Content-Type": "application/json",
                                                                                   "X-Hermes-Session-Token": env["HERMES_DASHBOARD_SESSION_TOKEN"]}),
                                     timeout=30) as response:
                        configured = json.load(response)
                    if configured.get("ok") is not True or configured.get("model") != MODEL_ID:
                        raise RuntimeError(f"model assignment failed: {configured}")
                    if f"default: {MODEL_ID}" not in config_file.read_text(encoding="utf-8"):
                        raise RuntimeError("model assignment did not persist the selected model")

                    async def chat(prompt: str, expected: str, request_method: str = "",
                                   expected_reasoning: str = "") -> tuple[str, int, int, int]:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={env['HERMES_DASHBOARD_SESSION_TOKEN']}"
                        async with connect(url, open_timeout=5, proxy=None, max_size=8 * 1024 * 1024) as ws:
                            while True:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                                if frame.get("params", {}).get("type") == "gateway.ready":
                                    break
                            await ws.send(json.dumps({"jsonrpc":"2.0","id":1,"method":"client.capabilities",
                                                      "params":{"server_requests":True,"desktop_local":True}}))
                            while True:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                                if frame.get("id") == 1:
                                    if frame.get("error") or "clarify" not in frame.get("result", {}).get("server_requests", []):
                                        raise RuntimeError(f"server requests unavailable: {frame}")
                                    break
                            await ws.send(json.dumps({"jsonrpc":"2.0","id":2,"method":"session.create",
                                                      "params":{"source":"desktop","cwd":str(root),"cwd_explicit":True,
                                                                "idempotency_key":secrets.token_hex(16)}}))
                            session_id = ""
                            while not session_id:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
                                if frame.get("id") == 2:
                                    if frame.get("error"):
                                        raise RuntimeError(f"session.create failed: {frame['error']}")
                                    session_id = frame["result"]["session_id"]
                            await ws.send(json.dumps({"jsonrpc":"2.0","id":3,"method":"prompt.submit",
                                                      "params":{"session_id":session_id,"text":prompt}}))
                            deltas = 0
                            reasoning_parts = []
                            tool_completions = 0
                            requests = 0
                            admitted = False
                            deadline = time.monotonic() + 60
                            while time.monotonic() < deadline:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                                if frame.get("method") == "clarify":
                                    questions = frame.get("params", {}).get("questions", [])
                                    if request_method != "clarify" or len(questions) != 1:
                                        raise RuntimeError(f"unexpected clarify request: {frame}")
                                    await ws.send(json.dumps({"jsonrpc":"2.0","id":frame["id"],
                                                              "result":{"answers":{questions[0]["qid"]:"blue"},
                                                                        "outcome":"submitted"}}))
                                    requests += 1
                                if frame.get("method") == "approval":
                                    if request_method != "approval":
                                        raise RuntimeError(f"unexpected approval request: {frame}")
                                    await ws.send(json.dumps({"jsonrpc":"2.0","id":frame["id"],
                                                              "result":{"choice":"deny"}}))
                                    requests += 1
                                if frame.get("id") == 3:
                                    if frame.get("error"):
                                        raise RuntimeError(f"prompt.submit failed: {frame['error']}")
                                    admitted = frame.get("result", {}).get("status") in {"streaming", "queued"}
                                params = frame.get("params", {})
                                if params.get("session_id") != session_id:
                                    continue
                                if params.get("type") == "message.delta" and isinstance(params.get("payload", {}).get("text"), str):
                                    deltas += 1
                                if params.get("type") == "reasoning.delta" and isinstance(params.get("payload", {}).get("text"), str):
                                    reasoning_parts.append(params["payload"]["text"])
                                if params.get("type") == "tool.complete":
                                    tool_completions += 1
                                if params.get("type") == "message.complete":
                                    result = params.get("payload", {})
                                    if not admitted or result.get("text") != expected:
                                        raise RuntimeError(f"unexpected completed turn: {result}")
                                    if expected_reasoning and "".join(reasoning_parts) != expected_reasoning:
                                        raise RuntimeError(f"reasoning stream mismatch: {reasoning_parts!r}")
                                    return session_id, deltas, tool_completions, requests
                            raise RuntimeError("message.complete was not received")

                    session_id, deltas, _, _ = asyncio.run(chat("Say hello", "Hermess I0 local model reply",
                                                             expected_reasoning="Hermess reasoning canary"))
                    if deltas < 1 or not model.main_requests():
                        raise RuntimeError("chat did not stream through the local fake model")
                    async def verify_history() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={env['HERMES_DASHBOARD_SESSION_TOKEN']}"
                        async with connect(url, open_timeout=5, proxy=None, max_size=8 * 1024 * 1024) as ws:
                            async def rpc(number: int, method: str, params: dict) -> dict:
                                await ws.send(json.dumps({"jsonrpc":"2.0","id":number,"method":method,"params":params}))
                                while True:
                                    frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
                                    if frame.get("id") == number:
                                        if frame.get("error"):
                                            raise RuntimeError(f"{method} failed: {frame['error']}")
                                        return frame["result"]
                            listed = await rpc(10, "session.list", {"limit":50})
                            stored = next((row["id"] for row in listed.get("sessions", []) if row.get("preview") == "Say hello"), None)
                            if not stored:
                                raise RuntimeError(f"completed session was absent from session.list: rows={listed.get('sessions', [])!r}")
                            resumed = await rpc(11, "session.resume", {"session_id":stored,"source":"desktop"})
                            if not resumed.get("session_id") or not any(message.get("text") == "Hermess I0 local model reply" for message in resumed.get("messages", [])):
                                raise RuntimeError("session.resume did not restore transcript")
                            if not any(message.get("reasoning_content") == "Hermess reasoning canary"
                                       for message in resumed.get("messages", [])):
                                raise RuntimeError("session.resume did not restore reasoning content")
                            interrupted = await rpc(12, "session.interrupt", {"session_id":resumed["session_id"]})
                            if interrupted.get("status") not in {"interrupted", "not_interrupted"}:
                                raise RuntimeError(f"session.interrupt returned unexpected status: {interrupted}")
                    asyncio.run(verify_history())
                    async def verify_attachments() -> None:
                        from PIL import Image

                        image = root / "pixel.png"
                        Image.new("RGB", (2, 2), (20, 40, 60)).save(image)
                        url = f"ws://127.0.0.1:{port}/api/ws?token={env['HERMES_DASHBOARD_SESSION_TOKEN']}"
                        async with connect(url, open_timeout=5, proxy=None, max_size=8 * 1024 * 1024) as ws:
                            async def rpc(number: int, method: str, params: dict) -> dict:
                                await ws.send(json.dumps({"jsonrpc": "2.0", "id": number, "method": method, "params": params}))
                                while True:
                                    frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                                    if frame.get("id") == number:
                                        if frame.get("error"):
                                            raise RuntimeError(f"{method} failed: {frame['error']}")
                                        return frame["result"]

                            created = await rpc(30, "session.create", {"source": "desktop", "cwd": str(root),
                                                                         "cwd_explicit": True,
                                                                         "idempotency_key": secrets.token_hex(16)})
                            sid = created["session_id"]
                            catalog = await rpc(35, "commands.catalog", {"session_id": sid})
                            if not any(pair[0] == "/help" for pair in catalog.get("pairs", [])):
                                raise RuntimeError("command catalog did not include /help")
                            if not any(pair[0] == "/model" for pair in catalog.get("pairs", [])):
                                raise RuntimeError("command catalog did not include /model")
                            if "/composer-canary" not in catalog.get("skills", {}):
                                raise RuntimeError("command catalog did not include the installed skill")
                            help_result = await rpc(36, "slash.exec", {"session_id": sid, "command": "/help"})
                            if not help_result.get("output"):
                                raise RuntimeError(f"/help returned no output: {help_result}")
                            skill_result = await rpc(37, "command.dispatch", {
                                "session_id": sid, "name": "composer-canary", "arg": "check the picker"})
                            if skill_result.get("type") != "skill" or not skill_result.get("message"):
                                raise RuntimeError(f"skill command did not resolve: {skill_result}")
                            file_result = await rpc(31, "file.attach", {"session_id": sid, "path": str(fixture)})
                            if not file_result.get("attached") or not file_result.get("ref_text", "").startswith("@file:"):
                                raise RuntimeError(f"file attachment failed: {file_result}")
                            staged = Path(file_result["path"])
                            if staged.read_bytes() != fixture.read_bytes():
                                raise RuntimeError("staged file differs from selected file")
                            image_result = await rpc(32, "image.attach", {"session_id": sid, "path": str(image)})
                            if not image_result.get("attached") or not image_result.get("path"):
                                raise RuntimeError(f"image attachment failed: {image_result}")
                            detached = await rpc(33, "image.detach", {"session_id": sid,
                                                                       "path": image_result["path"]})
                            if detached.get("detached") is not True:
                                raise RuntimeError(f"image detach failed: {detached}")
                            model.push(Text("Attachment canary reply"))
                            submitted = await rpc(34, "prompt.submit", {"session_id": sid,
                                                                          "text": "Read this file\n" + file_result["ref_text"]})
                            if submitted.get("status") not in {"streaming", "queued"}:
                                raise RuntimeError(f"attachment prompt was not admitted: {submitted}")
                            while True:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                                params = frame.get("params", {})
                                if params.get("session_id") == sid and params.get("type") == "message.complete":
                                    if params.get("payload", {}).get("text") != "Attachment canary reply":
                                        raise RuntimeError(f"attachment turn failed: {params}")
                                    break
                    asyncio.run(verify_attachments())
                    async def reconnect_live_turn() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={env['HERMES_DASHBOARD_SESSION_TOKEN']}"
                        model.push(Text("Reconnect stream canary reached completion", chunk_chars=2, delay_per_chunk=0.12))
                        async with connect(url, open_timeout=5, proxy=None) as first:
                            while True:
                                ready = json.loads(await asyncio.wait_for(first.recv(), timeout=5))
                                if ready.get("params", {}).get("type") == "gateway.ready":
                                    first_epoch = ready["params"]["payload"]["replay_epoch"]
                                    break
                            await first.send(json.dumps({"jsonrpc":"2.0","id":20,"method":"session.create","params":{
                                "source":"desktop","cwd":str(root),"cwd_explicit":True,"idempotency_key":secrets.token_hex(16)}}))
                            while True:
                                frame = json.loads(await asyncio.wait_for(first.recv(), timeout=20))
                                if frame.get("id") == 20:
                                    created = frame["result"]
                                    break
                            await first.send(json.dumps({"jsonrpc":"2.0","id":21,"method":"prompt.submit","params":{
                                "session_id":created["session_id"],"text":"Stream across reconnect"}}))
                            while True:
                                frame = json.loads(await asyncio.wait_for(first.recv(), timeout=20))
                                params = frame.get("params", {})
                                if params.get("type") == "message.delta" and params.get("session_id") == created["session_id"]:
                                    first_seq = params["seq"]
                                    break
                        async with connect(url, open_timeout=5, proxy=None) as second:
                            await second.send(json.dumps({"jsonrpc":"2.0","id":22,"method":"client.capabilities","params":{
                                "server_requests":True,"desktop_local":True}}))
                            await second.send(json.dumps({"jsonrpc":"2.0","id":23,"method":"session.resume","params":{
                                "session_id":created["stored_session_id"],"source":"desktop"}}))
                            result = {}
                            saw_complete = False
                            while 23 not in result:
                                frame = json.loads(await asyncio.wait_for(second.recv(), timeout=20))
                                saw_complete |= frame.get("params", {}).get("type") == "message.complete"
                                if frame.get("id") in {22, 23}:
                                    result[frame["id"]] = frame.get("result")
                            resumed = result[23]
                            if resumed.get("session_id") != created["session_id"]:
                                raise RuntimeError("live reconnect minted another runtime session")
                            await second.send(json.dumps({"jsonrpc":"2.0","id":24,"method":"session.events.since","params":{
                                "session_id":created["session_id"],"last_seen":first_seq,
                                "replay_epoch":first_epoch}}))
                            while True:
                                frame = json.loads(await asyncio.wait_for(second.recv(), timeout=20))
                                saw_complete |= frame.get("params", {}).get("type") == "message.complete"
                                if frame.get("id") == 24:
                                    replay = frame["result"]
                                    break
                            if replay.get("truncated") or replay.get("epoch") != first_epoch or replay.get("latest_seq", 0) < first_seq:
                                raise RuntimeError("reconnect replay has a gap")
                            saw_complete |= any(event.get("type") == "message.complete" for event in replay.get("events", []))
                            if not saw_complete:
                                while True:
                                    frame = json.loads(await asyncio.wait_for(second.recv(), timeout=20))
                                    if frame.get("params", {}).get("type") == "message.complete":
                                        break
                    asyncio.run(reconnect_live_turn())
                    async def interrupt_live_turn() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={env['HERMES_DASHBOARD_SESSION_TOKEN']}"
                        model.push(Text("A deliberately long stream that must be interrupted before it finishes", chunk_chars=1, delay_per_chunk=0.15))
                        async with connect(url, open_timeout=5, proxy=None) as ws:
                            await ws.send(json.dumps({"jsonrpc":"2.0","id":30,"method":"session.create","params":{
                                "source":"desktop","cwd":str(root),"cwd_explicit":True,"idempotency_key":secrets.token_hex(16)}}))
                            while True:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
                                if frame.get("id") == 30:
                                    created = frame["result"]
                                    break
                            sid = created["session_id"]
                            await ws.send(json.dumps({"jsonrpc":"2.0","id":31,"method":"prompt.submit","params":{
                                "session_id":sid,"text":"Interrupt this stream"}}))
                            while True:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
                                if frame.get("params", {}).get("type") == "message.delta":
                                    break
                            await ws.send(json.dumps({"jsonrpc":"2.0","id":32,"method":"session.interrupt","params":{
                                "session_id":sid}}))
                            interrupted = None
                            completed = None
                            deadline = time.monotonic() + 20
                            while (interrupted is None or completed is None) and time.monotonic() < deadline:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                                if frame.get("id") == 32:
                                    interrupted = frame.get("result")
                                if frame.get("params", {}).get("type") == "message.complete":
                                    completed = frame["params"].get("payload", {})
                            if interrupted is None or interrupted.get("status") != "interrupted" or completed is None:
                                raise RuntimeError(f"running turn failed to interrupt: rpc={interrupted}, complete={completed}")
                    asyncio.run(interrupt_live_turn())
                    model.push(ToolCall("read_file", {"path": str(fixture)}), Text("Tool read complete"))
                    tool_session, _, tools, _ = asyncio.run(chat("Read notes.txt", "Tool read complete"))
                    if tools < 1 or len(model.main_requests()) < 3:
                        raise RuntimeError("tool call did not execute through the original Hermes backend")
                    model.push(ToolCall("clarify", {"questions":[{"question":"Which colour?", "choices":["red", "blue"]}]}), Text("Clarify complete"))
                    clarify_session, _, _, requests = asyncio.run(chat("Choose a colour", "Clarify complete", request_method="clarify"))
                    if requests != 1:
                        raise RuntimeError("clarify server request did not round-trip")
                    victim = root / "approval-deny-canary"
                    victim.mkdir()
                    model.push(ToolCall("terminal", {"command": f"rm -rf {victim}"}), Text("Approval denied"))
                    approval_session, _, _, approval_requests = asyncio.run(chat("Ask to remove canary", "Approval denied", request_method="approval"))
                    if approval_requests != 1 or not victim.is_dir():
                        raise RuntimeError("approval denial did not prevent the terminal command")
                    if child.poll() is not None:
                        raise RuntimeError("backend exited during WebSocket ping")
                    print(f"owned serve, auth rejection, command catalog, /help, skill dispatch, streamed chat, file/image attachment, live reconnect, running interrupt, history resume, file tool, clarify and approval denial passed: sessions={session_id},{tool_session},{clarify_session},{approval_session}, deltas={deltas}, tool_events={tools}, server_requests={requests + approval_requests}")
                finally:
                    if child.poll() is None:
                        child.terminate()
                    try:
                        child.wait(timeout=8)
                    except subprocess.TimeoutExpired:
                        child.kill()
                        child.wait(timeout=8)
                    time.sleep(1)
        finally:
            model.stop()
            if previous_home is None:
                os.environ.pop("HERMES_HOME", None)
            else:
                os.environ["HERMES_HOME"] = previous_home


if __name__ == "__main__":
    main()
