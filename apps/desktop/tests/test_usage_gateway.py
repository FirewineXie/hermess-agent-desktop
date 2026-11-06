"""Check production analytics paths and response fields against the locked Dashboard."""
import json
import subprocess
import sys
from contextlib import closing
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_usage_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    import hermes_state
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_usage_request_shapes", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("USAGE_SHAPE=", 1)[1]) for line in output.splitlines() if "USAGE_SHAPE=" in line]
    assert len(shapes) == 2

    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", tmp_path / "state.db")
    with closing(hermes_state.SessionDB()) as db:
        db.create_session("usage-probe", source="cli", model="probe-model")
    with closing(TestClient(app, raise_server_exceptions=False)) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        usage = client.get(shapes[0]["path"])
        models = client.get(shapes[1]["path"])
    assert usage.status_code == 200, usage.text
    assert models.status_code == 200, models.text
    assert usage.json()["daily"][0]["sessions"] == 1
    assert isinstance(usage.json()["skills"]["top_skills"], list)
    model = next(row for row in models.json()["models"] if row["model"] == "probe-model")
    assert model["sessions"] == 1 and "input_tokens" in model
    assert models.json()["totals"]["distinct_models"] == 1
    assert models.json()["totals"]["total_sessions"] == 1
    assert models.json()["period_days"] == 30
    assert "last_used_at" in model
    assert "capabilities" in model and isinstance(model["capabilities"], dict)
    assert "tool_calls" in model and "avg_tokens_per_session" in model
