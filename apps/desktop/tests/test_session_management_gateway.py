"""Exercise product session routes against the locked Gateway with isolated storage."""
import json
import os
import subprocess
import sys
import time
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_session_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_state import SessionDB
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    session_id = "product-session-test"
    bulk_id = "product-bulk-test"
    empty_id = "product-empty-test"
    old_id = "product-old-test"
    db = SessionDB()
    db.create_session(session_id, "cli", profile_name="default")
    db.append_message(session_id, "user", "gateway shape sample")
    for index in range(500):
        db.append_message(session_id, "assistant", f"bounded history {index}")
    db.end_session(session_id, "completed")
    for sid in (bulk_id, empty_id):
        db.create_session(sid, "cli", profile_name="default")
        db.end_session(sid, "completed")
    db.create_session(old_id, "cli", profile_name="default")
    db.append_message(old_id, "user", "old session sample")
    db.end_session(old_id, "completed")
    old_time = time.time() - 120 * 86400
    db._write_sql("UPDATE sessions SET started_at=?, last_activity_at=?, ended_at=? WHERE id=?",
                  (old_time, old_time, old_time, old_id))
    db._write_sql("UPDATE messages SET timestamp=? WHERE session_id=?", (old_time, old_id))
    db.close()

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    snapshot = client.get(f"/api/sessions/{session_id}/mutation-snapshot?profile=default")
    assert snapshot.status_code == 200, snapshot.text
    assert snapshot.json()["exists"] is True

    imported = {"id": "product-import-test", "source": "cli", "messages": [
        {"role": "user", "content": "imported session sample"}]}
    environment = dict(os.environ, HERMESS_TEST_PROFILE="default", HERMESS_TEST_SESSION_ID=session_id,
                       HERMESS_TEST_EMPTY_ID=bulk_id, HERMESS_TEST_IMPORT_SESSION=json.dumps(imported),
                       HERMESS_TEST_REVISION=str(snapshot.json()["runtime_revision"]),
                       HERMESS_TEST_GENERATION=json.dumps(snapshot.json()["runtime_generation"]))
    command = ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
               "--locked", "print_production_shapes_for_gateway_test", "--", "--ignored", "--nocapture"]
    cargo_result = subprocess.run(command, env=environment, capture_output=True, text=True,
                                  encoding="utf-8", errors="replace")
    assert cargo_result.returncode == 0, cargo_result.stderr
    output = cargo_result.stdout
    shapes = [json.loads(line.split("SESSION_MANAGEMENT_SHAPES=", 1)[1]) for line in output.splitlines()
              if "SESSION_MANAGEMENT_SHAPES=" in line]
    assert len(shapes) == 1
    shape = shapes[0]

    listing = client.get(shape["list"])
    assert listing.status_code == 200, listing.text
    assert any(row["id"] == session_id for row in listing.json()["sessions"])
    multi_source_listing = client.get(shape["multiSourceList"])
    assert multi_source_listing.status_code == 200, multi_source_listing.text
    assert any(row["id"] == session_id for row in multi_source_listing.json()["sessions"])
    excluded_source_listing = client.get(shape["excludedSourceList"])
    assert excluded_source_listing.status_code == 200, excluded_source_listing.text
    assert any(row["id"] == session_id for row in excluded_source_listing.json()["sessions"])
    searched = client.get(shape["search"])
    assert searched.status_code == 200, searched.text
    assert any(row["id"] == session_id for row in searched.json()["results"])
    stats = client.get(shape["stats"])
    assert stats.status_code == 200, stats.text
    assert stats.json()["total"] >= 1
    messages = client.get(shape["messages"])
    assert messages.status_code == 200, messages.text
    assert len(messages.json()["messages"]) == 500
    assert messages.json()["pagination"] == {
        "limit": 500, "offset": 0, "order": "latest", "returned": 500,
    }
    assert messages.json()["messages"][-1]["content"] == "bounded history 499"
    route, body = shape["rename"]
    renamed = client.patch(route, json=body)
    assert renamed.status_code == 200, renamed.text
    assert client.get(f"/api/sessions/{session_id}?profile=default").json()["title"] == "Renamed by product"
    archive_route, archive_body = shape["archive"]
    archived = client.patch(archive_route, json=archive_body)
    assert archived.status_code == 200, archived.text
    assert bool(client.get(f"/api/sessions/{session_id}?profile=default").json()["archived"]) is True
    restore_route, restore_body = shape["restore"]
    restored = client.patch(restore_route, json=restore_body)
    assert restored.status_code == 200, restored.text
    assert bool(client.get(f"/api/sessions/{session_id}?profile=default").json()["archived"]) is False

    import_route, import_body = shape["import"]
    imported_result = client.post(import_route, json=import_body)
    assert imported_result.status_code == 200, imported_result.text
    assert imported_result.json()["imported"] == 1
    assert client.get("/api/sessions/product-import-test?profile=default").status_code == 200

    assert client.get(shape["emptyCount"]).json()["count"] == 2
    bulk_method, bulk_route, bulk_body = shape["bulkDelete"]
    bulk_result = client.request(bulk_method, bulk_route, json=bulk_body)
    assert bulk_result.status_code == 200, bulk_result.text
    assert bulk_result.json()["deleted"] == 1
    assert bulk_result.json()["skipped_active"] == []
    assert client.get(shape["emptyCount"]).json()["count"] == 1

    empty_method, empty_route, empty_body = shape["deleteEmpty"]
    empty_result = client.request(empty_method, empty_route, json=empty_body)
    assert empty_result.status_code == 200, empty_result.text
    assert empty_result.json()["deleted"] == 1
    assert client.get(shape["emptyCount"]).json()["count"] == 0

    preview_method, preview_route, preview_body = shape["prunePreview"]
    preview = client.request(preview_method, preview_route, json=preview_body)
    assert preview.status_code == 200, preview.text
    assert preview.json()["matched"] == 1
    assert preview.json()["sessions"][0]["id"] == old_id
    invalid_window = client.request(preview_method, preview_route,
                                    json={**preview_body, "older_than_days": 0})
    assert invalid_window.status_code == 400
    assert client.get(f"/api/sessions/{old_id}?profile=default").status_code == 200
    prune_method, prune_route, prune_body = shape["pruneApply"]
    pruned = client.request(prune_method, prune_route, json=prune_body)
    assert pruned.status_code == 200, pruned.text
    assert pruned.json()["removed"] == 1
    assert client.get(f"/api/sessions/{old_id}?profile=default").status_code == 404
