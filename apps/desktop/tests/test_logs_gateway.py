"""Verify Rust-produced log queries against the locked Dashboard in isolated storage."""
import json
import subprocess
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_log_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_log_request_shapes", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("LOG_SHAPE=", 1)[1]) for line in output.splitlines() if "LOG_SHAPE=" in line]
    assert [shape["profile"] for shape in shapes] == ["default", "default", "ghost"]

    log_dir = tmp_path / "logs"
    log_dir.mkdir(exist_ok=True)
    (log_dir / "agent.log").write_text(
        "2026-01-01 12:00:00 INFO tools.runner: needle normal\n"
        "2026-01-01 12:00:01 WARNING tools.runner: needle warning\n"
        "2026-01-01 12:00:02 ERROR agent.runner: needle other component\n",
        encoding="utf-8",
    )
    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    all_logs = client.get(shapes[0]["path"])
    assert all_logs.status_code == 200, all_logs.text
    assert all_logs.json()["file"] == "agent" and len(all_logs.json()["lines"]) == 3
    filtered = client.get(shapes[1]["path"])
    assert filtered.status_code == 200, filtered.text
    assert len(filtered.json()["lines"]) == 1
    assert "needle warning" in filtered.json()["lines"][0]
    missing_profile = client.get(shapes[2]["path"])
    assert missing_profile.status_code == 404, missing_profile.text
