"""Locked Gateway receiver check for the Rust channel management request bodies."""
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "upstream" / "hermes-agent"))


def verify(client, root: Path, profile: str) -> None:
    home = root if profile == "default" else root / "profiles" / profile
    home.mkdir(parents=True, exist_ok=True)
    if profile != "default":
        (home / "config.yaml").write_text("{}\n", encoding="utf-8")

    params = {"profile": profile}
    response = client.get("/api/messaging/platforms", params=params)
    assert response.status_code == 200
    catalog = {row["id"]: row for row in response.json()["platforms"]}
    for platform, env in (
        ("telegram", {"TELEGRAM_BOT_TOKEN": "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi", "TELEGRAM_ALLOWED_USERS": "123456789"}),
        ("dingtalk", {"DINGTALK_CLIENT_ID": "fixture-id", "DINGTALK_CLIENT_SECRET": "fixture-secret"}),
        ("wecom", {"WECOM_BOT_ID": "fixture-id", "WECOM_SECRET": "fixture-secret"}),
        ("qqbot", {"QQ_APP_ID": "fixture-id", "QQ_CLIENT_SECRET": "fixture-secret", "QQ_ALLOWED_USERS": "fixture-user"}),
        ("yuanbao", {"YUANBAO_APP_ID": "fixture-id", "YUANBAO_APP_SECRET": "fixture-secret"}),
    ):
        assert platform in catalog, platform
        for key in env:
            assert key in {field["key"] for field in catalog[platform]["env_vars"]}, (platform, key)
        # Exact shape emitted by channel_save and the QR apply commands.
        body = {"profile": profile, "enabled": True, "env": env, "clear_env": []}
        saved = client.put(f"/api/messaging/platforms/{platform}", json=body)
        assert saved.status_code == 200 and saved.json()["ok"], (platform, profile, saved.status_code)
        if platform == "telegram":
            # The Telegram QR apply command intentionally omits clear_env.
            qr_saved = client.put(f"/api/messaging/platforms/{platform}",
                                  json={"profile": profile, "enabled": True, "env": env})
            assert qr_saved.status_code == 200 and qr_saved.json()["ok"], (platform, profile, qr_saved.status_code)
        rows = client.get("/api/messaging/platforms", params=params).json()["platforms"]
        current = next(row for row in rows if row["id"] == platform)
        assert current["enabled"] is True, (platform, profile)
        assert all(field["is_set"] for field in current["env_vars"] if field["key"] in env), (platform, profile)
        tested = client.post(f"/api/messaging/platforms/{platform}/test", params=params)
        assert tested.status_code == 200, (platform, profile, tested.status_code)
        assert tested.json()["ok"] is False, "No Gateway is running in this isolated test"
        disabled = client.put(f"/api/messaging/platforms/{platform}",
                              json={"profile": profile, "enabled": False, "env": {}, "clear_env": []})
        assert disabled.status_code == 200, (platform, profile, disabled.status_code)
        bad = client.put(f"/api/messaging/platforms/{platform}",
                         json={"profile": profile, "enabled": True, "env": {"NOT_ALLOWED": "x"}, "clear_env": []})
        assert bad.status_code == 400, (platform, profile, bad.status_code)

    # Exercise the actual Dashboard onboarding receiver without launching Node:
    # a linked session is the route's documented no-spawn branch.
    session = home / "platforms" / "whatsapp" / "session"
    session.mkdir(parents=True, exist_ok=True)
    (session / "creds.json").write_text('{"me":{"id":"123456789@s.whatsapp.net"}}', encoding="utf-8")
    started = client.post("/api/messaging/whatsapp/onboarding/start",
                          json={"profile": profile, "mode": "bot", "allowed_users": "", "reset_session": False})
    assert started.status_code == 200, (profile, started.status_code)
    pairing_id = started.json()["pairing_id"]
    assert started.json()["status"] == "connected"
    polled = client.get(f"/api/messaging/whatsapp/onboarding/{pairing_id}", params=params)
    assert polled.status_code == 200 and polled.json()["status"] == "connected"
    # Production QR apply saves through this route to leave restart ownership to the desktop.
    saved = client.put("/api/messaging/platforms/whatsapp",
                       json={"profile": profile, "enabled": True,
                             "env": {"WHATSAPP_MODE": "bot", "WHATSAPP_DM_POLICY": "pairing",
                                     "WHATSAPP_ENABLED": "true"}, "clear_env": []})
    assert saved.status_code == 200 and saved.json()["ok"], (profile, saved.status_code)
    cancelled = client.delete(f"/api/messaging/whatsapp/onboarding/{pairing_id}", params=params)
    assert cancelled.status_code == 200 and cancelled.json()["ok"]


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="hermess-channel-management-", ignore_cleanup_errors=True) as directory:
        os.environ["HERMES_HOME"] = directory
        import hermes_state
        from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
        from starlette.testclient import TestClient

        hermes_state.DEFAULT_DB_PATH = Path(directory) / "state.db"
        with TestClient(app) as client:
            client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
            verify(client, Path(directory), "default")
            verify(client, Path(directory), "work")
    print("channel management receiver: passed for default and work profiles")
