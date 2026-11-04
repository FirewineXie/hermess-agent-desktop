"""Verify the desktop's production Hermes Console websocket shape against the locked Gateway."""
import json
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_console_shape_and_protocol(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli import web_server
    from hermes_cli.profiles import get_profile_dir
    from starlette.testclient import TestClient

    writer_home = get_profile_dir("writer")
    writer_home.mkdir(parents=True, exist_ok=True)
    # Locked Hermes only treats a named profile directory as live when it owns
    # an identity marker; a bare directory is deliberately rejected as a ghost.
    (writer_home / "config.yaml").write_text("model: {}\n", encoding="utf-8")
    monkeypatch.setattr(web_server, "_DASHBOARD_EMBEDDED_CHAT_ENABLED", True)
    previous_auth_required = getattr(web_server.app.state, "auth_required", None)
    previous_bound_host = getattr(web_server.app.state, "bound_host", None)
    web_server.app.state.auth_required = False
    web_server.app.state.bound_host = None

    command = [
        "cargo", "test", "--manifest-path",
        str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"), "--locked",
        "print_production_console_request_shape", "--", "--ignored", "--nocapture",
    ]
    output = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    ).stdout
    line = next(item for item in output.splitlines() if "CONSOLE_SHAPE=" in item)
    shape = json.loads(line.split("CONSOLE_SHAPE=", 1)[1])
    parsed = urlsplit(shape["uri"].replace("PRODUCTION_TOKEN", web_server._SESSION_TOKEN))
    path = urlunsplit(("", "", parsed.path, parsed.query, ""))

    client = TestClient(web_server.app)
    try:
        with client.websocket_connect(path) as console:
            ready = console.receive_json()
            assert ready["type"] == "ready", ready
            assert ready["profile"] == "writer"
            assert ready["prompt"] == "hermes> "
            console.send_json({"type": "ping"})
            pong = console.receive_json()
            assert pong["type"] == "pong"
            assert pong["prompt"] == "hermes> "
    finally:
        client.close()
        if previous_auth_required is None:
            if hasattr(web_server.app.state, "auth_required"):
                delattr(web_server.app.state, "auth_required")
        else:
            web_server.app.state.auth_required = previous_auth_required
        if previous_bound_host is None:
            if hasattr(web_server.app.state, "bound_host"):
                delattr(web_server.app.state, "bound_host")
        else:
            web_server.app.state.bound_host = previous_bound_host
