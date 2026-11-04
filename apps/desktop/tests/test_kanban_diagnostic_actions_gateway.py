"""Verify desktop diagnostic action payloads against the pinned Kanban router."""
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


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    from hermes_cli import kanban_db

    kanban_db.init_db()
    source = UPSTREAM / "plugins" / "kanban" / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location("hermess_kanban_diagnostic_actions_test", source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    app = FastAPI()
    app.include_router(module.router, prefix="/api/plugins/kanban")
    return TestClient(app), kanban_db


def _create(client, title):
    response = client.post(
        "/api/plugins/kanban/tasks?board=default",
        json={"title": title, "triage": True},
    )
    assert response.status_code == 200, response.text
    return response.json()["task"]["id"]


def test_diagnostic_reassign_and_unblock_payloads(tmp_path, monkeypatch):
    client, _ = _client(tmp_path, monkeypatch)
    task_id = _create(client, "Recover assignment")

    reassigned = client.post(
        f"/api/plugins/kanban/tasks/{task_id}/reassign?board=default",
        json={
            "profile": "default",
            "reclaim_first": False,
            "reason": "recovery action for missing_profile",
        },
    )
    assert reassigned.status_code == 200, reassigned.text
    assert reassigned.json()["assignee"] == "default"

    readied = client.patch(
        f"/api/plugins/kanban/tasks/{task_id}?board=default",
        json={"status": "ready"},
    )
    assert readied.status_code == 200, readied.text

    blocked = client.patch(
        f"/api/plugins/kanban/tasks/{task_id}?board=default",
        json={"status": "blocked", "block_reason": "needs input"},
    )
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()["task"]["status"] == "blocked"

    unblocked = client.patch(
        f"/api/plugins/kanban/tasks/{task_id}?board=default",
        json={"status": "ready"},
    )
    assert unblocked.status_code == 200, unblocked.text
    assert unblocked.json()["task"]["status"] == "ready"


def test_diagnostic_reclaim_payload(tmp_path, monkeypatch):
    client, kanban_db = _client(tmp_path, monkeypatch)
    task_id = _create(client, "Recover worker")
    started_at = int(time.time())
    with sqlite3.connect(kanban_db.kanban_db_path("default")) as conn:
        conn.execute(
            "UPDATE tasks SET status = 'running', claim_lock = 'desktop-test', worker_pid = ? WHERE id = ?",
            (2147483647, task_id),
        )
        run_id = conn.execute(
            "INSERT INTO task_runs (task_id, profile, status, claim_lock, worker_pid, started_at) "
            "VALUES (?, ?, 'running', 'desktop-test', ?, ?)",
            (task_id, "default", 2147483647, started_at),
        ).lastrowid
        conn.execute("UPDATE tasks SET current_run_id = ? WHERE id = ?", (run_id, task_id))

    reclaimed = client.post(
        f"/api/plugins/kanban/tasks/{task_id}/reclaim?board=default",
        json={"reason": "recovery action for stale_worker"},
    )
    assert reclaimed.status_code == 200, reclaimed.text
    task = client.get(f"/api/plugins/kanban/tasks/{task_id}?board=default")
    assert task.status_code == 200, task.text
    assert task.json()["task"]["status"] == "ready"
    run = client.get(f"/api/plugins/kanban/runs/{run_id}?board=default")
    assert run.status_code == 200, run.text
    assert run.json()["run"]["ended_at"] is not None
    assert run.json()["run"]["status"] == "reclaimed"
