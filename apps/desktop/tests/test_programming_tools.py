"""Real locked PM discovery against synthetic stores; no tool downloads or execution."""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "upstream/hermes-agent"))
spec = importlib.util.spec_from_file_location("worker", REPO / "apps/desktop/runtime/programming_worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

from pm.lock import Facts, Lockfile
from pm.paths import lockfile_path
from pm.registry import get_package
from pm.store import current_target


class ProductToolsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.product = self.root / "product"
        self.payload = self.root / "payload/tools"
        self.personal = self.root / "personal/tools"
        self.session = self.root / "session"
        self.session.mkdir()
        self.env = patch.dict(os.environ, {
            "HERMES_HOME": str(self.session), "HOME": str(self.session),
            "USERPROFILE": str(self.session), "PATH": str(self.root / "system"),
            "HERMES_RUNTIME_DIR": str(self.personal), "PYTHONPATH": "IMPORT_PATH_MUST_STAY",
            "VIRTUAL_ENV": "VENV_MUST_STAY", "TEST_SECRET_KEY": "SECRET_MUST_STAY",
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def record(self, root, name, *, version=None):
        lock = Lockfile(lockfile_path())
        target = current_target()
        package = get_package(name)
        entry = root / package.store_entry(lock.version(name), target)
        entry.mkdir(parents=True, exist_ok=True)
        binary = package.binary(entry, target)
        if binary is not None:
            binary.parent.mkdir(parents=True, exist_ok=True)
            binary.write_bytes(b"synthetic executable, never run")
        Facts(root / "facts.json").record(name, version or lock.version(name), entry.name,
            {"PATH": [str(entry)]}, root, target=target,
            artifacts=[item["sha256"] for item in lock.artifacts(name, target)])
        return str(entry)

    def test_product_precedence_payload_fallback_and_no_personal_store(self):
        personal = self.record(self.personal, "node")
        payload = self.record(self.payload, "node")
        product = self.record(self.product, "node")
        before = dict(os.environ)
        count = worker.prepare_pm_tools([str(self.product), str(self.payload)])
        paths = os.environ["PATH"].split(os.pathsep)
        self.assertEqual(paths[:2], [product, payload])
        self.assertNotIn(personal, paths)
        self.assertEqual(count, 2)
        self.assertEqual({k: v for k, v in os.environ.items() if k != "PATH"},
                         {k: v for k, v in before.items() if k != "PATH"})
        self.assertFalse((self.session / "tools").exists())

    def test_missing_outdated_and_incomplete_dependency_chain_are_excluded(self):
        self.record(self.personal, "node")
        self.record(self.product, "node", version="0.0.0")
        self.record(self.product, "npm")
        before = os.environ["PATH"]
        self.assertEqual(worker.prepare_pm_tools([str(self.product), str(self.root / "absent")]), 0)
        self.assertEqual(os.environ["PATH"], before)
        self.assertFalse((self.root / "absent").exists())

    def test_failure_restores_runtime_selection_and_path(self):
        before = dict(os.environ)
        with self.assertRaises(ValueError):
            worker.prepare_pm_tools(["relative-store"])
        self.assertEqual(dict(os.environ), before)

    def test_internal_uv_launcher_is_exposed_without_other_internal_tools(self):
        uv = self.record(self.payload, "uv")
        self.record(self.payload, "python")
        worker.prepare_pm_tools([str(self.payload)])
        self.assertEqual(os.environ["PATH"].split(os.pathsep)[0], uv)
        self.assertNotIn("PYTHONHOME", os.environ)

    def test_no_roots_leaves_environment_unchanged(self):
        before = dict(os.environ)
        self.assertEqual(worker.prepare_pm_tools([]), 0)
        self.assertEqual(dict(os.environ), before)


if __name__ == "__main__":
    unittest.main()
