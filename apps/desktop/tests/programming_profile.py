"""Integration checks against the pinned Hermes resolver, with synthetic Profile files."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT / "apps/desktop/runtime/programming_profile.py"

class ProfileImport(unittest.TestCase):
    def run_profile(self, config, env_text="", request=None, models=None):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            (home / "config.yaml").write_text(config, encoding="utf-8")
            (home / ".env").write_text(env_text, encoding="utf-8")
            env = {key:value for key,value in os.environ.items() if key in {"PATH","SystemRoot","SystemDrive","WINDIR","TEMP","TMP","HOME","USERPROFILE"}}
            env.update(HERMES_HOME=str(home), CODEX_HOME=str(home / "isolated-codex"), CODEX_SQLITE_HOME=str(home / "isolated-codex"), PYTHONPATH=str(ROOT / "upstream/hermes-agent"), PYTHONUTF8="1")
            if request is not None:
                models_path = home / "model-candidates.json"
                models_path.write_text(json.dumps(models or {}), encoding="utf-8")
                env["HERMESS_PROFILE_IMPORT_REQUEST"] = json.dumps({**request, "models_file":str(models_path)})
            result = subprocess.run([sys.executable, str(HELPER)], env=env, capture_output=True, timeout=30, creationflags=0x08000000 if os.name=="nt" else 0)
            return result

    def test_named_static_provider_uses_profile_env(self):
        result=self.run_profile("model:\n  default: fixture-model\n  provider: custom:fixture\nproviders:\n  fixture:\n    base_url: https://fixture.invalid/v1\n    key_env: FIXTURE_KEY\n", "FIXTURE_KEY=PROFILE_IMPORT_FIXTURE\n")
        self.assertEqual(result.returncode,0, "synthetic static Profile resolution failed")
        self.assertEqual(json.loads(result.stdout),dict(base_url="https://fixture.invalid/v1",model="fixture-model",api_key="PROFILE_IMPORT_FIXTURE"))

    def test_legacy_static_provider(self):
        result=self.run_profile("model:\n  default: fixture-model\n  provider: custom:fixture\ncustom_providers:\n  - name: fixture\n    base_url: https://legacy.invalid/v1\n    api_key: LEGACY_IMPORT_FIXTURE\n")
        self.assertEqual(result.returncode,0,"synthetic legacy Profile resolution failed")
        self.assertEqual(json.loads(result.stdout)["base_url"],"https://legacy.invalid/v1")

    def test_provider_selection_copies_entire_non_main_provider(self):
        config = """model:
  default: main-model
  provider: custom:main
providers:
  main:
    name: Main fixture
    base_url: https://main.invalid/v1
    api_key: MAIN_FIXTURE_KEY
    default_model: main-model
  secondary:
    name: Secondary fixture
    base_url: https://secondary.invalid/v1
    key_env: SECONDARY_KEY
    default_model: secondary-one
    models:
      secondary-one: {}
      secondary-two: {}
"""
        models={"secondary":["secondary-one","secondary-two","secondary-three"]}
        listing=self.run_profile(config, "SECONDARY_KEY=SECONDARY_FIXTURE_KEY\n", {"provider":None}, models)
        self.assertEqual(listing.returncode,0,"provider list failed")
        listed=json.loads(listing.stdout)
        self.assertEqual([p["id"] for p in listed],["custom:main","custom:secondary"])
        self.assertNotIn(b"MAIN_FIXTURE_KEY",listing.stdout)
        self.assertNotIn(b"SECONDARY_FIXTURE_KEY",listing.stdout)
        imported=self.run_profile(config,"SECONDARY_KEY=SECONDARY_FIXTURE_KEY\n", {"provider":"custom:secondary"}, models)
        self.assertEqual(imported.returncode,0,"selected provider import failed")
        value=json.loads(imported.stdout)
        self.assertEqual(value["name"],"Secondary fixture")
        self.assertEqual(value["base_url"],"https://secondary.invalid/v1")
        self.assertEqual(value["api_key"],"SECONDARY_FIXTURE_KEY")
        self.assertEqual(value["models"],models["secondary"])
        self.assertNotIn(b"MAIN_FIXTURE_KEY",imported.stdout)
        unknown=self.run_profile(config,request={"provider":"custom:does-not-exist"})
        self.assertNotEqual(unknown.returncode,0)
        self.assertEqual(unknown.stdout,b"")

    def test_reject_oauth_and_command_credentials_without_stdout(self):
        for config in ["model:\n  default: fixture-model\n  provider: openai-codex\n", "model:\n  default: fixture-model\n  provider: custom:fixture\nproviders:\n  fixture:\n    base_url: https://fixture.invalid/v1\n    key_cmd: echo PRIVATE_COMMAND_FIXTURE\n", "model:\n  default: fixture-model\n  provider: custom:fixture\nproviders:\n  fixture:\n    base_url: https://fixture.invalid/v1\n    extra_headers:\n      X-Key: EXTRA_HEADER_FIXTURE\n"]:
            result=self.run_profile(config)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(result.stdout,b"")
            self.assertNotIn(b"PRIVATE_COMMAND_FIXTURE",result.stderr)
            self.assertNotIn(b"EXTRA_HEADER_FIXTURE",result.stderr)

if __name__ == "__main__":
    unittest.main()
