"""Exercise two Profile owners through one product-isolated Hermes Gateway."""

from __future__ import annotations

import asyncio
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import threading
import time
from urllib.request import Request, urlopen
from urllib.error import HTTPError

import pytest
import hermes_yaml as yaml
from websockets.asyncio.client import connect


PRODUCT = Path(__file__).resolve().parents[1]
HERMES = Path(sys.executable).with_name("hermes.exe" if os.name == "nt" else "hermes")


@contextmanager
def _model_endpoint(reply: str | None, write_file: tuple[Path, str] | None = None,
                    terminal_command: str | None = None):
    requests: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(body)
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            if reply is None:
                payload = {"error": {"message": "model unavailable", "type": "invalid_request_error",
                                     "code": "unsupported_model"}}
                status, mime = 400, "application/json"
                data = json.dumps(payload).encode("utf-8")
            else:
                tool_results = [message for message in body.get("messages", [])
                                if message.get("role") == "tool"]
                if terminal_command and not tool_results:
                    tool_name = "terminal"
                elif write_file and not tool_results:
                    tool_name = "read_file"
                elif write_file and tool_results and "stale_write_blocked" in str(tool_results[-1].get("content")):
                    tool_name = "patch"
                elif write_file and tool_results and tool_results[-1].get("tool_call_id") == "checkpoint-read_file":
                    tool_name = "write_file"
                else:
                    tool_name = None
                tool_call = tool_name is not None
                tool_arguments = ({"command": terminal_command} if tool_name == "terminal" else {
                    "path": str(write_file[0]),
                    **({"content": write_file[1]} if tool_name == "write_file" else {}),
                    **({"old_string": "ORIGINAL\n", "new_string": write_file[1]}
                       if tool_name == "patch" else {}),
                }) if tool_call else None
                message = ({"role": "assistant", "content": None,
                            "tool_calls": [{"index": 0, "id": f"checkpoint-{tool_name}", "type": "function",
                                            "function": {"name": tool_name, "arguments": json.dumps(tool_arguments)}}]}
                           if tool_call else {"role": "assistant", "content": reply})
                if body.get("stream"):
                    choice = {"index": 0, "delta": message,
                              "finish_reason": "tool_calls" if tool_call else "stop"}
                    payload = {"id": "chatcmpl-profile-canary", "created": 1,
                               "model": body["model"], "object": "chat.completion.chunk",
                               "choices": [choice]}
                    status, mime = 200, "text/event-stream"
                    data = f"data: {json.dumps(payload)}\n\ndata: [DONE]\n\n".encode("utf-8")
                else:
                    payload = {"id": "chatcmpl-profile-canary", "created": 1,
                               "model": body["model"], "object": "chat.completion",
                               "choices": [{"index": 0, "message": message,
                                            "finish_reason": "tool_calls" if tool_call else "stop"}]}
                    status, mime = 200, "application/json"
                    data = json.dumps(payload).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", requests
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


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
            "OPENAI_API_KEY": "sk-fake",
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
                        metrics_before = await _rpc(ws, 41, "shared_metrics.status", {"profile": "beta"})
                        assert metrics_before.get("result") == {
                            "enabled": False, "send": False, "decided": False, "reask": False,
                        }, metrics_before
                        collecting = await _rpc(ws, 42, "shared_metrics.set", {
                            "profile": "beta", "enabled": True, "send": False, "first_run": False,
                        })
                        assert collecting.get("result") == {
                            "enabled": True, "send": False, "decided": True, "reask": False,
                        }, collecting
                        assert (await _rpc(ws, 43, "shared_metrics.status", {"profile": "default"}))[
                            "result"
                        ]["decided"] is False
                        withdrawing = await _rpc(ws, 44, "shared_metrics.set", {
                            "profile": "beta", "enabled": False, "send": True, "first_run": False,
                        })
                        assert withdrawing.get("result") == {
                            "enabled": False, "send": False, "decided": True, "reask": False,
                        }, withdrawing
                        assert (await _rpc(ws, 45, "shared_metrics.status", {"profile": "beta"}))[
                            "result"
                        ] == withdrawing["result"]
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
                assert "shared_metrics" not in (home / "config.yaml").read_text(encoding="utf-8")
                beta_config = (beta / "config.yaml").read_text(encoding="utf-8")
                assert "offer_version: 2" in beta_config
                assert "enabled: false" in beta_config and "send: false" in beta_config
                checkpoint_home = beta / "checkpoints" / "beta-canary"
                checkpoint_home.mkdir(parents=True)
                (checkpoint_home / "snapshot.txt").write_bytes(b"beta-checkpoint")
                for profile, expected_sessions in (("default", []), ("beta", ["beta-canary"])):
                    request = Request(
                        f"http://127.0.0.1:{port}/api/ops/checkpoints?profile={profile}",
                        headers={"X-Hermes-Session-Token": token},
                    )
                    with urlopen(request, timeout=20) as response:
                        inventory = json.load(response)
                    assert [row["session"] for row in inventory["sessions"]] == expected_sessions
                    assert inventory["total_bytes"] == (len(b"beta-checkpoint") if profile == "beta" else 0)
                checkpoint_setting = Request(
                    f"http://127.0.0.1:{port}/api/config?profile=beta",
                    data=json.dumps({"config": {"checkpoints": {"max_snapshots": 17}}}).encode("utf-8"),
                    headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                    method="PUT",
                )
                with urlopen(checkpoint_setting, timeout=20) as response:
                    assert json.load(response)["ok"] is True
                for profile, expected in (("default", None), ("beta", 17)):
                    request = Request(
                        f"http://127.0.0.1:{port}/api/config?profile={profile}&include_defaults=false",
                        headers={"X-Hermes-Session-Token": token},
                    )
                    with urlopen(request, timeout=20) as response:
                        config = json.load(response)
                    assert config.get("checkpoints", {}).get("max_snapshots") == expected
                with _model_endpoint("PROVIDER-ANSWER") as (provider_url, provider_requests):
                    endpoint_id = "desktop-profile-canary"
                    endpoint_path = f"http://127.0.0.1:{port}/api/providers/custom-endpoints"
                    headers = {"X-Hermes-Session-Token": token, "Content-Type": "application/json"}
                    for name, model in (("Profile provider", "provider-first"),
                                        ("Profile provider renamed", "provider-second")):
                        save = Request(
                            f"{endpoint_path}?profile=beta",
                            data=json.dumps({"id": endpoint_id, "name": name, "base_url": provider_url,
                                             "model": model, "api_key": "sk-fake", "make_default": True,
                                             "discover_models": False}).encode("utf-8"),
                            headers=headers, method="POST",
                        )
                        with urlopen(save, timeout=20) as response:
                            assert json.load(response)["ok"] is True
                        listed = Request(f"{endpoint_path}?profile=beta",
                                         headers={"X-Hermes-Session-Token": token})
                        with urlopen(listed, timeout=20) as response:
                            endpoints = json.load(response)["endpoints"]
                        saved = next(item for item in endpoints if item["id"] == endpoint_id)
                        assert (saved["name"], saved["model"], saved["base_url"], saved["is_current"]) == (
                            name, model, provider_url, True)
                        read = Request(f"http://127.0.0.1:{port}/api/config/raw?profile=beta",
                                       headers={"X-Hermes-Session-Token": token})
                        with urlopen(read, timeout=20) as response:
                            current = yaml.safe_load(json.load(response)["yaml"])["model"]
                        assert (current["provider"], current["default"], current["base_url"]) == (
                            endpoint_id, model, provider_url)
                    async def check_provider_turn() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                        async with connect(url, open_timeout=5, proxy=None) as provider_ws:
                            created = await _rpc(provider_ws, 91, "session.create", {
                                "source": "desktop", "cwd": str(workspace), "cwd_explicit": True,
                                "idempotency_key": secrets.token_hex(16), "profile": "beta",
                            })
                            assert "error" not in created, created
                            session_id = created["result"]["session_id"]
                            sent = await _rpc(provider_ws, 92, "prompt.submit", {
                                "session_id": session_id, "text": "Provider settings canary", "profile": "beta",
                            })
                            assert "error" not in sent, sent
                            while True:
                                frame = json.loads(await asyncio.wait_for(provider_ws.recv(), timeout=30))
                                event = frame.get("params") if frame.get("method") == "event" else None
                                if isinstance(event, dict) and event.get("session_id") == session_id \
                                        and event.get("type") == "message.complete":
                                    assert event.get("payload", {}).get("text") == "PROVIDER-ANSWER", event
                                    return

                    asyncio.run(check_provider_turn())
                    assert any(request.get("model") == "provider-second" for request in provider_requests)
                    default_read = Request(
                        f"http://127.0.0.1:{port}/api/config/raw?profile=default",
                        headers={"X-Hermes-Session-Token": token},
                    )
                    with urlopen(default_read, timeout=20) as response:
                        assert yaml.safe_load(json.load(response)["yaml"])["model"]["default"] == "default-canary"
                    delete = Request(f"{endpoint_path}/{endpoint_id}?profile=beta",
                                     headers={"X-Hermes-Session-Token": token}, method="DELETE")
                    with urlopen(delete, timeout=20) as response:
                        assert json.load(response)["ok"] is True
                    with urlopen(listed, timeout=20) as response:
                        assert not any(item["id"] == endpoint_id for item in json.load(response)["endpoints"])
                    with urlopen(read, timeout=20) as response:
                        after_delete = yaml.safe_load(json.load(response)["yaml"])["model"]
                    assert after_delete.get("provider") != endpoint_id
                    assert after_delete.get("base_url") != provider_url
                    builtin = Request(
                        f"http://127.0.0.1:{port}/api/model/set?profile=beta",
                        data=json.dumps({"scope": "main", "provider": "openai", "model": "gpt-4.1",
                                         "base_url": provider_url, "api_key": "sk-fake",
                                         "confirm_expensive_model": True}).encode("utf-8"),
                        headers=headers, method="POST",
                    )
                    try:
                        with urlopen(builtin, timeout=20) as response:
                            assert json.load(response)["ok"] is True
                    except HTTPError as error:
                        raise AssertionError(error.read().decode("utf-8")) from error
                    with urlopen(read, timeout=20) as response:
                        builtin_model = yaml.safe_load(json.load(response)["yaml"])["model"]
                    assert (builtin_model["provider"], builtin_model["default"], builtin_model["base_url"]) == (
                        "openai", "gpt-4.1", provider_url)
                fallback_chain = [
                    {"provider": "custom", "model": "first-canary"},
                    {"provider": "openai", "model": "second-canary"},
                ]
                fallback_update = Request(
                    f"http://127.0.0.1:{port}/api/config?profile=beta",
                    data=json.dumps({"config": {"fallback_providers": fallback_chain}}).encode("utf-8"),
                    headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                    method="PUT",
                )
                with urlopen(fallback_update, timeout=20) as response:
                    assert json.load(response)["ok"] is True
                for profile, expected in (("default", None), ("beta", fallback_chain)):
                    request = Request(
                        f"http://127.0.0.1:{port}/api/config?profile={profile}&include_defaults=false",
                        headers={"X-Hermes-Session-Token": token},
                    )
                    with urlopen(request, timeout=20) as response:
                        config = json.load(response)
                    assert config.get("fallback_providers") == expected
                with _model_endpoint(None) as (primary_url, primary_requests), \
                        _model_endpoint("FROM-FALLBACK") as (fallback_url, fallback_requests):
                    live_model_config = Request(
                        f"http://127.0.0.1:{port}/api/config?profile=beta",
                        data=json.dumps({"config": {
                            "model": {"provider": "custom", "default": "primary-canary",
                                      "base_url": primary_url},
                            "fallback_providers": [{"provider": "custom", "model": "fallback-canary",
                                                    "base_url": fallback_url, "api_key": "sk-fake"}],
                            "agent": {"api_max_retries": 1, "auto_recovery_cycles": 0},
                        }}).encode("utf-8"),
                        headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                        method="PUT",
                    )
                    with urlopen(live_model_config, timeout=20) as response:
                        assert json.load(response)["ok"] is True

                    async def check_model_fallback() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                        async with connect(url, open_timeout=5, proxy=None) as ws:
                            created = await _rpc(ws, 51, "session.create", {
                                "source": "desktop", "cwd": str(workspace), "cwd_explicit": True,
                                "idempotency_key": secrets.token_hex(16), "profile": "beta",
                            })
                            assert "error" not in created, created
                            session_id = created["result"]["session_id"]
                            submitted = await _rpc(ws, 52, "prompt.submit", {
                                "session_id": session_id, "text": "Reply with the canary", "profile": "beta",
                            })
                            assert "error" not in submitted, submitted
                            deadline = time.monotonic() + 35
                            observed: list[tuple[str, str]] = []
                            while time.monotonic() < deadline:
                                try:
                                    frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic()))
                                except TimeoutError:
                                    break
                                event = frame.get("params") if frame.get("method") == "event" else None
                                if not isinstance(event, dict):
                                    continue
                                observed.append((str(event.get("type")), str(event.get("session_id"))))
                                if event.get("session_id") != session_id:
                                    continue
                                if event.get("type") == "message.complete":
                                    assert "FROM-FALLBACK" in event.get("payload", {}).get("text", ""), event
                                    return
                            raise AssertionError(f"fallback turn did not complete: frames={observed[-8:]}, "
                                                 f"primary={primary_requests}, fallback={fallback_requests}")

                    asyncio.run(check_model_fallback())
                    assert primary_requests and fallback_requests
                    assert any(request.get("model") == "fallback-canary" for request in fallback_requests), fallback_requests
                with _model_endpoint("MODEL-ANSWER") as (model_url, model_requests):
                    def set_main(model: str) -> None:
                        request = Request(
                            f"http://127.0.0.1:{port}/api/model/set?profile=beta",
                            data=json.dumps({"scope": "main", "provider": "custom", "model": model,
                                             "base_url": model_url, "api_key": "sk-fake",
                                             "confirm_expensive_model": True}).encode("utf-8"),
                            headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                            method="POST",
                        )
                        with urlopen(request, timeout=20) as response:
                            assert json.load(response).get("ok") is True

                    set_main("old-main-canary")

                    async def check_main_model_boundary() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                        async with connect(url, open_timeout=5, proxy=None) as ws:
                            async def turn(session_id: str, number: int) -> None:
                                submitted = await _rpc(ws, number, "prompt.submit", {
                                    "session_id": session_id, "text": f"Model boundary {number}",
                                    "profile": "beta",
                                })
                                assert "error" not in submitted, submitted
                                while True:
                                    frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=30))
                                    event = frame.get("params") if frame.get("method") == "event" else None
                                    if isinstance(event, dict) and event.get("session_id") == session_id \
                                            and event.get("type") == "message.complete":
                                        assert event.get("payload", {}).get("text") == "MODEL-ANSWER", event
                                        return

                            async def create(number: int, model: str) -> str:
                                response = await _rpc(ws, number, "session.create", {
                                    "source": "desktop", "cwd": str(workspace), "cwd_explicit": True,
                                    "idempotency_key": secrets.token_hex(16), "profile": "beta",
                                    "provider": "custom", "model": model,
                                })
                                assert "error" not in response, response
                                return response["result"]["session_id"]

                            old_session = await create(61, "old-main-canary")
                            await turn(old_session, 62)
                            await asyncio.to_thread(set_main, "new-main-canary")
                            await turn(old_session, 63)
                            new_session = await create(64, "new-main-canary")
                            await turn(new_session, 65)

                    asyncio.run(check_main_model_boundary())
                    actual_models = [request.get("model") for request in model_requests if request.get("model")]
                    assert actual_models == ["old-main-canary", "old-main-canary", "new-main-canary"], actual_models
                    for profile, expected_model in (("default", "default-canary"),
                                                    ("beta", "new-main-canary")):
                        request = Request(
                            f"http://127.0.0.1:{port}/api/config?profile={profile}&include_defaults=false",
                            headers={"X-Hermes-Session-Token": token},
                        )
                        with urlopen(request, timeout=20) as response:
                            saved_model = json.load(response).get("model")
                        actual_model = saved_model.get("default") if isinstance(saved_model, dict) else saved_model
                        assert actual_model == expected_model, (profile, saved_model)
                        profile_home = home if profile == "default" else beta
                        raw_model = yaml.safe_load((profile_home / "config.yaml").read_text(encoding="utf-8"))["model"]
                        assert raw_model["default"] == expected_model, (profile, raw_model)
                with _model_endpoint("AUX-ANSWER") as (aux_url, aux_requests):
                    aux_update = Request(
                        f"http://127.0.0.1:{port}/api/config?profile=beta",
                        data=json.dumps({"config": {"auxiliary": {"title_generation": {
                            "enabled": True, "provider": "custom", "model": "aux-canary",
                            "base_url": aux_url, "api_key": "sk-fake",
                        }}}}).encode("utf-8"),
                        headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                        method="PUT",
                    )
                    with urlopen(aux_update, timeout=20) as response:
                        assert json.load(response).get("ok") is True
                    for profile in ("beta", "default"):
                        listing = Request(
                            f"http://127.0.0.1:{port}/api/model/auxiliary?profile={profile}",
                            headers={"X-Hermes-Session-Token": token},
                        )
                        with urlopen(listing, timeout=20) as response:
                            auxiliary_listing = json.load(response)
                        task = next(row for row in auxiliary_listing["tasks"] if row["task"] == "title_generation")
                        assert (task["provider"], task["model"], task["local_endpoint"]) == (
                            ("custom", "aux-canary", True) if profile == "beta" else ("auto", "", False)
                        ), (profile, task)

                    async def check_auxiliary_route() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                        async with connect(url, open_timeout=5, proxy=None) as ws:
                            result = await _rpc(ws, 71, "llm.oneshot", {
                                "task": "title_generation", "instructions": "Answer briefly",
                                "input": "Auxiliary route canary", "profile": "beta",
                            })
                            assert result.get("result", {}).get("text") == "AUX-ANSWER", result

                    asyncio.run(check_auxiliary_route())
                    assert [request.get("model") for request in aux_requests] == ["aux-canary"], aux_requests
                disable_title = Request(
                    f"http://127.0.0.1:{port}/api/config?profile=beta",
                    data=json.dumps({"config": {"auxiliary": {"title_generation": {
                        "enabled": False,
                    }}}}).encode("utf-8"),
                    headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                    method="PUT",
                )
                with urlopen(disable_title, timeout=20) as response:
                    assert json.load(response).get("ok") is True
                moa_url = f"http://127.0.0.1:{port}/api/model/moa?profile=beta"
                moa_preset = {
                    "reference_models": [{"provider": "custom:moa-canary", "model": "reference-canary"}],
                    "aggregator": {"provider": "custom:moa-canary", "model": "aggregate-canary"},
                }
                moa_update = Request(
                    moa_url,
                    data=json.dumps({"default_preset": "canary", "active_preset": "canary",
                                     "presets": {"canary": moa_preset}}).encode("utf-8"),
                    headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                    method="PUT",
                )
                with urlopen(moa_update, timeout=20) as response:
                    assert json.load(response)["presets"]["canary"]["aggregator"]["model"] == "aggregate-canary"
                with urlopen(Request(moa_url, headers={"X-Hermes-Session-Token": token}), timeout=20) as response:
                    saved_moa = json.load(response)
                assert saved_moa["presets"]["canary"]["reference_models"][0]["model"] == "reference-canary"
                default_moa_url = f"http://127.0.0.1:{port}/api/model/moa?profile=default"
                with urlopen(Request(default_moa_url, headers={"X-Hermes-Session-Token": token}), timeout=20) as response:
                    assert "canary" not in json.load(response)["presets"]
                invalid_moa = Request(
                    moa_url,
                    data=json.dumps({"default_preset": "canary", "presets": {"canary": {
                        "reference_models": [{"provider": "custom", "model": ""}],
                        "aggregator": moa_preset["aggregator"],
                    }}}).encode("utf-8"),
                    headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                    method="PUT",
                )
                try:
                    urlopen(invalid_moa, timeout=20)
                except HTTPError as error:
                    assert error.code == 422
                else:
                    raise AssertionError("incomplete MoA preset was accepted")
                with urlopen(Request(moa_url, headers={"X-Hermes-Session-Token": token}), timeout=20) as response:
                    assert json.load(response) == saved_moa
                with _model_endpoint("MOA-ANSWER") as (moa_endpoint, moa_requests):
                    moa_provider = Request(
                        f"http://127.0.0.1:{port}/api/providers/custom-endpoints?profile=beta",
                        data=json.dumps({"id": "moa-canary", "name": "MoA canary",
                                         "base_url": moa_endpoint, "model": "aggregate-canary",
                                         "models": ["reference-canary", "aggregate-canary"],
                                         "api_key": "sk-fake", "api_mode": "chat_completions",
                                         "make_default": False, "discover_models": False}).encode("utf-8"),
                        headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                        method="POST",
                    )
                    with urlopen(moa_provider, timeout=20) as response:
                        assert json.load(response).get("ok") is True
                    async def check_moa_runtime() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                        async with connect(url, open_timeout=5, proxy=None) as ws:
                            created = await _rpc(ws, 72, "session.create", {
                                "source": "desktop", "cwd": str(workspace), "cwd_explicit": True,
                                "idempotency_key": secrets.token_hex(16), "profile": "beta",
                                "provider": "moa", "model": "canary",
                            })
                            assert "error" not in created, created
                            session_id = created["result"]["session_id"]
                            submitted = await _rpc(ws, 74, "prompt.submit", {
                                "session_id": session_id, "profile": "beta",
                                "text": "Answer the canary question",
                            })
                            assert "error" not in submitted, submitted
                            deadline = time.monotonic() + 30
                            events = []
                            while time.monotonic() < deadline:
                                try:
                                    frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic()))
                                except TimeoutError:
                                    break
                                event = frame.get("params") if frame.get("method") == "event" else None
                                if isinstance(event, dict):
                                    events.append((event.get("type"), event.get("session_id"), event.get("payload")))
                                if isinstance(event, dict) and event.get("session_id") == session_id \
                                        and event.get("type") == "message.complete":
                                    assert {"reference-canary", "aggregate-canary"} <= {
                                        request.get("model") for request in moa_requests
                                    }, [request.get("model") for request in moa_requests]
                                    assert "MOA-ANSWER" in event.get("payload", {}).get("text", ""), \
                                        (event, moa_requests, events[-12:])
                                    return
                            raise AssertionError(f"MoA turn did not complete: requests={moa_requests}, "
                                                 f"events={events[-12:]}")

                    asyncio.run(check_moa_runtime())
                    routed_models = [request.get("model") for request in moa_requests]
                    assert "reference-canary" in routed_models, routed_models
                    assert "aggregate-canary" in routed_models, routed_models

                with _model_endpoint("MAIN-ANSWER") as (compression_main_url, main_requests), \
                        _model_endpoint("SUMMARY-ANSWER") as (summary_url, summary_requests):
                    compression_update = Request(
                        f"http://127.0.0.1:{port}/api/config?profile=beta",
                        data=json.dumps({"config": {
                            "model": {"provider": "custom", "default": "compression-main-canary",
                                      "base_url": compression_main_url, "context_length": 65536},
                            "compression": {"enabled": True, "threshold_tokens": 200,
                                            "protect_first_n": 0, "protect_last_n": 1,
                                            "progress_notices": True},
                            "auxiliary": {"compression": {"provider": "custom",
                                                          "model": "compression-summary-canary",
                                                          "base_url": summary_url, "api_key": "sk-fake"}},
                        }}).encode("utf-8"),
                        headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                        method="PUT",
                    )
                    with urlopen(compression_update, timeout=20) as response:
                        assert json.load(response).get("ok") is True

                    async def check_auto_compression() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                        async with connect(url, open_timeout=5, proxy=None) as ws:
                            created = await _rpc(ws, 75, "session.create", {
                                "source": "desktop", "cwd": str(workspace), "cwd_explicit": True,
                                "idempotency_key": secrets.token_hex(16), "profile": "beta",
                                "provider": "custom", "model": "compression-main-canary",
                            })
                            assert "error" not in created, created
                            session_id = created["result"]["session_id"]
                            completions = []
                            for number in (76, 77, 78):
                                submitted = await _rpc(ws, number, "prompt.submit", {
                                    "session_id": session_id, "profile": "beta",
                                    "text": f"Turn {number}: " + ("canary context " * 140),
                                })
                                assert "error" not in submitted, submitted
                                deadline = time.monotonic() + 25
                                while time.monotonic() < deadline:
                                    frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic()))
                                    event = frame.get("params") if frame.get("method") == "event" else None
                                    if isinstance(event, dict) and event.get("session_id") == session_id \
                                            and event.get("type") == "message.complete":
                                        payload = event.get("payload", {})
                                        completions.append((payload.get("status"),
                                                            payload.get("text", "")[:200],
                                                            payload.get("usage", {}).get("compressions")))
                                        break
                                else:
                                    raise AssertionError(f"compression turn {number} did not complete")
                            return completions

                    compression_completions = asyncio.run(check_auto_compression())
                    assert all(row[0] == "complete" and "MAIN-ANSWER" in row[1]
                               for row in compression_completions), compression_completions
                    assert any(isinstance(row[2], int) and row[2] > 0
                               for row in compression_completions), compression_completions
                    assert any(request.get("model") == "compression-main-canary"
                               for request in main_requests), main_requests
                    assert any(request.get("model") == "compression-summary-canary"
                               for request in summary_requests), summary_requests
                checkpoint_file = workspace / "checkpoint-canary.txt"
                (workspace / "pyproject.toml").write_text("[project]\nname = \"checkpoint-canary\"\nversion = \"0.0.0\"\n", encoding="utf-8")
                checkpoint_file.write_text("ORIGINAL\n", encoding="utf-8")
                with _model_endpoint("WROTE", write_file=(checkpoint_file, "UPDATED\n")) as (checkpoint_url, checkpoint_requests):
                    checkpoint_config = Request(
                        f"http://127.0.0.1:{port}/api/config?profile=beta",
                        data=json.dumps({"config": {
                            "model": {"provider": "custom", "default": "checkpoint-canary",
                                      "base_url": checkpoint_url, "context_length": 65536},
                            "compression": {"enabled": False},
                            "checkpoints": {"enabled": True, "max_snapshots": 17},
                        }}).encode("utf-8"),
                        headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                        method="PUT",
                    )
                    with urlopen(checkpoint_config, timeout=20) as response:
                        assert json.load(response).get("ok") is True

                    async def check_checkpoint_roundtrip() -> None:
                        url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                        async with connect(url, open_timeout=5, proxy=None) as ws:
                            created = await _rpc(ws, 79, "session.create", {
                                "source": "desktop", "cwd": str(workspace), "cwd_explicit": True,
                                "idempotency_key": secrets.token_hex(16), "profile": "beta",
                                "provider": "custom", "model": "checkpoint-canary",
                            })
                            assert "error" not in created, created
                            session_id = created["result"]["session_id"]
                            submitted = await _rpc(ws, 80, "prompt.submit", {
                                "session_id": session_id, "profile": "beta", "text": "Write the checkpoint canary file",
                            })
                            assert "error" not in submitted, submitted
                            deadline = time.monotonic() + 40
                            while time.monotonic() < deadline:
                                frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic()))
                                event = frame.get("params") if frame.get("method") == "event" else None
                                if isinstance(event, dict) and event.get("session_id") == session_id \
                                        and event.get("type") == "message.complete":
                                    assert event.get("payload", {}).get("status") == "complete", event
                                    break
                            else:
                                raise AssertionError("checkpoint tool turn did not complete")
                            assert checkpoint_file.read_text(encoding="utf-8") == "UPDATED\n", "\n".join(
                                str(message.get("content")) for request in checkpoint_requests
                                for message in request.get("messages", []) if message.get("role") == "tool"
                            )[-1200:]
                            from tools import checkpoint_manager as checkpoint_module
                            previous_base = checkpoint_module.CHECKPOINT_BASE
                            checkpoint_module.CHECKPOINT_BASE = beta / "checkpoints"
                            try:
                                manager = checkpoint_module.CheckpointManager(enabled=True)
                                entries = manager.list_checkpoints(str(workspace))
                                assert entries, "file tool did not create a beta Profile checkpoint"
                                restored = manager.restore(str(workspace), entries[0]["hash"],
                                                           file_path=checkpoint_file.name)
                                assert restored.get("success") is True, restored
                                assert checkpoint_file.read_text(encoding="utf-8") == "ORIGINAL\n"
                            finally:
                                checkpoint_module.CHECKPOINT_BASE = previous_base

                    asyncio.run(check_checkpoint_roundtrip())
                protected_file = workspace / "AGENTS.md"
                for approval_choice in ("deny", "once"):
                    protected_file.write_text("ORIGINAL\n", encoding="utf-8")
                    with _model_endpoint("APPROVAL-ANSWER", write_file=(protected_file, "UPDATED\n")) as (approval_url, approval_requests):
                        approval_config = Request(
                            f"http://127.0.0.1:{port}/api/config?profile=beta",
                            data=json.dumps({"config": {
                                "model": {"provider": "custom", "default": "approval-canary",
                                          "base_url": approval_url, "context_length": 65536},
                                "approvals": {"mode": "manual"},
                            }}).encode("utf-8"),
                            headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                            method="PUT",
                        )
                        with urlopen(approval_config, timeout=20) as response:
                            assert json.load(response).get("ok") is True

                        async def check_approval_turn() -> int:
                            url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                            async with connect(url, open_timeout=5, proxy=None) as ws:
                                capabilities = await _rpc(ws, 81, "client.capabilities", {"server_requests": True})
                                assert "approval" in capabilities["result"]["server_requests"], capabilities
                                created = await _rpc(ws, 82, "session.create", {
                                    "source": "desktop", "cwd": str(workspace), "cwd_explicit": True,
                                    "idempotency_key": secrets.token_hex(16), "profile": "beta",
                                    "provider": "custom", "model": "approval-canary",
                                })
                                assert "error" not in created, created
                                session_id = created["result"]["session_id"]
                                submitted = await _rpc(ws, 83, "prompt.submit", {
                                    "session_id": session_id, "profile": "beta", "text": "Update the protected file",
                                })
                                assert "error" not in submitted, submitted
                                answered = 0
                                deadline = time.monotonic() + 40
                                while time.monotonic() < deadline:
                                    frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic()))
                                    if frame.get("method") == "approval" and frame.get("params", {}).get("session_id") == session_id:
                                        assert approval_choice in frame["params"].get("choices", []), frame
                                        await ws.send(json.dumps({"jsonrpc": "2.0", "id": frame["id"],
                                                                  "result": {"choice": approval_choice}}))
                                        answered += 1
                                    event = frame.get("params") if frame.get("method") == "event" else None
                                    if isinstance(event, dict) and event.get("session_id") == session_id \
                                            and event.get("type") == "message.complete":
                                        assert event.get("payload", {}).get("status") == "complete", frame
                                        return answered
                                raise AssertionError(f"approval turn did not complete: {approval_choice}")

                        assert asyncio.run(check_approval_turn()) > 0, (approval_choice, approval_requests)
                        tool_outputs = "\n".join(
                            str(message.get("content")) for request in approval_requests
                            for message in request.get("messages", []) if message.get("role") == "tool"
                        )[-1200:]
                        assert protected_file.read_text(encoding="utf-8") == (
                            "UPDATED\n" if approval_choice == "once" else "ORIGINAL\n"
                        ), (approval_choice, tool_outputs)
                assert yaml.safe_load((beta / "config.yaml").read_text(encoding="utf-8"))["approvals"]["mode"] == "manual"
                assert "approvals" not in yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8"))
                rule_target = workspace / "allowlist-canary.txt"
                assert rule_target.resolve().is_relative_to(workspace.resolve())
                rule_command = (
                    'powershell.exe -NoProfile -Command "Remove-Item -Force -LiteralPath '
                    f"'{rule_target.as_posix()}'\""
                )
                with _model_endpoint("RULE-ANSWER", terminal_command=rule_command) as (rule_url, rule_requests):
                    for profile in ("beta", "default"):
                        rule_target.write_text("CANARY\n", encoding="utf-8")
                        rule_config = Request(
                            f"http://127.0.0.1:{port}/api/config?profile={profile}",
                            data=json.dumps({"config": {
                                "model": {"provider": "custom", "default": "rule-canary",
                                          "base_url": rule_url, "context_length": 65536},
                                "approvals": {"mode": "manual"},
                                **({"command_allowlist": [rule_command]} if profile == "beta" else {}),
                            }}).encode("utf-8"),
                            headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                            method="PUT",
                        )
                        with urlopen(rule_config, timeout=20) as response:
                            assert json.load(response).get("ok") is True

                        async def check_rule_turn() -> int:
                            url = f"ws://127.0.0.1:{port}/api/ws?token={token}"
                            async with connect(url, open_timeout=5, proxy=None) as ws:
                                capabilities = await _rpc(ws, 84, "client.capabilities", {"server_requests": True})
                                assert "approval" in capabilities["result"]["server_requests"], capabilities
                                created = await _rpc(ws, 85, "session.create", {
                                    "source": "desktop", "cwd": str(workspace), "cwd_explicit": True,
                                    "idempotency_key": secrets.token_hex(16), "profile": profile,
                                    "provider": "custom", "model": "rule-canary",
                                })
                                assert "error" not in created, created
                                session_id = created["result"]["session_id"]
                                submitted = await _rpc(ws, 86, "prompt.submit", {
                                    "session_id": session_id, "profile": profile, "text": "Run the test command",
                                })
                                assert "error" not in submitted, submitted
                                requests_seen = 0
                                deadline = time.monotonic() + 40
                                while time.monotonic() < deadline:
                                    frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=deadline - time.monotonic()))
                                    if frame.get("method") == "approval" and frame.get("params", {}).get("session_id") == session_id:
                                        await ws.send(json.dumps({"jsonrpc": "2.0", "id": frame["id"],
                                                                  "result": {"choice": "deny"}}))
                                        requests_seen += 1
                                    event = frame.get("params") if frame.get("method") == "event" else None
                                    if isinstance(event, dict) and event.get("session_id") == session_id \
                                            and event.get("type") == "message.complete":
                                        assert event.get("payload", {}).get("status") == "complete", frame
                                        return requests_seen
                                raise AssertionError(f"allowlist turn did not complete: {profile}")

                        requests_seen = asyncio.run(check_rule_turn())
                        tool_outputs = "\n".join(
                            str(message.get("content")) for request in rule_requests
                            for message in request.get("messages", []) if message.get("role") == "tool"
                        )[-1200:]
                        assert (requests_seen == 0 and not rule_target.exists()) if profile == "beta" else (
                            requests_seen > 0 and rule_target.is_file()
                        ), (profile, requests_seen, tool_outputs)
                    revoke = Request(
                        f"http://127.0.0.1:{port}/api/config?profile=beta",
                        data=json.dumps({"config": {"command_allowlist": []}}).encode("utf-8"),
                        headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                        method="PUT",
                    )
                    with urlopen(revoke, timeout=20) as response:
                        assert json.load(response).get("ok") is True
                    assert yaml.safe_load((beta / "config.yaml").read_text(encoding="utf-8"))["command_allowlist"] == []
                    profile = "beta"
                    rule_target.write_text("CANARY\n", encoding="utf-8")
                    assert asyncio.run(check_rule_turn()) > 0, rule_requests[-3:]
                    assert rule_target.is_file(), "removed allowlist rule still executed the command"
                routing_url = f"http://127.0.0.1:{port}/api/delegation/routing?profile=beta"
                with urlopen(Request(routing_url, headers={"X-Hermes-Session-Token": token}), timeout=20) as response:
                    initial_routing = json.load(response)
                assert any(item["name"] == "default" and item["available"] for item in initial_routing["backends"])
                model_route = {"name": "canary", "description": "Test route for this temporary profile",
                               "base_url": "http://127.0.0.1:1/v1", "model": "route-canary",
                               "api_mode": "chat_completions", "reasoning_effort": "low",
                               "service_tier": "normal", "api_key": "sk-route-canary",
                               "fallback_providers": [{"provider": "openai", "model": "fallback-canary"}],
                               "request_overrides": {"extra_body": {"test_route": True}}}
                routing_update = Request(
                    f"http://127.0.0.1:{port}/api/delegation/backends/model_map?profile=beta",
                    data=json.dumps({"options": [model_route], "default": "canary"}).encode("utf-8"),
                    headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                    method="PUT",
                )
                with urlopen(routing_update, timeout=20) as response:
                    assert json.load(response)["ok"] is True
                with urlopen(Request(routing_url, headers={"X-Hermes-Session-Token": token}), timeout=20) as response:
                    saved_routing = json.load(response)
                assert saved_routing["model_map"]["options"][0]["model"] == "route-canary"
                assert saved_routing["model_map"]["default"] == "canary"
                assert saved_routing["model_map"]["options"][0]["fallback_providers"] == model_route["fallback_providers"]
                assert saved_routing["model_map"]["options"][0]["request_overrides"] == model_route["request_overrides"]
                preview_key = saved_routing["model_map"]["options"][0]["api_key"]
                assert preview_key.startswith("«redacted:")
                assert preview_key != model_route["api_key"]
                renamed_route = {**saved_routing["model_map"]["options"][0],
                                 "name": "renamed-canary", "original_name": "canary"}
                rename_request = Request(
                    f"http://127.0.0.1:{port}/api/delegation/backends/model_map?profile=beta",
                    data=json.dumps({"options": [renamed_route], "default": "renamed-canary"}).encode("utf-8"),
                    headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                    method="PUT",
                )
                with urlopen(rename_request, timeout=20) as response:
                    assert json.load(response)["ok"] is True
                with urlopen(Request(routing_url, headers={"X-Hermes-Session-Token": token}), timeout=20) as response:
                    saved_routing = json.load(response)
                assert saved_routing["model_map"]["default"] == "renamed-canary"
                assert saved_routing["model_map"]["options"][0]["api_key"] == preview_key
                stored_routes = yaml.safe_load((beta / "config.yaml").read_text(encoding="utf-8"))
                assert stored_routes["delegation"]["backends"]["model_map"]["options"][0]["api_key"] == model_route["api_key"]
                invalid_routing = Request(
                    f"http://127.0.0.1:{port}/api/delegation/backends/model_map?profile=beta",
                    data=json.dumps({"options": [{**renamed_route, "description": ""}], "default": "renamed-canary"}).encode("utf-8"),
                    headers={"X-Hermes-Session-Token": token, "Content-Type": "application/json"},
                    method="PUT",
                )
                try:
                    urlopen(invalid_routing, timeout=20)
                except HTTPError as error:
                    assert error.code == 400
                else:
                    raise AssertionError("incomplete delegation route was accepted")
                with urlopen(Request(routing_url, headers={"X-Hermes-Session-Token": token}), timeout=20) as response:
                    assert json.load(response)["model_map"] == saved_routing["model_map"]
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
