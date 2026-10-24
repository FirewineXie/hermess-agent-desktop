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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=Path, required=True, help="prepared Hermes venv Python")
    args = parser.parse_args()
    python = args.python.resolve(strict=True)
    hermes = python.with_name("hermes.exe" if os.name == "nt" else "hermes")
    if not hermes.is_file():
        parser.error(f"Hermes launcher is missing beside the selected Python: {hermes}")
    product = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(product / "vendor" / "hermes-agent"))
    if not python.is_relative_to(product / ".build"):
        parser.error("I0 smoke only accepts a prepared environment under the product .build directory")
    subprocess.run(["node", str(product / "scripts" / "verify-upstream.mjs")], check=True)

    from websockets.asyncio.client import connect
    from websockets.exceptions import ConnectionClosed, InvalidStatus
    from tests.fakes.fake_llm_provider import FakeLLMServer, Text, ToolCall, write_hermes_home

    scratch = product / ".build"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="gateway-smoke-", dir=scratch, ignore_cleanup_errors=True) as temp:
        root = Path(temp)
        home = root / "hermes-home"
        fixture = root / "notes.txt"
        fixture.write_text("Hermess file tool canary\n", encoding="utf-8")
        model = FakeLLMServer([Text("Hermess I0 local model reply", chunk_chars=4)])
        model.start()
        write_hermes_home(home, model.base_url)
        ready = root / "ready.json"
        env = os.environ.copy()
        env.update({
            "HERMES_HOME": str(home),
            "HERMES_GATEWAY_LOCK_DIR": str(root / "gateway-locks"),
            "HERMES_DESKTOP_READY_FILE": str(ready),
            "HERMES_DESKTOP": "1",
            "HERMES_DASHBOARD_SESSION_TOKEN": secrets.token_urlsafe(32),
            "HERMES_PARENT_PID": str(os.getpid()),
        })
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

                    async def reject_wrong_token() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token=invalid-i0-probe"
                        try:
                            async with connect(url, open_timeout=5, proxy=None) as ws:
                                await asyncio.wait_for(ws.recv(), timeout=5)
                        except (ConnectionClosed, InvalidStatus):
                            return
                        raise RuntimeError("backend accepted a wrong WebSocket credential")

                    asyncio.run(reject_wrong_token())

                    async def chat(prompt: str, expected: str, request_method: str = "") -> tuple[str, int, int, int]:
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
                                if params.get("type") == "tool.complete":
                                    tool_completions += 1
                                if params.get("type") == "message.complete":
                                    result = params.get("payload", {})
                                    if not admitted or result.get("text") != expected:
                                        raise RuntimeError(f"unexpected completed turn: {result}")
                                    return session_id, deltas, tool_completions, requests
                            raise RuntimeError("message.complete was not received")

                    session_id, deltas, _, _ = asyncio.run(chat("Say hello", "Hermess I0 local model reply"))
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
                            interrupted = await rpc(12, "session.interrupt", {"session_id":resumed["session_id"]})
                            if interrupted.get("status") not in {"interrupted", "not_interrupted"}:
                                raise RuntimeError(f"session.interrupt returned unexpected status: {interrupted}")
                    asyncio.run(verify_history())
                    async def reconnect_live_turn() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={env['HERMES_DASHBOARD_SESSION_TOKEN']}"
                        model.push(Text("Reconnect stream canary reached completion", chunk_chars=2, delay_per_chunk=0.12))
                        async with connect(url, open_timeout=5, proxy=None) as first:
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
                                "session_id":created["session_id"],"last_seen":first_seq}}))
                            while True:
                                frame = json.loads(await asyncio.wait_for(second.recv(), timeout=20))
                                saw_complete |= frame.get("params", {}).get("type") == "message.complete"
                                if frame.get("id") == 24:
                                    replay = frame["result"]
                                    break
                            if replay.get("truncated") or replay.get("latest_seq", 0) < first_seq:
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
                    print(f"owned serve, auth rejection, streamed chat, live reconnect, running interrupt, history resume, file tool, clarify and approval denial passed: sessions={session_id},{tool_session},{clarify_session},{approval_session}, deltas={deltas}, tool_events={tools}, server_requests={requests + approval_requests}")
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
