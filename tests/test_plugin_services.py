"""Exercise the embedded service bridge with isolated profiles and CLI fixtures."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / "apps/desktop/runtime/plugin_services.py"
UPSTREAM = ROOT / "upstream/hermes-agent"


def invoke(home: Path, action: str, profile="default", service="openviking.quick-local"):
    env = {**os.environ, "HERMES_HOME": str(home), "PYTHONPATH": str(UPSTREAM),
           "HERMES_DISABLE_LAZY_INSTALLS": "1"}
    return subprocess.run(
        [sys.executable, str(BRIDGE), str(home), action, profile, service],
        env=env, cwd=home, capture_output=True, text=True, encoding="utf-8", timeout=15,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )


class PluginServicesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="hermess-plugin-services-")
        self.addCleanup(self.temporary.cleanup)
        self.home = Path(self.temporary.name) / "产品 空格" / "hermes-home"
        self.home.mkdir(parents=True)
        (self.home / "config.yaml").write_text("memory:\n  provider: other\n", encoding="utf-8")
        (self.home / "active_profile").write_text("work", encoding="utf-8")
        self.work = self.home / "profiles/work"
        self.work.mkdir(parents=True)
        (self.work / "config.yaml").write_text("{}", encoding="utf-8")
        self.install(self.home)
        self.install(self.work)

    def install(self, home):
        plugin = home / "plugins/openviking"
        plugin.mkdir(parents=True)
        (plugin / "__init__.py").write_text("raise RuntimeError('provider must not load')", encoding="utf-8")
        (plugin / "cli.py").write_text('''from pathlib import Path
from hermes_constants import get_hermes_home
def run(args):
    home = Path(get_hermes_home())
    marker = home / "openviking/ov.conf"
    if args.action == "stop":
        marker.write_text("stopped", encoding="utf-8")
        print("Quick Local stopped.")
    else:
        state = marker.read_text(encoding="utf-8")
        print(f"Quick Local: {state} at http://127.0.0.1:1934")
def register_cli(parser):
    sub = parser.add_subparsers(dest="command", required=True)
    local = sub.add_parser("local")
    local.add_argument("action", choices=["status", "stop"])
    local.set_defaults(func=run)
''', encoding="utf-8")
        (home / "openviking").mkdir()
        (home / "openviking/ov.conf").write_text("ready", encoding="utf-8")

    def reply(self, action, profile="default"):
        process = invoke(self.home, action, profile)
        self.assertEqual(process.returncode, 0, process.stdout)
        return json.loads(process.stdout)

    def test_enumerates_all_live_profiles_and_ignores_ghost_directories(self):
        (self.home / "profiles/ghost/openviking").mkdir(parents=True)
        (self.home / "profiles/ghost/openviking/ov.conf").write_text("ready")
        self.assertEqual(self.reply("inventory")["targets"], [
            {"profile": "default", "service": "openviking.quick-local"},
            {"profile": "work", "service": "openviking.quick-local"},
        ])

    def test_exact_default_binding_ignores_sticky_profile_and_provider_selection(self):
        self.assertEqual(self.reply("status")["state"], "ready")
        self.reply("stop")
        self.assertEqual(self.reply("status")["state"], "stopped")
        self.assertEqual(self.reply("status", "work")["state"], "ready")

    def test_unknown_output_missing_cli_and_invalid_profile_fail_closed(self):
        (self.home / "openviking/ov.conf").write_text("unexpected")
        result = invoke(self.home, "status")
        self.assertEqual(json.loads(result.stdout)["error"], "unrecognized_status")
        (self.work / "plugins/openviking/cli.py").unlink()
        result = invoke(self.home, "status", "work")
        self.assertEqual(json.loads(result.stdout)["error"], "command_unavailable")
        self.assertNotEqual(invoke(self.home, "status", "../outside").returncode, 0)
        self.assertNotEqual(invoke(self.home, "stop", service="unknown").returncode, 0)

    def test_plugin_failure_does_not_disclose_exception_contents(self):
        cli = self.home / "plugins/openviking/cli.py"
        cli.write_text("raise RuntimeError('test-secret-must-not-leak')", encoding="utf-8")
        result = invoke(self.home, "status")
        self.assertEqual(json.loads(result.stdout)["error"], "control_exception")
        self.assertNotIn("test-secret", result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
