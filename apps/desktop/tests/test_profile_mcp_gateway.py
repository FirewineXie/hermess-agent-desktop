"""Check the Profile MCP create body against the pinned Dashboard router."""
import asyncio
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_stdio_environment_is_saved_in_selected_profile_and_redacted(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    from hermes_cli.web_routers.mcp import router

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    created = client.post("/api/mcp/servers?profile=default", json={
        "name": "desktop-env-test", "command": "python", "args": ["-m", "example"],
        "env": {"DESKTOP_TEST_KEY": "isolated-secret"},
    })
    assert created.status_code == 200, created.text
    assert created.json()["transport"] == "stdio"
    assert created.json()["env"]["DESKTOP_TEST_KEY"] != "isolated-secret"

    listed = client.get("/api/mcp/servers?profile=default")
    assert listed.status_code == 200, listed.text
    server = next(item for item in listed.json()["servers"] if item["name"] == "desktop-env-test")
    assert server["env"]["DESKTOP_TEST_KEY"] != "isolated-secret"
    assert "isolated-secret" not in listed.text

    refused = client.post("/api/mcp/servers?profile=default", json={
        "name": "desktop-http-reject", "url": "https://example.com/mcp",
        "env": {"DESKTOP_TEST_KEY": "should-not-save"},
    })
    assert refused.status_code == 400, refused.text
    assert all(item["name"] != "desktop-http-reject" for item in client.get(
        "/api/mcp/servers?profile=default").json()["servers"])


def test_oauth_cancel_uses_locked_delete_route_without_exposing_authorization_url(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    from hermes_cli.web_routers.mcp import router
    from hermes_cli.web_server import _SESSION_HEADER_NAME, _SESSION_TOKEN
    from hermes_cli.web_server_mcp import _mcp_oauth_flows
    from tools.mcp_dashboard_oauth import DashboardOAuthFlow

    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    flow = DashboardOAuthFlow(
        flow_id="desktop-cancel-flow",
        server_name="desktop-oauth-test",
        profile="default",
        hermes_home=str(tmp_path),
        redirect_uri="http://127.0.0.1/callback",
    )
    asyncio.run(flow.publish_authorization_url(
        "https://identity.example/authorize?state=desktop-state&client_secret=must-not-leak"))
    _mcp_oauth_flows[flow.flow_id] = flow

    try:
        response = client.delete("/api/mcp/oauth/flows/desktop-cancel-flow")
        assert response.status_code == 200, response.text
        assert response.json() == {"ok": True, "status": "error"}
        assert "identity.example" not in response.text
        assert "must-not-leak" not in response.text
        assert flow.snapshot()["status"] == "error"

        expired = client.delete("/api/mcp/oauth/flows/missing-flow")
        assert expired.status_code == 200, expired.text
        assert expired.json() == {"ok": True, "status": "expired"}
    finally:
        _mcp_oauth_flows.pop(flow.flow_id, None)
