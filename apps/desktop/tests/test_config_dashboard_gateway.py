"""Verify the desktop full-config request shape against the locked Dashboard receiver."""
import json
import subprocess
import sys
from contextlib import closing
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_full_config_shape_and_defaults(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    command = [
        "cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
        "--locked", "print_production_full_config_request_shape", "--", "--ignored", "--nocapture",
    ]
    output = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    ).stdout
    shapes = [
        json.loads(line.split("FULL_CONFIG_SHAPE=", 1)[1])
        for line in output.splitlines() if "FULL_CONFIG_SHAPE=" in line
    ]
    assert len(shapes) == 1
    shape = shapes[0]

    with closing(TestClient(app, raise_server_exceptions=False)) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        defaults = client.get(shape["defaults_path"])
        assert defaults.status_code == 200, defaults.text
        assert isinstance(defaults.json(), dict) and defaults.json()

        saved = client.request(shape["method"], shape["path"], json=shape["body"])
        assert saved.status_code == 200, saved.text
        assert saved.json()["ok"] is True
        readback = client.get(shape["path"])
        assert readback.status_code == 200, readback.text
        assert readback.json()["display"]["language"] == "zh-CN"
        assert readback.json()["agent"]["reasoning_effort"] == "high"

        rejected = client.request(shape["method"], shape["path"], json={"config": []})
        assert rejected.status_code == 422
