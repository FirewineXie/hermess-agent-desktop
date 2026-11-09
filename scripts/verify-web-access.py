"""Probe the locked Gateway's Webapp and private desktop boundary."""

import argparse
import asyncio
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlsplit

import httpx
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus


PRODUCT = Path(__file__).resolve().parents[1]
UPSTREAM = PRODUCT / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))
from tests.gateway.fixtures.local_recovery_probe import child_env, seed_offline_models_dev
from tests.gateway.test_normal_runtime_boot import control


@contextmanager
def boot(home, env, launcher):
    seed_offline_models_dev(home)
    with (home / "gateway-probe.log").open("w+", encoding="utf-8") as log:
        process = subprocess.Popen(
            [str(launcher), "gateway", "run", "--external-supervisor"], cwd=UPSTREAM,
            env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 90
            while process.poll() is None and time.monotonic() < deadline:
                try:
                    identity = control(home, "identify")
                    if identity.get("state") == "ready":
                        break
                except (OSError, ValueError):
                    pass
                time.sleep(.15)
            else:
                log.seek(0)
                raise AssertionError(log.read())
            yield identity
        finally:
            if process.poll() is None:
                subprocess.run([str(launcher), "gateway", "stop"], env=env, cwd=UPSTREAM,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
                try:
                    process.wait(timeout=12)
                except subprocess.TimeoutExpired:
                    process.kill()
            process.wait(timeout=10)


def checked(response):
    assert response.status_code == 200, (response.request.method, response.request.url.path, response.status_code)
    return response


def native_headers(home, descriptor):
    grant = control(home, "session-ticket", {
        "profile_id": str(home.resolve()), "instance_id": descriptor["instance_id"],
        "purpose": "native-http", "scope": "profile",
    })
    return {"X-Hermes-Gateway-Ticket": grant["ticket"]}


async def browser_socket(origin, ticket, browser_origin):
    try:
        async with connect(origin.replace("http:", "ws:") + "/api/ws",
                           origin=browser_origin,
                           subprotocols=["hermes-gateway-v1", "hermes-gateway-ticket." + ticket]):
            return 101
    except InvalidStatus as error:
        return error.response.status_code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes", type=Path, required=True)
    parser.add_argument("--webapp-dist", type=Path, help="explicit renderer for the source build probe")
    parser.add_argument("--expect-private-conflict", action="store_true",
                        help="demonstrate the current fork's same-origin WebSocket rejection")
    args = parser.parse_args()
    launcher = args.hermes.resolve(strict=True)
    lock = json.loads((PRODUCT / "runtime/upstream.lock.json").read_text(encoding="utf-8"))
    head = subprocess.check_output(["git", "-C", str(UPSTREAM), "rev-parse", "HEAD"], text=True).strip()
    assert head == lock["commit"]
    with tempfile.TemporaryDirectory(prefix="web-access-probe-", dir=PRODUCT / ".build") as directory:
        root = Path(directory)
        home, user = root / "hermes-home", root / "user"
        home.mkdir(mode=0o700)
        user.mkdir()
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        (home / "config.yaml").write_text(json.dumps({
            "gateway": {"multiplex_profiles": True},
            "webapp": {"host": "127.0.0.1", "port": port},
        }), encoding="utf-8")
        token = secrets.token_hex(32)
        headers = {"X-Hermes-Session-Token": token}
        env = child_env()
        env.update(HOME=str(user), USERPROFILE=str(user), HERMES_HOME=str(home), HERMES_PARENT_PID=str(os.getpid()),
                   HERMES_DASHBOARD_SESSION_TOKEN=token, HERMES_DESKTOP="1", HERMESS_DESKTOP_PRIVATE_API="1",
                   HERMES_DISABLE_LAZY_INSTALLS="1", HERMES_GATEWAY_LOCK_DIR=str(root / "locks"))
        if args.webapp_dist:
            env["HERMES_WEBAPP_DIST"] = str(args.webapp_dist.resolve(strict=True))
        with httpx.Client(trust_env=False, timeout=20) as client:
            with boot(home, env, launcher) as descriptor:
                assert control(home, "webapp-status")["state"] == "off"
                url = descriptor["api_origin"] + "/api/config"
                enable = {"config": {"webapp": {"enabled": True}}}
                assert client.put(url, json=enable).status_code in {401, 403}
                checked(client.put(url, json=enable, headers=headers))
                assert control(home, "webapp-status")["state"] == "off"
            with boot(home, env, launcher) as descriptor:
                status = control(home, "webapp-status")
                origin = f"http://127.0.0.1:{port}"
                assert status["state"] == "serving" and status["url"] == origin, status
                assert descriptor["api_origin"] == origin
                html = checked(client.get(origin + "/"))
                asset = re.search(r'<script[^>]+src="([^"]+\.js)"', html.text)
                assert asset and "X-Hermes-Window-Ticket" not in html.text
                checked(client.get(origin + "/" + asset[1].lstrip("/")))
                launch = control(home, "webapp-launch")
                link = urlsplit(launch["url"])
                assert link.netloc == f"127.0.0.1:{port}" and link.path == "/webapp/launch"
                assert launch["expires_in_seconds"] == 60
                launch_page = checked(client.get(origin + link.path))
                assert "X-Hermes-Window-Ticket" in launch_page.text
                ticket = link.fragment.removeprefix("ticket=")
                handoff = origin + "/webapp/window-session"
                header = {"X-Hermes-Window-Ticket": ticket}
                assert client.post(handoff, headers=header).status_code == 403
                browser = checked(client.post(handoff, headers={**header, "Origin": origin})).json()["token"]
                assert browser != token and len(browser) == 43 and browser not in html.text
                assert client.post(handoff, headers={**header, "Origin": origin}).status_code == 403
                url = origin + "/api/config"
                assert client.get(url, headers=headers).status_code == 401
                checked(client.get(url, headers=native_headers(home, descriptor)))
                browser_headers = {"X-Hermes-Session-Token": browser, "Origin": origin}
                assert checked(client.get(url, headers=browser_headers)).json()["webapp"]["enabled"] is True
                mint = origin + "/api/webapp/socket-ticket?socket=gateway"
                for browser_origin, expected in [
                    ("http://127.0.0.1:1", 403),
                    (origin, 403 if args.expect_private_conflict else 101),
                ]:
                    ws_ticket = checked(client.post(mint, headers=browser_headers)).json()["ticket"]
                    assert asyncio.run(browser_socket(origin, ws_ticket, browser_origin)) == expected
                disable = {"config": {"webapp": {"enabled": False}}}
                checked(client.put(url, json=disable, headers=native_headers(home, descriptor)))
            with boot(home, env, launcher) as descriptor:
                assert control(home, "webapp-status")["state"] == "off"
                assert client.get(descriptor["api_origin"] + "/webapp/launch").status_code in {403, 404}
        print("Verified Webapp start/stop, bundled assets, native HTTP tickets and one-use browser handoff.")
        if args.expect_private_conflict:
            print("Confirmed locked fork rejects the same-origin browser WebSocket with a valid Webapp ticket.")


if __name__ == "__main__":
    main()
