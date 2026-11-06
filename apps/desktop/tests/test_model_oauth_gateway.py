"""Verify production Rust model OAuth requests against the locked Dashboard receiver."""
import json
import subprocess
import sys
import time
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_model_oauth_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from hermes_cli.web_server_oauth import _oauth_sessions, _oauth_sessions_lock
    from starlette.testclient import TestClient

    command = [
        "cargo", "test", "--manifest-path",
        str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"), "--locked",
        "print_production_model_oauth_request_shapes", "--", "--ignored", "--nocapture",
    ]
    output = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    ).stdout
    shapes = [
        json.loads(line.split("MODEL_OAUTH_SHAPE=", 1)[1])
        for line in output.splitlines() if "MODEL_OAUTH_SHAPE=" in line
    ]
    assert [item["operation"] for item in shapes] == [
        "list", "start", "poll", "cancel", "disconnect",
    ]

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

    def send(shape):
        return client.request(shape["method"], shape["path"], json=shape["body"])

    listed = send(shapes[0])
    assert listed.status_code == 200, listed.text
    providers = listed.json()["providers"]
    assert providers and all("status" in row and "disconnectable" in row for row in providers)

    rejected_start = send(shapes[1])
    assert rejected_start.status_code == 400, rejected_start.text

    session_id = "missing-session"
    with _oauth_sessions_lock:
        _oauth_sessions[session_id] = {
            "session_id": session_id,
            "provider": "openai-codex",
            "flow": "device_code",
            "profile": "default",
            "created_at": time.time(),
            "status": "pending",
            "error_message": None,
        }
    try:
        polled = send(shapes[2])
        assert polled.status_code == 200, polled.text
        assert polled.json()["status"] == "pending"

        cancelled = send(shapes[3])
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["ok"] is True
        with _oauth_sessions_lock:
            assert session_id not in _oauth_sessions
    finally:
        with _oauth_sessions_lock:
            _oauth_sessions.pop(session_id, None)

    rejected_disconnect = send(shapes[4])
    assert rejected_disconnect.status_code == 400, rejected_disconnect.text
