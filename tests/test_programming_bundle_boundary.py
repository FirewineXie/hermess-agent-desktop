"""Validate the production bundle entrypoint without building an installer or real binaries."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


PRODUCT = Path(__file__).resolve().parents[1]
SCRIPT = PRODUCT / "scripts" / "build-offline-runtime.py"
spec = importlib.util.spec_from_file_location("offline_bundle", SCRIPT)
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class ProgrammingBundleBoundary(unittest.TestCase):
    def test_python_adapter_sources_and_regular_runtime_tools_are_allowed(self):
        with tempfile.TemporaryDirectory(prefix="coding-bundle-test-", dir=PRODUCT / ".build") as directory:
            payload = Path(directory)
            for relative in ("bin/hermes.exe", "tools/python/python.exe", "tools/uv/uv", "agent/codex_app_server.py"):
                path = payload / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"synthetic test file")
            bundle.verify_optional_runtime_excluded(payload, PRODUCT)

    def test_downloaded_binaries_and_all_locked_platform_archives_are_rejected(self):
        lock = json.loads((PRODUCT / "runtime" / "codex.lock.json").read_text(encoding="utf-8"))
        names = ["codex", "CODEX.EXE", "codex-app-server", "codex-app-server.exe"]
        names.extend(asset["name"] for asset in lock["assets"].values())
        with tempfile.TemporaryDirectory(prefix="coding-bundle-test-", dir=PRODUCT / ".build") as directory:
            payload = Path(directory)
            nested = payload / "tools" / "optional"
            nested.mkdir(parents=True)
            for name in names:
                with self.subTest(name=name):
                    candidate = nested / name
                    candidate.write_bytes(b"synthetic optional runtime")
                    with self.assertRaisesRegex(RuntimeError, "programming runtime must not be bundled"):
                        bundle.verify_optional_runtime_excluded(payload, PRODUCT)
                    candidate.unlink()

    def test_production_entrypoint_rejects_before_archiving_or_running_build_tools(self):
        with tempfile.TemporaryDirectory(prefix="coding-bundle-test-", dir=PRODUCT / ".build") as directory:
            payload = Path(directory)
            (payload / "codex.exe").write_bytes(b"synthetic optional runtime")
            # No manifest exists: a successful exclusion check must run before
            # manifest loading, upstream imports, archive creation or Tauri.
            result = subprocess.run([sys.executable, str(SCRIPT), "--payload", str(payload)],
                                    capture_output=True, text=True, encoding="utf-8")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("programming runtime must not be bundled: codex.exe", result.stderr)
            self.assertNotIn("manifest.json", result.stderr)


if __name__ == "__main__":
    unittest.main()
