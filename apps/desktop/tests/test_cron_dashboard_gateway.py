"""Use Rust cron paths against the locked Dashboard in isolated storage."""
import json
import subprocess
import sys
from contextlib import closing
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_cron_runs_and_delete_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    import hermes_state
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_cron_dashboard_shapes", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("CRON_SHAPE=", 1)[1]) for line in output.splitlines() if "CRON_SHAPE=" in line]
    assert [shape["method"] for shape in shapes] == ["POST", "PUT", "GET", "DELETE"]

    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", tmp_path / "state.db")
    with closing(hermes_state.SessionDB()) as db:
        db.create_session("cron-store-probe", source="cli")
    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    created = client.post(shapes[0]["path"], json=shapes[0]["body"])
    assert created.status_code == 200, created.text
    job_id = created.json()["id"]
    assert created.json()["provider"] == "test-provider"
    assert created.json()["model"] == "test-model"
    paths = [shape["path"].replace("123456abcdef", job_id) for shape in shapes[1:]]
    updated = client.put(paths[0], json=shapes[1]["body"])
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "isolated-cron-edited"
    assert updated.json()["provider"] is None and updated.json()["model"] is None
    runs = client.get(paths[1])
    assert runs.status_code == 200, runs.text
    assert isinstance(runs.json()["runs"], list)
    deleted = client.delete(paths[2])
    assert deleted.status_code == 200 and deleted.json()["ok"] is True, deleted.text
    assert client.delete(paths[2]).status_code == 404


def test_blueprint_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    import hermes_state
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_blueprint_shapes", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("BLUEPRINT_SHAPE=", 1)[1]) for line in output.splitlines() if "BLUEPRINT_SHAPE=" in line]
    assert [shape["method"] for shape in shapes] == ["GET", "POST"]

    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", tmp_path / "state.db")
    with closing(hermes_state.SessionDB()) as db:
        db.create_session("blueprint-store-probe", source="cli")
    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    catalog = client.get(shapes[0]["path"])
    assert catalog.status_code == 200, catalog.text
    assert any(entry["key"] == "morning-brief" for entry in catalog.json()["blueprints"])
    unknown = client.post(shapes[1]["path"], json={"blueprint": "not-a-blueprint", "values": {}})
    assert unknown.status_code == 404, unknown.text
    invalid = client.post(shapes[1]["path"], json={"blueprint": "morning-brief", "values": {"time": "invalid", "deliver": "local"}})
    assert invalid.status_code == 422, invalid.text
    created = client.post(shapes[1]["path"], json=shapes[1]["body"])
    assert created.status_code == 200, created.text
    assert created.json()["profile"] == "default"
    job_id = created.json()["id"]
    deleted = client.delete(f"/api/cron/jobs/{job_id}?profile=default")
    assert deleted.status_code == 200 and deleted.json()["ok"] is True, deleted.text


def test_trigger_shape_waits_for_actual_job_result(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    import hermes_state
    from starlette.testclient import TestClient

    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_cron_trigger_shape", "--", "--ignored", "--nocapture"]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("TRIGGER_SHAPE=", 1)[1]) for line in output.splitlines() if "TRIGGER_SHAPE=" in line]
    assert len(shapes) == 1 and shapes[0]["method"] == "POST"

    scripts = tmp_path / "scripts"
    scripts.mkdir()
    (scripts / "smoke.py").write_text("print('cron smoke')\n", encoding="utf-8")
    monkeypatch.setattr(hermes_state, "DEFAULT_DB_PATH", tmp_path / "state.db")
    with closing(hermes_state.SessionDB()) as db:
        db.create_session("trigger-store-probe", source="cli")
    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    created = client.post("/api/cron/jobs?profile=default", json={
        "schedule": "0 0 1 1 *", "name": "isolated-script-trigger", "script": "smoke.py",
        "no_agent": True, "deliver": "local", "paused": True,
    })
    assert created.status_code == 200, created.text
    job_id = created.json()["id"]
    trigger_path = shapes[0]["path"].replace("123456abcdef", job_id)
    triggered = client.post(trigger_path)
    assert triggered.status_code == 200, triggered.text
    assert triggered.json()["id"] == job_id
    assert triggered.json()["profile"] == "default"
    assert triggered.json()["last_status"] == "ok"
    assert client.delete(f"/api/cron/jobs/{job_id}?profile=default").status_code == 200

    (scripts / "fail.py").write_text("raise SystemExit(7)\n", encoding="utf-8")
    failed_job = client.post("/api/cron/jobs?profile=default", json={
        "schedule": "0 0 1 1 *", "name": "isolated-script-failure", "script": "fail.py",
        "no_agent": True, "deliver": "local", "paused": True,
    })
    assert failed_job.status_code == 200, failed_job.text
    failed_id = failed_job.json()["id"]
    failed = client.post(shapes[0]["path"].replace("123456abcdef", failed_id))
    assert failed.status_code == 200, failed.text
    assert failed.json()["last_status"] == "error"
    assert failed.json()["last_error"]
    assert client.delete(f"/api/cron/jobs/{failed_id}?profile=default").status_code == 200

    (scripts / "delivery.py").write_text("print('deliver this result')\n", encoding="utf-8")
    delivery_job = client.post("/api/cron/jobs?profile=default", json={
        "schedule": "0 0 1 1 *", "name": "isolated-delivery-failure", "script": "delivery.py",
        "no_agent": True, "deliver": "telegram", "paused": True,
    })
    assert delivery_job.status_code == 200, delivery_job.text
    delivery_id = delivery_job.json()["id"]
    delivery_failed = client.post(shapes[0]["path"].replace("123456abcdef", delivery_id))
    assert delivery_failed.status_code == 200, delivery_failed.text
    assert delivery_failed.json()["last_status"] == "delivery_failed"
    assert delivery_failed.json()["last_delivery_error"]
    assert client.delete(f"/api/cron/jobs/{delivery_id}?profile=default").status_code == 200
