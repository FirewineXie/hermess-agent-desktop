"""Verify production memory-provider activation requests against the locked Dashboard."""
import json
import subprocess
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_memory_provider_activation_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    command = [
        "cargo", "test", "--manifest-path",
        str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"), "--locked",
        "print_production_memory_provider_shapes", "--", "--ignored", "--nocapture",
    ]
    output = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    ).stdout
    shapes = [
        json.loads(line.split("MEMORY_PROVIDER_SHAPE=", 1)[1])
        for line in output.splitlines() if "MEMORY_PROVIDER_SHAPE=" in line
    ]
    assert [shape["body"]["provider"] for shape in shapes] == ["", "missing-provider"]

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

    builtin = client.request(shapes[0]["method"], shapes[0]["path"], json=shapes[0]["body"])
    assert builtin.status_code == 200, builtin.text
    assert builtin.json() == {"ok": True, "active": ""}

    missing = client.request(shapes[1]["method"], shapes[1]["path"], json=shapes[1]["body"])
    assert missing.status_code == 400, missing.text
