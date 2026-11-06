"""Exercise production credential-pool shapes against the locked Dashboard."""
import json
import subprocess
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_credential_pool_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_credential_pool_shapes", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("POOL_SHAPE=", 1)[1]) for line in output.splitlines() if "POOL_SHAPE=" in line]
    assert [shape["method"] for shape in shapes] == ["GET", "POST", "DELETE"]
    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

    initial = client.get(shapes[0]["path"])
    assert initial.status_code == 200, initial.text
    assert initial.json()["providers"] == []
    created = client.post(shapes[1]["path"], json=shapes[1]["body"])
    assert created.status_code == 200 and created.json()["ok"] is True, created.text
    listed = client.get(shapes[0]["path"])
    assert listed.status_code == 200, listed.text
    pool = next(item for item in listed.json()["providers"] if item["provider"] == "custom:codex-smoke")
    assert len(pool["entries"]) == 1
    entry = pool["entries"][0]
    assert entry["index"] == 1 and entry["id"] and entry["source"] == "manual"
    assert shapes[1]["body"]["api_key"] not in json.dumps(pool)
    removed = client.delete(shapes[2]["path"])
    assert removed.status_code == 200 and removed.json()["ok"] is True, removed.text
    assert client.get(shapes[0]["path"]).json()["providers"] == []
    assert client.delete(shapes[2]["path"]).status_code == 404
