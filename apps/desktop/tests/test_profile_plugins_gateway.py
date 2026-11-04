"""Send desktop plugin-management request shapes to the locked Dashboard."""
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def _production_shapes():
    env = dict(os.environ)
    env["CARGO_TARGET_DIR"] = str(PRODUCT / ".build" / "cargo-plugin-parity-check")
    command = [
        "cargo", "test", "--manifest-path",
        str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"), "--locked",
        "print_production_plugin_management_shapes", "--", "--ignored", "--nocapture",
    ]
    output = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace",
        check=True, env=env,
    ).stdout
    return [
        json.loads(line.split("PLUGIN_SHAPE=", 1)[1])
        for line in output.splitlines() if "PLUGIN_SHAPE=" in line
    ]


def test_plugin_hub_visibility_and_scan_override_shapes(tmp_path, monkeypatch, request):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    plugin = tmp_path / "plugins" / "desktop-fixture"
    dashboard = plugin / "dashboard"
    (dashboard / "dist").mkdir(parents=True)
    (plugin / "plugin.yaml").write_text(
        "name: desktop-fixture\nversion: 1.0.0\ndescription: Desktop fixture\n",
        encoding="utf-8",
    )
    (plugin / "__init__.py").write_text("def register(ctx):\n    return None\n", encoding="utf-8")
    (dashboard / "dist" / "index.js").write_text("// fixture\n", encoding="utf-8")
    (dashboard / "plugin_api.py").write_text(
        "from fastapi import APIRouter\n"
        "from fastapi import WebSocket\n"
        "router = APIRouter()\n"
        "@router.get('/echo')\n"
        "async def echo():\n"
        "    return {'ok': True, 'source': 'desktop-fixture'}\n"
        "@router.websocket('/events')\n"
        "async def events(ws: WebSocket):\n"
        "    await ws.accept()\n"
        "    message = await ws.receive()\n"
        "    if message.get('bytes') is not None:\n"
        "        await ws.send_bytes(message['bytes'])\n"
        "    else:\n"
        "        await ws.send_text('echo:' + message.get('text', ''))\n",
        encoding="utf-8",
    )
    (dashboard / "manifest.json").write_text(json.dumps({
        "name": "desktop-fixture",
        "label": "Desktop Fixture",
        "description": "Dashboard fixture",
        "version": "1.0.0",
        "icon": "puzzle",
        "tab": {"path": "/desktop-fixture"},
        "slots": ["statusbar"],
        "entry": "dist/index.js",
        "api": "plugin_api.py",
    }), encoding="utf-8")
    (tmp_path / "config.yaml").write_text(
        json.dumps({"plugins": {"enabled": ["desktop-fixture"]}}), encoding="utf-8",
    )

    from hermes_cli import plugins_cmd, web_server, web_server_dashboard
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    web_server._dashboard_plugins_cache = None
    request.addfinalizer(lambda: setattr(web_server, "_dashboard_plugins_cache", None))
    web_server_dashboard._invalidate_plugins_hub_cache()
    calls = []

    def fake_update(name, *, accept_capabilities=False, force=False):
        calls.append((name, accept_capabilities, force))
        return {"ok": True, "name": name}

    install_calls = []

    def fake_install(identifier, *, force, enable, catalog_name=None, ref=None, **_kwargs):
        install_calls.append((identifier, force, enable, catalog_name, ref))
        return {"ok": True, "plugin_name": "custom-fixture", "enabled": enable}

    monkeypatch.setattr(plugins_cmd, "dashboard_update_user_plugin", fake_update)
    monkeypatch.setattr(plugins_cmd, "dashboard_install_plugin", fake_install)
    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    shapes = _production_shapes()
    assert [shape["method"] for shape in shapes] == ["GET", "POST", "POST", "POST", "PUT"]

    hub = client.request(shapes[0]["method"], shapes[0]["path"])
    assert hub.status_code == 200, hub.text
    row = next(item for item in hub.json()["plugins"] if item["name"] == "desktop-fixture")
    assert row["runtime_status"] == "enabled"
    assert row["has_dashboard_manifest"] is True
    assert row["dashboard_manifest"]["tab"]["path"] == "/desktop-fixture"
    assert row["user_hidden"] is False

    manifests = client.get("/api/dashboard/plugins")
    assert manifests.status_code == 200, manifests.text
    manifest = next(item for item in manifests.json() if item["name"] == "desktop-fixture")
    assert manifest["entry"] == "dist/index.js"
    asset = client.get("/dashboard-plugins/desktop-fixture/dist/index.js")
    assert asset.status_code == 200 and asset.text.strip() == "// fixture"
    plugin_api = client.get("/api/plugins/desktop-fixture/echo")
    assert plugin_api.status_code == 200, plugin_api.text
    assert plugin_api.json() == {"ok": True, "source": "desktop-fixture"}
    with client.websocket_connect(
        f"/api/plugins/desktop-fixture/events?token={quote(_SESSION_TOKEN, safe='')}"
    ) as socket:
        socket.send_text("desktop")
        assert socket.receive_text() == "echo:desktop"
    with client.websocket_connect(
        f"/api/plugins/desktop-fixture/events?token={quote(_SESSION_TOKEN, safe='')}"
    ) as socket:
        socket.send_bytes(b"\x00desktop")
        assert socket.receive_bytes() == b"\x00desktop"

    visibility = client.request(
        shapes[1]["method"], shapes[1]["path"], json=shapes[1]["body"],
    )
    assert visibility.status_code == 200, visibility.text
    assert visibility.json() == {"ok": True, "name": "desktop-fixture", "hidden": True}
    config_text = (tmp_path / "config.yaml").read_text(encoding="utf-8")
    assert "hidden_plugins" in config_text and "desktop-fixture" in config_text

    updated = client.request(
        shapes[2]["method"], shapes[2]["path"], json=shapes[2]["body"],
    )
    assert updated.status_code == 200, updated.text
    assert calls == [("desktop-fixture", False, True)]

    installed = client.request(
        shapes[3]["method"], shapes[3]["path"], json=shapes[3]["body"],
    )
    assert installed.status_code == 200, installed.text
    assert installed.json()["plugin_name"] == "custom-fixture"
    assert install_calls == [("owner/repo/subdir", False, True, None, None)]

    context = client.request(
        shapes[4]["method"], shapes[4]["path"], json=shapes[4]["body"],
    )
    assert context.status_code == 200, context.text
    refreshed_hub = client.get("/api/dashboard/plugins/hub")
    assert refreshed_hub.status_code == 200, refreshed_hub.text
    assert refreshed_hub.json()["providers"]["context_engine"] == "desktop-context"
