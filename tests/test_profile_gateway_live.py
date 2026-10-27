"""Exercise two Profile owners through one product-isolated Hermes Gateway."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen

import pytest
from websockets.asyncio.client import connect


PRODUCT = Path(__file__).resolve().parents[1]
HERMES = Path(sys.executable).with_name("hermes.exe" if os.name == "nt" else "hermes")


async def _rpc(ws, number: int, method: str, params: dict) -> dict:
    await ws.send(json.dumps({"jsonrpc": "2.0", "id": number, "method": method, "params": params}))
    while True:
        frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=20))
        if frame.get("id") == number:
            return frame


def _config(home: Path, model: str) -> None:
    home.mkdir(parents=True, exist_ok=True)
    (home / "config.yaml").write_text(
        "gateway:\n  multiplex_profiles: true\n"
        f"model:\n  provider: custom\n  default: {model}\n"
        "  base_url: http://127.0.0.1:1/v1\n"
        "auxiliary:\n  title_generation:\n    enabled: false\n",
        encoding="utf-8",
    )


@pytest.mark.skipif(not HERMES.is_file(), reason="requires the prepared product Hermes launcher")
def test_one_gateway_routes_sessions_and_file_attachments_to_two_profiles():
    assert HERMES.is_relative_to(PRODUCT / ".build"), "only run the product-owned test launcher"
    with tempfile.TemporaryDirectory(prefix="profile-gateway-", dir=PRODUCT / ".build",
                                     ignore_cleanup_errors=True) as temporary:
        root = Path(temporary)
        home = root / "hermes-home"
        beta = home / "profiles" / "beta"
        _config(home, "default-canary")
        _config(beta, "beta-canary")
        attachment = root / "note.txt"
        attachment.write_text("Profile attachment canary\n", encoding="utf-8")
        workspace = root / "workspace"
        workspace.mkdir()
        ready = root / "ready.json"
        token = secrets.token_urlsafe(32)
        env = os.environ.copy()
        env.update({
            "HERMES_HOME": str(home),
            "HERMES_GATEWAY_LOCK_DIR": str(root / "gateway-locks"),
            "HERMES_DESKTOP_READY_FILE": str(ready),
            "HERMES_DESKTOP": "1",
            "HERMESS_DESKTOP_PRIVATE_API": "1",
            "HERMES_DASHBOARD_SESSION_TOKEN": token,
            "HERMES_PARENT_PID": str(os.getpid()),
            "HERMES_DISABLE_LAZY_INSTALLS": "1",
            "NO_PROXY": "127.0.0.1,localhost",
        })
        for key in ("HERMES_RUNTIME_DIR", "HERMES_INSTALL_ROOT", "PYTHONPATH"):
            env.pop(key, None)
        with (root / "stdout.log").open("wb") as stdout, (root / "stderr.log").open("wb") as stderr:
            child = subprocess.Popen(
                [str(HERMES), "serve", "--host", "127.0.0.1", "--port", "0", "--isolated"],
                cwd=PRODUCT, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            try:
                deadline = time.monotonic() + 60
                while not ready.is_file() and child.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.2)
                assert ready.is_file() and child.poll() is None, "isolated Gateway did not start"
                port = json.loads(ready.read_text(encoding="utf-8"))["port"]

                async def check() -> None:
                    url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                    async with connect(url, open_timeout=5, proxy=None) as ws, \
                            connect(url, open_timeout=5, proxy=None) as beta_ws:
                        roster = await _rpc(ws, 1, "profiles.list", {"include_sessions": False})
                        assert {row["name"] for row in roster["result"]["profiles"]} >= {"default", "beta"}
                        owners = (("default", ws, {}), ("beta", beta_ws, {"profile": "beta"}))
                        created_both = await asyncio.gather(*(
                            _rpc(owner_ws, number, "session.create", {
                                "source": "desktop", "cwd": str(workspace), "cwd_explicit": True,
                                "idempotency_key": secrets.token_hex(16), **scope,
                            })
                            for number, (_, owner_ws, scope) in enumerate(owners, 2)
                        ))
                        ids = {}
                        for number, ((name, owner_ws, scope), created) in enumerate(zip(owners, created_both), 2):
                            assert "error" not in created, created
                            ids[name] = created["result"]["session_id"]
                            attached = await _rpc(owner_ws, number + 10, "file.attach", {
                                "session_id": ids[name], "path": str(attachment), "name": attachment.name, **scope,
                            })
                            assert "error" not in attached, attached
                            assert attached["result"]["ref_text"].startswith("@file:")
                            owner_home = home if name == "default" else beta
                            assert Path(attached["result"]["path"]).is_relative_to(
                                owner_home / "attachments"
                            ), attached
                        assert ids["default"] != ids["beta"]
                        wrong_resume = await _rpc(ws, 19, "session.resume", {
                            "session_id": ids["default"], "profile": "beta", "source": "desktop",
                        })
                        assert "error" in wrong_resume, wrong_resume
                        wrong_owner = await _rpc(ws, 20, "file.attach", {
                            "session_id": ids["default"], "path": str(attachment),
                            "name": attachment.name, "profile": "beta",
                        })
                        # The Gateway resolves attachment ownership from the session ID.
                        # It currently accepts a mismatched profile field; verify that the
                        # attachment still lands in the session owner's home.
                        assert "error" not in wrong_owner, wrong_owner
                        assert Path(wrong_owner["result"]["path"]).is_relative_to(
                            home / "attachments"
                        ), wrong_owner
                        beta_job = await _rpc(ws, 21, "cron.manage", {
                            "action": "add", "name": "beta-task", "schedule": "0 9 * * *",
                            "prompt": "Profile isolation test", "deliver": "local", "profile": "beta",
                        })
                        assert beta_job.get("result", {}).get("success") is True, beta_job
                        job_id = beta_job["result"]["job_id"]
                        for number, profile, expected in ((22, "default", 0), (23, "beta", 1)):
                            scope = {} if profile == "default" else {"profile": profile}
                            listed = await _rpc(ws, number, "cron.manage", {
                                "action": "list", "include_disabled": True, **scope,
                            })
                            assert listed.get("result", {}).get("count") == expected, listed
                        paused = await _rpc(ws, 24, "cron.manage", {
                            "action": "pause", "name": job_id, "profile": "beta",
                        })
                        assert paused.get("result", {}).get("success") is True, paused
                        resumed = await _rpc(ws, 25, "cron.manage", {
                            "action": "resume", "name": job_id, "profile": "beta",
                        })
                        assert resumed.get("result", {}).get("success") is True, resumed
                        return job_id

                job_id = asyncio.run(check())
                for profile, expected in (("default", []), ("beta", [job_id])):
                    request = Request(
                        f"http://127.0.0.1:{port}/api/cron/jobs?profile={profile}",
                        headers={"X-Hermes-Session-Token": token},
                    )
                    with urlopen(request, timeout=20) as response:
                        jobs = json.load(response)
                    assert [job["id"] for job in jobs] == expected
                    assert all(job["profile"] == profile for job in jobs)
                detail = Request(
                    f"http://127.0.0.1:{port}/api/cron/jobs/{job_id}?profile=beta",
                    headers={"X-Hermes-Session-Token": token},
                )
                with urlopen(detail, timeout=20) as response:
                    assert json.load(response)["profile"] == "beta"
                update = Request(
                    f"http://127.0.0.1:{port}/api/cron/jobs/{job_id}?profile=beta",
                    data=json.dumps({"updates": {"name": "renamed-beta-task", "schedule": "0 10 * * *",
                                                   "prompt": "Updated Profile isolation test"}}).encode("utf-8"),
                    headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                    method="PUT",
                )
                with urlopen(update, timeout=20) as response:
                    updated = json.load(response)
                assert updated["id"] == job_id and updated["profile"] == "beta"
                assert updated["name"] == "renamed-beta-task"
                with urlopen(detail, timeout=20) as response:
                    assert json.load(response)["prompt"] == "Updated Profile isolation test"
                for owner in (home, beta):
                    assert any(path.read_text(encoding="utf-8") == "Profile attachment canary\n"
                               for path in (owner / "attachments").iterdir())
            finally:
                if child.poll() is None:
                    child.terminate()
                try:
                    child.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=8)
