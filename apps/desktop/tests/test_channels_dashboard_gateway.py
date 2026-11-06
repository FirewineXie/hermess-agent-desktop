"""Send desktop channel request shapes to the locked Dashboard receiver."""
import json
import subprocess
import sys
from contextlib import closing
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def _production_shapes():
    command = [
        "cargo", "test", "--manifest-path",
        str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"), "--locked",
        "print_production_channel_shapes", "--", "--ignored", "--nocapture",
    ]
    output = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    ).stdout
    return [
        json.loads(line.split("CHANNEL_SHAPE=", 1)[1])
        for line in output.splitlines() if "CHANNEL_SHAPE=" in line
    ]


def test_telegram_multi_user_and_whatsapp_setup_shapes(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from hermes_cli.web_routers import messaging
    from hermes_cli.web_server_messaging import _whatsapp_onboarding_sessions
    from hermes_cli.config import load_env
    from starlette.testclient import TestClient

    shapes = _production_shapes()
    by_kind = {shape["kind"]: shape for shape in shapes}
    assert set(by_kind) == {"telegram_config", "whatsapp_start", "whatsapp_config"}

    backup_calls = []

    def fake_backup(session_path):
        backup_calls.append(session_path)

    def fake_reserve(record):
        record.session_reserved = False

    def fake_launch(_pairing_id, record, session_path):
        session_path.mkdir(parents=True, exist_ok=True)
        (session_path / "creds.json").write_text('{"registered":true}', encoding="utf-8")
        record.status = "connected"
        record.account_id = "1555123:1@s.whatsapp.net"
        record.account_name = "Desktop fixture"
        record.account_phone = "1555123"

    monkeypatch.setattr(messaging, "_backup_whatsapp_session", fake_backup)
    monkeypatch.setattr(messaging, "_reserve_whatsapp_session", fake_reserve)
    monkeypatch.setattr(messaging, "_launch_whatsapp_pairing", fake_launch)
    _whatsapp_onboarding_sessions.clear()

    with closing(TestClient(app, raise_server_exceptions=False)) as client:
        client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

        telegram = by_kind["telegram_config"]
        saved = client.request(telegram["method"], telegram["path"], json=telegram["body"])
        assert saved.status_code == 200, saved.text
        assert saved.json()["ok"] is True
        env = load_env()
        assert env["TELEGRAM_ALLOWED_USERS"] == "123456789,987654321"

        rejected_telegram = dict(telegram["body"])
        rejected_telegram["env"] = dict(telegram["body"]["env"])
        rejected_telegram["env"]["TELEGRAM_ALLOWED_USERS"] = "123456789,@bad"
        rejected = client.put(telegram["path"], json=rejected_telegram)
        assert rejected.status_code == 400, rejected.text

        start = by_kind["whatsapp_start"]
        started = client.request(start["method"], start["path"], json=start["body"])
        assert started.status_code == 200, started.text
        started_body = started.json()
        assert started_body["status"] == "connected"
        assert started_body["mode"] == "self-chat"
        assert started_body["allowed_users"] == "1555123"
        assert started_body["account_phone"] == "1555123"
        assert len(backup_calls) == 1

        whatsapp = by_kind["whatsapp_config"]
        configured = client.request(whatsapp["method"], whatsapp["path"], json=whatsapp["body"])
        assert configured.status_code == 200, configured.text
        assert configured.json()["ok"] is True
        env = load_env()
        assert env["WHATSAPP_MODE"] == "self-chat"
        assert env["WHATSAPP_ALLOWED_USERS"] == "1555123"

        platforms = client.get("/api/messaging/platforms")
        assert platforms.status_code == 200, platforms.text
        row = next(item for item in platforms.json()["platforms"] if item["id"] == "whatsapp")
        assert row["whatsapp_setup"]["mode"] == "self-chat"
        assert row["whatsapp_setup"]["allowed_users_set"] is True

        invalid_start = dict(start["body"], mode="assistant")
        rejected = client.post(start["path"], json=invalid_start)
        assert rejected.status_code == 400, rejected.text

    _whatsapp_onboarding_sessions.clear()
