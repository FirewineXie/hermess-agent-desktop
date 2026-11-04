"""Verify the desktop debug-share request against the pinned Dashboard route without uploading."""
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_production_debug_share_shape(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    (tmp_path / "config.yaml").write_text("{}\n", encoding="utf-8")
    from hermes_cli import debug
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    captured = {}

    def fake_share(*, log_lines, redact):
        captured.update(log_lines=log_lines, redact=redact)
        return SimpleNamespace(
            urls={"report": "https://paste.example/report"}, failures={},
            redacted=redact, auto_delete_seconds=21600,
        )

    monkeypatch.setattr(debug, "build_debug_share", fake_share)
    result = subprocess.run(
        ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
         "--locked", "print_production_debug_share_shape", "--", "--ignored", "--nocapture"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    )
    shapes = [json.loads(line.split("DEBUG_SHARE_SHAPE=", 1)[1]) for line in result.stdout.splitlines()
              if "DEBUG_SHARE_SHAPE=" in line]
    assert len(shapes) == 1
    shape = shapes[0]
    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    response = client.request(shape["method"], shape["path"], json=shape["body"])
    assert response.status_code == 200, response.text
    assert captured == {"log_lines": 200, "redact": True}
    assert response.json() == {
        "ok": True, "urls": {"report": "https://paste.example/report"}, "failures": {},
        "redacted": True, "auto_delete_seconds": 21600,
    }
