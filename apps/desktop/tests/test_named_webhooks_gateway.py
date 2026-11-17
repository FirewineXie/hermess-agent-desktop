"""Exercise a product-created named subscription against the locked Webhook receiver."""
import asyncio
import hashlib
import hmac
import json
import subprocess
import sys
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock


PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_named_subscription_reaches_locked_receiver(tmp_path, monkeypatch):
    output = subprocess.run([
        "cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
        "--locked", "print_production_named_webhook_record", "--", "--ignored", "--nocapture",
    ], capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    record = next(json.loads(line.split("NAMED_WEBHOOK_RECORD=", 1)[1])
                  for line in output.splitlines() if "NAMED_WEBHOOK_RECORD=" in line)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "profiles" / "research").mkdir(parents=True)
    (tmp_path / "webhook_subscriptions.json").write_text(
        json.dumps(record["stored"]), encoding="utf-8")

    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
    from gateway.config import PlatformConfig
    from gateway.platforms.webhook import WebhookAdapter

    adapter = WebhookAdapter(PlatformConfig(enabled=True, extra={"host": "127.0.0.1", "port": 0}))
    runner = MagicMock()
    runner.config.multiplex_profiles = True
    adapter.gateway_runner = runner
    monkeypatch.setattr("hermes_cli.profiles.profiles_to_serve",
                        lambda multiplex: [("default", tmp_path), ("research", tmp_path / "profiles" / "research")])

    async def exercise():
        app = web.Application()
        app.router.add_post("/webhooks/{route_name}", adapter._handle_webhook)
        app.router.add_post("/p/{profile}/webhooks/{route_name}", adapter._handle_webhook)
        body = b'{"event_type":"pull_request"}'
        secret = record["created"]["secret"].encode()
        signature = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
        async with TestClient(TestServer(app)) as client:
            url = "/p/research/webhooks/profile-event"
            assert (await client.post(url, data=body, headers={"X-Hub-Signature-256": "sha256=invalid"})).status == 401
            accepted = await client.post(url, data=body, headers={"X-Hub-Signature-256": signature})
            assert accepted.status == 200, await accepted.text()
            assert (await accepted.json())["status"] == "ignored"
            assert (await client.post("/webhooks/profile-event", data=body,
                                      headers={"X-Hub-Signature-256": signature})).status == 404
    asyncio.run(exercise())


if __name__ == "__main__":
    from unittest.mock import patch

    class PatchScope:
        def __init__(self):
            self.patches = []

        def setenv(self, key, value):
            self.patches.append(patch.dict("os.environ", {key: value}))
            self.patches[-1].start()

        def setattr(self, target, value):
            self.patches.append(patch(target, value))
            self.patches[-1].start()

        def undo(self):
            for active in reversed(self.patches):
                active.stop()

    with TemporaryDirectory() as temporary:
        scope = PatchScope()
        try:
            test_named_subscription_reaches_locked_receiver(Path(temporary), scope)
        finally:
            scope.undo()
