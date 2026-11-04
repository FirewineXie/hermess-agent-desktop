"""Verify production Rust key operations against the locked Dashboard in isolation."""
import json
import subprocess
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_env_key_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_env_key_request_shapes", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("ENV_KEY_SHAPE=", 1)[1]) for line in output.splitlines() if "ENV_KEY_SHAPE=" in line]
    assert [item["operation"] for item in shapes] == ["envKeys.list", "envKeys.save", "envKeys.reveal", "envKeys.delete"]

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

    def send(shape):
        return client.request(shape["method"], shape["path"], json=shape["body"])

    initial = send(shapes[0])
    assert initial.status_code == 200, initial.text
    assert shapes[1]["body"]["key"] not in initial.json()
    saved = send(shapes[1])
    assert saved.status_code == 200, saved.text
    listed = send(shapes[0])
    assert listed.status_code == 200
    row = listed.json()[shapes[1]["body"]["key"]]
    assert row["is_set"] is True and row["custom"] is True
    assert shapes[1]["body"]["value"] not in json.dumps(row)
    revealed = send(shapes[2])
    assert revealed.status_code == 200, revealed.text
    assert revealed.json() == {"key": shapes[1]["body"]["key"], "value": shapes[1]["body"]["value"]}
    rejected = dict(shapes[1], body=dict(shapes[1]["body"], value=row["redacted_value"]))
    assert send(rejected).status_code == 400
    assert send(shapes[3]).status_code == 200
    assert shapes[1]["body"]["key"] not in send(shapes[0]).json()
    assert send(shapes[2]).status_code == 404
    assert send(shapes[3]).status_code == 404
