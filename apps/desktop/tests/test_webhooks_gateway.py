"""Verify production Rust webhook requests against the locked Dashboard receiver."""
import asyncio
import hashlib
import hmac
import json
import subprocess
import sys
from pathlib import Path


PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_webhook_shapes_are_accepted_and_rejected(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from starlette.testclient import TestClient
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN

    command = [
        "cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
        "--locked", "print_production_webhook_request_shapes", "--", "--ignored", "--nocapture",
    ]
    output = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    shapes = [json.loads(line.split("WEBHOOK_SHAPE=", 1)[1]) for line in output.splitlines() if "WEBHOOK_SHAPE=" in line]
    assert [item["operation"] for item in shapes] == [
        "webhooks.list", "webhooks.create", "webhooks.toggle", "webhooks.delete",
    ]

    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

    def send(shape):
        return client.request(shape["method"], shape["path"], json=shape["body"])

    assert send(shapes[0]).status_code == 200
    rejected = send(shapes[1])
    assert rejected.status_code == 400
    assert send(shapes[0]).json()["subscriptions"] == []

    enable_command = [
        "cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
        "--locked", "print_production_webhook_enable_shape", "--", "--ignored", "--nocapture",
    ]
    enable_output = subprocess.run(enable_command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True).stdout
    enable_shapes = [json.loads(line.split("WEBHOOK_ENABLE_SHAPE=", 1)[1]) for line in enable_output.splitlines() if "WEBHOOK_ENABLE_SHAPE=" in line]
    assert len(enable_shapes) == 1
    assert send(enable_shapes[0]).status_code == 200
    assert send(shapes[0]).json()["enabled"] is True

    created = send(shapes[1])
    assert created.status_code == 200, created.text
    assert created.json()["name"] == "native-shape-test"
    assert created.json()["secret"]
    listed = send(shapes[0])
    assert listed.status_code == 200
    assert listed.json()["subscriptions"][0]["secret_set"] is True
    assert "secret" not in listed.json()["subscriptions"][0]

    toggled = send(shapes[2])
    assert toggled.status_code == 200, toggled.text
    assert toggled.json()["enabled"] is False
    assert send(shapes[0]).json()["subscriptions"][0]["enabled"] is False

    enabled_shape = dict(shapes[2], body={"enabled": True})
    assert send(enabled_shape).status_code == 200

    async def verify_ingress_survives_restart():
        from aiohttp import web
        from aiohttp.test_utils import TestClient as AioHttpClient, TestServer
        from gateway.config import PlatformConfig
        from gateway.platforms.webhook import WebhookAdapter
        from tests.gateway.fixtures.webhook_route_authority import mount_authority

        body = json.dumps({"action": "created", "id": 17}).encode()
        signature = "sha256=" + hmac.new(
            created.json()["secret"].encode(), body, hashlib.sha256,
        ).hexdigest()

        async def exercise(adapter, delivery_id):
            adapter._reload_dynamic_routes()
            assert "native-shape-test" in adapter._routes
            app = web.Application()
            mount_authority(app, adapter)
            app.router.add_post("/webhooks/{route_name}", adapter._handle_webhook)
            async with AioHttpClient(TestServer(app)) as ingress:
                common_headers = {"X-GitHub-Delivery": delivery_id, "X-GitHub-Event": "push"}
                rejected = await ingress.post(
                    "/webhooks/native-shape-test", data=body,
                    headers={**common_headers, "X-Hub-Signature-256": "sha256=invalid"},
                )
                assert rejected.status == 401
                accepted = await ingress.post(
                    "/webhooks/native-shape-test", data=body,
                    headers={**common_headers, "X-Hub-Signature-256": signature},
                )
                assert accepted.status == 202
                assert await accepted.json() == {
                    "status": "accepted", "route": "native-shape-test",
                    "event": "push", "delivery_id": delivery_id,
                }

        config = PlatformConfig(enabled=True, extra={"host": "127.0.0.1", "port": 0, "routes": {}})
        await exercise(WebhookAdapter(config), "desktop-before-restart")
        await exercise(WebhookAdapter(config), "desktop-after-restart")

    asyncio.run(verify_ingress_survives_restart())

    deleted = send(shapes[3])
    assert deleted.status_code == 200, deleted.text
    assert send(shapes[0]).json()["subscriptions"] == []
    assert send(shapes[3]).status_code == 404
