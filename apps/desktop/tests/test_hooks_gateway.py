"""Send production Shell Hook request shapes to the locked Dashboard in isolation."""
import json
import subprocess
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_hook_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_hook_shapes", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("HOOK_SHAPE=", 1)[1]) for line in output.splitlines() if "HOOK_SHAPE=" in line]
    assert [shape["method"] for shape in shapes] == ["GET", "POST", "DELETE"]
    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

    def send(shape):
        return client.request(shape["method"], shape["path"], json=shape.get("body"))

    listed = send(shapes[0])
    assert listed.status_code == 200, listed.text
    assert "on_session_start" in listed.json()["valid_events"]
    created = send(shapes[1])
    assert created.status_code == 200 and created.json()["ok"] is True, created.text
    assert created.json()["approved"] is False
    hooks = send(shapes[0]).json()["hooks"]
    assert any(hook["event"] == "on_session_start" and hook["command"] == "test-hook-command"
               and hook["allowed"] is False for hook in hooks)
    removed = send(shapes[2])
    assert removed.status_code == 200 and removed.json()["ok"] is True, removed.text
    assert not any(hook["command"] == "test-hook-command" for hook in send(shapes[0]).json()["hooks"])
    assert send(shapes[2]).status_code == 404
    rejected = dict(shapes[1], body=dict(shapes[1]["body"], event="not-a-real-event"))
    assert send(rejected).status_code == 400
