"""Exercise the desktop auxiliary reset request against the locked Gateway receiver."""
import json
import subprocess
import sys
from contextlib import closing
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_auxiliary_reset_shape(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.config import load_config, save_config
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_auxiliary_reset_request_shape", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("AUX_RESET_SHAPE=", 1)[1]) for line in output.splitlines() if "AUX_RESET_SHAPE=" in line]
    assert len(shapes) == 1
    shape = shapes[0]
    config = load_config()
    config.setdefault("auxiliary", {})["vision"] = {
        "provider": "openai", "model": "probe-model", "reasoning_effort": "high",
        "base_url": "http://127.0.0.1:9999", "api_key": "probe-secret",
    }
    save_config(config)

    with closing(TestClient(app, raise_server_exceptions=False)) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        response = client.post(shape["path"], json=shape["body"])
        assert response.status_code == 200, response.text
        assert response.json()["ok"] is True and response.json()["reset"] is True
        readback = client.get(shape["read_path"])
        assert readback.status_code == 200, readback.text
        assert readback.json()["tasks"]
        assert all(row["provider"] == "auto" and row["model"] == "" for row in readback.json()["tasks"])
        rejected = client.post(shape["path"], json={**shape["body"], "scope": "unknown"})
        assert rejected.status_code == 400
        missing = client.post(shape["path"], json={**shape["body"], "profile": "missing-profile"})
        assert missing.status_code == 404

    saved = load_config()["auxiliary"]["vision"]
    assert saved["provider"] == "auto" and saved["model"] == ""
    assert saved["reasoning_effort"] == "" and saved["base_url"] == "" and saved["api_key"] == ""
