"""Verify the desktop's production system stats path against the locked Gateway."""
import json
import subprocess
import sys
from contextlib import closing
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_system_stats_shape(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_system_stats_shape", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("SYSTEM_STATS_SHAPE=", 1)[1]) for line in output.splitlines()
              if "SYSTEM_STATS_SHAPE=" in line]
    assert len(shapes) == 1
    shape = shapes[0]
    assert shape["method"] == "GET"

    with closing(TestClient(app, raise_server_exceptions=False)) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        response = client.get(shape["path"])
    assert response.status_code == 200, response.text
    stats = response.json()
    for key in ("os", "arch", "hostname", "python_version", "python_impl", "hermes_version"):
        assert isinstance(stats[key], str)
    assert isinstance(stats["psutil"], bool)
    assert stats["cpu_count"] is None or isinstance(stats["cpu_count"], int)
    if "load_avg" in stats:
        assert len(stats["load_avg"]) >= 3
        assert all(isinstance(value, (int, float)) for value in stats["load_avg"][:3])
