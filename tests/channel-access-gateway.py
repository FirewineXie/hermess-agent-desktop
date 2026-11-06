"""Exercise the pinned Dashboard receiver with the desktop channel request shapes."""

import os
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "upstream" / "hermes-agent"))


def verify(client, home: Path, profile: str) -> None:
    from gateway.pairing import PairingStore

    profile_home = home if profile == "default" else home / "profiles" / profile
    profile_home.mkdir(parents=True, exist_ok=True)
    if profile != "default":
        (profile_home / "config.yaml").write_text("{}\n", encoding="utf-8")

    for platform in ("feishu", "weixin"):
        allowlist_key = f"{platform.upper()}_ALLOWED_USERS"
        prior_allowlist = client.put("/api/env", json={"profile": profile, "key": allowlist_key, "value": "old-user"})
        assert prior_allowlist.status_code == 200, (platform, profile, prior_allowlist.text)
        credentials = (
            {"FEISHU_APP_ID": "cli_test", "FEISHU_APP_SECRET": "fixture-secret", "FEISHU_DOMAIN": "feishu"}
            if platform == "feishu" else
            {"WEIXIN_ACCOUNT_ID": "fixture-account", "WEIXIN_TOKEN": "fixture-token", "WEIXIN_BASE_URL": "https://ilinkai.weixin.qq.com"}
        )
        for access in ("pairing", "open"):
            env = dict(credentials)
            flag = f"{platform.upper()}_ALLOW_ALL_USERS"
            flag_value = "true" if access == "open" else "false"
            flag_response = client.put("/api/env", json={"profile": profile, "key": flag, "value": flag_value})
            assert flag_response.status_code == 200, (platform, profile, access, flag_response.text)
            if platform == "feishu":
                cleared = ["FEISHU_ALLOWED_USERS"]
            else:
                env.update(WEIXIN_DM_POLICY=access,
                           WEIXIN_GROUP_POLICY="disabled")
                cleared = ["WEIXIN_ALLOWED_USERS"]
            response = client.put(
                f"/api/messaging/platforms/{platform}",
                json={"enabled": True, "env": env, "clear_env": cleared, "profile": profile},
            )
            assert response.status_code == 200, (platform, profile, access, response.text)
            values = (profile_home / ".env").read_text(encoding="utf-8")
            assert f"{flag}={flag_value}" in values, (flag, profile, access)
            assert f"{allowlist_key}=old-user" not in values, (allowlist_key, profile, access)
            for key, value in env.items():
                assert f"{key}={value}" in values, (key, profile, access)

        store = PairingStore(profile=None if profile == "default" else profile)
        code = store.generate_code(platform, f"fixture-{profile}-{platform}", "Test Sender")
        assert code
        approved = client.post("/api/pairing/approve", json={"profile": profile, "platform": platform, "code": code})
        assert approved.status_code == 200, (platform, profile, approved.text)
        assert approved.json()["ok"] is True
        assert store.is_approved(platform, f"fixture-{profile}-{platform}")
        reused = client.post("/api/pairing/approve", json={"profile": profile, "platform": platform, "code": code})
        assert reused.status_code == 404, (platform, profile, reused.text)
        for attempt in range(4):
            wrong = client.post("/api/pairing/approve", json={"profile": profile, "platform": platform, "code": "ZZZZZZZZ"})
            assert wrong.status_code == (429 if attempt == 3 else 404), (platform, profile, attempt, wrong.text)

    # The desktop pairing form now uses the same receiver for other channel cards.
    for platform in ("telegram", "dingtalk", "wecom", "qqbot", "whatsapp", "discord", "slack"):
        store = PairingStore(profile=None if profile == "default" else profile)
        sender = f"fixture-{profile}-{platform}"
        code = store.generate_code(platform, sender, "Test Sender")
        assert code
        response = client.post("/api/pairing/approve", json={"profile": profile, "platform": platform, "code": code})
        assert response.status_code == 200, (platform, profile, response.text)
        assert store.is_approved(platform, sender)
        repeated = client.post("/api/pairing/approve", json={"profile": profile, "platform": platform, "code": code})
        assert repeated.status_code == 404, (platform, profile, repeated.text)


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="hermess-channel-receiver-", ignore_cleanup_errors=True) as directory:
        os.environ["HERMES_HOME"] = directory
        import hermes_state
        from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
        from starlette.testclient import TestClient

        hermes_state.DEFAULT_DB_PATH = Path(directory) / "state.db"
        with TestClient(app) as client:
            client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
            verify(client, Path(directory), "default")
            verify(client, Path(directory), "work")
    print("channel access and pairing receiver: passed for default and work profiles")
