"""Verify the desktop plugin auxiliary assignment shape against the locked Gateway."""

import json
import subprocess
import sys
from contextlib import closing
from pathlib import Path


PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def _write_plugin(home: Path) -> None:
    plugin = home / "plugins" / "desktop-probe"
    plugin.mkdir(parents=True)
    (plugin / "plugin.yaml").write_text(json.dumps({
        "name": "desktop-probe", "version": "0.1.0", "description": "Desktop probe",
    }), encoding="utf-8")
    (plugin / "__init__.py").write_text(
        "def register(ctx):\n"
        "    ctx.register_auxiliary_task('desktop_probe_task', "
        "display_name='Desktop probe task', description='Dynamic desktop probe', "
        "inherit_from='review')\n",
        encoding="utf-8",
    )


def test_production_plugin_auxiliary_assignment_shape(tmp_path, monkeypatch):
    home = tmp_path / ".hermes"
    _write_plugin(home)
    (home / "config.yaml").write_text(json.dumps({
        "plugins": {"enabled": ["desktop-probe"]},
    }), encoding="utf-8")
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("HERMES_HOME", str(home))

    import hermes_cli.plugins as plugins_mod
    from hermes_cli.plugins import PluginManager
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    monkeypatch.setattr(plugins_mod, "get_bundled_plugins_dir", lambda: tmp_path / "empty-bundled")
    monkeypatch.setattr(PluginManager, "_scan_entry_points", lambda self: [])
    plugins_mod._reset_plugin_managers_for_tests()

    command = [
        "cargo", "test", "--manifest-path",
        str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"), "--locked",
        "print_production_auxiliary_assignment_request_shape", "--", "--ignored", "--nocapture",
    ]
    output = subprocess.run(
        command, capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    ).stdout
    shapes = [json.loads(line.split("AUX_ASSIGNMENT_SHAPE=", 1)[1])
              for line in output.splitlines() if "AUX_ASSIGNMENT_SHAPE=" in line]
    assert len(shapes) == 1
    shape = shapes[0]

    try:
        with closing(TestClient(app, raise_server_exceptions=False)) as client:
            client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
            before = client.get(shape["read_path"])
            assert before.status_code == 200, before.text
            plugin_row = next(row for row in before.json()["tasks"]
                              if row["task"] == "desktop_probe_task")
            assert plugin_row["label"] == "Desktop probe task"
            assert plugin_row["hint"] == "Dynamic desktop probe"
            assert plugin_row["plugin"] == "desktop-probe"
            assert plugin_row["inherit_from"] == "review"

            saved = client.request(shape["method"], shape["path"], json=shape["body"])
            assert saved.status_code == 200, saved.text
            assert saved.json()["ok"] is True
            readback = client.get(shape["read_path"])
            assert readback.status_code == 200, readback.text
            row = next(row for row in readback.json()["tasks"]
                       if row["task"] == "desktop_probe_task")
            assert row["provider"] == "openrouter"
            assert row["model"] == "vendor/probe-model"
            assert row["reasoning_effort"] == "low"

            rejected = client.request(shape["method"], shape["path"], json={
                **shape["body"], "task": "not_registered",
            })
            assert rejected.status_code == 400
    finally:
        plugins_mod._reset_plugin_managers_for_tests()
