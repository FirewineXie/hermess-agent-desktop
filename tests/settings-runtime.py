"""Exercise locked runtime settings routes using temporary, product-owned homes.

Run with the prepared Hermes Python; no model, network server or user data required.
"""
import os
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch


def main():
    root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(root / "upstream/hermes-agent"))
    with tempfile.TemporaryDirectory(prefix="settings-check-", dir=root / ".build") as temp:
        home = Path(temp)
        os.environ["HERMES_HOME"] = str(home)
        os.environ["HERMES_DASHBOARD_SESSION_TOKEN"] = "settings-test-only"
        worker = home / "profiles" / "worker"
        worker.mkdir(parents=True)
        for folder in (home, worker):
            (folder / "config.yaml").write_text("{}\n", encoding="utf-8")
            (folder / ".env").write_text("", encoding="utf-8")

        from starlette.testclient import TestClient
        from hermes_cli import profiles
        from hermes_cli.web_server import app, _SESSION_HEADER_NAME, _SESSION_TOKEN
        import hermes_yaml as yaml

        with patch.object(profiles, "_get_default_hermes_home", return_value=home), \
                patch.object(profiles, "_get_profiles_root", return_value=home / "profiles"):
            client = TestClient(app)
            client.headers[_SESSION_HEADER_NAME] = _SESSION_TOKEN

            def request(method, path, **kwargs):
                response = getattr(client, method)(path, **kwargs)
                assert response.status_code == 200, (path, response.status_code)
                return response.json()

            # Real schema discovers the new pages' fields, rather than a UI fixture.
            fields = request("get", "/api/config/schema?profile=worker")["fields"]
            required = (
                "command_allowlist", "approvals.mode", "checkpoints.enabled",
                "agent.max_turns", "terminal.timeout", "tool_output.max_bytes", "display.language")
            assert all(key in fields for key in required), [key for key in required if key not in fields]
            defaults = request("get", "/api/config/defaults")
            assert isinstance(defaults, dict)

            # List replacement and normal field writes stay in the target Profile.
            request("put", "/api/config?profile=worker", json={"config": {
                "command_allowlist": ["echo settings-test"], "agent": {"max_turns": 37}}})
            request("put", "/api/config?profile=worker", json={"config": {"command_allowlist": []}})
            actual = request("get", "/api/config?profile=worker")
            assert actual["agent"]["max_turns"] == 37
            assert actual["command_allowlist"] == []
            assert yaml.safe_load((home / "config.yaml").read_text(encoding="utf-8")) == {}

            # Same nested PUT and readback used by the desktop's saveField route.
            request("put", "/api/config?profile=worker", json={"config": {"display": {"language": "zh"}}})
            assert request("get", "/api/config?profile=worker")["display"]["language"] == "zh"
            assert yaml.safe_load((worker / "config.yaml").read_text(encoding="utf-8"))["display"]["language"] == "zh"

            # Full YAML replacement must actually delete omitted keys/sections.
            for document in (
                "agent:\n  max_turns: 38\n  reasoning_overrides:\n    removed: 1\n    keep: 2\nunknown_section:\n  keep: yes\n",
                "agent:\n  max_turns: 39\n  reasoning_overrides:\n    keep: 2\n",
            ):
                request("put", "/api/config/raw?profile=worker", json={"yaml_text": document})
            raw = request("get", "/api/config/raw?profile=worker")
            saved = yaml.safe_load(raw["yaml"])
            assert saved["agent"]["reasoning_overrides"] == {"keep": 2}
            assert "unknown_section" not in saved
            assert Path(raw["path"]) == worker / "config.yaml"

            # An explicit rejection records a decision without enabling transmission.
            request("put", "/api/shared-metrics/consent?profile=worker", json={"enabled": False, "send": False})
            consent = request("get", "/api/shared-metrics/consent?profile=worker")
            assert consent["decided"] and not consent["enabled"] and not consent["send"]
            assert not request("get", "/api/shared-metrics/consent")["decided"]

            checkpoint = worker / "checkpoints" / "settings-test-session"
            checkpoint.mkdir(parents=True)
            (checkpoint / "test.bin").write_bytes(b"settings")
            inventory = request("get", "/api/ops/checkpoints?profile=worker")
            assert inventory == {"sessions": [{"session": "settings-test-session", "files": 1, "bytes": 8}], "total_bytes": 8}
            assert request("get", "/api/ops/checkpoints")["sessions"] == []
            print("PASS: schema, Profile field/list isolation, language write/readback, full replacement, consent, checkpoint inventory")


if __name__ == "__main__":
    main()
