"""Run source CLI and product payload side by side with separate data roots."""

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
    parser.add_argument("--python", required=True, type=Path)
    parser.add_argument("--payload", required=True, type=Path)
    args = parser.parse_args()
    product = Path(__file__).resolve().parents[1]
    build = product / ".build"
    python = args.python.resolve(strict=True)
    payload = args.payload.resolve(strict=True)
    if not python.is_relative_to(build) or not payload.is_relative_to(build):
        parser.error("test inputs must remain under the product .build directory")
    source_cli = python.with_name("hermes.exe")
    product_cli = payload / "bin" / "hermes.exe"
    if not source_cli.is_file() or not product_cli.is_file():
        parser.error("source or payload launcher is missing")
    sys.path.insert(0, str(product / "upstream" / "hermes-agent"))
    from tests.fakes.fake_llm_provider import FakeLLMServer, Text, write_hermes_home
    from websockets.asyncio.client import connect
    from websockets.exceptions import ConnectionClosed, InvalidStatus

    with tempfile.TemporaryDirectory(prefix="coexistence-", dir=build,
                                     ignore_cleanup_errors=True) as temporary:
        root = Path(temporary)
        model = FakeLLMServer([Text("source CLI reply"), Text("product payload reply")])
        model.start()
        children: list[subprocess.Popen] = []
        logs = []
        try:
            def launch(label: str, executable: Path) -> tuple[subprocess.Popen, int, str, Path]:
                work = root / label
                work.mkdir()
                home = work / "hermes-home"
                write_hermes_home(home, model.base_url)
                token = secrets.token_urlsafe(32)
                ready = work / "ready.json"
                env = os.environ.copy()
                env.update({
                    "HERMES_HOME": str(home),
                    "HERMES_GATEWAY_LOCK_DIR": str(work / "locks"),
                    "HERMES_DESKTOP_READY_FILE": str(ready),
                    "HERMES_DASHBOARD_SESSION_TOKEN": token,
                    "HERMES_PARENT_PID": str(os.getpid()),
                    "HERMES_DISABLE_LAZY_INSTALLS": "1",
                    "HTTP_PROXY": "http://127.0.0.1:9",
                    "HTTPS_PROXY": "http://127.0.0.1:9",
                    "ALL_PROXY": "http://127.0.0.1:9",
                    "NO_PROXY": "127.0.0.1,localhost",
                })
                if label == "product":
                    env["HERMES_DESKTOP"] = "1"
                else:
                    env.pop("HERMES_DESKTOP", None)
                for key in ("HERMES_RUNTIME_DIR", "HERMES_INSTALL_ROOT", "PYTHONPATH"):
                    env.pop(key, None)
                stdout = (work / "stdout.log").open("wb")
                stderr = (work / "stderr.log").open("wb")
                logs.extend((stdout, stderr))
                child = subprocess.Popen(
                    [str(executable), "serve", "--host", "127.0.0.1", "--port", "0", "--isolated"],
                    cwd=work, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
                children.append(child)
                deadline = time.monotonic() + 60
                while not ready.is_file() and child.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.2)
                if not ready.is_file() or child.poll() is not None:
                    raise RuntimeError(f"{label} did not become ready: exit={child.poll()}")
                port = json.loads(ready.read_text(encoding="utf-8"))["port"]
                return child, port, token, work

            official, official_port, official_token, official_work = launch("source-cli", source_cli)
            owned, product_port, product_token, product_work = launch("product", product_cli)
            if official.pid == owned.pid or official_port == product_port:
                raise RuntimeError("instances shared a process or listener")

            async def call(port: int, token: str, method: str, params: dict) -> dict:
                url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                async with connect(url, open_timeout=5, proxy=None) as ws:
                    await ws.send(json.dumps({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
                    while True:
                        frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
                        if frame.get("id") == 1:
                            if frame.get("error"):
                                raise RuntimeError(f"{method} failed: {frame['error']}")
                            return frame["result"]

            async def reject_cross_token(port: int, token: str) -> None:
                try:
                    await call(port, token, "ping", {})
                except (ConnectionClosed, InvalidStatus):
                    return
                raise RuntimeError("an instance accepted the other instance's credential")

            async def create_persisted(port: int, token: str, label: str, cwd: Path) -> str:
                url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                async with connect(url, open_timeout=5, proxy=None) as ws:
                    async def rpc(number: int, method: str, params: dict) -> dict:
                        await ws.send(json.dumps({"jsonrpc":"2.0","id":number,"method":method,"params":params}))
                        while True:
                            frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                            if frame.get("id") == number:
                                if frame.get("error"):
                                    raise RuntimeError(f"{label} {method} failed: {frame['error']}")
                                return frame["result"]
                    created = await rpc(2, "session.create", {
                        "source":"desktop", "cwd":str(cwd), "cwd_explicit":True,
                        "idempotency_key":secrets.token_hex(16)})
                    await ws.send(json.dumps({"jsonrpc":"2.0","id":3,"method":"prompt.submit","params":{
                        "session_id":created["session_id"],"text":f"{label} private prompt"}}))
                    admitted = False
                    completed = False
                    while not (admitted and completed):
                        frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                        if frame.get("id") == 3:
                            if frame.get("error"):
                                raise RuntimeError(f"{label} prompt.submit failed: {frame['error']}")
                            admitted = True
                        completed |= frame.get("params", {}).get("type") == "message.complete"
                    return created["stored_session_id"]

            async def verify() -> None:
                if await call(official_port, official_token, "ping", {}) != {"pong": True}:
                    raise RuntimeError("source CLI ping failed")
                if await call(product_port, product_token, "ping", {}) != {"pong": True}:
                    raise RuntimeError("product ping failed")
                await reject_cross_token(official_port, product_token)
                await reject_cross_token(product_port, official_token)
                source_id = await create_persisted(official_port, official_token, "source", official_work)
                product_id = await create_persisted(product_port, product_token, "product", product_work)
                source_rows = (await call(official_port, official_token, "session.list", {"limit":50}))["sessions"]
                product_rows = (await call(product_port, product_token, "session.list", {"limit":50}))["sessions"]
                if source_id == product_id or source_id not in {row["id"] for row in source_rows} or product_id not in {row["id"] for row in product_rows}:
                    raise RuntimeError("own session was missing or session IDs collided")
                if product_id in {row["id"] for row in source_rows} or source_id in {row["id"] for row in product_rows}:
                    raise RuntimeError("sessions leaked across independent data roots")
                owned.terminate()
                owned.wait(timeout=8)
                if official.poll() is not None or await call(official_port, official_token, "ping", {}) != {"pong": True}:
                    raise RuntimeError("stopping product affected source CLI")
            asyncio.run(verify())
            print(f"parallel source CLI and product passed: pids={official.pid},{owned.pid}; ports={official_port},{product_port}")
        finally:
            for child in children:
                if child.poll() is None:
                    child.terminate()
                try:
                    child.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=8)
            for log in logs:
                log.close()
            model.stop()


if __name__ == "__main__":
    main()
