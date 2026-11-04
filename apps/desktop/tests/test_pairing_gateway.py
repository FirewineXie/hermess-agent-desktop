"""Send production Rust pairing shapes to the locked Dashboard with isolated storage."""
import json
import subprocess
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_pairing_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from gateway.pairing import PairingStore
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_pairing_request_shapes", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("PAIRING_SHAPE=", 1)[1]) for line in output.splitlines() if "PAIRING_SHAPE=" in line]
    assert [item["operation"] for item in shapes] == ["pairing.list", "pairing.approve", "pairing.revoke", "pairing.clearPending"]
    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

    def send(shape):
        return client.request(shape["method"], shape["path"], json=shape["body"])

    assert send(shapes[0]).json() == {"pending": [], "approved": []}
    code = PairingStore().generate_code("telegram", "12345", "Test user")
    assert code
    pending = send(shapes[0]).json()["pending"]
    assert len(pending) == 1 and pending[0]["request_id"] and "code" not in pending[0]
    approve = dict(shapes[1], body=dict(shapes[1]["body"], request_id=pending[0]["request_id"]))
    assert send(approve).json()["ok"] is True
    assert send(approve).status_code == 404
    assert send(shapes[0]).json()["approved"][0]["user_id"] == "12345"
    assert send(shapes[2]).json()["ok"] is True
    assert send(shapes[2]).status_code == 404
    assert send(shapes[0]).json()["approved"] == []
    assert PairingStore().generate_code("discord", "67890")
    assert send(shapes[3]).json() == {"ok": True, "cleared": 1}
    assert send(shapes[0]).json()["pending"] == []
