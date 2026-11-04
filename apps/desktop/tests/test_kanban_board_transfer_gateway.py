"""Verify the desktop board-transfer request bodies against the pinned Kanban router."""
import importlib.util
import sqlite3
import sys
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

PRODUCT = Path(__file__).resolve().parents[3]
UPSTREAM = PRODUCT / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))


def test_board_export_import_and_rejection(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    from hermes_cli import kanban_db

    kanban_db.init_db()
    source = UPSTREAM / "plugins" / "kanban" / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location("hermess_kanban_transfer_test", source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    app = FastAPI()
    app.include_router(module.router, prefix="/api/plugins/kanban")
    client = TestClient(app)

    created = client.post("/api/plugins/kanban/tasks?board=default", json={
        "title": "Portable task", "tenant": "hermess-desktop-default"})
    assert created.status_code == 200, created.text

    output = tmp_path / "exported.tar.gz"
    exported = client.post("/api/plugins/kanban/boards/default/export", json={
        "output": str(output), "attachments": True, "logs": False})
    assert exported.status_code == 200, exported.text
    archive = Path(exported.json()["archive"])
    assert archive == output and archive.is_file() and archive.stat().st_size == exported.json()["size"]

    imported = client.post("/api/plugins/kanban/boards/import", json={"archive": str(archive), "switch": False})
    assert imported.status_code == 200, imported.text
    result = imported.json()
    assert result["board"] != "default" and result["renamed"] is True
    assert result["tasks_parked"] >= 0 and isinstance(result["warnings"], list)
    board = client.get("/api/plugins/kanban/board", params={"board": result["board"]})
    assert board.status_code == 200, board.text
    assert any(task["title"] == "Portable task" for column in board.json()["columns"] for task in column["tasks"])
    assert kanban_db.get_current_board() == "default"

    # Desktop diagnostics use these pinned routes for active workers and run control.
    task_id = created.json()["task"]["id"]
    with sqlite3.connect(kanban_db.kanban_db_path("default")) as conn:
        conn.execute("UPDATE tasks SET status = 'running', claim_lock = 'desktop-test' WHERE id = ?", (task_id,))
        run_id = conn.execute(
            "INSERT INTO task_runs (task_id, profile, status, claim_lock, worker_pid, started_at) "
            "VALUES (?, ?, 'running', 'desktop-test', ?, ?)",
            (task_id, "default", 2147483647, int(time.time())),
        ).lastrowid
        conn.execute("UPDATE tasks SET current_run_id = ? WHERE id = ?", (run_id, task_id))
    active = client.get("/api/plugins/kanban/workers/active?board=default")
    assert active.status_code == 200, active.text
    assert active.json()["count"] == 1 and active.json()["workers"][0]["run_id"] == run_id
    run_detail = client.get(f"/api/plugins/kanban/runs/{run_id}?board=default")
    assert run_detail.status_code == 200, run_detail.text
    assert run_detail.json()["run"]["task_id"] == task_id
    assert run_detail.json()["run"]["profile"] == "default"
    assert run_detail.json()["run"]["ended_at"] is None
    inspected = client.get(f"/api/plugins/kanban/runs/{run_id}/inspect?board=default")
    assert inspected.status_code == 200 and inspected.json()["alive"] is False, inspected.text
    terminated = client.post(
        f"/api/plugins/kanban/runs/{run_id}/terminate?board=default",
        json={"reason": "Stopped from desktop Kanban"},
    )
    assert terminated.status_code == 200 and terminated.json()["task_id"] == task_id, terminated.text
    assert client.get("/api/plugins/kanban/workers/active?board=default").json()["count"] == 0
    repeated = client.post(
        f"/api/plugins/kanban/runs/{run_id}/terminate?board=default", json={"reason": "again"})
    assert repeated.status_code == 409, repeated.text

    missing = client.post("/api/plugins/kanban/boards/import", json={"archive": str(tmp_path / "missing.tar.gz"), "switch": False})
    assert missing.status_code == 404, missing.text
    invalid = tmp_path / "invalid.tar.gz"
    invalid.write_bytes(b"not a board archive")
    rejected = client.post("/api/plugins/kanban/boards/import", json={"archive": str(invalid), "switch": False})
    assert rejected.status_code == 500 and rejected.json()["detail"] == "not a gzip file", rejected.text
