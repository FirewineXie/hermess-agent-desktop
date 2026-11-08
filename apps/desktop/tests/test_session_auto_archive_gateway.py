"""Exercise existing config requests and archive listing against the locked receiver."""
import sys
import time
from contextlib import closing
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_auto_archive_config_readback_and_archived_search(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from hermes_state import SessionDB
    from starlette.testclient import TestClient

    with closing(TestClient(app, raise_server_exceptions=False)) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
        # save_agent_config_field wraps each dotted key into this nested config body.
        schema = client.get("/api/config/schema?profile=default")
        assert schema.status_code == 200, schema.text
        for key, value in (("auto_archive", True), ("auto_archive_days", 7)):
            assert f"sessions.{key}" in schema.json()["fields"]
            saved = client.put("/api/config?profile=default", json={"config": {"sessions": {key: value}}})
            assert saved.status_code == 200, saved.text
            actual = client.get("/api/config?profile=default")
            assert actual.status_code == 200, actual.text
            assert actual.json()["sessions"][key] == value

        db = SessionDB(tmp_path / "state.db")
        try:
            old = time.time() - 10 * 86400
            for sid in ("archive-match-old", "archive-match-recent", "archive-match-pinned"):
                db.create_session(sid, "cli", profile_name="default")
                db.append_message(sid, "user", "archive-match sample")
                db.end_session(sid, "completed")
                if sid != "archive-match-recent":
                    db._write_sql("UPDATE sessions SET started_at=?, last_activity_at=?, ended_at=? WHERE id=?",
                                  (old, old, old, sid))
                    db._write_sql("UPDATE messages SET timestamp=? WHERE session_id=?", (old, sid))
            db.set_session_pinned("archive-match-pinned", True)
            result = db.maybe_auto_archive(idle_days=7, min_interval_hours=24)
            assert result["archived"] == 1, result
        finally:
            db.close()

        listed = client.get("/api/sessions?profile=default&archived=only&limit=25&offset=0&order=recent")
        assert listed.status_code == 200, listed.text
        listing = listed.json()
        assert {row["id"] for row in listing["sessions"] if row["archived"]} == {"archive-match-old"}
        assert listing["total"] == 1
        # The receiver backfills unarchived pins; the frontend explicitly removes these.
        assert any(row["id"] == "archive-match-pinned" and not row["archived"] for row in listing["sessions"])
        searched = client.get("/api/sessions/search?profile=default&q=archive-match&limit=100")
        assert searched.status_code == 200, searched.text
        rows = searched.json()["results"]
        assert {row["id"] for row in rows if row["archived"]} == {"archive-match-old"}
        assert any(not row["archived"] for row in rows)
        # Disabling auto archive preserves the threshold and already archived history.
        saved = client.put("/api/config?profile=default", json={"config": {"sessions": {"auto_archive": False}}})
        assert saved.status_code == 200, saved.text
        actual = client.get("/api/config?profile=default").json()["sessions"]
        assert actual["auto_archive"] is False
        assert actual["auto_archive_days"] == 7
        assert bool(client.get("/api/sessions/archive-match-old?profile=default").json()["archived"]) is True
