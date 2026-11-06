"""Verify task model, home-channel and dispatch controls against the pinned Kanban router."""
import importlib.util
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

PRODUCT = Path(__file__).resolve().parents[3]
UPSTREAM = PRODUCT / "upstream" / "hermes-agent"
sys.path.insert(0, str(UPSTREAM))


def test_task_controls_and_rejections(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    from hermes_cli import kanban_db

    kanban_db.init_db()
    source = UPSTREAM / "plugins" / "kanban" / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location("hermess_kanban_task_controls_test", source)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "_configured_home_channels", lambda: [{
        "platform": "telegram", "chat_id": "home-chat", "thread_id": "", "name": "Main",
    }])
    monkeypatch.setattr(module, "_active_profile_name", lambda: "default")
    app = FastAPI()
    app.include_router(module.router, prefix="/api/plugins/kanban")
    client = TestClient(app)

    created = client.post("/api/plugins/kanban/tasks?board=default", json={
        "title": "Controlled task", "triage": True,
        "priority": 7, "workspace_kind": "dir", "workspace_path": str(tmp_path),
        "skills": ["blogwatcher", "github-code-review"], "goal_mode": True,
        "model_override": "gpt-test", "provider_override": "openai", "reasoning_effort": "high",
    })
    assert created.status_code == 200, created.text
    task_id = created.json()["task"]["id"]
    assert created.json()["task"]["model_override"] == "gpt-test"
    assert created.json()["task"]["provider_override"] == "openai"
    assert created.json()["task"]["reasoning_effort"] == "high"
    assert created.json()["task"]["priority"] == 7
    assert created.json()["task"]["workspace_kind"] == "dir"
    assert created.json()["task"]["workspace_path"] == str(tmp_path)
    assert created.json()["task"]["skills"] == ["blogwatcher", "github-code-review"]
    assert created.json()["task"]["goal_mode"] is True

    second = client.post("/api/plugins/kanban/tasks?board=default", json={
        "title": "Second task", "triage": True,
    })
    assert second.status_code == 200, second.text
    second_id = second.json()["task"]["id"]
    child = client.post("/api/plugins/kanban/tasks?board=default", json={
        "title": "Child task", "triage": False, "parents": [task_id],
    })
    assert child.status_code == 200, child.text
    child_id = child.json()["task"]["id"]
    grandchild = client.post("/api/plugins/kanban/tasks?board=default", json={
        "title": "Grandchild task", "triage": False, "parents": [child_id],
    })
    assert grandchild.status_code == 200, grandchild.text
    grandchild_id = grandchild.json()["task"]["id"]
    child_detail = client.get(f"/api/plugins/kanban/tasks/{child_id}?board=default")
    assert child_detail.status_code == 200, child_detail.text
    assert child_detail.json()["links"]["parents"] == [task_id]
    assert child_detail.json()["links"]["children"] == [grandchild_id]
    bulk = client.post("/api/plugins/kanban/tasks/bulk?board=default", json={
        "ids": [task_id, second_id, "t_missing"], "status": "todo",
        "assignee": "default", "reclaim_first": True,
    })
    assert bulk.status_code == 200, bulk.text
    assert bulk.json()["results"] == [
        {"id": task_id, "ok": True}, {"id": second_id, "ok": True},
        {"id": "t_missing", "ok": False, "error": "not found"},
    ]
    stats = client.get("/api/plugins/kanban/stats?board=default")
    assert stats.status_code == 200, stats.text
    assert stats.json()["by_status"]["todo"] == 4
    assert stats.json()["by_assignee"]["default"]["todo"] == 2
    assert isinstance(stats.json()["now"], int)
    rejected_estimate = client.post("/api/plugins/kanban/estimate", json={"title": "", "body": ""})
    assert rejected_estimate.status_code == 200, rejected_estimate.text
    assert rejected_estimate.json()["ok"] is False

    cleared_model = client.patch(f"/api/plugins/kanban/tasks/{task_id}?board=default", json={
        "clear_model_override": True, "reasoning_effort": "none",
    })
    assert cleared_model.status_code == 200, cleared_model.text
    task = client.get(f"/api/plugins/kanban/tasks/{task_id}?board=default").json()["task"]
    assert task["model_override"] is None and task["provider_override"] is None
    assert task["reasoning_effort"] == "none"

    cleared_effort = client.patch(f"/api/plugins/kanban/tasks/{task_id}?board=default", json={
        "model_override": "gpt-next", "provider_override": "openai", "clear_reasoning_effort": True,
    })
    assert cleared_effort.status_code == 200, cleared_effort.text
    task = client.get(f"/api/plugins/kanban/tasks/{task_id}?board=default").json()["task"]
    assert task["model_override"] == "gpt-next" and task["provider_override"] == "openai"
    assert task["reasoning_effort"] is None

    for running_id in (task_id, second_id):
        ready = client.patch(
            f"/api/plugins/kanban/tasks/{running_id}?board=default",
            json={"status": "ready"},
        )
        assert ready.status_code == 200, ready.text
    with module._board_conn("default") as (_, conn):
        assert kanban_db.claim_task(conn, task_id, claimer="default") is not None
        assert kanban_db.claim_task(conn, second_id, claimer="default") is not None

    completion_summary = "Parent work shipped and verified"
    completed = client.post("/api/plugins/kanban/tasks/bulk?board=default", json={
        "ids": [task_id, second_id], "status": "done",
        "result": completion_summary, "summary": completion_summary,
    })
    assert completed.status_code == 200, completed.text
    assert completed.json()["results"] == [
        {"id": task_id, "ok": True}, {"id": second_id, "ok": True},
    ]
    completed_detail = client.get(f"/api/plugins/kanban/tasks/{task_id}?board=default")
    assert completed_detail.status_code == 200, completed_detail.text
    assert completed_detail.json()["task"]["result"] == completion_summary
    assert completed_detail.json()["task"]["latest_summary"] == completion_summary

    # The board tree starts from a task in review but must retain its children
    # even when they are in another workflow status.  Drive the exact locked
    # lifecycle, then prove the board summary and detail links expose that shape.
    with module._board_conn("default") as (_, conn):
        claimed = kanban_db.claim_task(conn, child_id, claimer="default")
        assert claimed is not None
        assert kanban_db.request_review(
            conn, child_id, summary="Ready for review",
            expected_run_id=claimed.current_run_id,
        )
    board_payload = client.get("/api/plugins/kanban/board?board=default")
    assert board_payload.status_code == 200, board_payload.text
    review_tasks = next(
        column["tasks"] for column in board_payload.json()["columns"]
        if column["name"] == "review"
    )
    review_root = next(task for task in review_tasks if task["id"] == child_id)
    assert review_root["link_counts"]["children"] == 1
    review_detail = client.get(f"/api/plugins/kanban/tasks/{child_id}?board=default")
    assert review_detail.status_code == 200, review_detail.text
    assert review_detail.json()["links"]["children"] == [grandchild_id]
    related = {task["id"]: task for task in review_detail.json()["link_tasks"]}
    assert related[grandchild_id] == {
        "id": grandchild_id, "title": "Grandchild task", "status": "todo",
    }
    assert related[task_id] == {
        "id": task_id, "title": "Controlled task", "status": "done",
    }

    homes = client.get("/api/plugins/kanban/home-channels", params={"board": "default", "task_id": task_id})
    assert homes.status_code == 200 and homes.json()["home_channels"][0]["subscribed"] is False
    subscribed = client.post(f"/api/plugins/kanban/tasks/{task_id}/home-subscribe/telegram?board=default", json={})
    assert subscribed.status_code == 200, subscribed.text
    homes = client.get("/api/plugins/kanban/home-channels", params={"board": "default", "task_id": task_id})
    assert homes.json()["home_channels"][0]["subscribed"] is True
    removed = client.delete(f"/api/plugins/kanban/tasks/{task_id}/home-subscribe/telegram?board=default")
    assert removed.status_code == 200, removed.text
    assert client.get("/api/plugins/kanban/home-channels", params={"board": "default", "task_id": task_id}).json()["home_channels"][0]["subscribed"] is False

    dispatched = client.post("/api/plugins/kanban/dispatch?board=default", json={})
    assert dispatched.status_code == 200, dispatched.text
    invalid_effort = client.patch(f"/api/plugins/kanban/tasks/{task_id}?board=default", json={"reasoning_effort": "extreme"})
    assert invalid_effort.status_code == 400, invalid_effort.text
    invalid_provider = client.post("/api/plugins/kanban/tasks?board=default", json={
        "title": "Invalid", "triage": True, "provider_override": "openai",
    })
    assert invalid_provider.status_code == 400, invalid_provider.text

    # The desktop subscribes after loading a board snapshot and resumes from
    # ``latest_event_id``.  Prove the locked receiver accepts its canonical
    # loopback credential and emits only events after that cursor.
    from hermes_cli.web_server import _SESSION_TOKEN

    snapshot_cursor = client.get("/api/plugins/kanban/board?board=default").json()["latest_event_id"]
    with client.websocket_connect(
        "/api/plugins/kanban/events",
        params={"board": "default", "since": snapshot_cursor, "token": _SESSION_TOKEN},
    ) as socket:
        live_task = client.post("/api/plugins/kanban/tasks?board=default", json={
            "title": "Live event task", "triage": True,
        })
        assert live_task.status_code == 200, live_task.text
        frame = socket.receive_json()
        assert frame["cursor"] > snapshot_cursor
        assert any(event["task_id"] == live_task.json()["task"]["id"] for event in frame["events"])
