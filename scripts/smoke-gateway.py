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
    if not python.is_relative_to(product / ".build"):
        parser.error("I0 smoke only accepts a prepared environment under the product .build directory")
    subprocess.run(["node", str(product / "scripts" / "verify-upstream.mjs")], check=True)

    from websockets.asyncio.client import connect
    from websockets.exceptions import ConnectionClosed, InvalidStatus

    scratch = product / ".build"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="gateway-smoke-", dir=scratch, ignore_cleanup_errors=True) as temp:
        root = Path(temp)
        home = root / "hermes-home"
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
                    if child.poll() is not None:
                        raise RuntimeError("backend exited during WebSocket ping")
                    print(f"owned serve, authenticated ping and wrong-token rejection passed on port {port}")
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
            if previous_home is None:
                os.environ.pop("HERMES_HOME", None)
            else:
                os.environ["HERMES_HOME"] = previous_home


if __name__ == "__main__":
    main()
