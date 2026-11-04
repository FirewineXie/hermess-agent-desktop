"""Verify the desktop's production memory-reset request against the locked Dashboard."""
import json
import subprocess
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_memory_reset_shape(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli import profiles as profile_api
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    profile_home = profile_api.create_profile("writer", no_alias=True)
    memory_dir = profile_home / "memories"
    memory_dir.mkdir(parents=True, exist_ok=True)
    (memory_dir / "MEMORY.md").write_text("agent fact", encoding="utf-8")
    (memory_dir / "USER.md").write_text("user fact", encoding="utf-8")

    command = [
        "cargo", "test", "--manifest-path",
        str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"), "--locked",
        "print_production_memory_reset_request_shape", "--", "--ignored", "--nocapture",
    ]
    output = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    ).stdout
    line = next(item for item in output.splitlines() if "MEMORY_RESET_SHAPE=" in item)
    shape = json.loads(line.split("MEMORY_RESET_SHAPE=", 1)[1])

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    response = client.request(shape["method"], shape["path"], json=shape["body"])

    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "deleted": ["MEMORY.md", "USER.md"]}
    assert not (memory_dir / "MEMORY.md").exists()
    assert not (memory_dir / "USER.md").exists()
