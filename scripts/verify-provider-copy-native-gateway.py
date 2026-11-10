"""Check provider copy with the locked Gateway's real profile ticket receiver."""

from __future__ import annotations

import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time

import httpx

from validation_workspace import validation_workspace


ROOT = Path(__file__).resolve().parents[1]
UPSTREAM = ROOT / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))


def control(home: Path, verb: str, params: dict | None = None) -> dict:
    request = json.dumps({"protocol": 1, "id": 1, "verb": verb, "params": params or {}}).encode() + b"\n"
    if os.name == "nt":
        from gateway.runtime_bootstrap_windows import query_runtime_control
        raw = query_runtime_control(home, request, 2)
    else:
        pointer = home / "gateway.sock.path"
        path = pointer.read_text(encoding="utf-8").strip() if pointer.exists() else str(home / "gateway.sock")
        with socket.socket(socket.AF_UNIX) as peer:
            peer.settimeout(2)
            peer.connect(path)
            peer.sendall(request)
            with peer.makefile("rb") as stream:
                raw = stream.readline()
    reply = json.loads(raw.split(b"\n", 1)[0])
    assert reply["ok"], reply
    return reply["result"]


def main() -> None:
    scratch = ROOT / ".build"
    scratch.mkdir(exist_ok=True)
    with validation_workspace(prefix="provider-copy-native-", dir=scratch) as temp:
        root = Path(temp)
        home = root / "hermes-home"
        home.mkdir()
        user = root / "user"
        user.mkdir()
        (home / "config.yaml").write_text(json.dumps({"gateway": {"multiplex_profiles": True}}), encoding="utf-8")
        profiles = {}
        for name in ("source", "target"):
            profile_home = home / "profiles" / name
            profile_home.mkdir(parents=True)
            (profile_home / "config.yaml").write_text("{}", encoding="utf-8")
            profiles[name] = profile_home

        env = os.environ.copy()
        env.update({
            "HOME": str(user), "USERPROFILE": str(user), "HERMES_HOME": str(home),
            "HERMES_GATEWAY_LOCK_DIR": str(root / "gateway-locks"),
            "HERMES_DASHBOARD_SESSION_TOKEN": secrets.token_urlsafe(32),
            "HERMES_DISABLE_LAZY_INSTALLS": "1", "PYTHONPATH": str(UPSTREAM),
            "HTTP_PROXY": "http://127.0.0.1:9", "HTTPS_PROXY": "http://127.0.0.1:9",
            "ALL_PROXY": "http://127.0.0.1:9", "NO_PROXY": "127.0.0.1,localhost",
        })
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        with (root / "gateway.log").open("w+") as log:
            process = subprocess.Popen([sys.executable, "-m", "gateway.run"], cwd=UPSTREAM,
                                       env=env, stdin=subprocess.DEVNULL, stdout=log,
                                       stderr=subprocess.STDOUT, creationflags=creationflags)
            try:
                deadline = time.monotonic() + 60
                descriptor = {}
                while process.poll() is None and time.monotonic() < deadline:
                    try:
                        descriptor = control(home, "identify")
                        if descriptor.get("state") == "ready":
                            break
                    except (OSError, ValueError):
                        pass
                    time.sleep(.1)
                if descriptor.get("state") != "ready":
                    log.seek(0)
                    raise RuntimeError(f"isolated Gateway failed: {log.read()[-2500:]}")

                def headers(profile: str) -> dict[str, str]:
                    ticket = control(home, "session-ticket", {
                        "profile_id": str(profiles[profile].resolve()),
                        "purpose": "native-http", "instance_id": descriptor["instance_id"],
                    })["ticket"]
                    return {"X-Hermes-Gateway-Ticket": ticket}

                with httpx.Client(base_url=descriptor["api_origin"], trust_env=False, timeout=20) as client:
                    source_body = {
                        "id": "source-endpoint", "name": "Copy Fixture",
                        "base_url": "https://example.test/v1", "model": "fixture-model",
                        "models": ["fixture-model"], "api_key": "fixture-secret-only",
                        "make_default": False, "discover_models": True,
                        "api_mode": "chat_completions", "model_details": [],
                    }
                    response = client.post("/api/providers/custom-endpoints", params={"profile": "source"},
                                           headers=headers("source"), json=source_body)
                    assert response.status_code == 200, ("create source", response.status_code)
                    listed = client.get("/api/providers/custom-endpoints", params={"profile": "source"},
                                        headers=headers("source"))
                    assert listed.status_code == 200, ("list source", listed.status_code)
                    row = next(item for item in listed.json()["endpoints"] if item["id"] == "source-endpoint")
                    source_key = row["api_key_preview"].removeprefix("${").removesuffix("}")
                    revealed = client.post("/api/env/reveal", headers=headers("source"),
                                           json={"profile": "source", "key": source_key})
                    assert revealed.status_code == 200, ("reveal source", revealed.status_code)
                    secret = revealed.json()["value"]
                    assert secret == source_body["api_key"]

                    target_before = client.get("/api/config", params={"profile": "target"},
                                               headers=headers("target"))
                    assert target_before.status_code == 200, ("read target", target_before.status_code)
                    copy_body = {**source_body, "id": "copy-fixture", "api_key": secret}
                    copied = client.post("/api/providers/custom-endpoints", params={"profile": "target"},
                                         headers=headers("target"), json=copy_body)
                    assert copied.status_code == 200, ("copy target", copied.status_code)
                    target_list = client.get("/api/providers/custom-endpoints", params={"profile": "target"},
                                             headers=headers("target"))
                    assert target_list.status_code == 200, ("list target", target_list.status_code)
                    target_row = next(item for item in target_list.json()["endpoints"] if item["id"] == "copy-fixture")
                    key_name = "HERMES_CUSTOM_COPY_FIXTURE_API_KEY"
                    assert target_row["has_api_key"] and target_row["api_key_preview"] == "${" + key_name + "}"
                    target_env = client.get("/api/env", params={"profile": "target"}, headers=headers("target"))
                    assert target_env.status_code == 200 and target_env.json()[key_name]["is_set"]
                    target_after = client.get("/api/config", params={"profile": "target"},
                                              headers=headers("target"))
                    assert target_after.status_code == 200 and target_after.json()["model"] == target_before.json()["model"]
                    assert secret in (profiles["target"] / ".env").read_text(encoding="utf-8")

                    rejected = client.post("/api/providers/custom-endpoints", params={"profile": "target"},
                                           headers=headers("target"), json={
                                               **copy_body, "id": "copy-rejected", "api_key": "${FAKE_KEY}",
                                           })
                    assert rejected.status_code == 400, ("redacted credential", rejected.status_code)
                    rejected_list = client.get("/api/providers/custom-endpoints", params={"profile": "target"},
                                               headers=headers("target"))
                    assert rejected_list.status_code == 200
                    assert not any(item["id"] == "copy-rejected" for item in rejected_list.json()["endpoints"])

                    wrong_profile = client.post("/api/env/reveal", headers=headers("target"),
                                                json={"profile": "source", "key": source_key})
                    assert wrong_profile.status_code in (401, 403), ("cross-profile reveal", wrong_profile.status_code)
                    print("Locked Gateway accepted native-ticket copy; redacted and cross-profile credential requests rejected.")
            finally:
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)


if __name__ == "__main__":
    main()
