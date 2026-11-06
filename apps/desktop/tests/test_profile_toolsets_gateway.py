"""Exercise the desktop Toolset route shapes against the locked Gateway."""
import json
import os
import subprocess
import sys
from pathlib import Path

PRODUCT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(PRODUCT / "upstream" / "hermes-agent"))


def test_toolset_config_provider_and_env(tmp_path, monkeypatch):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
    from starlette.testclient import TestClient

    printed = subprocess.run(
        ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
         "--locked", "print_production_toolset_shapes", "--", "--ignored", "--nocapture"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    )
    shapes = [json.loads(line.split("TOOLSET_SHAPE=", 1)[1]) for line in printed.stdout.splitlines()
              if "TOOLSET_SHAPE=" in line]
    assert [shape["operation"] for shape in shapes] == ["toolsets.config", "toolsets.provider", "toolsets.env"]

    client = TestClient(app, raise_server_exceptions=False)
    client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN
    config = client.request(shapes[0]["method"], shapes[0]["path"])
    assert config.status_code == 200, config.text
    providers = config.json()["providers"]
    provider = next(row for row in providers if row["env_vars"] and "search" in row.get("capabilities", [])
                    and row.get("web_backend") not in (None, "firecrawl"))

    provider_body = {**shapes[1]["body"], "provider": provider["name"]}
    selected = client.request(shapes[1]["method"], shapes[1]["path"], json=provider_body)
    assert selected.status_code == 200 and selected.json()["ok"] is True, selected.text
    refreshed = client.request(shapes[0]["method"], shapes[0]["path"])
    assert refreshed.status_code == 200 and refreshed.json()["active_search_backend"] == provider["web_backend"], refreshed.text

    env_key = provider["env_vars"][0]["key"]
    env_body = {**shapes[2]["body"], "env": {env_key: "isolated-test-value"}}
    saved = client.request(shapes[2]["method"], shapes[2]["path"], json=env_body)
    assert saved.status_code == 200 and env_key in saved.json()["saved"], saved.text
    assert saved.json()["is_set"][env_key] is True
    rejected = client.request(shapes[2]["method"], shapes[2]["path"], json=shapes[2]["body"])
    assert rejected.status_code == 400, rejected.text

    printed_toggles = subprocess.run(
        ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
         "--locked", "print_production_toolset_toggle_args", "--", "--ignored", "--nocapture"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    )
    toggles = [json.loads(line.split("TOOLSET_TOGGLE=", 1)[1]) for line in printed_toggles.stdout.splitlines()
               if "TOOLSET_TOGGLE=" in line]
    stt_toggles = [json.loads(line.split("TOOLSET_STT_TOGGLE=", 1)[1]) for line in printed_toggles.stdout.splitlines()
                   if "TOOLSET_STT_TOGGLE=" in line]
    assert [(row["profile"], row["enabled"]) for row in toggles] == [
        ("default", False), ("default", True), ("worker_beta", False), ("worker_beta", True)]
    assert [row["body"]["enabled"] for row in stt_toggles] == [False, True]
    hermes = PRODUCT / ".build" / "hermes-venv-i1" / "Scripts" / "hermes.exe"
    named_home = tmp_path / "profiles" / "worker_beta"
    named_home.mkdir(parents=True)
    (named_home / "config.yaml").write_text("{}\n", encoding="utf-8")
    for row in toggles:
        result = subprocess.run([str(hermes), *row["args"]],
                                env={**os.environ, "HERMES_HOME": str(tmp_path), "HERMES_DISABLE_LAZY_INSTALLS": "1"},
                                capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        assert result.returncode == 0, result.stderr[-1200:]
        scope = {} if row["profile"] == "default" else {"profile": row["profile"]}
        listed = client.get("/api/tools/toolsets", params=scope)
        assert listed.status_code == 200, listed.text
        web = next(item for item in listed.json() if item["name"] == "web")
        assert web["enabled"] is row["enabled"]

    for row in stt_toggles:
        changed = client.request(row["method"], row["path"], json=row["body"])
        assert changed.status_code == 200, changed.text
        listed = client.get("/api/tools/toolsets")
        stt = next(item for item in listed.json() if item["name"] == "stt")
        assert stt["enabled"] is row["body"]["enabled"]

    setup_shape = subprocess.run(
        ["cargo", "test", "--manifest-path", str(PRODUCT / "apps/desktop/src-tauri/Cargo.toml"),
         "--locked", "print_production_toolset_setup_args", "--", "--ignored", "--nocapture"],
        capture_output=True, text=True, encoding="utf-8", errors="replace", check=True,
    )
    setup_args = [json.loads(line.split("TOOLSET_SETUP=", 1)[1])["args"] for line in setup_shape.stdout.splitlines()
                  if "TOOLSET_SETUP=" in line]
    assert len(setup_args) == 1
    config = client.get("/api/tools/toolsets/web/config", params={"profile": "worker_beta"})
    assert config.status_code == 200, config.text
    assert any(provider["post_setup"] == "ddgs" for provider in config.json()["providers"])
    invalid_setup = subprocess.run([str(hermes), *setup_args[0]],
                                   env={**os.environ, "HERMES_HOME": str(tmp_path), "HERMES_DISABLE_LAZY_INSTALLS": "1"},
                                   capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
    assert invalid_setup.returncode == 2
